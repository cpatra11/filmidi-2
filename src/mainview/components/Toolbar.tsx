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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { useAppStore } from "@/store/useAppStore";
import { useExportStore } from "@/store/useExportStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useEditorStore } from "@videoflow/react-video-editor";
import { cn } from "@/lib/utils";

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

      <Separator orientation="vertical" className="mx-1 h-4 bg-white/10" />

      {/* Tools */}
      <ToolButton icon={MousePointer2} label="Pointer" shortcut="V" active={toolMode === "pointer"} onClick={() => setToolMode("pointer")} />
      <ToolButton icon={Scissors} label="Razor" shortcut="B" active={toolMode === "razor"} onClick={() => setToolMode("razor")} />
      <ToolButton icon={SplitSquareVertical} label="Split" shortcut="S" onClick={() => {
        const s = useEditorStore.getState();
        const frame = s.currentFrame;
        const fps = s.video.fps || 30;
        const ids = expandToPartners(s.selection.layerIds);
        if (ids.length === 0) return;
        s.commit((v: any) => {
          const idSet = new Set(ids);
          const toAdd: any[] = [];
          const processLayers = (layers: any[]) => {
            for (const layer of layers) {
              if (idSet.has(layer.id)) {
                const startFrame = Math.round(layer.startTime * fps);
                const durFrames = Math.round((layer.duration || layer.sourceDuration || 5) * fps);
                if (frame > startFrame && frame < startFrame + durFrames) {
                  const splitOffset = (frame - startFrame) / fps;
                  const origDur = layer.duration || layer.sourceDuration || 5;
                  const linkId = layer.settings?.linkId;
                  const rightLinkId = linkId ? `${linkId}-r-${Date.now()}` : "";
                  toAdd.push({ ...layer, id: `${layer.id}-r-${Date.now()}`, name: `${layer.name || "Clip"} (R)`, startTime: layer.startTime + splitOffset, sourceStart: (layer.sourceStart || 0) + splitOffset, sourceDuration: origDur - splitOffset, duration: origDur - splitOffset, settings: { ...layer.settings, linkId: rightLinkId || linkId } });
                  if (rightLinkId) layer.settings.linkId = rightLinkId;
                  layer.duration = splitOffset;
                  layer.sourceDuration = splitOffset;
                }
              } else if (layer.type === "group" && Array.isArray(layer.children)) processLayers(layer.children);
            }
          };
          processLayers(v.layers);
          v.layers.push(...toAdd);
        }, { label: "Split at playhead" });
      }} />
      <ToolButton icon={ChevronLeft} label="Split Left" shortcut="⌥S" onClick={() => {
        const s = useEditorStore.getState();
        const frame = s.currentFrame;
        const fps = s.video.fps || 30;
        const ids = s.selection.layerIds;
        if (ids.length === 0) return;
        s.commit((v: any) => {
          const idSet = new Set(ids);
          for (const layer of v.layers) {
            if (idSet.has(layer.id)) {
              const startFrame = Math.round(layer.startTime * fps);
              const durFrames = Math.round((layer.duration || layer.sourceDuration || 5) * fps);
              if (frame > startFrame && frame < startFrame + durFrames) {
                const splitOffset = (frame - startFrame) / fps;
                layer.duration = splitOffset;
                layer.sourceDuration = splitOffset;
              }
            }
          }
        }, { label: "Trim end at playhead" });
      }} />
      <ToolButton icon={ChevronRight} label="Split Right" shortcut="⌥⇧S" onClick={() => {
        const s = useEditorStore.getState();
        const frame = s.currentFrame;
        const fps = s.video.fps || 30;
        const ids = s.selection.layerIds;
        if (ids.length === 0) return;
        s.commit((v: any) => {
          const idSet = new Set(ids);
          for (const layer of v.layers) {
            if (idSet.has(layer.id)) {
              const startFrame = Math.round(layer.startTime * fps);
              const durFrames = Math.round((layer.duration || layer.sourceDuration || 5) * fps);
              if (frame > startFrame && frame < startFrame + durFrames) {
                const splitOffset = (frame - startFrame) / fps;
                const origDur = layer.duration || layer.sourceDuration || 5;
                layer.startTime = layer.startTime + splitOffset;
                layer.sourceStart = (layer.sourceStart || 0) + splitOffset;
                layer.duration = origDur - splitOffset;
                layer.sourceDuration = origDur - splitOffset;
              }
            }
          }
        }, { label: "Trim start at playhead" });
      }} />

      <Separator orientation="vertical" className="mx-1 h-4 bg-white/10" />

      {/* Snap toggle */}
      <ToolButton icon={Magnet} label="Snap" shortcut="N" active={useAppStore.getState().snapEnabled} onClick={() => {
        const s = useAppStore.getState();
        s.setSnapEnabled(!s.snapEnabled);
      }} />

      <Separator orientation="vertical" className="mx-1 h-4 bg-white/10" />

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

      <Separator orientation="vertical" className="mx-1 h-4 bg-white/10" />

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

      <Separator orientation="vertical" className="mx-1 h-4 bg-white/10" />

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

      <Separator orientation="vertical" className="mx-1 h-4 bg-white/10" />

      {/* Panel toggles */}
      <ToolButton icon={showMediaPanel ? PanelLeft : PanelLeftClose} label="Media" shortcut="⌘⇧M" active={showMediaPanel} onClick={toggleMediaPanel} />
      <ToolButton icon={showInspector ? PanelRight : PanelRightClose} label="Inspector" shortcut="⌘⇧I" active={showInspector} onClick={toggleInspector} />

      <Separator orientation="vertical" className="mx-1 h-4 bg-white/10" />

      {/* Export */}
      <ToolButton icon={Download} label="Export" shortcut="⌘E" onClick={() => useExportStore.getState().open()} />

      <Separator orientation="vertical" className="mx-1 h-4 bg-white/10" />

      {/* Home */}
      <ToolButton icon={Home} label="Home" onClick={() => useProjectStore.getState().openProject(null)} />
    </div>
  );
}
