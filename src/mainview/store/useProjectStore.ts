import { create } from "zustand";

export interface ProjectEntry {
  id: string;
  name: string;
  width?: number;
  height?: number;
  fps?: number;
  createdAt: number;
  lastOpenedAt: number;
  thumbnailUrl?: string;
}

interface ProjectState {
  projects: ProjectEntry[];
  currentProjectId: string | null;
  showNewProjectDialog: boolean;

  addProject: (name: string, settings?: { width?: number; height?: number; fps?: number }) => string;
  openProject: (id: string | null) => void;
  deleteProject: (id: string) => void;
  renameProject: (id: string, name: string) => void;
  updateThumbnail: (id: string, url: string) => void;
  setShowNewProjectDialog: (show: boolean) => void;
  clearAll: () => void;
}

const STORAGE_KEY = "filmidi_projects";

function loadProjects(): ProjectEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveProjects(projects: ProjectEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

function generateId(): string {
  return `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: loadProjects(),
  currentProjectId: null,
  showNewProjectDialog: false,

  addProject: (name: string, settings?: { width?: number; height?: number; fps?: number }) => {
    const id = generateId();
    const now = Date.now();
    const entry: ProjectEntry = {
      id,
      name,
      width: settings?.width ?? 1920,
      height: settings?.height ?? 1080,
      fps: settings?.fps ?? 30,
      createdAt: now,
      lastOpenedAt: now,
    };
    const updated = [entry, ...get().projects];
    saveProjects(updated);
    set({ projects: updated, currentProjectId: id });
    return id;
  },

  openProject: (id: string | null) => {
    const now = Date.now();
    const updated = id ? get().projects.map((p) =>
      p.id === id ? { ...p, lastOpenedAt: now } : p
    ) : get().projects;
    if (id) saveProjects(updated);
    set({ projects: updated, currentProjectId: id });
  },

  deleteProject: (id: string) => {
    const updated = get().projects.filter((p) => p.id !== id);
    saveProjects(updated);
    set((s) => ({
      projects: updated,
      currentProjectId: s.currentProjectId === id ? null : s.currentProjectId,
    }));
  },

  renameProject: (id: string, name: string) => {
    const updated = get().projects.map((p) =>
      p.id === id ? { ...p, name } : p
    );
    saveProjects(updated);
    set({ projects: updated });
  },

  updateThumbnail: (id: string, url: string) => {
    const updated = get().projects.map((p) =>
      p.id === id ? { ...p, thumbnailUrl: url } : p
    );
    saveProjects(updated);
    set({ projects: updated });
  },

  setShowNewProjectDialog: (show: boolean) => {
    set({ showNewProjectDialog: show });
  },

  clearAll: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ projects: [], currentProjectId: null });
  },
}));
