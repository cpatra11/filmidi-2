/**
 * Extract audio track from a video File/Blob into a 16kHz mono WAV URL.
 * This MUST be called when the file is fresh — blob URLs can expire.
 */

export async function extractAudioTrack(src: File | Blob | string): Promise<Blob> {
  let arrayBuffer: ArrayBuffer;
  if (typeof src === "string") {
    const resp = await fetch(src);
    arrayBuffer = await resp.arrayBuffer();
  } else {
    arrayBuffer = await src.arrayBuffer();
  }

  const audioCtx = new AudioContext();
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } catch (e) {
    audioCtx.close();
    throw new Error(`Audio decode failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  audioCtx.close();

  // Convert to 16kHz mono WAV
  const numChannels = 1;
  const targetRate = 16000;
  const srcRate = audioBuffer.sampleRate;
  const srcLen = audioBuffer.length;
  const dstLen = Math.round(srcLen * targetRate / srcRate);
  const srcData = audioBuffer.getChannelData(0);

  // Linear resampling
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

  // Build WAV header
  const dataSize = pcm.length * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const w = (off: number, str: string) => {
    for (let i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i));
  };
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
