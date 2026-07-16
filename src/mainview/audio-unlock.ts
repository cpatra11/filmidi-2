/**
 * WebKit audio unlock for Electrobun (WKWebView).
 *
 * Problem: WebKit blocks HTMLAudioElement.play() unless called directly
 * from a user gesture handler. VideoFlow's DomRenderer calls play() after
 * async renderAudio() — by then the gesture context has expired.
 *
 * Solution:
 * 1. Create a global AudioContext during user gesture (persists unlock)
 * 2. Play a silent audio element to "warm up" the audio subsystem
 * 3. Expose the context globally so DomRenderer patches can use it
 */

let audioCtx: AudioContext | null = null;

function unlockAudio() {
  if (audioCtx) {
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    return;
  }

  try {
    audioCtx = new AudioContext();
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    // Expose globally so patched DomRenderer can access it
    (window as any).__vfAudioCtx = audioCtx;
    console.log("[audio-unlock] AudioContext created and unlocked, state:", audioCtx.state);
  } catch {
    console.warn("[audio-unlock] AudioContext not available");
  }

  // Warm up the audio subsystem with a silent element
  // This tricks WebKit into allowing subsequent play() calls
  try {
    const silent = new Audio();
    silent.volume = 0;
    // Create a tiny silent WAV (0.1s of silence)
    const ctx = new OfflineAudioContext(1, 4410, 44100);
    const buffer = ctx.createBuffer(1, 4410, 44100);
    // Leave buffer silent (zeros)
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();
    ctx.startRendering().then((rendered) => {
      const wav = audioBufferToWavBlob(rendered);
      silent.src = URL.createObjectURL(wav);
      silent.play().then(() => {
        console.log("[audio-unlock] Silent audio warmup succeeded");
        URL.revokeObjectURL(silent.src);
      }).catch(() => {});
    }).catch(() => {});
  } catch {
    // Non-fatal
  }

  document.removeEventListener("click", unlockAudio);
  document.removeEventListener("keydown", unlockAudio);
  document.removeEventListener("pointerdown", unlockAudio);
}

/** Convert AudioBuffer to a WAV Blob (minimal implementation). */
function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  const samples = buffer.length;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = samples * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const ab = new ArrayBuffer(totalSize);
  const view = new DataView(ab);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, totalSize - 8, true);
  writeString(view, 8, "WAVE");

  // fmt chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);

  // data chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // Interleave and write samples
  const channels: Float32Array[] = [];
  for (let i = 0; i < numChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  let offset = 44;
  for (let i = 0; i < samples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([ab], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// Register listeners to unlock on first interaction
document.addEventListener("click", unlockAudio, { capture: true });
document.addEventListener("keydown", unlockAudio, { capture: true });
document.addEventListener("pointerdown", unlockAudio, { capture: true });

export {};
