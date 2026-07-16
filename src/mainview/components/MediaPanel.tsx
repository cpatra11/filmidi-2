import { useState } from "react";
import { Folder, Captions, Music } from "lucide-react";
import { useMediaPanelStore } from "@/store/useMediaPanelStore";
import { cn } from "@/lib/utils";
import { MediaTab } from "./MediaTab";
import { CaptionTab } from "./CaptionTab";
import { AudioPanelTab } from "./AudioPanelTab";

const tabs = [
  { id: "media" as const, label: "Media", icon: Folder },
  { id: "captions" as const, label: "Captions", icon: Captions },
  { id: "music" as const, label: "Music", icon: Music },
];

export function MediaPanel() {
  const { panelTab, setPanelTab } = useMediaPanelStore();
  const [hoveredTab, setHoveredTab] = useState<string | null>(null);

  return (
    <div className="h-full flex">
      {/* Tab rail */}
      <div className="w-10 flex flex-col items-center gap-1 py-2 bg-[#0A0A0A] border-r border-[#1C1C1C] shrink-0">
        {tabs.map((tab) => {
          const selected = panelTab === tab.id;
          const hovered = hoveredTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setPanelTab(tab.id)}
              onMouseEnter={() => setHoveredTab(tab.id)}
              onMouseLeave={() => setHoveredTab(null)}
              className={cn(
                "w-8 h-8 flex items-center justify-center rounded-md transition-colors relative",
                selected
                  ? "text-white bg-white/10"
                  : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
              )}
              title={tab.label}
            >
              <Icon size={16} />
              {selected && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-3 bg-white rounded-r" />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {panelTab === "media" && <MediaTab />}
        {panelTab === "captions" && <CaptionTab />}
        {panelTab === "music" && <AudioPanelTab />}
      </div>
    </div>
  );
}
