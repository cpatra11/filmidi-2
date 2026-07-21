/**
 * Cloud transcription through Vercel AI Gateway.
 */

import { logTranscript } from "./transcriptLogger";
import { getNativeMediaBackend, requestNativeMedia } from "./nativeMediaBridge";
import { getSecureApiKey } from "./secureApiKey";

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

const ASR_MODEL = "xai/grok-stt";

/**
 * Transcribe audio from a URL using Vercel AI Gateway.
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
  logTranscript("info", "transcribeAudio", "request", {
    url: audioUrl.slice(0, 120),
    hasVercelKey: !!(apiKey?.trim() || await getSecureApiKey()),
    options,
  });

  // Cloud transcription cannot fetch the editor's loopback media server. Upload local
  // media-server files as multipart bytes directly to Vercel.
  let resolvedUrl = audioUrl;
  let localBlob: Blob | null = null;
  let needsUpload = audioUrl.startsWith("blob:");
  try {
    const parsed = new URL(audioUrl);
    needsUpload ||= parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  } catch {
    // File paths and custom app URLs are handled by the native fallback.
  }
  if (needsUpload) {
    const resp = await fetch(audioUrl);
    if (!resp.ok) throw new Error(`Could not read local audio source (${resp.status})`);
    const blob = await resp.blob();
    localBlob = blob;
    resolvedUrl = "local-multipart-source";
    logTranscript("info", "transcribeAudio", "uploaded blob for ASR", {
      source: audioUrl.slice(0, 80),
      resolvedUrl: resolvedUrl.slice(0, 120),
      mimeType: blob.type || "video/mp4",
      uploadedLocalSource: true,
    });
  }

  const effectiveApiKey = apiKey?.trim() || (await getSecureApiKey()) || "";
  if (!effectiveApiKey) throw new Error("vercel_api_key_required");
  logTranscript("info", "transcribeAudio", "route", { mode: "vercel", resolvedUrl: resolvedUrl.slice(0, 120) });
  return transcribeViaVercel(localBlob ?? resolvedUrl, effectiveApiKey, options);
}

async function transcribeViaVercel(
  audioSource: string | Blob,
  apiKey: string,
  options?: {
    language?: string;
    startSeconds?: number;
    endSeconds?: number;
    diarization?: boolean;
  },
): Promise<TranscriptionResult> {
  const sourceBlob = audioSource instanceof Blob ? audioSource : await (async () => {
    const sourceResp = await fetch(audioSource);
    if (!sourceResp.ok) throw new Error(`Could not read audio source (${sourceResp.status})`);
    return sourceResp.blob();
  })();
  const form = new FormData();
  form.append("file", await sourceBlob, "filmidi-transcription-media");
  form.append("model", ASR_MODEL);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");

  const response = await fetch("https://ai-gateway.vercel.sh/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!response.ok) throw new Error(`Vercel transcription failed (${response.status}): ${await response.text()}`);

  const data = await response.json() as any;
  const words = (data.words ?? []).map((word: any) => ({
    text: String(word.word ?? word.text ?? ""),
    start: Number(word.start ?? 0),
    end: Number(word.end ?? word.start ?? 0),
  }));
  const segments = (data.segments ?? []).map((segment: any) => ({
    text: String(segment.text ?? ""),
    start: Number(segment.start ?? 0),
    end: Number(segment.end ?? segment.start ?? 0),
  }));
  return { text: String(data.text ?? segments.map((segment: TranscriptionSegment) => segment.text).join(" ")), language: data.language, words, segments };
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
    // ASR returns timestamps in milliseconds — convert to seconds
    const start = ((t.start_time as number) ?? (t.begin_time as number) ?? (t.start as number) ?? 0) / 1000;
    const end = ((t.end_time as number) ?? (t.end as number) ?? 0) / 1000;
    const speaker = (t.speaker as string) ?? (t.speaker_id as string) ?? undefined;

    // Words may be at transcript level or nested inside sentence segments.
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
      if (sentenceWords.length === 0) {
        for (const s of sentences) {
          const sText = (s.text as string) ?? "";
          const sStart = ((s.begin_time as number) ?? (s.start_time as number) ?? 0) / 1000;
          const sEnd = ((s.end_time as number) ?? 0) / 1000;
          if (sText) {
            sentenceWords.push({ text: sText, begin_time: sStart, end_time: sEnd });
          }
        }
      }
    }
    const segmentWords = sentenceWords.length > 0 ? sentenceWords : (text
      ? [{ text, begin_time: start * 1000, end_time: end * 1000 }]
      : []);
    for (const w of segmentWords) {
      const wText = (w.text as string) ?? "";
      // Convert milliseconds to seconds
      const wStart = ((w.start_time as number) ?? (w.begin_time as number) ?? (w.start as number) ?? start * 1000) / 1000;
      const wEnd = ((w.end_time as number) ?? (w.end as number) ?? end * 1000) / 1000;
      const wSpeaker = (w.speaker as string) ?? (w.speaker_id as string) ?? speaker;

      if (options?.startSeconds !== undefined && wEnd < options.startSeconds) continue;
      if (options?.endSeconds !== undefined && wStart > options.endSeconds) continue;

      words.push({ text: wText, start: wStart, end: wEnd, speaker: wSpeaker });
    }

    if (options?.startSeconds !== undefined && end < options.startSeconds) continue;
    if (options?.endSeconds !== undefined && start > options.endSeconds) continue;

    segments.push({ text, start, end, speaker });
  }

  logTranscript("debug", "transcribeAudio", "parsed transcript payload", {
    transcriptCount: transcripts.length,
    wordCount: words.length,
    segmentCount: segments.length,
    language: options?.language ?? null,
  });

  return {
    text: segments.map((s) => s.text).join(" "),
    language: options?.language,
    words,
    segments,
  };
}
/**
 * Upload audio blob to a temporary URL for ASR.
 * In web context, return a temporary local URL for native media handling.
 */
export function audioBlobToUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}
