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
const ASR_MODEL = "qwen3-asr-flash-filetrans";

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
  // Convert blob URLs to accessible URLs before routing
  let resolvedUrl = audioUrl;
  if (audioUrl.startsWith("blob:")) {
    const { uploadAudioForASR } = await import("@/lib/agentIPC");
    // Upload the blob directly — DashScope ASR accepts video (MP4) and audio files
    const resp = await fetch(audioUrl);
    const blob = await resp.blob();
    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const [_, base64] = dataUrl.split(",");
    resolvedUrl = await uploadAudioForASR(base64, blob.type || "video/mp4");
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
  // Route through Bun IPC to avoid CORS issues
  const { transcribeOnBun } = await import("@/lib/agentIPC");
  const resultJson = await transcribeOnBun(audioUrl, apiKey);
  const resultData = JSON.parse(resultJson) as Record<string, unknown>;
  return parseTranscriptionResult(resultData, options);
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

    // Words may be at transcript level or nested inside sentences (Fun-ASR format)
    let sentenceWords: Array<Record<string, unknown>> = [];
    const topWords = t.words as Array<Record<string, unknown>> | undefined;
    const sentences = t.sentences as Array<Record<string, unknown>> | undefined;
    if (topWords) {
      sentenceWords = topWords;
    } else if (sentences) {
      for (const s of sentences) {
        const sWords = s.words as Array<Record<string, unknown>> | undefined;
        if (sWords) sentenceWords.push(...sWords);
      }
      // If sentences exist but have no words, use sentence as a word
      if (sentenceWords.length === 0) {
        for (const s of sentences) {
          const sText = (s.text as string) ?? "";
          const sStart = (s.begin_time as number) ?? (s.start_time as number) ?? 0;
          const sEnd = (s.end_time as number) ?? 0;
          if (sText) {
            sentenceWords.push({ text: sText, begin_time: sStart, end_time: sEnd });
          }
        }
      }
    }
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
 * Upload audio blob to a temporary URL for ASR.
 * In web context, we pass the blob URL directly since DashScope accepts URLs.
 */
export function audioBlobToUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}
