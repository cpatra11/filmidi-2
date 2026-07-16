import {
  Plus,
  FolderOpen,
  Trash2,
  Pencil,
  Film,
  Music,
  ImageIcon,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "@/components/ui/context-menu";

interface MediaContextMenuProps {
  children: React.ReactNode;
  fileType?: "video" | "audio" | "image";
  onAction?: (action: string) => void;
}

export function MediaContextMenu({
  children,
  fileType = "video",
  onAction,
}: MediaContextMenuProps) {
  const handle = (action: string) => () => onAction?.(action);

  const TypeIcon =
    fileType === "video" ? Film : fileType === "audio" ? Music : ImageIcon;

  return (
    <ContextMenu>
      {children}
      <ContextMenuContent side="right" sideOffset={4}>
        <ContextMenuItem onClick={handle("add-to-timeline")}>
          <Plus size={14} />
          Add to Timeline
          <ContextMenuShortcut>⏎</ContextMenuShortcut>
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem onClick={handle("rename")}>
          <Pencil size={14} />
          Rename
        </ContextMenuItem>
        <ContextMenuItem onClick={handle("show-in-finder")}>
          <FolderOpen size={14} />
          Show in Finder
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem onClick={handle("delete")} variant="destructive">
          <Trash2 size={14} />
          Delete
          <ContextMenuShortcut>Del</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
