import { create } from "zustand";

const AUTOSAVE_DELAY_MS = 3000;
const PROJECT_DATA_PREFIX = "filmidi_project_data_";

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
  loadProject: (id: string) => ProjectData | null;
  deleteProjectData: (id: string) => void;
  scheduleAutoSave: (dataGetter: () => ProjectData | null) => void;
  cancelAutoSave: () => void;
  setAutoSaveEnabled: (enabled: boolean) => void;
  exportProject: (id: string) => ProjectData | null;
  importProject: (id: string, data: ProjectData) => void;
}

function getDataKey(id: string): string {
  return `${PROJECT_DATA_PREFIX}${id}`;
}

function writeProjectData(id: string, data: ProjectData): void {
  try {
    localStorage.setItem(getDataKey(id), JSON.stringify(data));
  } catch (e) {
    console.error("Failed to save project data:", e);
  }
}

function readProjectData(id: string): ProjectData | null {
  try {
    const raw = localStorage.getItem(getDataKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
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
    writeProjectData(currentProjectId, data);
    set({ isSaving: false, isDirty: false, lastSavedAt: Date.now() });
  },

  loadProject: (id: string) => {
    return readProjectData(id);
  },

  deleteProjectData: (id: string) => {
    localStorage.removeItem(getDataKey(id));
  },

  scheduleAutoSave: (dataGetter: () => ProjectData | null) => {
    const { autoSaveTimer, isAutoSaveEnabled, currentProjectId } = get();
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    if (!isAutoSaveEnabled || !currentProjectId) return;

    const timer = setTimeout(() => {
      const data = dataGetter();
      if (data) {
        writeProjectData(currentProjectId, data);
        set({ isDirty: false, lastSavedAt: Date.now(), autoSaveTimer: null });
      }
    }, AUTOSAVE_DELAY_MS);
    set({ autoSaveTimer: timer });
  },

  cancelAutoSave: () => {
    const { autoSaveTimer } = get();
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      set({ autoSaveTimer: null });
    }
  },

  setAutoSaveEnabled: (enabled) => set({ isAutoSaveEnabled: enabled }),

  exportProject: (id: string) => {
    return readProjectData(id);
  },

  importProject: (id: string, data: ProjectData) => {
    writeProjectData(id, data);
  },
}));
