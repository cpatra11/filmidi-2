import { useState } from "react";
import { Mic, Music } from "lucide-react";
import { cn } from "@/lib/utils";
import { SpeechTab } from "./SpeechTab";
import { MusicTab } from "./MusicTab";

const subTabs = [
  { id: "speech" as const, label: "Speech", icon: Mic },
  { id: "music" as const, label: "Music", icon: Music },
];

export function AudioPanelTab() {
  const [tab, setTab] = useState<"speech" | "music">("speech");

  return (
    <div className="h-full flex flex-col bg-[#0A0A0A]">
      {/* Sub-tab bar */}
      <div className="flex items-center h-8 px-2 gap-1 border-b border-[#1C1C1C] bg-[#0A0A0A]">
        {subTabs.map((t) => {
          const selected = tab === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1 px-2.5 py-1 rounded text-[11px] transition-colors",
                selected
                  ? "bg-white/10 text-white font-medium"
                  : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
              )}
            >
              <Icon size={12} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === "speech" ? <SpeechTab /> : <MusicTab />}
      </div>
    </div>
  );
}
