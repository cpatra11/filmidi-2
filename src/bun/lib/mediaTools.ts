import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";

type ProcessResult = { code: number | null; stdout: string; stderr: string };

function run(command: string, args: string[], timeoutMs = 300_000): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function findCommand(name: string): Promise<string | null> {
  const candidates = [
    process.env[`FILMIDI_${name.toUpperCase()}_PATH`] ?? "",
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
  ].filter(Boolean);
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  try {
    const result = await run("which", [name], 5_000);
    return result.code === 0 ? result.stdout.trim() || null : null;
  } catch {
    return null;
  }
}

export async function probeMedia(payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const ffprobe = await findCommand("ffprobe");
  const base64Data = typeof payload.base64Data === "string" ? payload.base64Data : "";
  if (!ffprobe || !base64Data) return null;
  const workDir = mkdtempSync(join(tmpdir(), "filmidi-probe-"));
  const inputPath = join(workDir, "input");
  try {
    writeFileSync(inputPath, Buffer.from(base64Data, "base64"));
    const result = await run(ffprobe, [
      "-v", "error", "-show_entries", "format=duration:stream=codec_type,duration",
      "-of", "json", inputPath,
    ], 30_000);
    if (result.code !== 0) return null;
    const parsed = JSON.parse(result.stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; duration?: string }> };
    const duration = Number(parsed.format?.duration ?? parsed.streams?.map((s) => Number(s.duration)).filter(Number.isFinite).reduce((a, b) => Math.max(a, b), 0));
    if (!Number.isFinite(duration) || duration <= 0) return null;
    return {
      duration,
      hasAudio: Boolean(parsed.streams?.some((stream) => stream.codec_type === "audio")),
      hasVideo: Boolean(parsed.streams?.some((stream) => stream.codec_type === "video")),
    };
  } catch {
    return null;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

/** Convert formats that Web Audio cannot decode consistently (notably MOV) to MP4/AAC. */
export async function normalizeMediaWithFfmpeg(payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const ffmpeg = await findCommand("ffmpeg");
  const base64Data = typeof payload.base64Data === "string" ? payload.base64Data : "";
  if (!ffmpeg || !base64Data) return null;
  const workDir = mkdtempSync(join(tmpdir(), "filmidi-media-"));
  const inputPath = join(workDir, "input");
  const outputPath = join(workDir, "normalized.mp4");
  try {
    writeFileSync(inputPath, Buffer.from(base64Data, "base64"));
    const result = await run(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-y", "-i", inputPath,
      "-map", "0:v:0", "-map", "0:a:0?",
      "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outputPath,
    ]);
    if (result.code !== 0 || !existsSync(outputPath)) return null;
    const bytes = readFileSync(outputPath);
    return {
      backend: "ffmpeg",
      dataUrl: `data:video/mp4;base64,${bytes.toString("base64")}`,
      mimeType: "video/mp4",
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
