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
  const account = useAccountStore.getState();
  const isBackendUser = account.isSignedIn();

  if (isBackendUser && account.sessionToken) {
    return transcribeViaBackend(audioUrl, account.sessionToken, options);
  }

  return transcribeViaDashScope(audioUrl, apiKey, options);
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

  if (audioUrl.startsWith("blob:")) {
    // Blob URLs don't exist outside the renderer — convert to inline base64
    const resp = await fetch(audioUrl);
    const blob = await resp.blob();
    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    input.file_urls = [dataUrl];
  } else {
    input.file_urls = [audioUrl];
  }

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
    const start = (t.start_time as number) ?? (t.start as number) ?? 0;
    const end = (t.end_time as number) ?? (t.end as number) ?? 0;
    const speaker = (t.speaker as string) ?? (t.speaker_id as string) ?? undefined;

    // Parse words from transcript
    const sentenceWords = (t.words ?? []) as Array<Record<string, unknown>>;
    for (const w of sentenceWords) {
      const wText = (w.text as string) ?? "";
      const wStart = (w.start_time as number) ?? (w.start as number) ?? start;
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
 * Upload audio blob to a temporary URL for ASR.
 * In web context, we pass the blob URL directly since DashScope accepts URLs.
 */
export function audioBlobToUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}
