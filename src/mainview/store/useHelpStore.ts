import { create } from "zustand";

export type HelpTab = "shortcuts" | "mcp";

interface HelpState {
  isOpen: boolean;
  activeTab: HelpTab;
  open: (tab?: HelpTab) => void;
  close: () => void;
  setTab: (tab: HelpTab) => void;
}

export const useHelpStore = create<HelpState>((set) => ({
  isOpen: false,
  activeTab: "shortcuts",
  open: (tab) => set({ isOpen: true, activeTab: tab || "shortcuts" }),
  close: () => set({ isOpen: false }),
  setTab: (tab) => set({ activeTab: tab }),
}));
