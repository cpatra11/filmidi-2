import { useState, useRef, useCallback, useEffect } from "react";
import { Settings, ChevronDown, Download, KeyRound } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useExportStore } from "@/store/useExportStore";
import { useSettingsStore } from "@/store/useSettingsStore";

export function TitleBar() {
  const { projectName, setProjectName } = useAppStore();
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastClickRef = useRef(0);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    };
  }, []);

  const handleBlur = useCallback(() => {
    setIsEditing(false);
    if (!inputRef.current?.value.trim()) {
      setProjectName("Untitled Project");
    }
  }, [setProjectName]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") setIsEditing(false);
    if (e.key === "Escape") setIsEditing(false);
  }, []);

  const handleProjectDoubleClick = useCallback(() => {
    setIsEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, []);

  const handleTitleBarMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest(".electrobun-webkit-app-region-no-drag")) return;

    const now = Date.now();
    const timeSinceLastClick = now - lastClickRef.current;
    lastClickRef.current = now;

    if (timeSinceLastClick < 400) {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      const w = window as any;
      w.__electrobunBunBridge?.postMessage(
        JSON.stringify({ type: "toggleMaximize" })
      );
    }
  }, []);

  return (
    <div
      className="electrobun-webkit-app-region-drag h-10 flex items-center px-3 gap-3 select-none shrink-0"
      style={{
        background: "#0A0A0A",
        borderBottom: "1px solid #1C1C1C",
        paddingLeft: "78px",
      }}
      onMouseDown={handleTitleBarMouseDown}
    >
      {/* Brand */}
      <div className="flex items-center gap-1.5 electrobun-webkit-app-region-no-drag">
        <div className="w-4 h-4 rounded bg-white flex items-center justify-center">
          <span className="text-[8px] font-bold text-black leading-none">F</span>
        </div>
        <span className="text-xs font-medium text-white/80 tracking-wide">
          Filmidi
        </span>
      </div>

      <div className="w-px h-3 bg-white/10" />

      {/* Project name */}
      <div className="flex items-center gap-1 electrobun-webkit-app-region-no-drag">
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            className="bg-white/5 border border-white/15 text-xs text-white px-1.5 py-0.5 rounded outline-none min-w-[120px]"
            autoFocus
          />
        ) : (
          <button
            onDoubleClick={handleProjectDoubleClick}
            className="text-xs text-white/50 hover:text-white/80 px-1.5 py-0.5 rounded hover:bg-white/5 transition-colors"
          >
            {projectName}
          </button>
        )}
        <ChevronDown size={10} className="text-white/25" />
      </div>

      <div className="flex-1" />

      {/* Settings */}
      <button
        onClick={() => useSettingsStore.getState().open()}
        className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/8 transition-colors electrobun-webkit-app-region-no-drag"
        title="Settings"
      >
        <Settings size={13} className="text-white/40 hover:text-white/70" />
      </button>

      <button
        onClick={() => useExportStore.getState().open()}
        className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/8 transition-colors electrobun-webkit-app-region-no-drag"
        title="Export"
      >
        <Download size={13} className="text-white/40 hover:text-white/70" />
      </button>

      <button
        onClick={() => useSettingsStore.getState().openTab("agent")}
        className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/8 transition-colors electrobun-webkit-app-region-no-drag"
        title="Vercel API key"
      >
        <KeyRound size={13} className="text-white/40 hover:text-white/70" />
      </button>
    </div>
  );
}
