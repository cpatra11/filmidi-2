import { create } from "zustand";
import { streamChat, streamChatBackend } from "@/lib/qwenClient";
import { TOOL_DEFINITIONS } from "@/lib/toolDefinitions";
import { executeTool, getTimelineContext, getMediaContext } from "@/lib/toolExecutor";
import { useMediaPanelStore } from "./useMediaPanelStore";
import { useEditorStore } from "@videoflow/react-video-editor";
import { useAccountStore } from "./useAccountStore";
import { useSettingsStore } from "./useSettingsStore";
import { getSecureApiKey, setSecureApiKey, clearSecureApiKey } from "@/lib/secureApiKey";

export type MessageRole = "user" | "assistant" | "system";

export interface ToolUseEntry {
  id: string;
  name: string;
  inputJSON: string;
  result?: { content: string; isError: boolean };
}

export interface AgentMessage {
  id: string;
  role: MessageRole;
  content: string;
  toolUse?: ToolUseEntry[];
  mentions?: MentionRef[];
  timestamp: number;
}

export interface MentionRef {
  type: "mediaAsset" | "timelineClip" | "timelineRange";
  id: string;
  name: string;
  /** base64 data URL — set only for image media assets */
  imageDataUrl?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: AgentMessage[];
  createdAt: number;
  updatedAt: number;
}

interface AgentState {
  sessions: ChatSession[];
  currentSessionId: string | null;
  draft: string;
  isStreaming: boolean;
  streamError: string | null;
  model: string;
  /** Agent undo stack — tracks agent-made edit summaries for isolated undo */
  agentEditHistory: Array<{ turn: number; tool: string; summary: string }>;
  /** Running turn counter for edit history */
  agentTurn: number;

  createSession: () => string;
  selectSession: (id: string) => void;
  closeSession: (id: string) => void;
  deleteSession: (id: string) => void;
  setDraft: (text: string) => void;
  sendMessage: (text: string) => Promise<void>;
  cancelStream: () => void;
  setModel: (model: string) => void;
  setApiKey: (key: string) => void;

  currentSession: () => ChatSession | undefined;
  canSend: () => boolean;
}

const STORAGE_KEY = "filmidi_agent_sessions";
const API_KEY_STORAGE_KEY = "filmidi_qwen_api_key";
const STARTER_SESSION_TITLE = "New chat";

function makeId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const MODEL_MAP: Record<string, string> = {
  "qwen-max":    "qwen3.7-max",
  "qwen-plus":   "qwen3.7-plus",
  "qwen-flash":  "qwen3.6-flash",
  "qwen-turbo":  "qwen3.6-flash",  // qwen-turbo is invalid on Anthropic endpoint — fallback to flash
  // Pass canonical ids through unchanged
  "qwen3.7-max":   "qwen3.7-max",
  "qwen3.7-plus":  "qwen3.7-plus",
  "qwen3.6-plus":  "qwen3.6-plus",
  "qwen3.6-flash": "qwen3.6-flash",
};

const AVAILABLE_MODELS = [
  { id: "qwen3.7-max",   name: "Qwen 3.7 Max (Best)" },
  { id: "qwen3.7-plus",  name: "Qwen 3.7 Plus" },
  { id: "qwen3.6-plus",  name: "Qwen 3.6 Plus" },
  { id: "qwen3.6-flash", name: "Qwen 3.6 Flash (Fast)" },
];


async function getApiKey(): Promise<string | null> {
  return getSecureApiKey();
}

function persistSessions(sessions: ChatSession[]) {
  try {
    // Keep only necessary fields, limit to 20 sessions
    const trimmed = sessions.slice(-20).map((s) => ({
      id: s.id,
      title: s.title,
      messages: s.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        toolUse: m.toolUse?.map((t) => ({
          id: t.id,
          name: t.name,
          inputJSON: t.inputJSON,
          result: t.result ? { content: t.result.content, isError: t.result.isError } : undefined,
        })),
        mentions: m.mentions,
        timestamp: m.timestamp,
      })),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {}
}

function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ChatSession[];
  } catch {
    return [];
  }
}

interface QwenMessage {
  role: "user" | "assistant";
  content: string | Array<Record<string, unknown>>;
}

