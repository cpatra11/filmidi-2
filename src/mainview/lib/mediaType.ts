export type ImportedMediaType = "video" | "audio" | "image";

const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|webm|avi|mkv|3gp|mts|m2ts|ts)$/i;
const AUDIO_EXTENSIONS = /\.(mp3|wav|m4a|aac|ogg|flac|aiff|aif|caf)$/i;

/** Finder and drag-and-drop do not always provide a useful MIME type. */
export function getImportedMediaType(file: Pick<File, "name" | "type">): ImportedMediaType {
  const mime = String(file.type || "").toLowerCase();
  const name = String(file.name || "");
  if (mime.startsWith("video/") || VIDEO_EXTENSIONS.test(name)) return "video";
  if (mime.startsWith("audio/") || AUDIO_EXTENSIONS.test(name)) return "audio";
  return "image";
}
