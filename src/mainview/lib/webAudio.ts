/**
 * Web Audio API utilities for Phase 8-9 tools.
 * Equivalent to Swift's AudioTrackReader, AudioEnvelopeExtractor, etc.
 */

const SAMPLE_RATE = 16_000;
const ENVELOPE_HOP_SECONDS = 0.01; // 10ms (matches Swift)
const ENVELOPE_HOP_SIZE = SAMPLE_RATE * ENVELOPE_HOP_SECONDS; // 160 samples

/** Decode audio from a URL to mono Float32 PCM at the given sample rate. */
export async function decodeAudioToMono(
  url: string,
  targetSampleRate: number = SAMPLE_RATE
): Promise<{ samples: Float32Array; sampleRate: number; duration: number }> {
  const ctx = new OfflineAudioContext(1, 1, targetSampleRate);
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

  // Resample to target rate if needed
  if (audioBuffer.sampleRate === targetSampleRate && audioBuffer.numberOfChannels === 1) {
    return {
      samples: audioBuffer.getChannelData(0),
      sampleRate: targetSampleRate,
      duration: audioBuffer.duration,
    };
  }

  // Resample via OfflineAudioContext
  const duration = audioBuffer.duration;
  const length = Math.ceil(duration * targetSampleRate);
  const resampleCtx = new OfflineAudioContext(1, length, targetSampleRate);
  const source = resampleCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(resampleCtx.destination);
  source.start(0);
  const rendered = await resampleCtx.startRendering();
  return {
    samples: rendered.getChannelData(0),
    sampleRate: targetSampleRate,
    duration,
  };
}

