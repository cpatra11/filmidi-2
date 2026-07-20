import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Undo2,
  Redo2,
  MousePointer2,
  Scissors,
  Trash2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Play,
  Pause,
  StepForward,
  StepBack,
  PanelLeft,
  PanelRight,
  PanelLeftClose,
  PanelRightClose,
  Sparkles,
  Music,
  SplitSquareVertical,
  ChevronLeft,
  ChevronRight,
  Download,
  Home,
  Magnet,
  Flag,
  Type,
  Square,
  Plus,
  Upload,
  Circle,
  Triangle,
  Minus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAppStore } from "@/store/useAppStore";
import { useExportStore } from "@/store/useExportStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useEditorStore } from "@videoflow/react-video-editor";
import { cn } from "@/lib/utils";
import { splitAtPlayhead, trimSelectedToPlayhead } from "@/hooks/useKeyboardShortcuts";
import { importMediaFromPicker } from "@/lib/menuActions";
import { addMatteLayerAtPlayhead, addTextLayerAtPlayhead, addVideoTrack } from "@/lib/timelineAddActions";

// Expand layer IDs to include linked partners
function expandToPartners(ids: string[]): string[] {
  const layers = useEditorStore.getState().video.layers ?? [];
  const set = new Set(ids);
  for (const id of ids) {
    const partner = layers.find((l: any) => l.settings?.linkId && l.id !== id && layers.find((x: any) => x.id === id)?.settings?.linkId === l.settings?.linkId);
    if (partner) set.add(partner.id);
  }
  return Array.from(set);
}

