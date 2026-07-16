import { useState, useRef, useCallback } from "react";
import { Plus, X, Copy, Pencil } from "lucide-react";
import { useTimelineStore } from "@/store/useTimelineStore";
import { cn } from "@/lib/utils";

function InlineRenameField({
  initialName,
  onCommit,
  onCancel,
}: {
  initialName: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      onCommit(value.trim() || initialName);
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => onCommit(value.trim() || initialName)}
      autoFocus
      className="w-full bg-white/10 text-white text-xs px-1 py-0.5 rounded outline-none border border-white/20"
      onClick={(e) => e.stopPropagation()}
    />
  );
}

export function TimelineTabBar() {
  const {
    tabs,
    activeTimelineId,
    addTimeline,
    closeTimeline,
    renameTimeline,
    duplicateTimeline,
    setActiveTimeline,
  } = useTimelineStore();

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    tabId: string;
  } | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, tabId });
    },
    []
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  if (tabs.length === 0) return null;

  return (
    <div className="relative flex items-center h-8 bg-zinc-900/50 border-b border-white/10 electrobun-webkit-app-region-drag">
      <div className="flex items-center gap-0.5 px-1 overflow-x-auto electrobun-webkit-app-region-no-drag">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => setActiveTimeline(tab.id)}
            onContextMenu={(e) => handleContextMenu(e, tab.id)}
            onDoubleClick={() => setRenamingId(tab.id)}
            className={cn(
              "group flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md cursor-pointer transition-colors whitespace-nowrap electrobun-webkit-app-region-no-drag",
              activeTimelineId === tab.id
                ? "bg-white/10 text-white"
                : "text-white/50 hover:bg-white/5 hover:text-white/70"
            )}
          >
            {renamingId === tab.id ? (
              <InlineRenameField
                initialName={tab.name}
                onCommit={(name) => {
                  renameTimeline(tab.id, name);
                  setRenamingId(null);
                }}
                onCancel={() => setRenamingId(null)}
              />
            ) : (
              <>
                <span>{tab.name}</span>
                {tabs.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTimeline(tab.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/10 rounded p-0.5"
                  >
                    <X size={10} />
                  </button>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={addTimeline}
        className="ml-1 p-1 rounded hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors electrobun-webkit-app-region-no-drag"
        title="Add timeline"
      >
        <Plus size={12} />
      </button>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-50"
            onClick={closeContextMenu}
          />
          <div
            className="fixed z-50 bg-zinc-800 border border-white/10 rounded-lg shadow-2xl py-1 min-w-[160px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={() => {
                setRenamingId(contextMenu.tabId);
                closeContextMenu();
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-white/70 hover:bg-white/5 hover:text-white"
            >
              <Pencil size={12} />
              Rename
            </button>
            <button
              onClick={() => {
                duplicateTimeline(contextMenu.tabId);
                closeContextMenu();
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-white/70 hover:bg-white/5 hover:text-white"
            >
              <Copy size={12} />
              Duplicate
            </button>
            <div className="h-px bg-white/10 my-1" />
            <button
              onClick={() => {
                closeTimeline(contextMenu.tabId);
                closeContextMenu();
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300"
            >
              <X size={12} />
              Close Tab
            </button>
          </div>
        </>
      )}
    </div>
  );
}
