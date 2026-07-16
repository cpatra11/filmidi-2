import {
  Plus,
  Clipboard,
  CheckSquare,
  Trash2,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "@/components/ui/context-menu";

interface TimelineContextMenuProps {
  children: React.ReactNode;
  onAction?: (action: string) => void;
}

export function TimelineContextMenu({
  children,
  onAction,
}: TimelineContextMenuProps) {
  const handle = (action: string) => () => onAction?.(action);

  return (
    <ContextMenu>
      {children}
      <ContextMenuContent side="top" sideOffset={4}>
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
      </ContextMenuContent>
    </ContextMenu>
  );
}
