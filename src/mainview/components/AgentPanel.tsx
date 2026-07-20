import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useAgentStore, AVAILABLE_MODELS, type AgentMessage, type ChatSession, type MentionRef } from "@/store/useAgentStore";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Sparkles,
  Film,
  Camera,
  Captions,
  AudioWaveform,
  Music,
  FolderOpen,
  Plus,
  Clock,
  ArrowUp,
  Square,
  X,
  ChevronRight,
  Copy,
  Check,
  Loader2,
  MessageSquare,
  Settings,
  ChevronDown,
  Trash2,
  ImageIcon,
  Video,
} from "lucide-react";
import { useMediaPanelStore } from "@/store/useMediaPanelStore";
import { useEditorStore } from "@videoflow/react-video-editor";

/* ------------------------------------------------------------------ */
/*  Starter prompts                                                    */
/* ------------------------------------------------------------------ */

const STARTER_PROMPTS = [
  {
    title: "Generate an AI video",
    icon: Sparkles,
    prompt: "Generate an AI video of ",
  },
  {
    title: "Generate B-roll",
    icon: Film,
    prompt: "Generate B-roll for my timeline. Inspect the current edit, identify sections that would benefit from cutaways, generate suitable B-roll, and place it where it supports the story.",
  },
  {
    title: "Create a letterbox opening",
    icon: Camera,
    prompt: "Create a cinematic opening for my timeline. Use the first visual clip, animate a subtle letterbox matte with top and bottom crop keyframes, starting from crop to uncrop, and keep the motion restrained and polished.",
  },
  {
    title: "Add captions to my timeline",
    icon: Captions,
    prompt: "Add captions to my timeline. Transcribe spoken audio in timeline clips, build readable caption phrases on word boundaries, and place them as text clips aligned to the edit.",
  },
  {
    title: "Create a voiceover",
    icon: AudioWaveform,
    prompt: "Create a voiceover for my timeline. Draft concise narration for the current edit, generate the voiceover, and add it to an audio track aligned with the timeline.",
  },
  {
    title: "Generate music and sync to my timeline",
    icon: Music,
    prompt: "Score my timeline with music. Inspect the edit's mood and pacing, generate music for the full timeline, and place it on an audio track aligned to the edit.",
  },
  {
    title: "Organize my media into structured folders",
    icon: FolderOpen,
    prompt: "Organize my media into structured folders. Review all assets, create clearly named folders by role, scene, or type, move assets into them, and rename generic files when useful. Don't delete anything or change the timeline.",
  },
];

/* ------------------------------------------------------------------ */
/*  Thinking dots                                                      */
/* ------------------------------------------------------------------ */

