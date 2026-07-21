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
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
            "Access-Control-Allow-Headers": "Range,Content-Type",
            "Access-Control-Expose-Headers": "Accept-Ranges,Content-Length,Content-Range",
          },
        });
      }
      if (url.pathname === "/health") return Response.json({ status: "ok", service: "filmidi-media" });
      if (!url.pathname.startsWith("/media/")) return new Response("Not found", { status: 404 });
      const fileName = safeName(decodeURIComponent(url.pathname.slice("/media/".length)));
      const path = join(root, fileName);
      if (!existsSync(path)) return new Response("Not found", { status: 404 });
      const file = Bun.file(path);
      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "Accept-Ranges,Content-Length,Content-Range",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Accept-Ranges": "bytes",
        "Content-Type": file.type || "application/octet-stream",
      };
      if (request.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { ...corsHeaders, "Content-Length": String(file.size) },
        });
      }
      const range = request.headers.get("range");
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
        if (!match) return new Response("Invalid range", { status: 416, headers: corsHeaders });
        let start = match[1] ? Number(match[1]) : Math.max(0, file.size - Number(match[2] || 0));
        let end = match[2] ? Number(match[2]) : file.size - 1;
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= file.size) {
          return new Response(null, { status: 416, headers: { ...corsHeaders, "Content-Range": `bytes */${file.size}` } });
        }
        end = Math.min(end, file.size - 1);
        if (end < start) return new Response(null, { status: 416, headers: { ...corsHeaders, "Content-Range": `bytes */${file.size}` } });
        return new Response(file.slice(start, end + 1), {
          status: 206,
          headers: {
            ...corsHeaders,
            "Content-Length": String(end - start + 1),
            "Content-Range": `bytes ${start}-${end}/${file.size}`,
          },
        });
      }
      return new Response(file, {
        headers: {
          ...corsHeaders,
          "Content-Length": String(file.size),
        },
      });
    },
  });
  return { baseUrl: `http://127.0.0.1:${server.port}`, root };
}