/**
 * Resolve @-mentions in user text.
 * Replaces `@asset:xyz` patterns with asset names, collects MentionRefs,
 * and base64-encodes image assets for inlining.
 */
async function resolveMentions(text: string): Promise<{
  cleaned: string;
  mentions: MentionRef[];
}> {
  const mediaStore = useMediaPanelStore.getState();
  const editorStore = useEditorStore.getState();

  const mentions: MentionRef[] = [];
  let cleaned = text;

  // Resolve @asset:xxx patterns
  const assetPattern = /@asset:(\S+)/g;
  cleaned = cleaned.replace(assetPattern, (_match, refId) => {
    // Try by id first, then by name prefix
    let asset = mediaStore.assets.find((a) => a.id === refId);
    if (!asset) {
      asset = mediaStore.assets.find((a) =>
        a.name.toLowerCase().startsWith(refId.toLowerCase()),
      );
    }
    if (!asset) return _match; // leave unresolved

    const mention: MentionRef = {
      type: "mediaAsset",
      id: asset.id,
      name: asset.name,
    };

    // Inline image assets as base64 data URLs
    if (asset.type === "image" && asset.url) {
      // Try to fetch and convert to data URL
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        // We create a data URL from the blob URL synchronously
        // (already a blob URL from URL.createObjectURL)
        mention.imageDataUrl = asset.url; // already a blob: URL
      } catch {}
    }

    mentions.push(mention);
    return asset.name;
  });

  // Resolve @clip:xxx patterns
  const clipPattern = /@clip:(\S+)/g;
  cleaned = cleaned.replace(clipPattern, (_match, layerId) => {
    const layer = editorStore.video.layers.find(
      (l: { id: string }) => l.id === layerId,
    );
    if (!layer) return _match;
    mentions.push({
      type: "timelineClip",
      id: layer.id,
      name: (layer as Record<string, unknown>).name as string ?? layer.id.slice(0, 8),
    });
    return (layer as Record<string, unknown>).name as string ?? layer.id.slice(0, 8);
  });

  return { cleaned, mentions };
}

