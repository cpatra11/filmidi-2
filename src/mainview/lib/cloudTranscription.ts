/**
 * Cloud transcription via DashScope ASR API.
 * Matches Swift's DirectTranscriptionBackend + CloudTranscription.
 *
 * Supports paraformer-realtime-v2 (default, with diarization).
 * Routes through the Filmidi backend when the user is signed in.
 */

import { useAccountStore } from "@/store/useAccountStore";

export interface TranscriptionWord {
  text: string;
  start: number; // seconds
  end: number;   // seconds
  speaker?: string;
}

export interface TranscriptionSegment {
  text: string;
  start: number;
  end: number;
  speaker?: string;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  words: TranscriptionWord[];
  segments: TranscriptionSegment[];
}

const DASHSCOPE_BASE = "https://dashscope-intl.aliyuncs.com";
const BACKEND_URL = "http://localhost:3000";
const ASR_MODEL = "paraformer-realtime-v2";
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 150; // 5 minutes max

/**
 * Transcribe audio from a URL using cloud ASR.
 * Routes through the Filmidi backend when signed in, otherwise calls DashScope directly.
 */
export async function transcribeAudio(
  audioUrl: string,
  apiKey: string,
  options?: {
    language?: string;
    startSeconds?: number;
    endSeconds?: number;
    diarization?: boolean;
  }
): Promise<TranscriptionResult> {
  // Convert blob URLs to accessible WAV URLs before routing
  let resolvedUrl = audioUrl;
  if (audioUrl.startsWith("blob:")) {
    const { uploadAudioForASR } = await import("@/lib/agentIPC");
    // Extract audio track from video blob (DashScope ASR needs pure audio, not video containers)
    const audioBlob = await extractAudioTrack(audioUrl);
    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(audioBlob);
    });

    // Upload WAV to tempfile.org via Bun IPC → public HTTPS URL for DashScope
    const [header, base64] = dataUrl.split(",");
    resolvedUrl = await uploadAudioForASR(base64, "audio/wav");
  }

  const account = useAccountStore.getState();
  const isBackendUser = account.isSignedIn();

  if (isBackendUser && account.sessionToken) {
    return transcribeViaBackend(resolvedUrl, account.sessionToken, options);
  }

  return transcribeViaDashScope(resolvedUrl, apiKey, options);
}

