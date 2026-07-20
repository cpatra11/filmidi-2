import { create } from "zustand";

export type ToolMode = "pointer" | "razor";

interface AppState {
  projectName: string;
  setProjectName: (name: string) => void;

  toolMode: ToolMode;
  setToolMode: (mode: ToolMode) => void;

  snapEnabled: boolean;
  setSnapEnabled: (enabled: boolean) => void;

  trackHeight: number;
  setTrackHeight: (height: number) => void;

  showAgentPanel: boolean;
  toggleAgentPanel: () => void;

  showMediaPanel: boolean;
  toggleMediaPanel: () => void;

  showInspector: boolean;
  toggleInspector: () => void;

  showGenerationPanel: boolean;
  toggleGenerationPanel: () => void;

  cropEditingActive: boolean;
  toggleCropEditing: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  projectName: "Untitled Project",
  setProjectName: (name) => set({ projectName: name }),

  toolMode: "pointer",
  setToolMode: (mode) => set({ toolMode: mode }),

  snapEnabled: true,
  setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),

  trackHeight: 40,
  setTrackHeight: (height) => set({ trackHeight: Math.max(24, Math.min(80, height)) }),

  showAgentPanel: true,
  toggleAgentPanel: () => set((s) => ({ showAgentPanel: !s.showAgentPanel })),

  showMediaPanel: true,
  toggleMediaPanel: () => set((s) => ({ showMediaPanel: !s.showMediaPanel })),

  showInspector: true,
  toggleInspector: () => set((s) => ({ showInspector: !s.showInspector })),

  showGenerationPanel: false,
  toggleGenerationPanel: () =>
    set((s) => ({
      showGenerationPanel: !s.showGenerationPanel,
      showMediaPanel: s.showGenerationPanel ? s.showMediaPanel : true,
    })),

  cropEditingActive: false,
  toggleCropEditing: () => set((s) => ({ cropEditingActive: !s.cropEditingActive })),
}));
