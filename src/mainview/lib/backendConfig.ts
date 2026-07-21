/** Shared API origin for the desktop app and the local/hosted Filmidi backend. */
export const FILMIDI_BACKEND_URL =
  (import.meta.env.VITE_FILMIDI_BACKEND_URL as string | undefined)?.replace(/\/$/, "") ||
  "https://filmidi-api.filmidi-api.workers.dev";
