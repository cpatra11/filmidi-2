import { useState, useCallback, Component, type ReactNode } from "react";
import {
  Sidebar,
  useSelection,
  useEditorStore,
  usePlayhead,
} from "@videoflow/react-video-editor";
import {
  Sparkles,
  Wand2,
  ArrowUpCircle,
  RefreshCw,
  Video,
  Music,
  Scissors,
  Replace,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";

// ─── Error boundary to prevent Sidebar crashes from killing the app ───

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class SidebarErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    console.error("[SidebarErrorBoundary]", error);
    if (info.componentStack) {
      console.error("[SidebarErrorBoundary] Component stack:", info.componentStack);
    }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div style={{ padding: 16, color: "#666666", fontSize: 12, textAlign: "center" }}>
          <p>Properties panel failed to load.</p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{ marginTop: 8, padding: "4px 12px", background: "#1C1C1C", color: "#FFFFFF", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 11 }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Tab bar above VideoFlow's sidebar ───

type InspectorTab = "properties" | "ai-edit";

function TabBar({ active, onChange }: { active: InspectorTab; onChange: (t: InspectorTab) => void }) {
  const tabs: { id: InspectorTab; label: string }[] = [
    { id: "properties", label: "Properties" },
    { id: "ai-edit", label: "AI Edit" },
  ];

  return (
    <div
      style={{
        display: "flex",
        borderBottom: "1px solid #1C1C1C",
        background: "#0A0A0A",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          style={{
            flex: 1,
            padding: "8px 4px",
            fontSize: 11,
            fontWeight: 500,
            background: "none",
            border: "none",
            borderBottom: active === tab.id ? "2px solid #FFFFFF" : "2px solid transparent",
            color: active === tab.id ? "#FFFFFF" : "#666666",
            cursor: "pointer",
            transition: "color 0.15s, border-color 0.15s",
            fontFamily: "inherit",
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ─── AI Edit Tab ───

interface EditAction {
  id: string;
  label: string;
  description: string;
  icon: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}

function AIEditTab() {
  const { layers } = useSelection();
  const { frame } = usePlayhead();

  const layer = layers.length === 1 ? layers[0] : null;
  const [prompt, setPrompt] = useState("");
  const [replaceClipSource, setReplaceClipSource] = useState(false);
  const [useTrimmedPortion, setUseTrimmedPortion] = useState(true);
  const [placeAudioOnTimeline, setPlaceAudioOnTimeline] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [enhancedSectionOpen, setEnhancedSectionOpen] = useState(true);
  const [audioSectionOpen, setAudioSectionOpen] = useState(true);
  const [scopeSectionOpen, setScopeSectionOpen] = useState(true);

  const layerType = layer?.type ?? "unknown";
  const hasVisual = layerType === "video" || layerType === "image";
  const canAIEdit = hasVisual && layer;

  const runAction = useCallback((actionId: string) => {
    setIsGenerating(true);
    // TODO: Wire to actual AI generation API
    setTimeout(() => {
      setIsGenerating(false);
    }, 3000);
  }, []);

  if (!layer) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center" style={{ color: "#666666" }}>
        <Sparkles size={28} className="mb-3 opacity-40" />
        <p className="text-xs font-medium mb-1" style={{ color: "#FFFFFF" }}>No clip selected</p>
        <p className="text-[11px] opacity-60">Select a clip on the timeline to use AI editing</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Scope section */}
      <CollapsibleSection title="Scope" open={scopeSectionOpen} onToggle={() => setScopeSectionOpen(!scopeSectionOpen)}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <ToggleRow
            icon={<Replace size={13} />}
            label="Replace clip source"
            description="Swap the clip's media when generation completes"
            checked={replaceClipSource}
            onChange={setReplaceClipSource}
          />
          <ToggleRow
            icon={<Scissors size={13} />}
            label="Use trimmed portion"
            description="Send only the visible clip range to the model"
            checked={useTrimmedPortion}
            onChange={setUseTrimmedPortion}
          />
        </div>
      </CollapsibleSection>

      {/* AI Enhance section */}
      <CollapsibleSection title="AI Enhance" open={enhancedSectionOpen} onToggle={() => setEnhancedSectionOpen(!enhancedSectionOpen)}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <ActionRow
            icon={<ArrowUpCircle size={14} />}
            label="Upscale"
            description="Enhance resolution with AI"
            onClick={() => runAction("upscale")}
            disabled={!hasVisual || isGenerating}
          />
          <ActionRow
            icon={<Wand2 size={14} />}
            label="Edit"
            description="Transform with a prompt"
            onClick={() => runAction("edit")}
            disabled={!canAIEdit || isGenerating}
          />
          <ActionRow
            icon={<RefreshCw size={14} />}
            label="Rerun"
            description="Regenerate with same parameters"
            onClick={() => runAction("rerun")}
            disabled={isGenerating}
          />
          {layerType === "image" && (
            <ActionRow
              icon={<Video size={14} />}
              label="Create Video"
              description="Use as first frame or reference"
              onClick={() => runAction("create-video")}
              disabled={isGenerating}
            />
          )}
        </div>
      </CollapsibleSection>

      {/* AI Audio section (video clips only) */}
      {hasVisual && (
        <CollapsibleSection title="AI Audio" open={audioSectionOpen} onToggle={() => setAudioSectionOpen(!audioSectionOpen)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <ToggleRow
              icon={<Music size={13} />}
              label="Place on timeline"
              description="Add generated audio to an audio track"
              checked={placeAudioOnTimeline}
              onChange={setPlaceAudioOnTimeline}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <ActionRow
                icon={<Music size={14} />}
                label="Generate Music"
                description="Create music from this video"
                onClick={() => runAction("generate-music")}
                disabled={isGenerating}
              />
              <ActionRow
                icon={<Music size={14} />}
                label="Generate SFX"
                description="Create sound effects from this video"
                onClick={() => runAction("generate-sfx")}
                disabled={isGenerating}
              />
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* Prompt input */}
      {canAIEdit && (
        <div style={{ padding: "10px 16px", borderTop: "1px solid #1C1C1C" }}>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the edit you want..."
            style={{
              width: "100%",
              minHeight: 60,
              padding: "8px 10px",
              fontSize: 12,
              fontFamily: "inherit",
              background: "#141414",
              color: "#FFFFFF",
              border: "1px solid #1C1C1C",
              borderRadius: 6,
              resize: "vertical",
              outline: "none",
            }}
          />
          <button
            onClick={() => runAction("custom-edit")}
            disabled={!prompt.trim() || isGenerating}
            style={{
              width: "100%",
              marginTop: 8,
              padding: "7px 0",
              fontSize: 12,
              fontWeight: 600,
              fontFamily: "inherit",
              background: prompt.trim() ? "#FFFFFF" : "#141414",
              color: prompt.trim() ? "#fff" : "#666666",
              border: "none",
              borderRadius: 6,
              cursor: prompt.trim() && !isGenerating ? "pointer" : "default",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              transition: "background 0.15s",
            }}
          >
            {isGenerating ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles size={13} />
                Apply AI Edit
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Reusable sub-components ───

function CollapsibleSection({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div style={{ borderBottom: "1px solid #1C1C1C" }}>
      <button
        onClick={onToggle}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "10px 16px",
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "#666666",
          background: "none",
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {title}
      </button>
      {open && <div style={{ padding: "0 16px 12px" }}>{children}</div>}
    </div>
  );
}

function ToggleRow({ icon, label, description, checked, onChange }: {
  icon: ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
      <span style={{ color: "#666666", marginTop: 1, flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 11, color: "#FFFFFF", margin: 0, lineHeight: 1.3 }}>{label}</p>
        <p style={{ fontSize: 10, color: "#444444", margin: "2px 0 0", lineHeight: 1.3 }}>{description}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        style={{
          width: 32,
          height: 18,
          borderRadius: 9,
          border: "none",
          background: checked ? "#FFFFFF" : "#1C1C1C",
          position: "relative",
          cursor: "pointer",
          flexShrink: 0,
          transition: "background 0.15s",
          marginTop: 1,
        }}
      >
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: "#fff",
            position: "absolute",
            top: 2,
            left: checked ? 16 : 2,
            transition: "left 0.15s",
          }}
        />
      </button>
    </div>
  );
}

function ActionRow({ icon, label, description, onClick, disabled }: {
  icon: ReactNode;
  label: string;
  description: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        fontSize: 12,
        fontFamily: "inherit",
        background: "#141414",
        border: "1px solid #1C1C1C",
        borderRadius: 6,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        color: "#FFFFFF",
        textAlign: "left",
        transition: "border-color 0.15s, background 0.15s",
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.borderColor = "#FFFFFF";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "#1C1C1C";
      }}
    >
      <span style={{ color: "#FFFFFF", flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 12, fontWeight: 500, margin: 0, lineHeight: 1.3 }}>{label}</p>
        <p style={{ fontSize: 10, color: "#666666", margin: "1px 0 0", lineHeight: 1.3 }}>{description}</p>
      </div>
    </button>
  );
}

// ─── Main exported Sidebar ───

export function InspectorSidebar() {
  const [activeTab, setActiveTab] = useState<InspectorTab>("properties");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        background: "#0A0A0A",
      }}
    >
      <TabBar active={activeTab} onChange={setActiveTab} />

      {activeTab === "properties" && (
        <div style={{ flex: 1, overflow: "auto" }}>
          <SidebarErrorBoundary>
            <Sidebar />
          </SidebarErrorBoundary>
        </div>
      )}

      {activeTab === "ai-edit" && (
        <div style={{ flex: 1, overflow: "auto" }}>
          <AIEditTab />
        </div>
      )}
    </div>
  );
}
