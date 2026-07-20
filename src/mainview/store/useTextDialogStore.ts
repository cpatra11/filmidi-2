import { create } from "zustand";

interface TextDialogState {
  isOpen: boolean;
  open: () => Promise<string | null>;
  submit: (value: string) => void;
  close: () => void;
  resolver: ((value: string | null) => void) | null;
}

export const useTextDialogStore = create<TextDialogState>((set, get) => ({
  isOpen: false,
  resolver: null,
  open: () => new Promise<string | null>((resolve) => set({ isOpen: true, resolver: resolve })),
  submit: (value) => {
    const resolver = get().resolver;
    set({ isOpen: false, resolver: null });
    resolver?.(value.trim() || null);
  },
  close: () => {
    const resolver = get().resolver;
    set({ isOpen: false, resolver: null });
    resolver?.(null);
  },
}));