/** Encode mono PCM samples into a standard 16-bit WAV blob. */
export function encodeMonoWavBlob(samples: Float32Array, sampleRate: number = SAMPLE_RATE): Blob {
  const numChannels = 1;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = samples.length * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const ab = new ArrayBuffer(totalSize);
  const view = new DataView(ab);

  writeString(view, 0, "RIFF");
  view.setUint32(4, totalSize - 8, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return new Blob([ab], { type: "audio/wav" });
}

/** Decode an audio/video blob and normalize it to 16kHz mono WAV. */
export async function transcodeBlobToWavBlob(blob: Blob): Promise<Blob> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const { samples, sampleRate } = await decodeAudioToMono(objectUrl, SAMPLE_RATE);
    return encodeMonoWavBlob(samples, sampleRate);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Compute RMS amplitude envelope at 10ms hops. Matches Swift's AudioEnvelopeExtractor. */
export function computeEnvelope(samples: Float32Array, sampleRate: number = SAMPLE_RATE): Float32Array {
  const hopSize = Math.max(1, Math.round(sampleRate * ENVELOPE_HOP_SECONDS));
  const numHops = Math.floor(samples.length / hopSize);
  const envelope = new Float32Array(numHops);

  for (let i = 0; i < numHops; i++) {
    let sumSquares = 0;
    const start = i * hopSize;
    const end = Math.min(start + hopSize, samples.length);
    const count = end - start;
    for (let j = start; j < end; j++) {
      sumSquares += samples[j] * samples[j];
    }
    envelope[i] = Math.sqrt(sumSquares / count);
  }

  return envelope;
}

/** Compute peak waveform envelope for visualization. Matches Swift's WaveformExtractor. */
export function computeWaveformPeaks(
  samples: Float32Array,
  samplesPerSecond: number = 200,
  sampleRate: number = SAMPLE_RATE
): Float32Array {
  const hopSize = Math.max(1, Math.round(sampleRate / samplesPerSecond));
  const numHops = Math.floor(samples.length / hopSize);
  const peaks = new Float32Array(numHops);
  const noiseFloorDb = -50;

  for (let i = 0; i < numHops; i++) {
    let maxMag = 0;
    const start = i * hopSize;
    const end = Math.min(start + hopSize, samples.length);
    for (let j = start; j < end; j++) {
      const mag = Math.abs(samples[j]);
      if (mag > maxMag) maxMag = mag;
    }
    if (maxMag === 0) {
      peaks[i] = 1.0; // silence = top of waveform display
    } else {
      const db = 20 * Math.log10(maxMag);
      const clampedDb = Math.max(noiseFloorDb, Math.min(0, db));
      peaks[i] = clampedDb / noiseFloorDb;
    }
  }

  return peaks;
}

/** Pearson cross-correlation between two arrays at a given lag. */
export function pearsonCorrelation(
  x: Float32Array | number[],
  y: Float32Array | number[],
  lag: number
): number {
  const xArr = x instanceof Float32Array ? x : new Float32Array(x);
  const yArr = y instanceof Float32Array ? y : new Float32Array(y);

  const iStart = Math.max(0, -lag);
  const iEnd = Math.min(yArr.length, xArr.length - lag);
  const n = iEnd - iStart;
  if (n < 16) return 0;

  let sx = 0, sxx = 0, sy = 0, syy = 0, sxy = 0;
  for (let i = iStart; i < iEnd; i++) {
    const xi = xArr[i];
    const yi = yArr[i + lag];
    sx += xi;
    sxx += xi * xi;
    sy += yi;
    syy += yi * yi;
    sxy += xi * yi;
  }

  const cov = sxy - (sx * sy) / n;
  const vx = sxx - (sx * sx) / n;
  const vy = syy - (sy * sy) / n;
  const denom = Math.sqrt(vx * vy);
  if (denom === 0) return 0;
  return Math.max(0, cov / denom);
}

/** Find the best lag between two envelopes via Pearson correlation. */
export function findBestLag(
  reference: Float32Array,
  target: Float32Array,
  maxLagHops: number,
  centerLagHops?: number
): { lagHops: number; confidence: number } {
  let bestLag = 0;
  let bestScore = 0;

  const searchStart = centerLagHops !== undefined
    ? Math.max(-maxLagHops, centerLagHops - Math.floor(maxLagHops / 4))
    : -maxLagHops;
  const searchEnd = centerLagHops !== undefined
    ? Math.min(maxLagHops, centerLagHops + Math.floor(maxLagHops / 4))
    : maxLagHops;

  for (let lag = searchStart; lag <= searchEnd; lag++) {
    const score = pearsonCorrelation(reference, target, lag);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  return { lagHops: bestLag, confidence: bestScore };
}

/** LumaGrid 8×8 for visual deduplication. Matches Swift's LumaGrid. */
export function computeLumaGrid(canvas: HTMLCanvasElement | OffscreenCanvas): Float32Array {
  const cells = 8;
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = cells;
  tempCanvas.height = cells;
  const ctx = tempCanvas.getContext("2d")!;
  ctx.drawImage(canvas as CanvasImageSource, 0, 0, cells, cells);
  const data = ctx.getImageData(0, 0, cells, cells).data;
  const grid = new Float32Array(cells * cells);
  for (let i = 0; i < cells * cells; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    grid[i] = r * 0.299 + g * 0.587 + b * 0.114;
  }
  return grid;
}

/** Mean absolute difference between two luma grids. */
export function lumaGridDiff(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += Math.abs(a[i] - b[i]);
  }
  return sum / a.length;
}

/**
 * Sample video frames at evenly spaced intervals.
 * Returns canvas elements with the sampled frames.
 */
export async function sampleVideoFrames(
  url: string,
  maxFrames: number = 6,
  startSeconds?: number,
  endSeconds?: number
): Promise<{ frames: HTMLCanvasElement[]; timestamps: number[] }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    video.muted = true;

    video.onloadedmetadata = () => {
      const duration = endSeconds ?? video.duration;
      const start = startSeconds ?? 0;
      const span = duration - start;
      if (span <= 0 || !isFinite(span)) {
        reject(new Error("Invalid time range"));
        return;
      }

      const frames: HTMLCanvasElement[] = [];
      const timestamps: number[] = [];
      let index = 0;

      const sampleFrame = () => {
        if (index >= maxFrames) {
          video.remove();
          resolve({ frames, timestamps });
          return;
        }
        const time = start + (span * (index + 0.5)) / maxFrames;
        timestamps.push(time);
        video.currentTime = time;
      };

      video.onseeked = () => {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(video, 0, 0);
        frames.push(canvas);
        index++;
        sampleFrame();
      };

      sampleFrame();
    };

    video.onerror = () => {
      video.remove();
      reject(new Error(`Failed to load video: ${url}`));
    };

    video.src = url;
  });
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/** Extract audio track from a video element for analysis. */
export async function extractAudioFromVideo(url: string): Promise<Float32Array> {
  const { samples } = await decodeAudioToMono(url, SAMPLE_RATE);
  return samples;
}
