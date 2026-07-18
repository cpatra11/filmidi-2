import { BrowserWindow, Updater } from "electrobun/bun";
import Electrobun from "electrobun/bun";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { runAgentLoop, resolveToolResult } from "./lib/aiAgent";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

async function getMainViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();
  if (channel === "dev") {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" });
      console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
      return DEV_SERVER_URL;
    } catch {
      console.log(
        "Vite dev server not running. Run 'bun run dev:hmr' for HMR support.",
      );
    }
  }
  return "views://mainview/index.html";
}

const url = await getMainViewUrl();

const mainWindow = new BrowserWindow({
  title: "Filmidi Editor",
  url,
  frame: {
    width: 1400,
    height: 900,
    x: 100,
    y: 100,
  },
  titleBarStyle: "hiddenInset",
  trafficLightOffset: { x: 12, y: 12 },
});

// ─── IPC Transport ──────────────────────────────────────────────

const transport = mainWindow.webview.createTransport();
let isMaximized = false;

// ─── MCP pending request tracking
interface PendingRequest {
  resolve: (result: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
const mcpPendingRequests = new Map<string, PendingRequest>();

// Secure in-memory storage for sensitive credentials
const secureStore = new Map<string, string>();
const CREDENTIALS_FILE = join(homedir(), "Library", "Application Support", "com.filmidi.editor", "credentials.json");

function loadCredentials() {
  try {
    if (existsSync(CREDENTIALS_FILE)) {
      const data = JSON.parse(readFileSync(CREDENTIALS_FILE, "utf-8"));
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === "string") secureStore.set(key, value);
      }
    }
  } catch {}
}

