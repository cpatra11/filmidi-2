import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { NativeMediaBackend, NativeMediaRequest, NativeMediaResponse, NativeMediaTask } from "@/lib/nativeMediaBridge";

type Pending = {
  resolve: (value: NativeMediaResponse | null) => void;
  reject: (reason?: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

type SidecarState = {
  process: ChildProcessWithoutNullStreams | null;
  ready: boolean;
  readyPromise: Promise<boolean> | null;
  pending: Map<string, Pending>;
  restartTimer: ReturnType<typeof setTimeout> | null;
};

const state: SidecarState = {
  process: null,
  ready: false,
  readyPromise: null,
  pending: new Map(),
  restartTimer: null,
};

function isMac(): boolean {
  return process.platform === "darwin";
}

function sidecarPathCandidates(): string[] {
  const candidates = [
    join(import.meta.dir, "../../../native/sidecar/FilmidiSidecar"),
    join(process.cwd(), "native/sidecar/FilmidiSidecar"),
    process.env.FILMIDI_SIDECAR_PATH ?? "",
  ];
  return candidates.filter((p) => p.length > 0);
}

function sidecarBinaryPath(): string | null {
  for (const candidate of sidecarPathCandidates()) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function setReady(ready: boolean) {
  state.ready = ready;
}

function scheduleRestart() {
  if (!isMac()) return;
  if (state.restartTimer) return;
  state.restartTimer = setTimeout(() => {
    state.restartTimer = null;
    void startSidecar();
  }, 2_000);
}

function startSidecar(): Promise<boolean> | null {
  if (!isMac()) return null;
  if (state.readyPromise) return state.readyPromise;

  const binary = sidecarBinaryPath();
  if (!binary) {
    console.warn("[swift-sidecar] binary not found; falling back to Bun");
    state.readyPromise = Promise.resolve(false);
    return state.readyPromise;
  }

  state.readyPromise = new Promise((resolve) => {
    try {
      const proc = spawn(binary, [], {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          FILMIDI_SIDECAR: "1",
        },
      });

      state.process = proc;
      setReady(false);

      proc.on("exit", (code, signal) => {
        console.warn("[swift-sidecar] exited", { code, signal });
        setReady(false);
        state.process = null;
        state.readyPromise = null;
        if (state.restartTimer) {
          clearTimeout(state.restartTimer);
          state.restartTimer = null;
        }
        for (const [, pending] of state.pending) {
          clearTimeout(pending.timer);
          pending.reject(new Error("Swift sidecar exited"));
        }
        state.pending.clear();
        scheduleRestart();
      });

      const stdout = createInterface({ input: proc.stdout });
      stdout.on("line", (line) => {
        try {
          const msg = JSON.parse(line) as NativeMediaResponse & { type?: string; requestId?: string };
          if (msg.type === "ready") {
            setReady(true);
            if (state.restartTimer) {
              clearTimeout(state.restartTimer);
              state.restartTimer = null;
            }
            console.log("[swift-sidecar] ready");
            resolve(true);
            return;
          }
          if (msg.type === "response" && msg.requestId) {
            const pending = state.pending.get(msg.requestId);
            if (pending) {
              clearTimeout(pending.timer);
              state.pending.delete(msg.requestId);
              pending.resolve(msg);
            }
          }
        } catch (err) {
          console.warn("[swift-sidecar] malformed stdout line", line.slice(0, 200), err);
        }
      });

      const stderr = createInterface({ input: proc.stderr });
      stderr.on("line", (line) => {
        console.log("[swift-sidecar]", line);
      });

      proc.stdin.write(JSON.stringify({ type: "ping", requestId: "boot" }) + "\n");
      setTimeout(() => {
        if (!state.ready) {
          try { proc.kill(); } catch {}
          state.process = null;
          state.readyPromise = null;
          resolve(false);
        }
      }, 15_000);
    } catch (error) {
      console.warn("[swift-sidecar] failed to start", error);
      state.process = null;
      setReady(false);
      state.readyPromise = Promise.resolve(false);
      resolve(false);
    }
  });

  return state.readyPromise;
}

async function ensureSidecar(): Promise<boolean> {
  const promise = startSidecar();
  if (!promise) return false;
  return promise;
}

export async function requestSwiftSidecar(task: NativeMediaTask, payload: Record<string, unknown>): Promise<NativeMediaResponse | null> {
  if (!isMac()) {
    return null;
  }

  const ready = await ensureSidecar();
  if (!ready || !state.process) {
    return null;
  }

  const requestId = crypto.randomUUID();
  const response = await new Promise<NativeMediaResponse | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      state.pending.delete(requestId);
      reject(new Error(`Swift sidecar timed out for ${task}`));
    }, 120_000);

    state.pending.set(requestId, { resolve, reject, timer });

    const request: NativeMediaRequest = { task, payload };
    state.process?.stdin.write(JSON.stringify({
      type: "request",
      requestId,
      ...request,
    }) + "\n");
  });

  if (response?.ok === false || response?.error) {
    return response;
  }

  return response;
}

export async function requestNativeMediaThroughSidecar(task: NativeMediaTask, payload: Record<string, unknown>): Promise<{ backend: NativeMediaBackend; result: NativeMediaResponse | null }> {
  const response = await requestSwiftSidecar(task, payload);
  if (!response) {
    return { backend: "bun-fallback", result: null };
  }
  return { backend: "swift-sidecar", result: response };
}

export async function pingSwiftSidecar(): Promise<boolean> {
  return ensureSidecar();
}
