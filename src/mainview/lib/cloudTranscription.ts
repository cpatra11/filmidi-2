/** Cloud transcription through Vercel AI Gateway's AI SDK provider. */

import { experimental_transcribe as transcribe } from "ai";
import { logTranscript } from "./transcriptLogger";
import { getSecureApiKey } from "./secureApiKey";
import { createFilmidiGateway, DEFAULT_TRANSCRIPTION_MODEL, gatewayModelProvider } from "./aiGateway";

export interface TranscriptionWord {
  text: string;
  start: number;
  end: number;
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
  model?: string;
  provider?: string;
  warnings?: string[];
}

export interface TranscriptionOptions {
  language?: string;
  startSeconds?: number;
  endSeconds?: number;
  diarization?: boolean;
  model?: string;
}

function splitWords(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

/** Derive usable word timings when a provider returns segments only. */
export function wordsFromSegments(segments: TranscriptionSegment[]): TranscriptionWord[] {
  const words: TranscriptionWord[] = [];
  for (const segment of segments) {
    const parts = splitWords(segment.text);
    if (parts.length === 0) continue;
    const start = Number.isFinite(segment.start) ? segment.start : 0;
    const end = Math.max(start + 0.01, Number.isFinite(segment.end) ? segment.end : start + parts.length * 0.18);
    const step = Math.max(0.01, (end - start) / parts.length);
    parts.forEach((text, index) => {
      words.push({
        text,
        start: start + index * step,
        end: index === parts.length - 1 ? end : start + (index + 1) * step,
        speaker: segment.speaker,
      });
    });
  }
  return words;
}

function wordsFromProviderMetadata(metadata: unknown, provider: string): TranscriptionWord[] {
  const root = metadata as Record<string, any> | undefined;
  const candidates = [
    root?.[provider]?.words,
    root?.[provider]?.wordTimings,
    root?.words,
    root?.wordTimings,
  ];
  const raw = candidates.find(Array.isArray) as Array<Record<string, unknown>> | undefined;
  if (!raw) return [];
  return raw.map((word) => ({
    text: String(word.text ?? word.word ?? "").trim(),
    start: Number(word.start ?? word.startSecond ?? word.start_time ?? 0),
    end: Number(word.end ?? word.endSecond ?? word.end_time ?? word.start ?? 0),
  })).filter((word) => word.text && word.end > word.start);
}

function filterResult(result: TranscriptionResult, options?: TranscriptionOptions): TranscriptionResult {
  const start = options?.startSeconds;
  const end = options?.endSeconds;
  if (start === undefined && end === undefined) return result;
  const words = result.words.filter((word) => (end === undefined || word.start <= end) && (start === undefined || word.end >= start));
  const segments = result.segments.filter((segment) => (end === undefined || segment.start <= end) && (start === undefined || segment.end >= start));
  return { ...result, words, segments, text: segments.map((segment) => segment.text).join(" ").trim() };
}

async function readSource(audioUrl: string): Promise<{ bytes: Uint8Array; mediaType: string }> {
  const response = await fetch(audioUrl);
  if (!response.ok) throw new Error(`Could not read local audio source (${response.status})`);
  const mediaType = response.headers.get("content-type") || "audio/wav";
  return { bytes: new Uint8Array(await response.arrayBuffer()), mediaType };
}

export async function transcribeAudio(
  audioUrl: string,
  apiKey: string,
  options?: TranscriptionOptions,
): Promise<TranscriptionResult> {
  const effectiveApiKey = apiKey?.trim() || (await getSecureApiKey()) || "";
  if (!effectiveApiKey) throw new Error("vercel_api_key_required");

  const model = options?.model || DEFAULT_TRANSCRIPTION_MODEL;
  logTranscript("info", "transcribeAudio", "request", {
    source: audioUrl.slice(0, 120),
    model,
    provider: gatewayModelProvider(model),
    language: options?.language ?? null,
    diarization: options?.diarization === true,
  });

  let sourceUrl = audioUrl;
  let sourceBlob: Blob | null = null;
  let needsUpload = audioUrl.startsWith("blob:");
  try {
    const parsed = new URL(audioUrl);
    needsUpload ||= parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  } catch {
    // Non-URL paths are passed through to the normal fetch error below.
  }
  if (needsUpload) {
    const response = await fetch(audioUrl);
    if (!response.ok) throw new Error(`Could not read local audio source (${response.status})`);
    sourceBlob = await response.blob();
    sourceUrl = "local-binary-source";
    logTranscript("info", "transcribeAudio", "loaded local source", {
      source: audioUrl.slice(0, 100),
      bytes: sourceBlob.size,
      mediaType: sourceBlob.type || "audio/wav",
    });
  }

  const source = sourceBlob
    ? { bytes: new Uint8Array(await sourceBlob.arrayBuffer()), mediaType: sourceBlob.type || "audio/wav" }
    : await readSource(sourceUrl);
  const gateway = createFilmidiGateway(effectiveApiKey);

  try {
    const result = await transcribe({
      model: gateway.transcription(model),
      audio: source.bytes,
      providerOptions: options?.language ? { [gatewayModelProvider(model)]: { language: options.language } } : undefined,
    });
    const segments: TranscriptionSegment[] = (result.segments ?? []).map((segment: any) => ({
      text: String(segment.text ?? "").trim(),
      start: Number(segment.startSecond ?? segment.start ?? 0),
      end: Number(segment.endSecond ?? segment.end ?? segment.startSecond ?? 0),
    })).filter((segment) => segment.text && segment.end >= segment.start);
    const words = wordsFromProviderMetadata((result as any).providerMetadata, gatewayModelProvider(model));
    const timedWords = words.length > 0 ? words : wordsFromSegments(segments);
    const normalized: TranscriptionResult = {
      text: String(result.text ?? segments.map((segment) => segment.text).join(" ")).trim(),
      language: result.language,
      words: timedWords,
      segments,
      model,
      provider: gatewayModelProvider(model),
      warnings: (result.warnings ?? []).map((warning: any) => String(warning?.message ?? warning)),
    };
    const filtered = filterResult(normalized, options);
    logTranscript("info", "transcribeAudio", "success", {
      model,
      provider: normalized.provider,
      wordCount: filtered.words.length,
      segmentCount: filtered.segments.length,
      source: sourceUrl,
    });
    return filtered;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logTranscript("error", "transcribeAudio", "gateway failed", { model, provider: gatewayModelProvider(model), error: message });
    throw new Error(`Vercel transcription failed for ${model} via AI SDK Gateway: ${message}`);
  }
}

export function audioBlobToUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}