function saveCredentials() {
  try {
    const dir = dirname(CREDENTIALS_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const data: Record<string, string> = {};
    secureStore.forEach((value, key) => { data[key] = value; });
    writeFileSync(CREDENTIALS_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  } catch (err) {
    console.error("[credentials] Failed to save:", err);
  }
}

// Load existing credentials on startup
loadCredentials();

transport.registerHandler((msg: any) => {
  if (!msg || typeof msg !== "object") return;

  switch (msg.type) {
    case "toggleMaximize":
      if (isMaximized) {
        mainWindow.unmaximize();
        isMaximized = false;
      } else {
        mainWindow.maximize();
        isMaximized = true;
      }
      break;

    case "mcp-tool-result": {
      const pending = mcpPendingRequests.get(msg.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        mcpPendingRequests.delete(msg.requestId);
        if (msg.isError) {
          pending.reject(new Error(msg.result));
        } else {
          pending.resolve(msg.result);
        }
      }
      break;
    }

    case "openExternal": {
      if (typeof msg.url === "string" && msg.url.startsWith("https://")) {
        Electrobun.Utils.openExternal(msg.url);
      }
      break;
    }

    case "set-api-key": {
      if (typeof msg.key === "string") {
        if (msg.key.length > 0) {
          secureStore.set("qwen_api_key", msg.key);
        } else {
          secureStore.delete("qwen_api_key");
        }
        saveCredentials();
        transport.send({ type: "api-key-saved" });
      }
      break;
    }

    case "get-api-key": {
      // Check memory first, then try loading from file
      let key: string | null = secureStore.get("qwen_api_key") ?? null;
      if (!key) {
        loadCredentials();
        key = secureStore.get("qwen_api_key") ?? null;
      }
      transport.send({ type: "api-key-value", key });
      break;
    }

    case "sign-in": {
      if (typeof msg.authUrl === "string" && msg.authUrl.startsWith("https://")) {
        Electrobun.Utils.openExternal(msg.authUrl);
        transport.send({ type: "sign-in-browser-opened" });
      }
      break;
    }

    case "tool-result": {
      // Resolve pending tool execution from agent loop
      resolveToolResult(msg.toolResultId, msg.result, msg.isError);
      break;
    }

    case "upload-audio-for-asr": {
      // Upload audio blob to a public URL for ASR.
      // Tries tempfile.org first (public HTTPS URL), then fallbacks.
      (async () => {
        try {
          const { base64Data, mimeType, requestId } = msg;
          if (!base64Data || !requestId) {
            transport.send({ type: "upload-audio-result", requestId, error: "Missing base64Data or requestId" });
            return;
          }

          const buffer = Buffer.from(base64Data, "base64");
          const ext = mimeType?.includes("video") ? ".mp4" : mimeType?.includes("wav") ? ".wav" : ".mp3";
          const fileName = `filmidi-audio-${Date.now()}${ext}`;

          // 1. Try catbox.moe (free, no auth, no expiry)
          try {
            const formData = new FormData();
            formData.append("reqtype", "fileupload");
            formData.append("fileToUpload", new Blob([buffer], { type: mimeType || "audio/wav" }), fileName);
            const resp = await fetch("https://catbox.moe/user/api.php", {
              method: "POST",
              body: formData,
            });
            if (resp.ok) {
              const url = (await resp.text()).trim();
              if (url && url.startsWith("https://")) {
                transport.send({ type: "upload-audio-result", requestId, url });
                return;
              }
            }
          } catch (_) {}

          // 2. Try tempfile.org
          try {
            const formData = new FormData();
            formData.append("files", new Blob([buffer], { type: mimeType || "audio/wav" }), fileName);
            formData.append("expiryHours", "1");
            const resp = await fetch("https://tempfile.org/api/upload/local", {
              method: "POST",
              body: formData,
            });
            if (resp.ok) {
              const data = await resp.json() as any;
              if (data?.success && data?.files?.[0]?.id) {
                const fileId = data.files[0].id;
                transport.send({ type: "upload-audio-result", requestId, url: `https://tempfile.org/${fileId}/download` });
                return;
              }
            }
          } catch (_) {}

          // 3. Try backend upload (UploadThing)
          try {
            const formData = new FormData();
            formData.append("file", new Blob([buffer], { type: mimeType || "audio/wav" }), fileName);
            const resp = await fetch("http://localhost:3000/api/v1/uploads", {
              method: "POST",
              body: formData,
            });
            if (resp.ok) {
              const data = await resp.json() as any;
              if (data?.url) {
                transport.send({ type: "upload-audio-result", requestId, url: data.url });
                return;
              }
            }
          } catch (_) {}

          // 4. Last resort: file:// URL
          const tempDir = join(homedir(), "Library", "Caches", "com.filmidi.editor", "audio");
          mkdirSync(tempDir, { recursive: true });
          const filePath = join(tempDir, fileName);
          writeFileSync(filePath, buffer);
          transport.send({ type: "upload-audio-result", requestId, url: `file://${filePath}` });
        } catch (err: any) {
          transport.send({ type: "upload-audio-result", requestId: msg.requestId, error: err?.message ?? String(err) });
        }
      })();
      break;
    }

    case "transcribe-audio": {
      // Run transcription entirely in Bun (avoids browser CORS issues)
      (async () => {
        try {
          const { audioUrl, apiKey, requestId } = msg;
          if (!audioUrl || !apiKey || !requestId) {
            transport.send({ type: "transcription-result", requestId, error: "Missing audioUrl, apiKey, or requestId" });
            return;
          }

          const ASR_ENDPOINT = "https://dashscope-intl.aliyuncs.com/api/v1/services/audio/asr/transcription";
          const POLL_ENDPOINT = "https://dashscope-intl.aliyuncs.com/api/v1/tasks";

          // Submit transcription task
          const submitResp = await fetch(ASR_ENDPOINT, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
              "X-DashScope-Async": "enable",
            },
            body: JSON.stringify({
              model: "qwen3-asr-flash-filetrans",
              input: { file_url: audioUrl },
              parameters: { channel_id: [0], enable_words: true },
            }),
          });

          if (!submitResp.ok) {
            const err = await submitResp.text();
            transport.send({ type: "transcription-result", requestId, error: `ASR submit failed (${submitResp.status}): ${err}` });
            return;
          }

          const submitData = await submitResp.json();
          const taskId = submitData?.output?.task_id;
          if (!taskId) {
            transport.send({ type: "transcription-result", requestId, error: "No task_id in ASR response" });
            return;
          }

          // Poll for completion
          for (let attempt = 0; attempt < 150; attempt++) {
            await new Promise((r) => setTimeout(r, 2000));
            try {
              const pollResp = await fetch(`${POLL_ENDPOINT}/${taskId}`, {
                headers: { Authorization: `Bearer ${apiKey}` },
              });
              if (!pollResp.ok) continue;

              const pollData = await pollResp.json();
              const status = pollData?.output?.task_status;

              if (status === "SUCCEEDED") {
                const resultUrl = pollData?.output?.results?.[0]?.transcription_url;
                if (!resultUrl) {
                  transport.send({ type: "transcription-result", requestId, error: "No transcription_url in result" });
                  return;
                }
                const resultResp = await fetch(resultUrl);
                const resultData = await resultResp.text();
                transport.send({ type: "transcription-result", requestId, result: resultData });
                return;
              }

              if (status === "FAILED") {
                transport.send({ type: "transcription-result", requestId, error: `ASR task failed: ${JSON.stringify(pollData.output)}` });
                return;
              }
            } catch (_) {
              // Poll error — retry
            }
          }

          transport.send({ type: "transcription-result", requestId, error: "ASR task timed out" });
        } catch (err: any) {
          transport.send({ type: "transcription-result", requestId: msg.requestId, error: err?.message ?? String(err) });
        }
      })();
      break;
    }

    case "agent-message": {
      // Run the AI SDK agent loop in Bun
      const apiKey = secureStore.get("qwen_api_key");
      if (!apiKey) {
        transport.send({
          type: "agent-error",
          requestId: msg.requestId,
          error: "No API key configured. Set it in Settings > Agent.",
        });
        break;
      }
      runAgentLoop({
        requestId: msg.requestId,
        sessionMessages: msg.sessionMessages,
        userMessage: msg.userMessage,
        context: msg.context,
        toolDefs: msg.toolDefs,
        system: msg.system,
        modelId: msg.modelId,
        apiKey,
        send: (m: any) => transport.send(m),
      });
      break;
    }

    case "stream-chat-init": {
      const { requestId, model, messages, tools, system, apiKey } = msg;
      if (!requestId || !apiKey) break;

      (async () => {
        try {
          const controller = new AbortController();
          const fetchTimeout = setTimeout(() => controller.abort(), 20000);

          const body: Record<string, unknown> = {
            model,
            max_tokens: msg.maxTokens ?? 8192,
            stream: true,
            messages,
          };
          if (system) body.system = system;
          if (tools?.length) {
            body.tools = tools;
            const toolArr = body.tools as any[];
            toolArr[toolArr.length - 1].cache_control = { type: "ephemeral" };
          }

          const res = await fetch("https://dashscope-intl.aliyuncs.com/apps/anthropic/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          clearTimeout(fetchTimeout);

          if (!res.ok) {
            const text = await res.text().catch(() => "");
            transport.send({ type: "stream-chat-result", requestId, events: [{ type: "error", message: `API ${res.status}: ${text}` }] });
            return;
          }

          const reader = res.body?.getReader();
          if (!reader) throw new Error("No response body");

          const decoder = new TextDecoder();
          let buffer = "";
          // Track current block: text or tool_use (thinking blocks are skipped)
          let currentBlock: { type: "text" | "tool_use"; id?: string; name?: string; input?: string } | null = null;
          const events: Record<string, unknown>[] = [];

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              // DashScope sends `data:{...}` with no space — accept both forms
              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (!data) continue;

              let parsed: Record<string, unknown>;
              try { parsed = JSON.parse(data); } catch { continue; }

              const eventType = parsed.type as string;

              if (eventType === "content_block_start") {
                const block = parsed.content_block as Record<string, unknown>;
                if (block.type === "tool_use") {
                  currentBlock = { type: "tool_use", id: block.id as string, name: block.name as string, input: "" };
                } else if (block.type === "text") {
                  currentBlock = { type: "text" };
                } else {
                  // thinking or unknown — skip
                  currentBlock = null;
                }
                continue;
              }

              if (eventType === "content_block_delta") {
                const delta = parsed.delta as Record<string, unknown>;
                if (delta.type === "text_delta" && currentBlock?.type === "text") {
                  const text = delta.text as string;
                  if (text) events.push({ type: "text_delta", text });
                } else if (delta.type === "input_json_delta" && currentBlock?.type === "tool_use") {
                  currentBlock.input = (currentBlock.input ?? "") + (delta.partial_json as string);
                }
                continue;
              }

              if (eventType === "content_block_stop") {
                if (currentBlock?.type === "tool_use" && currentBlock.id && currentBlock.name) {
                  let input: Record<string, unknown> = {};
                  try { input = JSON.parse(currentBlock.input ?? "{}"); } catch {}
                  events.push({ type: "tool_use", id: currentBlock.id, name: currentBlock.name, input });
                }
                currentBlock = null;
                continue;
              }

              if (eventType === "message_delta") {
                const delta = parsed.delta as Record<string, unknown> | undefined;
                const usage = parsed.usage as Record<string, unknown> | undefined;
                events.push({
                  type: "stop",
                  stopReason: (delta?.stop_reason as string) ?? null,
                  usage: { input_tokens: (usage?.input_tokens as number) ?? 0, output_tokens: (usage?.output_tokens as number) ?? 0 },
                });
                continue;
              }
            }
          }

          transport.send({ type: "stream-chat-result", requestId, events });
        } catch (err: any) {
          console.error("[stream-chat] Bun fetch error:", err?.message ?? err);
          try {
            transport.send({ type: "stream-chat-result", requestId, events: [{ type: "error", message: err?.message ?? String(err) }] });
          } catch (sendErr) {
            console.error("[stream-chat] Failed to send error event:", sendErr);
          }
        }
      })();
      break;
    }
  }
});