async function transcribeViaBackend(
  audioUrl: string,
  sessionToken: string,
  options?: {
    language?: string;
    startSeconds?: number;
    endSeconds?: number;
    diarization?: boolean;
  },
): Promise<TranscriptionResult> {
  const submitResp = await fetch(`${BACKEND_URL}/api/v1/transcriptions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({
      fileUrl: audioUrl,
      model: ASR_MODEL,
      diarization: options?.diarization ?? true,
    }),
  });

  if (!submitResp.ok) {
    const err = await submitResp.text();
    throw new Error(`Backend transcription submit failed (${submitResp.status}): ${err}`);
  }

  const submitData = await submitResp.json();
  const taskId: string | undefined = submitData.taskId;
  if (!taskId) throw new Error("No taskId in backend transcription response");

  // Poll for completion
  for (let attempt = 0; attempt < 150; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));

    const pollResp = await fetch(
      `${BACKEND_URL}/api/v1/transcriptions/${taskId}`,
      { headers: { Authorization: `Bearer ${sessionToken}` } },
    );

    if (!pollResp.ok) continue;

    const pollData = await pollResp.json();
    const status: string = pollData.status;

    if (status === "succeeded") {
      return parseTranscriptionResult(pollData.result, options);
    }

    if (status === "failed") {
      throw new Error(`Backend transcription failed: ${JSON.stringify(pollData)}`);
    }
  }

  throw new Error("Backend transcription timed out");
}

async function transcribeViaDashScope(
  audioUrl: string,
  apiKey: string,
  options?: {
    language?: string;
    startSeconds?: number;
    endSeconds?: number;
    diarization?: boolean;
  },
): Promise<TranscriptionResult> {
  const input: Record<string, unknown> = {};

  // Blob URLs should already be resolved to public URLs by transcribeAudio()
  input.file_url = audioUrl;

  if (options?.diarization !== false) {
    input.diarization = { enable: true };
  }

  const submitBody: Record<string, unknown> = {
    model: ASR_MODEL,
    input,
  };

  const submitResp = await fetch(`${DASHSCOPE_BASE}/api/v1/services/asr/transcription/asr-task`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(submitBody),
  });

  if (!submitResp.ok) {
    const err = await submitResp.text();
    throw new Error(`ASR submit failed (${submitResp.status}): ${err}`);
  }

  const submitData = await submitResp.json();
  const taskId = submitData.output?.task_id;
  if (!taskId) throw new Error("No task_id in ASR response");

  // Poll for completion
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const pollResp = await fetch(
      `${DASHSCOPE_BASE}/api/v1/tasks/${taskId}`,
      { headers: { "Authorization": `Bearer ${apiKey}` } }
    );

    if (!pollResp.ok) continue;

    const pollData = await pollResp.json();
    const status = pollData.output?.task_status;

    if (status === "SUCCEEDED") {
      // Download the result JSON
      const resultUrl = pollData.output?.results?.[0]?.transcription_url;
      if (!resultUrl) throw new Error("No transcription_url in result");

      const resultResp = await fetch(resultUrl);
      const resultData = await resultResp.json();
      return parseTranscriptionResult(resultData, options);
    }

    if (status === "FAILED") {
      throw new Error(`ASR task failed: ${JSON.stringify(pollData.output)}`);
    }
    // else: RUNNING, keep polling
  }

  throw new Error("ASR task timed out");
}

function parseTranscriptionResult(
  data: unknown,
  options?: { language?: string; startSeconds?: number; endSeconds?: number }
): TranscriptionResult {
  const result = data as Record<string, unknown>;
  const transcription = result.transcription as Record<string, unknown> | undefined;
  const transcripts = (transcription?.transcripts ?? result.transcripts ?? []) as Array<Record<string, unknown>>;

  const words: TranscriptionWord[] = [];
  const segments: TranscriptionSegment[] = [];

  for (const t of transcripts) {
    const text = (t.text as string) ?? "";
    const start = (t.start_time as number) ?? (t.begin_time as number) ?? (t.start as number) ?? 0;
    const end = (t.end_time as number) ?? (t.end as number) ?? 0;
    const speaker = (t.speaker as string) ?? (t.speaker_id as string) ?? undefined;

    // Parse words from transcript
    const sentenceWords = (t.words ?? []) as Array<Record<string, unknown>>;
    for (const w of sentenceWords) {
      const wText = (w.text as string) ?? "";
      const wStart = (w.start_time as number) ?? (w.begin_time as number) ?? (w.start as number) ?? start;
      const wEnd = (w.end_time as number) ?? (w.end as number) ?? end;
      const wSpeaker = (w.speaker as string) ?? (w.speaker_id as string) ?? speaker;

      // Apply time window filter
      if (options?.startSeconds !== undefined && wEnd < options.startSeconds) continue;
      if (options?.endSeconds !== undefined && wStart > options.endSeconds) continue;

      words.push({
        text: wText,
        start: wStart,
        end: wEnd,
        speaker: wSpeaker,
      });
    }

    // Apply time window to segments
    if (options?.startSeconds !== undefined && end < options.startSeconds) continue;
    if (options?.endSeconds !== undefined && start > options.endSeconds) continue;

    segments.push({ text, start, end, speaker });
  }

  return {
    text: segments.map((s) => s.text).join(" "),
    language: options?.language,
    words,
    segments,
  };
}

/**
 * Extract audio track from a video blob URL into a 16kHz mono WAV blob.
 * DashScope ASR needs pure audio (WAV/MP3), not video containers.
 */
async function extractAudioTrack(blobUrl: string): Promise<Blob> {
  const resp = await fetch(blobUrl);
  const blob = await resp.blob();
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new AudioContext();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  await audioCtx.close();

  const numChannels = 1;
  const targetRate = 16000;
  const srcRate = audioBuffer.sampleRate;
  const srcLen = audioBuffer.length;
  const dstLen = Math.round(srcLen * targetRate / srcRate);
  const srcData = audioBuffer.getChannelData(0);

  // Resample to target rate
  const dstData = new Float32Array(dstLen);
  for (let i = 0; i < dstLen; i++) {
    const idx = i * srcRate / targetRate;
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, srcLen - 1);
    const frac = idx - lo;
    dstData[i] = srcData[lo] * (1 - frac) + srcData[hi] * frac;
  }

  // 16-bit PCM
  const pcm = new Int16Array(dstLen);
  for (let i = 0; i < dstLen; i++) {
    const s = Math.max(-1, Math.min(1, dstData[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }

  // WAV header
  const dataSize = pcm.length * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const w = (off: number, str: string) => { for (let i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i)); };
  w(0, "RIFF");
  v.setUint32(4, 36 + dataSize, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, numChannels, true);
  v.setUint32(24, targetRate, true);
  v.setUint32(28, targetRate * numChannels * 2, true);
  v.setUint16(32, numChannels * 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, dataSize, true);
  new Int16Array(buf, 44).set(pcm);

  return new Blob([buf], { type: "audio/wav" });
}

/**
 * Upload audio blob to a temporary URL for ASR.
 * In web context, we pass the blob URL directly since DashScope accepts URLs.
 */
export function audioBlobToUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}
