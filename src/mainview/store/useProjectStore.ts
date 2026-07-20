import { create } from "zustand";
import { dbListProjects, dbSaveProject, dbDeleteProject, dbUpdateProjectName } from "@/lib/dbIPC";
import { useAppStore } from "./useAppStore";

export interface ProjectEntry {
  id: string;
  name: string;
  width?: number;
  height?: number;
  fps?: number;
  createdAt: number;
  lastOpenedAt: number;
  thumbnailUrl?: string;
  filePath?: string;
}

interface ProjectState {
  projects: ProjectEntry[];
  currentProjectId: string | null;
  showNewProjectDialog: boolean;

  loadProjects: () => Promise<void>;
  addProject: (
    name: string,
    settings?: { width?: number; height?: number; fps?: number; filePath?: string },
    options?: { select?: boolean }
  ) => string;
  openProject: (id: string | null) => void;
  deleteProject: (id: string) => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
  updateThumbnail: (id: string, url: string) => void;
  setShowNewProjectDialog: (show: boolean) => void;
  clearAll: () => void;
}

function generateId(): string {
  return `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentProjectId: null,
  showNewProjectDialog: false,

  loadProjects: async () => {
    try {
      const projects = await dbListProjects();
      set({ projects });
    } catch {
      // Bun not available — keep empty list
    }
  },

  addProject: (name: string, settings?: { width?: number; height?: number; fps?: number; filePath?: string }, options?: { select?: boolean }) => {
    const id = generateId();
    const now = Date.now();
    const entry: ProjectEntry = {
      id, name,
      width: settings?.width ?? 1920,
      height: settings?.height ?? 1080,
      fps: settings?.fps ?? 30,
      createdAt: now, lastOpenedAt: now,
      filePath: settings?.filePath,
    };
    dbSaveProject(entry).catch(() => {});
    const updated = [entry, ...get().projects];
    set({ projects: updated, currentProjectId: options?.select === false ? get().currentProjectId : id });
    if (options?.select !== false) {
      useAppStore.getState().setProjectName(name);
    }
    return id;
  },

  openProject: (id: string | null) => {
    const now = Date.now();
    const updated = id ? get().projects.map((p) =>
      p.id === id ? { ...p, lastOpenedAt: now } : p
    ) : get().projects;
    if (id) dbSaveProject({ id, name: get().projects.find((p) => p.id === id)?.name ?? "Untitled" }).catch(() => {});
    set({ projects: updated, currentProjectId: id });
    if (id) {
      useAppStore.getState().setProjectName(get().projects.find((p) => p.id === id)?.name ?? "Untitled Project");
    }
  },

  deleteProject: async (id: string) => {
    try { await dbDeleteProject(id); } catch {}
    const updated = get().projects.filter((p) => p.id !== id);
    set((s) => ({
      projects: updated,
      currentProjectId: s.currentProjectId === id ? null : s.currentProjectId,
    }));
  },

  renameProject: async (id: string, name: string) => {
    try { await dbUpdateProjectName(id, name); } catch {}
    const updated = get().projects.map((p) =>
      p.id === id ? { ...p, name } : p
    );
    set({ projects: updated });
  },

  updateThumbnail: (id: string, url: string) => {
    // Thumbnails are saved as part of project_data
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === id ? { ...p, thumbnailUrl: url } : p
      ),
    }));
  },

  setShowNewProjectDialog: (show: boolean) => {
    set({ showNewProjectDialog: show });
  },

  clearAll: () => {
    set({ projects: [], currentProjectId: null });
  },
}));
