import { decodeAudioToMono } from "./webAudio";

export interface DenoiseOptions {
  strength: number;
  enabled: boolean;
}

let rnnoiseInstance: any = null;

async function getRnnoise(): Promise<any> {
  if (!rnnoiseInstance) {
    const { Rnnoise } = await import("@shiguredo/rnnoise-wasm");
    rnnoiseInstance = await Rnnoise.load();
  }
  return rnnoiseInstance;
}

function scaleTo16bitPCM(samples: Float32Array): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = Math.max(-32768, Math.min(32767, samples[i] * 32768));
  }
  return out;
}

function scaleFrom16bitPCM(samples: Float32Array): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = samples[i] / 32768;
  }
  return out;
}

export async function denoiseAudio(
  url: string,
  options: DenoiseOptions = { strength: 0.5, enabled: true }
): Promise<{ samples: Float32Array; sampleRate: number } | null> {
  if (!options.enabled) return null;

  const { samples, sampleRate } = await decodeAudioToMono(url);

  try {
    const rnnoise = await getRnnoise();
    const frameSize = rnnoise.frameSize;
    const state = rnnoise.createDenoiseState();

    const input = scaleTo16bitPCM(samples);
    const output = new Float32Array(samples.length);
    const numFrames = Math.ceil(samples.length / frameSize);
    const mixingRatio = options.strength;

    for (let i = 0; i < numFrames; i++) {
      const start = i * frameSize;
      const frame = input.subarray(start, start + frameSize);

      if (frame.length < frameSize) {
        const padded = new Float32Array(frameSize);
        padded.set(frame);
        state.processFrame(padded);
        output.set(scaleFrom16bitPCM(padded.subarray(0, frame.length)), start);
      } else {
        state.processFrame(frame);
        output.set(scaleFrom16bitPCM(frame), start);
      }
    }

    state.destroy();

    if (mixingRatio < 1.0) {
      for (let i = 0; i < output.length; i++) {
        output[i] = output[i] * mixingRatio + samples[i] * (1 - mixingRatio);
      }
    }

    return { samples: output, sampleRate };
  } catch (err) {
    console.warn("RNNoise denoising failed, falling back to original audio:", err);
    return { samples, sampleRate };
  }
}
