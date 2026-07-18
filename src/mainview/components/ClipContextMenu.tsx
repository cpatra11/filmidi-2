import {
  Scissors,
  Copy,
  Clipboard,
  Trash2,
  Wand2,
  Crop,
  Maximize,
  Eraser,
  Sparkles,
  Music,
  AudioLines,
  Lock,
  Unlock,
  Zap,
  Eye,
  EyeOff,
  Plus,
  CheckSquare,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuShortcut,
} from "@/components/ui/context-menu";

export type ContextTarget = "clip" | "empty";

interface ClipContextMenuProps {
  children: React.ReactNode;
  contextTarget: ContextTarget;
  onAction?: (action: string) => void;
}

export function ClipContextMenu({ children, contextTarget, onAction }: ClipContextMenuProps) {
  const handle = (action: string) => () => onAction?.(action);

  return (
    <ContextMenu>
      <ContextMenuTrigger render={<div />}>{children}</ContextMenuTrigger>
      <ContextMenuContent side="right" sideOffset={4}>
        {contextTarget === "clip" ? (
          <>
            {/* AI Edit group */}
            <ContextMenuItem onClick={handle("ai-edit")}>
              <Wand2 size={14} />
              AI Edit
              <ContextMenuShortcut>⌘E</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={handle("ai-crop")}>
              <Crop size={14} />
              AI Crop
            </ContextMenuItem>
            <ContextMenuItem onClick={handle("ai-resize")}>
              <Maximize size={14} />
              AI Resize
            </ContextMenuItem>
            <ContextMenuItem onClick={handle("ai-bg-remove")}>
              <Eraser size={14} />
              AI Background Remove
            </ContextMenuItem>
            <ContextMenuItem onClick={handle("ai-enhance")}>
              <Sparkles size={14} />
              AI Enhance
            </ContextMenuItem>

            <ContextMenuSeparator />

            {/* Beats submenu */}
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Music size={14} />
                Beats
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem onClick={handle("detect-beats")}>
                  <Zap size={14} />
                  Detect Beats
                </ContextMenuItem>
                <ContextMenuItem onClick={handle("show-beat-markers")}>
                  <Eye size={14} />
                  Show Beat Markers
                </ContextMenuItem>
                <ContextMenuItem onClick={handle("snap-to-beats")}>
                  <Zap size={14} />
                  Snap to Beats
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>

            <ContextMenuSeparator />

            {/* Sync submenu */}
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <AudioLines size={14} />
                Sync
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem onClick={handle("sync-audio")}>
                  <AudioLines size={14} />
                  Sync Audio
                </ContextMenuItem>
                <ContextMenuItem onClick={handle("sync-lock")}>
                  <Lock size={14} />
                  Link Tracks
                </ContextMenuItem>
                <ContextMenuItem onClick={handle("unlink")}>
                  <Unlock size={14} />
                  Unlink Tracks
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>

            <ContextMenuSeparator />

            {/* Standard editing */}
            <ContextMenuItem onClick={handle("cut")}>
              <Scissors size={14} />
              Cut
              <ContextMenuShortcut>⌘X</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={handle("copy")}>
              <Copy size={14} />
              Copy
              <ContextMenuShortcut>⌘C</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={handle("paste")}>
              <Clipboard size={14} />
              Paste
              <ContextMenuShortcut>⌘V</ContextMenuShortcut>
            </ContextMenuItem>

            <ContextMenuSeparator />

            <ContextMenuItem onClick={handle("split")}>
              <Scissors size={14} />
              Split at Playhead
              <ContextMenuShortcut>S</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={handle("delete")} variant="destructive">
              <Trash2 size={14} />
              Delete
              <ContextMenuShortcut>Del</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        ) : (
          <>
            {/* Empty area context menu */}
            <ContextMenuItem onClick={handle("add-track")}>
              <Plus size={14} />
              Add Track
            </ContextMenuItem>
            <ContextMenuItem onClick={handle("paste")}>
              <Clipboard size={14} />
              Paste
              <ContextMenuShortcut>⌘V</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={handle("select-all")}>
              <CheckSquare size={14} />
              Select All
              <ContextMenuShortcut>⌘A</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
