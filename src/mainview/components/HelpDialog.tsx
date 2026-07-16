import { Keyboard, Server } from "lucide-react";
import { useHelpStore, type HelpTab } from "@/store/useHelpStore";
import { ShortcutsPane } from "./ShortcutsPane";
import { MCPInstructionsPane } from "./MCPInstructionsPane";
import { cn } from "@/lib/utils";

const tabs: { id: HelpTab; label: string; icon: typeof Keyboard }[] = [
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "mcp", label: "MCP Server", icon: Server },
];

export function HelpDialog() {
  const { isOpen, activeTab, close, setTab } = useHelpStore();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={close} />

      {/* Dialog */}
      <div className="relative w-[820px] h-[520px] bg-[#0A0A0A] border border-[#1C1C1C] rounded-xl shadow-2xl flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-[180px] flex-shrink-0 border-r border-[#1C1C1C] flex flex-col">
          <div className="p-4 border-b border-[#1C1C1C]">
            <h2 className="text-sm font-semibold">Help</h2>
          </div>
          <nav className="flex-1 p-2 space-y-0.5">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setTab(tab.id)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
                    activeTab === tab.id
                      ? "bg-white/10 text-white"
                      : "text-white/60 hover:bg-white/5 hover:text-white/80"
                  )}
                >
                  <Icon size={16} />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Content */}
        {activeTab === "shortcuts" && <ShortcutsPane />}
        {activeTab === "mcp" && <MCPInstructionsPane />}

        {/* Close button */}
        <button
          onClick={close}
          className="absolute top-3 right-3 w-6 h-6 flex items-center justify-center rounded hover:bg-white/10 text-white/40 hover:text-white transition-colors"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
