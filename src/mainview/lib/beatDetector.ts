/**
 * Beat detection via onset energy analysis.
 * Matches Swift's BeatDetector (Beat This CoreML) using Web Audio API onset detection.
 *
 * The Swift app uses a CoreML model ("Beat This") for precise beat detection.
 * This web implementation uses energy-based onset detection as an approximation.
 * For production, a WASM-compiled beat detection model could be substituted.
 */

import { decodeAudioToMono, computeEnvelope } from "./webAudio";
import { requestNativeMedia } from "./nativeMediaBridge";

export interface BeatAnalysis {
  bpm: number;
  beats: number[];      // seconds in source media
  downbeats: number[];  // every 4th beat
}

const ONSET_THRESHOLD = 0.3;  // energy increase threshold
const MIN_BEAT_INTERVAL = 0.2; // minimum seconds between beats (300 BPM max)
const MAX_BEAT_INTERVAL = 2.0; // maximum seconds between beats (30 BPM min)

/**
 * Detect beats in an audio file using onset energy analysis.
 * Matches Swift's BeatDetector.predictLogits() + pickPeaks() + estimateBPM().
 */
export async function detectBeats(
  url: string,
  startSeconds?: number,
  endSeconds?: number
): Promise<BeatAnalysis> {
  const nativeResult = await requestNativeMedia<BeatAnalysis>("detect-beats", {
    url,
    startSeconds,
    endSeconds,
  });
  if (nativeResult?.beats) {
    return nativeResult;
  }

  const { samples, sampleRate } = await decodeAudioToMono(url);

  // Trim to window
  let trimmed = samples;
  if (startSeconds !== undefined || endSeconds !== undefined) {
    const start = Math.floor((startSeconds ?? 0) * sampleRate);
    const end = Math.floor((endSeconds ?? samples.length / sampleRate) * sampleRate);
    trimmed = samples.slice(Math.max(0, start), Math.min(samples.length, end));
  }

  // Compute RMS envelope
  const envelope = computeEnvelope(trimmed, sampleRate);

  // Onset detection: find points where energy increases sharply
  const beats: number[] = [];
  const hopSeconds = 0.01; // 10ms hops
  const minHopsBetween = Math.floor(MIN_BEAT_INTERVAL / hopSeconds);
  let lastBeatHop = -minHopsBetween;

  // Compute energy derivative
  const derivative = new Float32Array(envelope.length);
  for (let i = 1; i < envelope.length; i++) {
    derivative[i] = envelope[i] - envelope[i - 1];
  }

  // Adaptive threshold based on local energy
  const windowSize = Math.floor(0.5 / hopSeconds); // 500ms window

  for (let i = windowSize; i < envelope.length - 1; i++) {
    // Local mean energy
    let localSum = 0;
    for (let j = i - windowSize; j < i; j++) {
      localSum += envelope[j];
    }
    const localMean = localSum / windowSize;

    // Onset: energy increase above threshold AND above local mean
    const energyIncrease = derivative[i];
    const relativeIncrease = localMean > 0 ? energyIncrease / localMean : 0;

    if (
      energyIncrease > 0 &&
      relativeIncrease > ONSET_THRESHOLD &&
      envelope[i] > localMean * 0.5 &&
      (i - lastBeatHop) >= minHopsBetween
    ) {
      const time = i * hopSeconds + (startSeconds ?? 0);
      beats.push(time);
      lastBeatHop = i;
    }
  }

  // Estimate BPM from inter-beat intervals
  const bpm = estimateBPM(beats);

  // Downbeats: every 4th beat
  const downbeats = beats.filter((_, i) => i % 4 === 0);

  return { bpm, beats, downbeats };
}

/**
 * Estimate BPM from beat timestamps.
 * Matches Swift's BeatDetector.estimateBPM().
 */
function estimateBPM(beats: number[]): number {
  if (beats.length <= 2) return 0;

  // Compute inter-beat intervals
  const intervals: number[] = [];
  for (let i = 1; i < beats.length; i++) {
    intervals.push(beats[i] - beats[i - 1]);
  }

  // Sort and pick median
  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];

  if (median <= 0) return 0;

  const bpm = 60.0 / median;

  // Clamp to reasonable range
  if (bpm < 30 || bpm > 300) return 0;

  return Math.round(bpm * 10) / 10;
}
