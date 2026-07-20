import { useState, useRef, useEffect, useCallback } from "react";
import {
  FileText,
  Eye,
  HelpCircle,
  Undo2,
  Redo2,
  Scissors,
  Copy,
  Clipboard,
  Trash2,
  Settings,
  Keyboard,
  MessageSquare,
  Home,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useProjectStore } from "@/store/useProjectStore";
import { useExportStore } from "@/store/useExportStore";
import { useAppStore } from "@/store/useAppStore";
import { useEditorStore } from "@videoflow/react-video-editor";
import {
  importMediaFromPicker,
  openHelp,
  openProjectHome,
  saveCurrentProject,
  saveProjectAsCopy,
  sendFeedback,
  showMcpInstructions,
} from "@/lib/menuActions";
import {
  copySelectedLayers,
  cutSelectedLayers,
  deleteSelectedLayers,
  pasteLayers,
  splitAtPlayhead,
} from "@/hooks/useKeyboardShortcuts";

interface MenuItem {
  label: string;
  shortcut?: string;
  icon?: React.ReactNode;
  action?: () => void;
  divider?: boolean;
  disabled?: boolean;
  danger?: boolean;
}

interface MenuGroup {
  label: string;
  items: MenuItem[];
}

interface MenuBarProps {
  onAction: (action: string) => void;
}

function getFileMenuItems(): MenuItem[] {
  return [
    { label: "New Project", shortcut: "⌘N", icon: <FileText size={14} />, action: () => useProjectStore.getState().addProject("Untitled Project") },
    { label: "Open Project", shortcut: "⌘O", icon: <FileText size={14} />, action: openProjectHome },
    { label: "Save Project", shortcut: "⌘S", icon: <FileText size={14} />, action: () => { void saveCurrentProject(); } },
    { label: "Save As", shortcut: "⇧⌘S", icon: <FileText size={14} />, action: () => { void saveProjectAsCopy(); } },
    { label: "", divider: true },
    { label: "Import Media", shortcut: "⌘I", icon: <FileText size={14} />, action: () => { void importMediaFromPicker(); } },
    { label: "Export", shortcut: "⌘E", icon: <FileText size={14} />, action: () => useExportStore.getState().open() },
    { label: "", divider: true },
    { label: "Home", icon: <Home size={14} />, action: () => useProjectStore.getState().openProject(null) },
  ];
}

function getEditMenuItems(): MenuItem[] {
  return [
    { label: "Undo", shortcut: "⌘Z", icon: <Undo2 size={14} />, action: () => useEditorStore.getState().undo() },
    { label: "Redo", shortcut: "⇧⌘Z", icon: <Redo2 size={14} />, action: () => useEditorStore.getState().redo() },
    { label: "", divider: true },
    { label: "Cut", shortcut: "⌘X", icon: <Scissors size={14} />, action: cutSelectedLayers },
    { label: "Copy", shortcut: "⌘C", icon: <Copy size={14} />, action: copySelectedLayers },
    { label: "Paste", shortcut: "⌘V", icon: <Clipboard size={14} />, action: () => { void pasteLayers(); } },
    { label: "Delete", shortcut: "⌫", icon: <Trash2 size={14} />, action: deleteSelectedLayers },
    { label: "", divider: true },
    { label: "Select All", shortcut: "⌘A", action: () => {
      const allIds = useEditorStore.getState().video.layers.map((l: any) => l.id);
      useEditorStore.getState().selectLayers(allIds);
    }},
    { label: "Split at Playhead", shortcut: "⌘K", icon: <Scissors size={14} />, action: splitAtPlayhead },
  ];
}

