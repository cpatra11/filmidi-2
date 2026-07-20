import { requestNativeMedia } from "./nativeMediaBridge";

/** Extracts an AAC/M4A stream from Apple MOV media for browser playback. */
export async function extractMovAudio(file: File): Promise<string | null> {
  if (!file.name.toLowerCase().endsWith(".mov")) return null;
  if (!/Mac/i.test(navigator.platform) && !/Mac OS X/i.test(navigator.userAgent)) return null;

  try {
    const buffer = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
    }
    const result = await requestNativeMedia<{ dataUrl?: string }>("extract-audio", {
      base64Data: btoa(binary),
      sourceExtension: "mov",
      returnDataUrl: true,
    });
    return result?.dataUrl ?? null;
  } catch (error) {
    console.warn("[mov-audio] extraction failed; keeping original source", error);
    return null;
  }
}
