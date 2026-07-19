import { create } from "zustand";
import { dbSaveProjectData, dbLoadProjectData, dbDeleteProjectData } from "@/lib/dbIPC";

const AUTOSAVE_DELAY_MS = 3000;

export interface ProjectData {
  timeline: unknown;
  mediaManifest: unknown;
  generationLog: unknown;
  chatHistory: unknown;
  thumbnail?: string;
}

interface ProjectSaveState {
  currentProjectId: string | null;
  isDirty: boolean;
  lastSavedAt: number | null;
  isSaving: boolean;
  isAutoSaveEnabled: boolean;
  autoSaveTimer: ReturnType<typeof setTimeout> | null;

  setCurrentProject: (id: string | null) => void;
  markDirty: () => void;
  markClean: () => void;
  saveProject: (data: ProjectData) => Promise<void>;
  loadProject: (id: string) => Promise<ProjectData | null>;
  deleteProjectData: (id: string) => Promise<void>;
  scheduleAutoSave: (dataGetter: () => ProjectData | null) => void;
  cancelAutoSave: () => void;
  setAutoSaveEnabled: (enabled: boolean) => void;
  exportProject: (id: string) => Promise<ProjectData | null>;
  importProject: (id: string, data: ProjectData) => Promise<void>;
}

export const useProjectSaveStore = create<ProjectSaveState>((set, get) => ({
  currentProjectId: null,
  isDirty: false,
  lastSavedAt: null,
  isSaving: false,
  isAutoSaveEnabled: true,
  autoSaveTimer: null,

  setCurrentProject: (id) => {
    const prev = get().autoSaveTimer;
    if (prev) clearTimeout(prev);
    set({ currentProjectId: id, isDirty: false, lastSavedAt: null, autoSaveTimer: null });
  },

  markDirty: () => set({ isDirty: true }),
  markClean: () => set({ isDirty: false }),

  saveProject: async (data: ProjectData) => {
    const { currentProjectId } = get();
    if (!currentProjectId) return;
    set({ isSaving: true });
    try {
      await dbSaveProjectData(currentProjectId, data);
      set({ isSaving: false, isDirty: false, lastSavedAt: Date.now() });
    } catch {
      set({ isSaving: false });
    }
  },

  loadProject: async (id: string) => {
    try {
      return await dbLoadProjectData(id);
    } catch {
      return null;
    }
  },

  deleteProjectData: async (id: string) => {
    try { await dbDeleteProjectData(id); } catch {}
  },

  scheduleAutoSave: (dataGetter: () => ProjectData | null) => {
    const { autoSaveTimer, isAutoSaveEnabled, currentProjectId } = get();
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    if (!isAutoSaveEnabled || !currentProjectId) return;

    const timer = setTimeout(() => {
      const data = dataGetter();
      if (data) {
        dbSaveProjectData(currentProjectId, data).catch(() => {});
        set({ isDirty: false, lastSavedAt: Date.now(), autoSaveTimer: null });
      }
    }, AUTOSAVE_DELAY_MS);
    set({ autoSaveTimer: timer });
  },

  cancelAutoSave: () => {
    const { autoSaveTimer } = get();
    if (autoSaveTimer) { clearTimeout(autoSaveTimer); set({ autoSaveTimer: null }); }
  },

  setAutoSaveEnabled: (enabled) => set({ isAutoSaveEnabled: enabled }),

  exportProject: async (id: string) => {
    try { return await dbLoadProjectData(id); } catch { return null; }
  },

  importProject: async (id: string, data: ProjectData) => {
    try { await dbSaveProjectData(id, data); } catch {}
  },
}));
