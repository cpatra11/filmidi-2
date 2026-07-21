import { existsSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";

export const FILMIDI_MEDIA_PORT = 19791;

function safeName(value: string): string {
  return basename(value).replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function startMediaServer(root: string): { baseUrl: string; root: string } {
  mkdirSync(root, { recursive: true });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: FILMIDI_MEDIA_PORT,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/health") return Response.json({ status: "ok", service: "filmidi-media" });
      if (!url.pathname.startsWith("/media/")) return new Response("Not found", { status: 404 });
      const fileName = safeName(decodeURIComponent(url.pathname.slice("/media/".length)));
      const path = join(root, fileName);
      if (!existsSync(path)) return new Response("Not found", { status: 404 });
      const file = Bun.file(path);
      return new Response(file, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=31536000, immutable",
          "Accept-Ranges": "bytes",
          "Content-Type": file.type || "application/octet-stream",
        },
      });
    },
  });
  return { baseUrl: `http://127.0.0.1:${server.port}`, root };
}
