import { requestNativeMedia } from "./nativeMediaBridge";

function isMov(file: File): boolean {
  return file.name.toLowerCase().endsWith(".mov") || file.type === "video/quicktime";
}

/**
 * Produce a browser/WebAudio-safe copy of a QuickTime file. VideoFlow's
 * mixer decodes audio through Web Audio, which is much more reliable with
 * MP4/AAC than with camera-specific MOV containers.
 */
export async function normalizeMovForPlayback(file: File): Promise<string | null> {
  if (!isMov(file)) return null;
  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
    }
    const result = await requestNativeMedia<{ dataUrl?: string }>("normalize-media", {
      base64Data: btoa(binary),
      mimeType: file.type || "video/quicktime",
      fileName: file.name,
    });
    return result?.dataUrl ?? null;
  } catch (error) {
    console.warn("[mov-audio] MOV normalization failed; retaining source", error);
    return null;
  }
}

/** Extracts an AAC/M4A stream from Apple MOV media for browser playback. */
export async function extractMovAudio(file: File): Promise<string | null> {
  if (!isMov(file)) return null;
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