function ThinkingDots() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setPhase((p) => (p + 1) % 3), 280);
    return () => clearInterval(iv);
  }, []);
  return (
    <div className="flex gap-[5px] py-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="w-[5px] h-[5px] rounded-full bg-[#8888aa] transition-opacity duration-250"
          style={{ opacity: phase === i ? 1 : 0.25 }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tool run row                                                       */
/* ------------------------------------------------------------------ */

function ToolRunRow({
  name,
  inputJSON,
  result,
}: {
  name: string;
  inputJSON: string;
  result?: { content: string; isError: boolean };
}) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = !result;
  const prettyJSON = (() => {
    try {
      const obj = JSON.parse(inputJSON);
      return JSON.stringify(obj, null, 2);
    } catch {
      return "(no args)";
    }
  })();

  return (
    <div className="flex flex-col gap-1.5">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-2 text-left group cursor-pointer"
      >
        {isRunning ? (
          <Loader2 className="w-3 h-3 animate-spin text-[#8888aa]" />
        ) : result.isError ? (
          <X className="w-3 h-3 text-red-400" />
        ) : (
          <Check className="w-3 h-3 text-[#8888aa]" />
        )}
        <span className="text-[11px] font-medium font-mono text-[#8888aa]">
          {name}
        </span>
        <ChevronRight
          className={`w-2.5 h-2.5 text-[#8888aa] transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
        />
      </button>
      {expanded && (
        <div className="ml-4 p-3 rounded-lg bg-black/20 text-[11px] font-mono text-[#8888aa] select-text">
          <div className="mb-1 text-[9px] uppercase text-[#555577]">
            args
          </div>
          <pre className="whitespace-pre-wrap">{prettyJSON}</pre>
          {result && (
            <>
              <div
                className={`mt-2 mb-1 text-[9px] uppercase ${result.isError ? "text-red-400" : "text-[#555577]"}`}
              >
                {result.isError ? "error" : "result"}
              </div>
              <pre className="whitespace-pre-wrap">{result.content}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Copy message button                                                */
/* ------------------------------------------------------------------ */

function CopyMessageButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 text-[10px] text-[#8888aa] hover:text-[#aaaacc] cursor-pointer"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Message view                                                       */
/* ------------------------------------------------------------------ */

function MessageView({ message }: { message: AgentMessage }) {
  const [hovering, setHovering] = useState(false);

  if (message.role === "system") {
    return (
      <div className="flex justify-center py-2">
        <span className="text-[11px] text-[#8888aa] text-center">
          {message.content}
        </span>
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <div className="flex justify-end pl-12">
        <div className="px-4 py-2.5 rounded-2xl bg-white/5 text-[13px] text-[#e0e0ee] leading-relaxed select-text">
          {message.content}
        </div>
      </div>
    );
  }

  // assistant
  return (
    <div
      className="flex flex-col gap-2 max-w-full text-left"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div className="text-[13px] text-[#e0e0ee] leading-relaxed whitespace-pre-wrap select-text">
        {message.content}
      </div>
      {message.toolUse?.map((tool) => (
        <ToolRunRow
          key={tool.id}
          name={tool.name}
          inputJSON={tool.inputJSON}
          result={tool.result}
        />
      ))}
      {!message.toolUse && (
        <div
          className={`transition-opacity duration-150 ${hovering ? "opacity-100" : "opacity-0"}`}
        >
          <CopyMessageButton text={message.content} />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Chat tab                                                           */
/* ------------------------------------------------------------------ */

function ChatTab({
  session,
  isActive,
  onSelect,
  onClose,
}: {
  session: ChatSession;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const [hovering, setHovering] = useState(false);
  const title =
    session.title.length > 20
      ? session.title.slice(0, 20) + "\u2026"
      : session.title;

  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className="flex flex-col items-center gap-1 px-3 pt-1 cursor-pointer group min-w-0"
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          className={`text-[11px] truncate max-w-[120px] ${isActive ? "font-semibold text-[#e0e0ee]" : "text-[#8888aa]"}`}
        >
          {title}
        </span>
        {(hovering || isActive) && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="w-4 h-4 flex items-center justify-center text-[#555577] hover:text-[#8888aa] cursor-pointer"
          >
            <X className="w-2.5 h-2.5" />
          </button>
        )}
      </div>
      <div
        className={`w-full h-[2px] rounded-full ${isActive ? "bg-[#e0e0ee]" : "bg-transparent"}`}
      />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Chat history popover                                               */
/* ------------------------------------------------------------------ */

function ChatHistoryList({
  sessions,
  currentId,
  onSelect,
  onDelete,
}: {
  sessions: ChatSession[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <div className="w-[280px] max-h-[360px] overflow-y-auto rounded-lg bg-[#0A0A0A] border border-[#1C1C1C]">
      {sorted.length === 0 ? (
        <div className="p-3 text-[11px] text-[#555577]">
          No conversations yet
        </div>
      ) : (
        sorted.map((sess) => {
          const isCurrent = sess.id === currentId;
          return (
            <div
              key={sess.id}
              onClick={() => onSelect(sess.id)}
              className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer ${isCurrent ? "bg-white/8" : "hover:bg-white/5"}`}
            >
              <div className="flex-1 min-w-0">
                <div
                  className={`text-[11px] truncate ${isCurrent ? "font-semibold text-[#e0e0ee]" : "text-[#ccccee]"}`}
                >
                  {sess.title}
                </div>
                <div className="text-[9px] text-[#8888aa]">
                  {new Date(sess.updatedAt).toLocaleDateString()}
                </div>
              </div>
              {!isCurrent && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(sess.id);
                  }}
                  className="text-[#555577] hover:text-[#8888aa] cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Starter prompt button                                              */
/* ------------------------------------------------------------------ */

function StarterPromptButton({
  icon: Icon,
  title,
  onClick,
}: {
  icon: React.ElementType;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg bg-white/5 border border-white/5 hover:bg-white/10 cursor-pointer text-left transition-colors"
    >
      <Icon className="w-4 h-4 text-[#8888aa] shrink-0" />
      <span className="text-[13px] font-medium text-[#e0e0ee]">{title}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Main AgentPanel                                                    */
/* ------------------------------------------------------------------ */

export function AgentPanel() {
  const {
    sessions,
    currentSessionId,
    draft,
    isStreaming,
    model,
    createSession,
    selectSession,
    closeSession,
    deleteSession,
    setDraft,
    sendMessage,
    cancelStream,
    setModel,
    currentSession,
    canSend,
    streamError,
  } = useAgentStore();

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelBtnRef = useRef<HTMLButtonElement>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);

  // @-mention autocomplete
  const [mentionQuery, setMentionQuery] = useState("");
  const [showMentions, setShowMentions] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionTriggerPos, setMentionTriggerPos] = useState(0);

  const session = currentSession();
  const mediaAssets = useMediaPanelStore((s) => s.assets);
  const mediaFolders = useMediaPanelStore((s) => s.folders);
  const timelineLayers = useEditorStore((s) => s.video.layers ?? []);

  // Build mention suggestions from media + timeline
  const mentionSuggestions = useMemo(() => {
    if (!mentionQuery && !showMentions) return [];
    const q = mentionQuery.toLowerCase().trim();
    const items: { type: "mediaAsset" | "mediaFolder" | "timelineClip"; id: string; name: string }[] = [];

    for (const folder of mediaFolders) {
      if (!q || folder.name.toLowerCase().includes(q)) {
        items.push({ type: "mediaFolder", id: folder.id, name: folder.name });
      }
    }

    for (const a of mediaAssets) {
      if (!q || a.name.toLowerCase().includes(q)) {
        items.push({ type: "mediaAsset", id: a.id, name: a.name });
      }
    }

    for (const l of timelineLayers) {
      const name = (l as Record<string, unknown>).name as string ?? (l as { id: string }).id.slice(0, 8);
      if (!q || name.toLowerCase().includes(q)) {
        items.push({ type: "timelineClip", id: (l as { id: string }).id, name });
      }
    }

    return items.slice(0, 20);
  }, [mentionQuery, showMentions, mediaAssets, mediaFolders, timelineLayers]);

  // Handle input change with @-mention detection
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setDraft(value);

      // Detect @ trigger
      const cursorPos = e.target.selectionStart ?? value.length;
      const textBefore = value.slice(0, cursorPos);
      const atIdx = textBefore.lastIndexOf("@");

      if (atIdx !== -1) {
        // @ must start a token, but the searchable name may contain spaces.
        const charBeforeAt = textBefore[atIdx - 1];
        if (charBeforeAt && !/\s/.test(charBeforeAt)) {
          setShowMentions(false);
          setMentionQuery("");
          return;
        }
        const afterAt = textBefore.slice(atIdx + 1);
        setMentionQuery(afterAt);
        setShowMentions(true);
        setMentionIndex(0);
        setMentionTriggerPos(atIdx);
        return;
      }

      setShowMentions(false);
      setMentionQuery("");
    },
    [setDraft],
  );

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [session?.messages.length, isStreaming]);

  // Auto-create first session if needed
  useEffect(() => {
    if (sessions.length === 0) createSession();
  }, []);

  const handleSend = useCallback(() => {
    if (!canSend()) return;
    sendMessage(draft);
  }, [draft, canSend, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showMentions && mentionSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionSuggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionSuggestions.length) % mentionSuggestions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(mentionSuggestions[mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        setShowMentions(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const insertMention = useCallback(
    (item: { type: "mediaAsset" | "mediaFolder" | "timelineClip"; id: string; name: string }) => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const value = draft;
      const before = value.slice(0, mentionTriggerPos);
      const cursorPos = textarea.selectionStart ?? value.length;
      const rest = value.slice(cursorPos);
      const prefix = item.type === "mediaAsset" ? "asset" : item.type === "mediaFolder" ? "folder" : "clip";
      const replacement = `@${prefix}:${item.id}`;
      const newValue = before + replacement + rest;
      setDraft(newValue);
      setShowMentions(false);
      // Focus and set cursor
      setTimeout(() => {
        textarea.focus();
        const pos = before.length + replacement.length;
        textarea.setSelectionRange(pos, pos);
      }, 0);
    },
    [draft, mentionTriggerPos, setDraft],
  );

  const handleStarterPrompt = (prompt: string) => {
    setDraft(prompt);
    textareaRef.current?.focus();
  };

  return (
    <div className="h-full flex flex-col bg-[#0A0A0A]">
      {/* Floating tab bar */}
      <div className="flex items-center gap-1 px-2 h-10 border-b border-[#1C1C1C] shrink-0 bg-[#0A0A0A]/80 backdrop-blur-sm">
        <div className="flex-1 min-w-0 flex items-center overflow-hidden">
          {session && (
            <ChatTab
              session={session}
              isActive
              onSelect={() => selectSession(session.id)}
              onClose={() => closeSession(session.id)}
            />
          )}
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                onClick={() => createSession()}
                className="w-6 h-6 flex items-center justify-center text-[#8888aa] hover:text-[#aaaacc] cursor-pointer"
              />
            }
          >
            <Plus className="w-3.5 h-3.5" />
          </TooltipTrigger>
          <TooltipContent>New chat</TooltipContent>
        </Tooltip>
        <Popover open={showHistory} onOpenChange={setShowHistory}>
          <PopoverTrigger
            render={
              <button className="w-6 h-6 flex items-center justify-center text-[#8888aa] hover:text-[#aaaacc] cursor-pointer" />
            }
          >
            <Clock className="w-3.5 h-3.5" />
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="p-0 border-[#1C1C1C] bg-[#0A0A0A]">
            <ChatHistoryList
              sessions={sessions}
              currentId={currentSessionId}
              onSelect={(id) => {
                selectSession(id);
                setShowHistory(false);
              }}
              onDelete={deleteSession}
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Message list or empty state */}
      <div className="flex-1 min-h-0 relative">
        <div ref={scrollRef} className="h-full overflow-y-auto px-4 pt-2 pb-4">
          {(!session || session.messages.length === 0) && !isStreaming ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 max-w-[360px] mx-auto">
              <span className="text-[14px] font-medium text-[#aaaacc]">
                Ask anything, or start with:
              </span>
              <div className="flex flex-col gap-1.5 w-full">
                {STARTER_PROMPTS.map((sp) => (
                  <StarterPromptButton
                    key={sp.title}
                    icon={sp.icon}
                    title={sp.title}
                    onClick={() => handleStarterPrompt(sp.prompt)}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4 max-w-[520px] mx-auto">
              {session?.messages.map((msg) => (
                <MessageView key={msg.id} message={msg} />
              ))}
              {isStreaming && <ThinkingDots />}
            </div>
          )}
        </div>
      </div>

      {/* Footer: input box */}
      <div className="px-3 pb-3 pt-1 shrink-0">
        <div className="rounded-2xl bg-black/20 border border-white/10 focus-within:border-white/20 transition-colors overflow-visible">
          {/* Textarea */}
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Ask, or type @ to reference media"
              rows={1}
              className="w-full bg-transparent text-[13px] text-[#e0e0ee] placeholder:text-[#555577] px-4 pt-2.5 pb-1 resize-none outline-none min-h-[32px] max-h-[64px]"
              style={{ fieldSizing: "content" } as React.CSSProperties}
            />

            {/* @-mention autocomplete dropdown */}
            {showMentions && mentionSuggestions.length > 0 && (
              <div className="absolute bottom-full left-2 mb-1 w-[280px] max-h-[200px] overflow-y-auto bg-[#0A0A0A] border border-[#1C1C1C] rounded-lg shadow-lg z-50">
                {mentionSuggestions.map((item, idx) => (
                  <button
                    key={`${item.type}-${item.id}`}
                    onClick={() => insertMention(item)}
                    onMouseEnter={() => setMentionIndex(idx)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] cursor-pointer ${idx === mentionIndex
                        ? "bg-white/10 text-[#e0e0ee]"
                        : "text-[#aaaacc] hover:bg-white/5"
                      }`}
                  >
                    {item.type === "mediaFolder" ? (
                      <FolderOpen className="w-3 h-3 shrink-0" />
                    ) : item.type === "mediaAsset" ? (
                      <Video className="w-3 h-3 shrink-0" />
                    ) : (
                      <Film className="w-3 h-3 shrink-0" />
                    )}
                    <span className="truncate">{item.name}</span>
                    <span className="text-[9px] text-[#555577] shrink-0 ml-auto">
                      {item.type === "mediaFolder" ? "folder" : item.type === "mediaAsset" ? "media" : "clip"}
                    </span>
                  </button>
                ))}
              </div>
            )}

          </div>
          {/* Bottom bar */}
          <div className="flex items-center gap-2 px-2 py-2 border-t border-white/5">
            {/* Model picker */}
            <div className="relative">
              <button
                ref={modelBtnRef}
                onClick={() => setShowModelPicker((v) => !v)}
                className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium text-[#aaaacc] hover:text-[#ccccee] cursor-pointer"
              >
                {AVAILABLE_MODELS.find((m) => m.id === model)?.name ?? model}
                <ChevronDown className="w-2.5 h-2.5" />
              </button>
              {showModelPicker && modelBtnRef.current && (() => {
                const rect = modelBtnRef.current.getBoundingClientRect();
                return (
                  <div
                    className="fixed z-[9999] bg-[#0A0A0A] border border-[#1C1C1C] rounded-lg shadow-lg overflow-y-auto min-w-[180px]"
                    style={{
                      left: rect.left,
                      bottom: window.innerHeight - rect.top + 4,
                      maxHeight: Math.min(400, rect.top - 20),
                    }}
                  >
                    <div className="px-3 py-1 text-[9px] text-[#555577] border-b border-white/5 sticky top-0 bg-[#0A0A0A]">{AVAILABLE_MODELS.length} models</div>
                    {AVAILABLE_MODELS.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => {
                          setModel(m.id);
                          setShowModelPicker(false);
                        }}
                        className={`w-full px-3 py-1.5 text-left text-[11px] cursor-pointer truncate ${model === m.id ? "bg-white/10 text-[#e0e0ee]" : "text-[#aaaacc] hover:bg-white/5"}`}
                        title={m.name}
                      >
                        {m.name}
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>

            <div className="flex-1" />

            {/* Send / Stop */}
            {isStreaming ? (
              <button
                onClick={cancelStream}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/15 text-[#aaaacc] cursor-pointer transition-colors"
              >
                <Square className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!canSend()}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-white hover:bg-white/90 text-white cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-default"
              >
                <ArrowUp className="w-4 h-4" strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
