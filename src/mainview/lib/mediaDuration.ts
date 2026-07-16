/**
 * Detect the actual duration of a media file (video/audio) by briefly loading
 * it into a temporary element. Falls back to a default if detection fails.
 *
 * Images return `imageDuration` (default 5s) since they have no intrinsic length.
 */
export function getMediaDuration(
  file: File,
  type: "video" | "audio" | "image",
  imageDuration = 5,
): Promise<number> {
  if (type === "image") return Promise.resolve(imageDuration);

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

    const onMeta = () => {
      const dur = el.duration;
      cleanup();
      resolve(Number.isFinite(dur) && dur > 0 ? dur : 10);
    };

    const onErr = () => {
      cleanup();
      resolve(10);
    };

    el.addEventListener("loadedmetadata", onMeta, { once: true });
    el.addEventListener("error", onErr, { once: true });
    el.preload = "metadata";
    el.src = url;
  });
}
