import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";

type ProcessResult = { code: number | null; stdout: string; stderr: string };

function commandPath(name: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("which", [name]);
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code === 0 ? output.trim() || null : null));
  });
}

function run(command: string, args: string[], timeoutMs = 120_000): Promise<ProcessResult> {
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

async function gstreamerAvailable(): Promise<boolean> {
  const [launch, discoverer, inspect] = await Promise.all([
    commandPath("gst-launch-1.0"),
    commandPath("gst-discoverer-1.0"),
    commandPath("gst-inspect-1.0"),
  ]);
  return Boolean(launch && discoverer && inspect);
}

export async function getGStreamerStatus(): Promise<Record<string, unknown>> {
  const [launch, discoverer, inspect] = await Promise.all([
    commandPath("gst-launch-1.0"),
    commandPath("gst-discoverer-1.0"),
    commandPath("gst-inspect-1.0"),
  ]);
  if (!launch || !discoverer || !inspect) {
    return {
      available: false,
      backend: "gstreamer",
      missing: [
        !launch ? "gst-launch-1.0" : null,
        !discoverer ? "gst-discoverer-1.0" : null,
        !inspect ? "gst-inspect-1.0" : null,
      ].filter(Boolean),
    };
  }
  const plugins = ["decodebin", "videoconvert", "audioconvert", "mp4mux", "x264enc", "voaacenc", "avenc_h264", "avenc_aac"];
  const pluginChecks = await Promise.all(plugins.map(async (plugin) => ({
    plugin,
    available: (await run(inspect, [plugin], 10_000)).code === 0,
  })));
  return { available: true, backend: "gstreamer", executables: { launch, discoverer, inspect }, plugins: pluginChecks };
}

/** Normalize a browser-imported media file through GStreamer when installed. */
export async function normalizeWithGStreamer(payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  if (!(await gstreamerAvailable())) return null;
  const base64Data = typeof payload.base64Data === "string" ? payload.base64Data : "";
  if (!base64Data) throw new Error("gstreamer-normalize requires base64Data");

  const workDir = mkdtempSync(join(tmpdir(), "filmidi-gst-"));
  const inputPath = join(workDir, "input");
  const outputPath = join(workDir, "normalized.mp4");
  try {
    writeFileSync(inputPath, Buffer.from(base64Data, "base64"));
    const discoverer = await commandPath("gst-discoverer-1.0");
    if (!discoverer) return null;
    const probe = await run(discoverer, [inputPath], 30_000);
    if (probe.code !== 0) throw new Error(`GStreamer could not inspect media: ${probe.stderr.trim()}`);

    // Use standard plugins first, then the libav encoders commonly shipped
    // with desktop GStreamer distributions.
    const hasAudio = /audio\//i.test(probe.stdout) || /audio stream/i.test(probe.stdout);
    const hasVideo = /video\//i.test(probe.stdout) || /video stream/i.test(probe.stdout);
    if (!hasVideo) throw new Error("GStreamer found no video stream to normalize");
    const pipelines = [
      { video: ["x264enc", "tune=zerolatency", "speed-preset=veryfast"], audio: ["voaacenc", "bitrate=192000"] },
      { video: ["avenc_h264", "bitrate=8000000"], audio: ["avenc_aac", "bitrate=192000"] },
    ];
    let lastError = "GStreamer normalization failed";
    for (const pipeline of pipelines) {
      const launch = await commandPath("gst-launch-1.0");
      if (!launch) return null;
      const args = [
        "-e", "filesrc", `location=${inputPath}`,
        "!", "decodebin", "name=decode",
        "decode.", "!", "queue", "!", "videoconvert", "!", ...pipeline.video,
        "!", "h264parse", "!", "mp4mux", "name=mux", "faststart=true",
        "!", "filesink", `location=${outputPath}`,
      ];
      if (hasAudio) {
        args.push("decode.", "!", "queue", "!", "audioconvert", "!", "audioresample", "!", ...pipeline.audio, "!", "aacparse", "!", "mux.");
      }
      const result = await run(launch, args, 300_000);
      if (result.code === 0) {
        const bytes = readFileSync(outputPath);
        return {
          backend: "gstreamer",
          dataUrl: `data:video/mp4;base64,${bytes.toString("base64")}`,
          mimeType: "video/mp4",
          probe: probe.stdout.slice(0, 12_000),
        };
      }
      lastError = result.stderr.trim().slice(-2_000) || lastError;
    }
    throw new Error(lastError);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
