import { create } from "zustand";

interface TimelineTab {
  id: string;
  name: string;
  createdAt: number;
  timelineData: unknown;
}

interface TimelineState {
  tabs: TimelineTab[];
  activeTimelineId: string | null;

  addTimeline: () => string;
  closeTimeline: (id: string) => void;
  closeOtherTimelines: (id: string) => void;
  renameTimeline: (id: string, name: string) => void;
  duplicateTimeline: (id: string) => string;
  setActiveTimeline: (id: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  updateTimelineData: (id: string, data: unknown) => void;
  getActiveTimelineData: () => unknown;
}

function generateId(): string {
  return `tl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useTimelineStore = create<TimelineState>((set, get) => ({
  tabs: [],
  activeTimelineId: null,

  addTimeline: () => {
    const id = generateId();
    const tab: TimelineTab = {
      id,
      name: `Timeline ${get().tabs.length + 1}`,
      createdAt: Date.now(),
      timelineData: null,
    };
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTimelineId: id,
    }));
    return id;
  },

  closeTimeline: (id) => {
    const { tabs, activeTimelineId } = get();
    const filtered = tabs.filter((t) => t.id !== id);
    if (filtered.length === 0) return;

    let nextActive = activeTimelineId;
    if (activeTimelineId === id) {
      const closedIndex = tabs.findIndex((t) => t.id === id);
      nextActive = filtered[Math.min(closedIndex, filtered.length - 1)]?.id ?? null;
    }

    set({ tabs: filtered, activeTimelineId: nextActive });
  },

  closeOtherTimelines: (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (tab) {
      set({ tabs: [tab], activeTimelineId: id });
    }
  },

  renameTimeline: (id, name) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, name } : t)),
    }));
  },

  duplicateTimeline: (id) => {
    const source = get().tabs.find((t) => t.id === id);
    if (!source) return "";

    const newId = generateId();
    const newTab: TimelineTab = {
      id: newId,
      name: `${source.name} (copy)`,
      createdAt: Date.now(),
      timelineData: source.timelineData ? JSON.parse(JSON.stringify(source.timelineData)) : null,
    };
    set((s) => ({
      tabs: [...s.tabs, newTab],
      activeTimelineId: newId,
    }));
    return newId;
  },

  setActiveTimeline: (id) => {
    set({ activeTimelineId: id });
  },

  reorderTabs: (fromIndex, toIndex) => {
    set((s) => {
      const newTabs = [...s.tabs];
      const [moved] = newTabs.splice(fromIndex, 1);
      newTabs.splice(toIndex, 0, moved);
      return { tabs: newTabs };
    });
  },

  updateTimelineData: (id, data) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, timelineData: data } : t)),
    }));
  },

  getActiveTimelineData: () => {
    const { tabs, activeTimelineId } = get();
    if (!activeTimelineId) return null;
    const tab = tabs.find((t) => t.id === activeTimelineId);
    return tab?.timelineData ?? null;
  },
}));