function getViewMenuItems(): MenuItem[] {
  const app = useAppStore.getState();
  return [
    { label: "Media Panel", shortcut: "⌘⇧M", action: () => app.toggleMediaPanel() },
    { label: "Inspector", shortcut: "⌘⇧I", action: () => app.toggleInspector() },
    { label: "Agent Panel", shortcut: "⌥⌘A", action: () => app.toggleAgentPanel() },
    { label: "", divider: true },
    { label: "Zoom In", shortcut: "⌘+", action: () => {
      const s = useEditorStore.getState();
      s.setViewport({ timelineScale: Math.min(5, s.viewport.timelineScale * 1.2) });
    }},
    { label: "Zoom Out", shortcut: "⌘-", action: () => {
      const s = useEditorStore.getState();
      s.setViewport({ timelineScale: Math.max(0.1, s.viewport.timelineScale / 1.2) });
    }},
    { label: "Zoom to Fit", shortcut: "⌘0", action: () => {
      useEditorStore.getState().setViewport({ timelineScale: 1, previewZoom: 1, previewPanX: 0, previewPanY: 0 });
    }},
    { label: "Zoom to 100%", shortcut: "⌘1", action: () => {
      useEditorStore.getState().setViewport({ previewZoom: 1 });
    }},
  ];
}

function getHelpMenuItems(): MenuItem[] {
  return [
    { label: "Keyboard Shortcuts", shortcut: "?", icon: <Keyboard size={14} />, action: openHelp },
    { label: "MCP Instructions", icon: <MessageSquare size={14} />, action: showMcpInstructions },
    { label: "", divider: true },
    { label: "Send Feedback", icon: <HelpCircle size={14} />, action: sendFeedback },
  ];
}

function MenuDropdown({
  items,
  onSelect,
}: {
  items: MenuItem[];
  onSelect: () => void;
}) {
  return (
    <div className="absolute top-full left-0 mt-1 w-56 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl py-1 z-50">
      {items.map((item, i) =>
        item.divider ? (
          <div key={i} className="h-px bg-white/10 my-1" />
        ) : (
          <button
            key={i}
            onClick={() => {
              item.action?.();
              onSelect();
            }}
            disabled={item.disabled}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors",
              item.danger
                ? "text-red-400 hover:bg-red-500/10 hover:text-red-300"
                : "text-white/70 hover:bg-white/5 hover:text-white",
              item.disabled && "opacity-40 cursor-not-allowed"
            )}
          >
            <span className="w-4 flex-shrink-0">{item.icon}</span>
            <span className="flex-1 text-left">{item.label}</span>
            {item.shortcut && (
              <span className="text-xs text-white/30 ml-4">{item.shortcut}</span>
            )}
          </button>
        )
      )}
    </div>
  );
}

export function MenuBar({ onAction }: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuBarRef.current && !menuBarRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    }
    if (openMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [openMenu]);

  const handleMenuClick = useCallback(
    (label: string) => {
      setOpenMenu(openMenu === label ? null : label);
    },
    [openMenu]
  );

  const menuGroups = [
    { label: "File", items: getFileMenuItems() },
    { label: "Edit", items: getEditMenuItems() },
    { label: "View", items: getViewMenuItems() },
    { label: "Help", items: getHelpMenuItems() },
  ];

  return (
    <div
      ref={menuBarRef}
      className="flex items-center h-6 bg-zinc-900/50 border-b border-white/10 text-xs select-none electrobun-webkit-app-region-drag"
    >
      {menuGroups.map((group) => (
        <div key={group.label} className="relative electrobun-webkit-app-region-no-drag">
          <button
            onClick={() => handleMenuClick(group.label)}
            onMouseEnter={() => openMenu && setOpenMenu(group.label)}
            className={cn(
              "px-3 py-1.5 text-white/60 hover:text-white/80 transition-colors",
              openMenu === group.label && "bg-white/10 text-white"
            )}
          >
            {group.label}
          </button>
          {openMenu === group.label && (
            <MenuDropdown
              items={group.items}
              onSelect={() => setOpenMenu(null)}
            />
          )}
        </div>
      ))}
    </div>
  );
}
