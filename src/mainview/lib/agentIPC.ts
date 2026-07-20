import { executeTool, getTimelineContext, getMediaContext } from "./toolExecutor";
import { TOOL_DEFINITIONS } from "./toolDefinitions";
import { transcodeBlobToWavBlob } from "./webAudio";

let initialized = false;

type EventCallback = (event: any) => void;
type DoneCallback = (data: any) => void;
type ErrorCallback = (error: string) => void;
type ToolRequestCallback = (data: {
  toolResultId: string;
  toolName: string;
  input: unknown;
}) => void;

interface AgentIPCListeners {
  onEvent: EventCallback;
  onDone: DoneCallback;
  onError: ErrorCallback;
  onToolRequest: ToolRequestCallback;
}

let currentListeners: AgentIPCListeners | null = null;

export function setupAgentIPCHandler() {
  if (initialized) return;
  initialized = true;

  const prevHandler = (window as any).__electrobun?.receiveMessageFromBun;
  (window as any).__electrobun.receiveMessageFromBun = (msg: any) => {
    const data = typeof msg === "string"
      ? (() => {
          try {
            return JSON.parse(msg);
          } catch {
            return null;
          }
        })()
      : msg;
    if (!data || typeof data !== "object") {
      if (prevHandler) prevHandler(msg);
      return;
    }

    if (data.type === "agent-event" && currentListeners) {
      currentListeners.onEvent(data.event);
    }

    if (data.type === "agent-done" && currentListeners) {
      currentListeners.onDone(data);
      currentListeners = null;
    }

    if (data.type === "agent-error" && currentListeners) {
      currentListeners.onError(data.error);
      currentListeners = null;
    }

    if (data.type === "exec-tool") {
      // Execute tool locally and send result back to Bun
      executeTool(data.toolName, data.input as Record<string, unknown>)
        .then((result) => {
          const bridge = (window as any).__electrobunBunBridge;
          if (bridge) {
            bridge.postMessage(
              JSON.stringify({
                type: "tool-result",
                toolResultId: data.toolResultId,
                result,
              }),
            );
          }
        })
        .catch((err) => {
          const bridge = (window as any).__electrobunBunBridge;
          if (bridge) {
              bridge.postMessage(
                JSON.stringify({
                  type: "tool-result",
                  toolResultId: data.toolResultId,
                  result: JSON.stringify({
                    error: err instanceof Error ? err.message : String(err),
                  }),
                  isError: true,
                }),
            );
          }
        });
    }

    if (prevHandler) {
      prevHandler(msg);
    }
  };
}

export function sendAgentMessage(params: {
  requestId: string;
  sessionMessages: any[];
  userMessage: any;
  context: { timeline: string; media: string };
  system: string;
  modelId: string;
  listeners: AgentIPCListeners;
}) {
  const bridge = (window as any).__electrobunBunBridge;
  if (!bridge) {
    params.listeners.onError("No Bun process available. Restart the app.");
    return;
  }

  setupAgentIPCHandler();
  currentListeners = params.listeners;

  bridge.postMessage(
    JSON.stringify({
      type: "agent-message",
      requestId: params.requestId,
      sessionMessages: params.sessionMessages,
      userMessage: params.userMessage,
      context: params.context,
      toolDefs: TOOL_DEFINITIONS,
      system: params.system,
      modelId: params.modelId,
    }),
  );
}

export function cancelAgentStream() {
  currentListeners = null;
  const bridge = (window as any).__electrobunBunBridge;
  if (bridge) {
    bridge.postMessage(JSON.stringify({ type: "cancel-agent" }));
  }
}