// ─── MCP Tool Call Bridge ───────────────────────────────────────

function callToolOnRenderer(toolName: string, args: Record<string, unknown>): Promise<string> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      mcpPendingRequests.delete(requestId);
      reject(new Error(`MCP tool call timed out: ${toolName}`));
    }, 120_000);

    mcpPendingRequests.set(requestId, { resolve, reject, timer });
    transport.send({ type: "mcp-tool-call", requestId, toolName, args });
  });
}

// Start the MCP server (disabled — Bun v1.3.13 C++ crash in Electrobun)
// import { startMcpServer } from "./mcp/startMcpServer";
// startMcpServer(callToolOnRenderer).catch((err) => {
//   console.error("[MCP] Failed to start server:", err);
// });

// ─── Native Menu Bar ───

const isMac = process.platform === "darwin";

const menuTemplate: any[] = [
  // ── App menu (macOS only) ──
  ...(isMac
    ? [
        {
          submenu: [
            { label: "About Filmidi", role: "about" },
            { type: "separator" as const },
            {
              label: "Settings",
              accelerator: ",",
              action: "open-settings",
            },
            { type: "separator" as const },
            { label: "Hide Filmidi", role: "hide" },
            { label: "Hide Others", role: "hideOthers" },
            { label: "Show All", role: "showAll" },
            { type: "separator" as const },
            { label: "Quit Filmidi", role: "quit" },
          ],
        },
      ]
    : []),

  // ── File ──
  {
    label: "File",
    submenu: [
      { label: "New Project", accelerator: "n", action: "new-project" },
      { label: "Open Project", accelerator: "o", action: "open-project" },
      { type: "separator" },
      { label: "Save Project", accelerator: "s", action: "save-project" },
      {
        label: "Save As",
        accelerator: "shift+s",
        action: "save-as",
      },
      { type: "separator" },
      { label: "Import Media", accelerator: "i", action: "import-media" },
      { label: "Export", accelerator: "e", action: "export" },
      ...(!isMac
        ? [
            { type: "separator" as const },
            { label: "Settings", accelerator: ",", action: "open-settings" },
            { type: "separator" as const },
            { label: "Exit", role: "quit" },
          ]
        : []),
    ],
  },

  // ── Edit ──
  {
    label: "Edit",
    submenu: [
      { label: "Undo", role: "undo" },
      { label: "Redo", role: "redo" },
      { type: "separator" },
      { label: "Cut", role: "cut" },
      { label: "Copy", role: "copy" },
      { label: "Paste", role: "paste" },
      { label: "Delete", role: "delete" },
      { label: "Select All", role: "selectAll" },
      { type: "separator" },
      {
        label: "Split at Playhead",
        accelerator: "k",
        action: "split-at-playhead",
      },
      { label: "Trim Start", accelerator: "q", action: "trim-start" },
      { label: "Trim End", accelerator: "w", action: "trim-end" },
    ],
  },

  // ── View ──
  {
    label: "View",
    submenu: [
      {
        label: "Media Panel",
        accelerator: "shift+0",
        action: "toggle-media-panel",
      },
      {
        label: "Inspector",
        accelerator: "shift+alt+0",
        action: "toggle-inspector",
      },
      {
        label: "Agent Panel",
        accelerator: "shift+alt+a",
        action: "toggle-agent-panel",
      },
      { type: "separator" },
      { label: "Zoom In", accelerator: "=", action: "zoom-in" },
      { label: "Zoom Out", accelerator: "-", action: "zoom-out" },
      { label: "Zoom to Fit", accelerator: "0", action: "zoom-fit" },
      { label: "Zoom to 100%", accelerator: "1", action: "zoom-100" },
      { type: "separator" },
      { label: "Toggle Full Screen", role: "toggleFullScreen" },
    ],
  },

  // ── Window ──
  {
    label: "Window",
    submenu: [
      { label: "Minimize", role: "minimize" },
      { label: "Zoom", role: "zoom" },
      ...(isMac
        ? [
            { type: "separator" as const },
            { label: "Bring All to Front", role: "bringAllToFront" },
          ]
        : []),
    ],
  },

  // ── Help ──
  {
    label: "Help",
    submenu: [
      {
        label: "Keyboard Shortcuts",
        accelerator: "/",
        action: "open-help",
      },
      { label: "MCP Instructions", action: "open-mcp" },
      { type: "separator" },
      { label: "Send Feedback", action: "send-feedback" },
    ],
  },
];

Electrobun.ApplicationMenu.setApplicationMenu(menuTemplate);

// ─── Forward menu clicks to the webview ───

Electrobun.events.on("application-menu-clicked", (e) => {
  const { action } = e.data;
  if (!action) return;

  // Forward to webview via RPC
  transport.send({ type: "menu-action", action });
});

console.log("Filmidi Editor started!");
