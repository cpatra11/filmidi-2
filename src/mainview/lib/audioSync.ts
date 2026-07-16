/**
 * Audio synchronization via waveform cross-correlation.
 * Matches Swift's AudioSyncCorrelator using Pearson correlation.
 */

import { decodeAudioToMono, computeEnvelope, findBestLag } from "./webAudio";

export interface SyncResult {
  clipId: string;
  offsetFrames: number;
  confidence: number;
  method: string;
}

const HOP_SECONDS = 0.01; // 10ms envelope hops (matches Swift)
const DEFAULT_SEARCH_WINDOW_SECONDS = 30;
const DEFAULT_MIN_CONFIDENCE = 0.5;
const MIN_SPEED = 0.0001;

/**
 * Synchronize a target clip to a reference clip via envelope cross-correlation.
 * Matches Swift's AudioSyncCorrelator.correlate().
 */
export async function syncAudioClips(
  referenceUrl: string,
  targetUrl: string,
  targetClipId: string,
  options?: {
    searchWindowSeconds?: number;
    minConfidence?: number;
    referenceStartFrame?: number;
    referenceSpeed?: number;
    targetStartFrame?: number;
    fps?: number;
  }
): Promise<SyncResult | null> {
  const fps = options?.fps ?? 30;
  const searchWindow = options?.searchWindowSeconds ?? DEFAULT_SEARCH_WINDOW_SECONDS;
  const minConfidence = options?.minConfidence ?? DEFAULT_MIN_CONFIDENCE;

  // Decode both audio sources
  const [refAudio, targetAudio] = await Promise.all([
    decodeAudioToMono(referenceUrl),
    decodeAudioToMono(targetUrl),
  ]);

  // Compute envelopes
  const refEnvelope = computeEnvelope(refAudio.samples, refAudio.sampleRate);
  const targetEnvelope = computeEnvelope(targetAudio.samples, targetAudio.sampleRate);

  // Max lag in hops
  const maxLagHops = Math.floor(searchWindow / HOP_SECONDS);

  // Find best lag
  const { lagHops, confidence } = findBestLag(refEnvelope, targetEnvelope, maxLagHops);

  if (confidence < minConfidence) {
    return null;
  }

  // Convert lag to frame offset
  const lagSeconds = lagHops * HOP_SECONDS;
  const speed = options?.referenceSpeed ?? 1.0;
  const lagFrames = Math.round((lagSeconds * fps) / Math.max(speed, MIN_SPEED));
  const refStartFrame = options?.referenceStartFrame ?? 0;
  const targetStartFrame = options?.targetStartFrame ?? 0;
  const rawStart = refStartFrame + lagFrames;
  const offset = rawStart - targetStartFrame;

  return {
    clipId: targetClipId,
    offsetFrames: offset,
    confidence: Math.round(confidence * 1000) / 1000,
    method: "audio",
  };
}