let asrPendingResolvers = new Map<string, { resolve: (url: string) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>();

/**
 * Upload audio blob data to a public URL via Bun IPC (tempfile.org).
 * Used by cloudTranscription.ts when the source is a blob: URL.
 */
export function uploadAudioForASR(base64Data: string, mimeType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const bridge = (window as any).__electrobunBunBridge;
    if (!bridge) {
      reject(new Error("No Bun process available"));
      return;
    }

    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      asrPendingResolvers.delete(requestId);
      reject(new Error("Audio export timed out"));
    }, 120_000);

    asrPendingResolvers.set(requestId, { resolve, reject, timer });

    // Listen for the response
    const origHandler = (window as any).__electrobun?.receiveMessageFromBun;
    const handler = (msg: any) => {
      const data = typeof msg === "string"
        ? (() => {
            try {
              return JSON.parse(msg);
            } catch {
              return null;
            }
          })()
        : msg;
      if (!data || typeof data !== "object") {
        if (origHandler) origHandler(msg);
        return;
      }
      if (data.type === "upload-audio-result" && data.requestId === requestId) {
        const pending = asrPendingResolvers.get(requestId);
        if (pending) {
          clearTimeout(pending.timer);
          asrPendingResolvers.delete(requestId);
          if (data.error) {
            pending.reject(new Error(data.error));
          } else {
            pending.resolve(data.url);
          }
        }
        // Restore original handler
        if ((window as any).__electrobun) {
          (window as any).__electrobun.receiveMessageFromBun = origHandler;
        }
        return;
      }
      if (origHandler) origHandler(msg);
    };
    (window as any).__electrobun.receiveMessageFromBun = handler;

    (async () => {
      try {
        const binary = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
        const sourceBlob = new Blob([binary], { type: mimeType || "application/octet-stream" });
        let uploadBlob = sourceBlob;

        if (!String(mimeType || "").includes("wav")) {
          try {
            uploadBlob = await transcodeBlobToWavBlob(sourceBlob);
          } catch (error) {
            console.warn("[asr-upload] transcoding failed, uploading original blob", error);
          }
        }

        const uploadDataUrl: string = await new Promise((resolveData, rejectData) => {
          const reader = new FileReader();
          reader.onloadend = () => resolveData(reader.result as string);
          reader.onerror = rejectData;
          reader.readAsDataURL(uploadBlob);
        });
        const [, uploadBase64] = uploadDataUrl.split(",");
        bridge.postMessage(JSON.stringify({
          type: "upload-audio-for-asr",
          requestId,
          base64Data: uploadBase64,
          mimeType: uploadBlob.type || "audio/wav",
        }));
      } catch (error) {
        clearTimeout(timer);
        asrPendingResolvers.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });
}

/**
 * Run transcription entirely through Bun (avoids CORS issues with browser fetch).
 */
let transcriptionPendingResolvers = new Map<string, { resolve: (result: string) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>();

export function transcribeOnBun(audioUrl: string, apiKey: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const bridge = (window as any).__electrobunBunBridge;
    if (!bridge) {
      reject(new Error("No Bun process available"));
      return;
    }

    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      transcriptionPendingResolvers.delete(requestId);
      reject(new Error("Transcription timed out"));
    }, 300_000); // 5 min timeout for ASR

    transcriptionPendingResolvers.set(requestId, { resolve, reject, timer });

    const origHandler = (window as any).__electrobun?.receiveMessageFromBun;
    const handler = (msg: any) => {
      const data = typeof msg === "string"
        ? (() => {
            try {
              return JSON.parse(msg);
            } catch {
              return null;
            }
          })()
        : msg;
      if (!data || typeof data !== "object") {
        if (origHandler) origHandler(msg);
        return;
      }
      if (data.type === "transcription-result" && data.requestId === requestId) {
        const pending = transcriptionPendingResolvers.get(requestId);
        if (pending) {
          clearTimeout(pending.timer);
          transcriptionPendingResolvers.delete(requestId);
          if (data.error) {
            pending.reject(new Error(data.error));
          } else {
            pending.resolve(data.result);
          }
        }
        if ((window as any).__electrobun) {
          (window as any).__electrobun.receiveMessageFromBun = origHandler;
        }
        return;
      }
      if (origHandler) origHandler(msg);
    };
    (window as any).__electrobun.receiveMessageFromBun = handler;

    bridge.postMessage(JSON.stringify({
      type: "transcribe-audio",
      requestId,
      audioUrl,
      apiKey,
    }));
  });
}