function ToolButton({
  icon: Icon,
  label,
  shortcut,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={active ? "secondary" : "ghost"}
            size="icon-sm"
            onClick={onClick}
            className={cn(
              "text-white/50 hover:text-white/80",
              active && "bg-white/10 text-white"
            )}
          />
        }
      >
        <Icon size={14} />
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        <span>{label}</span>
        {shortcut && (
          <span className="ml-1.5 text-muted-foreground text-[10px]">
            {shortcut}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function ToolbarDivider() {
  return <span aria-hidden="true" className="px-1 text-[13px] leading-none text-white/20">|</span>;
}

function ShapeSelector() {
  const [open, setOpen] = useState(false);
  const shapes = [
    { type: "rectangle", label: "Rectangle", icon: Square },
    { type: "ellipse", label: "Ellipse", icon: Circle },
    { type: "triangle", label: "Triangle", icon: Triangle },
    { type: "line", label: "Line", icon: Minus },
  ];

  return (
    <div className="relative">
      <Tooltip>
        <TooltipTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label="Add shape" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="text-white/50 hover:text-white/80" />}
        >
          <Square size={14} />
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>Add Shape</TooltipContent>
      </Tooltip>
      {open && (
        <div className="absolute left-0 top-8 z-50 min-w-36 rounded-md border border-white/15 bg-[#151515] p-1 shadow-xl">
          <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-white/40">Shape</div>
          {shapes.map(({ type, label, icon: Icon }) => (
            <button key={type} type="button" onClick={() => { setOpen(false); void addMatteLayerAtPlayhead(type); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-white/75 hover:bg-white/10 hover:text-white">
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Toolbar() {
  const {
    toolMode,
    setToolMode,
    snapEnabled,
    setSnapEnabled,
    showAgentPanel,
    toggleAgentPanel,
    showInspector,
    toggleInspector,
    showMediaPanel,
    toggleMediaPanel,
    showGenerationPanel,
    toggleGenerationPanel,
  } = useAppStore();
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const viewport = useEditorStore((s) => s.viewport);

  return (
    <div className="h-9 flex items-center px-2 gap-0.5 bg-[#0A0A0A] border-b border-[#1C1C1C] select-none shrink-0">
      {/* Undo / Redo */}
      <ToolButton icon={Undo2} label="Undo" shortcut="⌘Z" onClick={() => useEditorStore.getState().undo()} />
      <ToolButton icon={Redo2} label="Redo" shortcut="⌘⇧Z" onClick={() => useEditorStore.getState().redo()} />

      <ToolbarDivider />

      {/* Tools */}
      <ToolButton icon={MousePointer2} label="Pointer" shortcut="V" active={toolMode === "pointer"} onClick={() => setToolMode("pointer")} />
      <ToolButton icon={Scissors} label="Razor" shortcut="B" active={toolMode === "razor"} onClick={() => setToolMode("razor")} />
      <ToolButton icon={SplitSquareVertical} label="Split" shortcut="S" onClick={splitAtPlayhead} />
      <ToolButton icon={ChevronLeft} label="Split Left" shortcut="⌥S" onClick={() => trimSelectedToPlayhead("left")} />
      <ToolButton icon={ChevronRight} label="Split Right" shortcut="⌥⇧S" onClick={() => trimSelectedToPlayhead("right")} />

      <ToolbarDivider />

      {/* Add timeline layers at the playhead */}
      <ToolButton icon={Type} label="Add Text" onClick={() => { void addTextLayerAtPlayhead(); }} />
      <ShapeSelector />
      <ToolButton icon={Plus} label="Add Video Track" onClick={addVideoTrack} />
      <ToolButton icon={Upload} label="Import Media" shortcut="⌘I" onClick={() => { void importMediaFromPicker(); }} />

      <ToolbarDivider />

      {/* Snap toggle */}
      <ToolButton icon={Magnet} label="Snap" shortcut="N" active={useAppStore.getState().snapEnabled} onClick={() => {
        const s = useAppStore.getState();
        s.setSnapEnabled(!s.snapEnabled);
      }} />

      <ToolbarDivider />

      {/* Playback */}
      <ToolButton icon={isPlaying ? Pause : Play} label={isPlaying ? "Pause" : "Play"} shortcut="Space" onClick={() => {
        const s = useEditorStore.getState();
        if (!s.bridge) return;
        if (s.isPlaying) { s.bridge.stop(); s.setPlaying(false); }
        else { s.setPlaying(true); s.bridge.play(); }
      }} />
      <ToolButton icon={StepBack} label="Step Back" shortcut="←" onClick={() => {
        const s = useEditorStore.getState();
        const f = Math.max(0, s.currentFrame - 1);
        s.setCurrentFrame(f);
        s.bridge?.seek(f);
      }} />
      <ToolButton icon={StepForward} label="Step Forward" shortcut="→" onClick={() => {
        const s = useEditorStore.getState();
        const fps = s.video.fps || 30;
        const f = Math.min(Math.max(0, Math.floor(s.video.duration * fps) - 1), s.currentFrame + 1);
        s.setCurrentFrame(f);
        s.bridge?.seek(f);
      }} />

      <ToolbarDivider />

      {/* Zoom */}
      <ToolButton icon={ZoomOut} label="Zoom Out" shortcut="⌘-" onClick={() => {
        const s = useEditorStore.getState();
        s.setViewport({ timelineScale: Math.max(0.1, s.viewport.timelineScale / 1.2), previewZoom: Math.max(0.05, (s.viewport.previewZoom || 1) / 1.2) });
      }} />
      <div className="px-1.5 text-[11px] text-white/30 font-mono min-w-[40px] text-center">
        {Math.round((viewport.timelineScale || 1) * 100)}%
      </div>
      <ToolButton icon={ZoomIn} label="Zoom In" shortcut="⌘+" onClick={() => {
        const s = useEditorStore.getState();
        s.setViewport({ timelineScale: Math.min(5, s.viewport.timelineScale * 1.2), previewZoom: Math.min(16, (s.viewport.previewZoom || 1) * 1.2) });
      }} />
      <ToolButton icon={Maximize2} label="Zoom Fit" shortcut="⌘0" onClick={() => {
        useEditorStore.getState().setViewport({ timelineScale: 1, previewZoom: 1 });
      }} />

      {/* Marker toggle — M+click on ruler to place */}
      <ToolButton icon={Flag} label="Marker" shortcut="M" active={!!(window as any).__markerMode} onClick={() => {
        (window as any).__markerMode = !(window as any).__markerMode;
        // Force re-render
        useAppStore.getState().setTrackHeight(useAppStore.getState().trackHeight);
      }} />

      {/* Track height */}
      <div style={{ display: "flex", alignItems: "center", gap: 3, marginLeft: 4 }}>
        <span style={{ fontSize: 10, opacity: 0.4, cursor: "default" }}>TH</span>
        <input
          type="range"
          min="24" max="80" step="2"
          value={useAppStore.getState().trackHeight}
          onChange={(e) => useAppStore.getState().setTrackHeight(parseInt(e.target.value, 10))}
          style={{ width: 40, accentColor: "#888", cursor: "pointer" }}
          title="Track height"
        />
      </div>

      <ToolbarDivider />

      {/* Delete */}
      <ToolButton icon={Trash2} label="Delete" shortcut="Del" onClick={() => {
        const s = useEditorStore.getState();
        const ids = expandToPartners(s.selection.layerIds);
        if (ids.length > 0) {
          s.commit((v: any) => {
            const idSet = new Set(ids);
            const remove = (layers: any[]) => {
              for (let i = layers.length - 1; i >= 0; i--) {
                if (idSet.has(layers[i].id)) layers.splice(i, 1);
                else if (layers[i].type === "group" && Array.isArray(layers[i].children)) remove(layers[i].children);
              }
            };
            remove(v.layers);
          }, { label: "Delete layers" });
          s.clearSelection();
        }
      }} />

      <div className="flex-1" />

      {/* AI / Generation */}
      <ToolButton icon={Sparkles} label="Agent" active={showAgentPanel} onClick={toggleAgentPanel} />
      <ToolButton icon={Music} label="Generate" active={showGenerationPanel} onClick={toggleGenerationPanel} />

      <ToolbarDivider />

      {/* Panel toggles */}
      <ToolButton icon={showMediaPanel ? PanelLeft : PanelLeftClose} label="Media" shortcut="⌘⇧M" active={showMediaPanel} onClick={toggleMediaPanel} />
      <ToolButton icon={showInspector ? PanelRight : PanelRightClose} label="Inspector" shortcut="⌘⇧I" active={showInspector} onClick={toggleInspector} />

      <ToolbarDivider />

      {/* Export */}
      <ToolButton icon={Download} label="Export" shortcut="⌘E" onClick={() => useExportStore.getState().open()} />

      <ToolbarDivider />

      {/* Home */}
      <ToolButton icon={Home} label="Home" onClick={() => useProjectStore.getState().openProject(null)} />
    </div>
  );
}