function buildQwenMessages(session: ChatSession): QwenMessage[] {
  const result: QwenMessage[] = [];

  // Inject timeline context as a system-prefixed user message
  const context = getTimelineContext();
  const mediaContext = getMediaContext();
  result.push({
    role: "user",
    content: `[Timeline context]\n${context}\n\n[Media library]\n${mediaContext}`,
  });

  for (const msg of session.messages) {
    if (msg.role === "system") continue;

    if (msg.role === "user") {
      const blocks: Array<Record<string, unknown>> = [];

      // If there are image mentions, add them as image blocks
      if (msg.mentions && msg.mentions.length > 0) {
        for (const m of msg.mentions) {
          if (m.imageDataUrl && m.type === "mediaAsset") {
            blocks.push({
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: m.imageDataUrl.replace(/^data:image\/\w+;base64,/, ""),
              },
            });
          }
        }
        // Add a note for the agent about inlined images
        blocks.push({
          type: "text",
          text: `[The user referenced the following media inline — do not call inspect_media for them: ${msg.mentions.filter((m) => m.imageDataUrl).map((m) => m.name).join(", ")}]`,
        });
      }

      blocks.push({ type: "text", text: msg.content });
      result.push({ role: "user", content: blocks });
      continue;
    }

    // assistant
    const blocks: Array<Record<string, unknown>> = [];
    if (msg.content) {
      blocks.push({ type: "text", text: msg.content });
    }
    if (msg.toolUse) {
      for (const tool of msg.toolUse) {
        if (tool.result) {
          blocks.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: tool.result.content,
            is_error: tool.result.isError,
          });
        } else {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(tool.inputJSON);
          } catch {}
          blocks.push({
            type: "tool_use",
            id: tool.id,
            name: tool.name,
            input,
          });
        }
      }
    }
    result.push({ role: "assistant", content: blocks });
  }

  return result;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  sessions: loadSessions(),
  currentSessionId: null,
  draft: "",
  isStreaming: false,
  streamError: null,
  model: localStorage.getItem("filmidi_agent_model") ?? "qwen3.7-plus",
  agentEditHistory: [],
  agentTurn: 0,

  createSession: () => {
    const id = makeId();
    const session: ChatSession = {
      id,
      title: STARTER_SESSION_TITLE,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    set((s) => {
      const next = { sessions: [...s.sessions, session], currentSessionId: id };
      persistSessions(next.sessions);
      return next;
    });
    return id;
  },

  selectSession: (id) => set({ currentSessionId: id }),

  closeSession: (id) =>
    set((s) => {
      const remaining = s.sessions.filter((x) => x.id !== id);
      const nextId =
        s.currentSessionId === id
          ? remaining[remaining.length - 1]?.id ?? null
          : s.currentSessionId;
      const next = { sessions: remaining, currentSessionId: nextId };
      persistSessions(next.sessions);
      return next;
    }),

  deleteSession: (id) =>
    set((s) => {
      const remaining = s.sessions.filter((x) => x.id !== id);
      const nextId =
        s.currentSessionId === id
          ? remaining[remaining.length - 1]?.id ?? null
          : s.currentSessionId;
      const next = { sessions: remaining, currentSessionId: nextId };
      persistSessions(next.sessions);
      return next;
    }),

  setDraft: (text) => set({ draft: text }),

  sendMessage: async (text) => {
    const state = get();
    if (!text.trim() || state.isStreaming) return;

    const apiKey = await getApiKey();
    const account = useAccountStore.getState();
    const isBackendUser = account.isSignedIn();
    if (!apiKey && !isBackendUser) {
      set({
        streamError:
          "No API key configured. Set it in Settings > Agent or sign in with Google to use the agent.",
      });
      return;
    }

    let sessionId = state.currentSessionId;
    if (!sessionId) {
      sessionId = state.createSession();
    }

    // Resolve @-mentions in the user's text
    const { cleaned, mentions } = await resolveMentions(text.trim());

    const userMsg: AgentMessage = {
      id: makeId(),
      role: "user",
      content: mentions.length > 0
        ? cleaned
        : text.trim(),
      mentions: mentions.length > 0 ? mentions : undefined,
      timestamp: Date.now(),
    };

    // Add user message
    set((s) => ({
      draft: "",
      isStreaming: true,
      streamError: null,
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId
          ? {
              ...sess,
              messages: [...sess.messages, userMsg],
              title:
                sess.title === STARTER_SESSION_TITLE
                  ? text.trim().slice(0, 40)
                  : sess.title,
              updatedAt: Date.now(),
            }
          : sess
      ),
    }));

    persistSessions(get().sessions);

    const model = MODEL_MAP[state.model] ?? state.model;
    const abortController = new AbortController();
    const aborter = abortController;
    (window as Record<string, unknown>).__vf_agent_abort = aborter;

    try {
      const assistantMsgId = makeId();
      let assistantContent = "";

      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId
            ? {
                ...sess,
                messages: [
                  ...sess.messages,
                  {
                    id: assistantMsgId,
                    role: "assistant" as const,
                    content: "",
                    toolUse: [],
                    timestamp: Date.now(),
                  },
                ],
                updatedAt: Date.now(),
              }
            : sess
        ),
      }));

      let maxToolRounds = 10;

      while (maxToolRounds > 0) {
        maxToolRounds--;
        const session = get().sessions.find((s) => s.id === sessionId);
        if (!session) break;

        const qwenMessages = buildQwenMessages(session);
        const agentState = get();
        const editHistoryText = agentState.agentEditHistory.length > 0
          ? "\n\nRecent agent edits (most recent first):\n" +
            agentState.agentEditHistory.slice(-12).reverse().map(
              (e) => `  [Turn ${e.turn}] ${e.tool}: ${e.summary}`,
            ).join("\n")
          : "";
        
        const effectiveAudioMode = (apiKey || isBackendUser) 
          ? "cloud" 
          : useSettingsStore.getState().audioProcessingMode;
          
        const systemMsg = `You are a creative AI assistant connected to Filmidi, an AI-native video editor. Help the user build and edit their project by calling the tools available to you.

# Core model
- The timeline has a fixed fps and resolution. All timing is in FRAMES, not seconds: frame = seconds × fps.
- Tracks are ordered and typed (video or audio). Video clips, images, and text overlays all live on video tracks.
- A clip references a media asset and occupies [startFrame, startFrame + durationFrames) on its track.
- Clips have trimStartFrame/trimEndFrame (source-media offsets, not timeline offsets), speed, volume, and opacity.
- Media assets live in a project library and are referenced by ID. They may be user-imported or AI-generated.
- IDs are returned as short prefixes. Pass them back exactly as given — never pad, complete, or guess a longer form.

# Always do
- Timeline context (totalFrames, trackCount, fps, currentFrame) is auto-injected before each of your turns. Call get_timeline only when you need the full track/clip structure.
- Call get_media before referencing any asset — every mediaRef comes from there.
- Before describing any user-supplied asset, call inspect_media and describe what you actually see — never paraphrase the filename.
- To find a moment across the library ("the sunset shot", "where she mentions the budget"), call search_media before inspecting files one by one.

# Editing
- Placements must match track type: video on video tracks, audio on audio tracks.
- Preview composition — where clips sit and how big they are on the canvas — is apply_layout's job, not set_clip_properties. Any split screen, picture-in-picture, grid, or layout: pick a named layout, assign a clip to each slot. Never hand-position with set_clip_properties transform to build a layout.
- Edits are undoable and effectively free. Don't ask permission for individual edits — just explain what you changed.
- Transcript-driven cuts (filler words, duplicate/retake removal): read the WORD-level get_transcript end-to-end as prose at least once, then cut with remove_words. After a cut, indices shift — re-read get_transcript before the next remove_words.

# Generation
- Costs real money and is not undoable. Propose the prompt, model, duration, and aspect ratio, then wait for confirmation before calling generate_video, generate_image, or generate_audio.
- All generation tools return a placeholder asset ID immediately and run in the background. Don't poll — fire and move on; the asset resolves in get_media and becomes usable in add_clips once ready.

# Audio Processing
- Audio processing mode is set to "${effectiveAudioMode}". In "local" mode, transcription and captions are unavailable — tell the user to switch to Cloud mode in Settings > Audio Processing. In "cloud" mode, use Qwen ASR for transcription. Audio denoising uses local RNNoise WASM in both modes.

# Export
- When the user asks to export/render/save, call export_project. Default mode is video. Use mode=xml for timeline XML and mode=filmidi for a self-contained .filmidi package.

# Communication
- Default to one or two sentences. Lead with the outcome; report the result, not the process. The user watches the timeline change, so never narrate steps ("let me…", "now I'll…").
- No preamble, no numbered play-by-play, no restating the plan back. Match the app's calm, terse voice: never chatty, never marketing.
- When the user is vague about aesthetic direction, ask one focused question instead of guessing.${editHistoryText}`;

        let currentToolBlock: ToolUseEntry | null = null;
        let gotStop = false;

        const useBackend = isBackendUser && account.sessionToken;
        const stream = useBackend
          ? streamChatBackend(account.sessionToken!, {
              messages: qwenMessages,
              tools: TOOL_DEFINITIONS,
              model,
              system: systemMsg,
              signal: aborter.signal,
            })
          : streamChat(apiKey!, {
              messages: qwenMessages,
              tools: TOOL_DEFINITIONS,
              model,
              system: systemMsg,
              signal: aborter.signal,
            });

        try {
          for await (const event of stream) {
            if (get().currentSessionId !== sessionId) break;

            if (event.type === "text_delta") {
              assistantContent += event.text;

              set((s) => ({
                sessions: s.sessions.map((sess) =>
                  sess.id === sessionId
                    ? {
                        ...sess,
                        messages: sess.messages.map((m) =>
                          m.id === assistantMsgId
                            ? { ...m, content: assistantContent }
                            : m
                        ),
                        updatedAt: Date.now(),
                      }
                    : sess
                ),
              }));
            }

            if (event.type === "tool_use") {
              currentToolBlock = {
                id: event.id,
                name: event.name,
                inputJSON: JSON.stringify(event.input),
              };

              set((s) => ({
                sessions: s.sessions.map((sess) =>
                  sess.id === sessionId
                    ? {
                        ...sess,
                        messages: sess.messages.map((m) =>
                          m.id === assistantMsgId
                            ? {
                                ...m,
                                toolUse: [...(m.toolUse ?? []), currentToolBlock!],
                              }
                            : m
                        ),
                        updatedAt: Date.now(),
                      }
                    : sess
                ),
              }));
            }

            if (event.type === "stop") {
              gotStop = true;

              const msg = get()
                .sessions.find((s) => s.id === sessionId)
                ?.messages.find((m) => m.id === assistantMsgId);
              if (!msg) break;

              const pendingTools =
                msg.toolUse?.filter((t) => !t.result) ?? [];
              if (pendingTools.length === 0) {
                break;
              }

              const results = await Promise.all(
                pendingTools.map(async (tool) => {
                  let input: Record<string, unknown> = {};
                  try {
                    input = JSON.parse(tool.inputJSON);
                  } catch {}
                  const resultStr = await executeTool(tool.name, input);
                  let isError = false;
                  try {
                    const parsed = JSON.parse(resultStr);
                    isError = !!parsed.error;
                  } catch {
                    isError = true;
                  }
                  // Track edit history for mutation tools
                  const mutationTools = [
                    "add_clips", "insert_clips", "remove_clips", "remove_tracks",
                    "move_clips", "split_clips", "set_clip_properties", "ripple_delete_ranges",
                    "set_keyframes", "add_texts", "update_text", "add_captions", "remove_words",
                    "apply_layout", "apply_color", "apply_effect", "create_matte",
                    "set_project_settings", "import_media",
                  ];
                  if (mutationTools.includes(tool.name) && !isError) {
                    const turn = get().agentTurn + 1;
                    const summary = typeof input === "object" ? JSON.stringify(input).slice(0, 120) : "";
                    set((s) => ({
                      agentTurn: turn,
                      agentEditHistory: [
                        ...s.agentEditHistory.slice(-30),
                        { turn, tool: tool.name, summary },
                      ],
                    }));
                  }
                  return {
                    id: tool.id,
                    name: tool.name,
                    inputJSON: tool.inputJSON,
                    result: { content: resultStr, isError },
                  };
                }),
              );

              set((s) => ({
                sessions: s.sessions.map((sess) =>
                  sess.id === sessionId
                    ? {
                        ...sess,
                        messages: sess.messages.map((m) =>
                          m.id === assistantMsgId
                            ? {
                                ...m,
                                toolUse: m.toolUse?.map((t) => {
                                  const res = results.find(
                                    (r) => r.id === t.id,
                                  );
                                  return res ?? t;
                                }),
                              }
                            : m
                        ),
                        updatedAt: Date.now(),
                      }
                    : sess
                ),
              }));

              assistantContent = "";
            }
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") {
            break;
          }
          if (!gotStop) {
            console.error("Stream error:", err);
            if (!assistantContent && !currentToolBlock) {
              set((s) => ({
                streamError: err instanceof Error ? err.message : "Stream failed",
              }));
            }
            break;
          }
        }

        if (gotStop) {
          const msg = get()
            .sessions.find((s) => s.id === sessionId)
            ?.messages.find((m) => m.id === assistantMsgId);

          if (!msg?.toolUse?.length) {
            persistSessions(get().sessions);
            break;
          }
          // Tools were executed — continue the loop so the model can respond to their results
        } else {
          break;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set((s) => ({
        streamError: msg,
      }));
    } finally {
      set({ isStreaming: false });
      persistSessions(get().sessions);
      delete (window as Record<string, unknown>).__vf_agent_abort;
    }
  },

  cancelStream: () => {
    const aborter = (window as Record<string, unknown>)
      .__vf_agent_abort as AbortController | undefined;
    aborter?.abort();
    set({ isStreaming: false });
  },

  setModel: (model) => {
    set({ model });
    localStorage.setItem("filmidi_agent_model", model);
  },

  setApiKey: (key) => {
    setSecureApiKey(key);
    set({ streamError: null });
  },

  currentSession: () => {
    const s = get();
    return s.sessions.find((x) => x.id === s.currentSessionId);
  },

  canSend: () => {
    const s = get();
    return !s.isStreaming && s.draft.trim().length > 0;
  },
}));

export { AVAILABLE_MODELS };
