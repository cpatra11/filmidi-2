import { create } from "zustand";

interface SaveAsState {
  isOpen: boolean;
  defaultName: string;
  open: (defaultName?: string) => void;
  close: () => void;
}

export const useSaveAsStore = create<SaveAsState>((set) => ({
  isOpen: false,
  defaultName: "Untitled Project Copy",
  open: (defaultName) => set({
    isOpen: true,
    defaultName: defaultName?.trim() || "Untitled Project Copy",
  }),
  close: () => set({ isOpen: false }),
}));
