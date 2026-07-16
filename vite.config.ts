import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { mkdirSync, writeFileSync, appendFileSync, createReadStream, existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

const uploadDir = join(process.cwd(), ".uploads");
const logFile = join(process.cwd(), ".play-debug.log");

function uploadPlugin(): Plugin {
  return {
    name: "upload-server",
    configureServer(server) {
      mkdirSync(uploadDir, { recursive: true });

      // Debug logging endpoint for WKWebView (no CDP access)
      server.middlewares.use("/api/log", (req, res) => {
        if (req.method === "POST") {
          const chunks: Buffer[] = [];
          req.on("data", (chunk) => chunks.push(chunk));
          req.on("end", () => {
            const msg = Buffer.concat(chunks).toString();
            const ts = new Date().toISOString().slice(11, 23);
            appendFileSync(logFile, `[${ts}] ${msg}\n`);
            res.setHeader("Content-Type", "text/plain");
            res.end("ok");
          });
        } else {
          // GET ?msg=... for fire-and-forget via Image src
          const url = new URL(req.url || "/", `http://${req.headers.host}`);
          const msg = url.searchParams.get("msg") || "";
          const ts = new Date().toISOString().slice(11, 23);
          appendFileSync(logFile, `[${ts}] ${msg}\n`);
          // Return 1x1 transparent GIF
          res.setHeader("Content-Type", "image/gif");
          res.setHeader("Cache-Control", "no-store");
          res.end(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"));
        }
      });

      server.middlewares.use("/api/upload", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("Method not allowed");
          return;
        }

        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
          const body = Buffer.concat(chunks);
          const ext = (req.headers["x-file-ext"] as string) || "bin";
          const name = `${randomUUID()}.${ext}`;
          const filePath = join(uploadDir, name);
          writeFileSync(filePath, body);
          const url = `http://localhost:5173/api/files/${name}`;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ url }));
        });
        req.on("error", (err) => {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(err) }));
        });
      });

      server.middlewares.use("/api/files/", (req, res) => {
        const fileName = decodeURIComponent(req.url!.replace("/api/files/", ""));
        const filePath = join(uploadDir, fileName);
        if (!existsSync(filePath)) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }
        const ext = fileName.split(".").pop()?.toLowerCase() || "";
        const mimeMap: Record<string, string> = {
          mp4: "video/mp4",
          webm: "video/webm",
          mov: "video/quicktime",
          mkv: "video/x-matroska",
          avi: "video/x-msvideo",
          mp3: "audio/mpeg",
          wav: "audio/wav",
          ogg: "audio/ogg",
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          gif: "image/gif",
        };
        const { statSync } = require("fs");
        const stat = statSync(filePath);
        res.setHeader("Content-Type", mimeMap[ext] || "application/octet-stream");
        res.setHeader("Content-Length", stat.size);
        res.setHeader("Accept-Ranges", "bytes");
        const stream = createReadStream(filePath);
        stream.pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), uploadPlugin()],
  resolve: {
    alias: {
      "@": join(__dirname, "src/mainview"),
    },
  },
  root: "src/mainview",
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  optimizeDeps: {
    include: ["@videoflow/react-video-editor", "@videoflow/core", "@videoflow/renderer-dom"],
  },
});
