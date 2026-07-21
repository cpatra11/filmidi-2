/**
 * Detect the actual duration of a media file (video/audio) by briefly loading
 * it into a temporary element. On desktop, probe the original bytes first so
 * long MOV/MP4 files do not collapse to the old 10-second fallback.
 *
 * Images return `imageDuration` (default 5s) since they have no intrinsic length.
 */
export function getMediaDuration(
  file: File,
  type: "video" | "audio" | "image",
  imageDuration = 5,
): Promise<number> {
  if (type === "image") return Promise.resolve(imageDuration);

  const nativeProbe = (async () => {
    try {
      const { requestNativeMedia } = await import("./nativeMediaBridge");
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
      }
      const result = await requestNativeMedia<{ duration?: number }>("probe-media", {
        base64Data: btoa(binary),
        mimeType: file.type,
        fileName: file.name,
      });
      return result?.duration && Number.isFinite(result.duration) && result.duration > 0
        ? result.duration
        : null;
    } catch {
      return null;
    }
  })();

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = type === "video"
      ? document.createElement("video")
      : document.createElement("audio");

    const cleanup = () => {
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("error", onErr);
      el.removeAttribute("src");
      el.load?.();
      URL.revokeObjectURL(url);
    };

    const onMeta = async () => {
      const dur = el.duration;
      cleanup();
      resolve(Number.isFinite(dur) && dur > 0 ? dur : (await nativeProbe) ?? 10);
    };

    const onErr = () => {
      cleanup();
      void nativeProbe.then((duration) => resolve(duration ?? 10));
    };

    el.addEventListener("loadedmetadata", onMeta, { once: true });
    el.addEventListener("error", onErr, { once: true });
    el.preload = "metadata";
    el.src = url;
  });
}
