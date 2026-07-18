import { executeTool, getTimelineContext, getMediaContext } from "./toolExecutor";
import { TOOL_DEFINITIONS } from "./toolDefinitions";

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

  (window as any).__electrobun.receiveMessageFromBun = (msg: any) => {
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "agent-event" && currentListeners) {
      currentListeners.onEvent(msg.event);
    }

    if (msg.type === "agent-done" && currentListeners) {
      currentListeners.onDone(msg);
      currentListeners = null;
    }

    if (msg.type === "agent-error" && currentListeners) {
      currentListeners.onError(msg.error);
      currentListeners = null;
    }

    if (msg.type === "exec-tool") {
      // Execute tool locally and send result back to Bun
      executeTool(msg.toolName, msg.input as Record<string, unknown>)
        .then((result) => {
          const bridge = (window as any).__electrobunBunBridge;
          if (bridge) {
            bridge.postMessage(
              JSON.stringify({
                type: "tool-result",
                toolResultId: msg.toolResultId,
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
                toolResultId: msg.toolResultId,
                result: JSON.stringify({
                  error: err instanceof Error ? err.message : String(err),
                }),
                isError: true,
              }),
            );
          }
        });
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
    const     timer = setTimeout(() => {
      asrPendingResolvers.delete(requestId);
      reject(new Error("Audio export timed out"));
    }, 30_000);

    asrPendingResolvers.set(requestId, { resolve, reject, timer });

    // Listen for the response
    const origHandler = (window as any).__electrobun?.receiveMessageFromBun;
    const handler = (msg: any) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "upload-audio-result" && msg.requestId === requestId) {
        const pending = asrPendingResolvers.get(requestId);
        if (pending) {
          clearTimeout(pending.timer);
          asrPendingResolvers.delete(requestId);
          if (msg.error) {
            pending.reject(new Error(msg.error));
          } else {
            pending.resolve(msg.url);
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

    bridge.postMessage(JSON.stringify({
      type: "upload-audio-for-asr",
      requestId,
      base64Data,
      mimeType,
    }));
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
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "transcription-result" && msg.requestId === requestId) {
        const pending = transcriptionPendingResolvers.get(requestId);
        if (pending) {
          clearTimeout(pending.timer);
          transcriptionPendingResolvers.delete(requestId);
          if (msg.error) {
            pending.reject(new Error(msg.error));
          } else {
            pending.resolve(msg.result);
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
