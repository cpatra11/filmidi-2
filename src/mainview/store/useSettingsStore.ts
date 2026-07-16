import { create } from "zustand";

export type SettingsTab = "general" | "account" | "models" | "agent" | "storage";

export type Theme = "dark" | "light" | "system";

export type AudioProcessingMode = "local" | "cloud";

interface SettingsState {
  isOpen: boolean;
  activeTab: SettingsTab;

  // General
  theme: Theme;
  defaultExportFormat: string;
  showTourOnLaunch: boolean;

  // Models — disabled model IDs
  disabledModelIds: string[];

  // Agent
  agentAutoExecute: boolean;
  agentContextSize: number;

  // Storage
  searchIndexEnabled: boolean;

  // Audio
  audioProcessingMode: AudioProcessingMode;

  // Notifications
  notificationsEnabled: boolean;

  // Actions
  open: () => void;
  openTab: (tab: SettingsTab) => void;
  close: () => void;
  setActiveTab: (tab: SettingsTab) => void;
  setTheme: (t: Theme) => void;
  setDefaultExportFormat: (f: string) => void;
  setShowTourOnLaunch: (v: boolean) => void;
  toggleModelDisabled: (id: string) => void;
  setAgentAutoExecute: (v: boolean) => void;
  setAgentContextSize: (n: number) => void;
  setSearchIndexEnabled: (v: boolean) => void;
  setNotificationsEnabled: (v: boolean) => void;
  setAudioProcessingMode: (m: AudioProcessingMode) => void;
}

const STORAGE_KEY = "filmidi_settings";

function loadSettings(): Partial<SettingsState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function persistSettings(state: Partial<SettingsState>) {
  try {
    const toSave = {
      theme: state.theme,
      defaultExportFormat: state.defaultExportFormat,
      showTourOnLaunch: state.showTourOnLaunch,
      disabledModelIds: state.disabledModelIds,
      agentAutoExecute: state.agentAutoExecute,
      agentContextSize: state.agentContextSize,
      searchIndexEnabled: state.searchIndexEnabled,
      notificationsEnabled: state.notificationsEnabled,
      audioProcessingMode: state.audioProcessingMode,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch { /* quota exceeded */ }
}

const saved = loadSettings();

export const useSettingsStore = create<SettingsState>((set, get) => ({
  isOpen: false,
  activeTab: "general",

  theme: (saved.theme as Theme) ?? "dark",
  defaultExportFormat: saved.defaultExportFormat ?? "mp4",
  showTourOnLaunch: saved.showTourOnLaunch ?? false,
  disabledModelIds: saved.disabledModelIds ?? [],
  agentAutoExecute: saved.agentAutoExecute ?? true,
  agentContextSize: saved.agentContextSize ?? 100,
  searchIndexEnabled: saved.searchIndexEnabled ?? true,
  notificationsEnabled: saved.notificationsEnabled ?? true,
  audioProcessingMode: (saved.audioProcessingMode as AudioProcessingMode) ?? "local",

  open: () => set({ isOpen: true }),
  openTab: (tab) => set({ isOpen: true, activeTab: tab }),
  close: () => set({ isOpen: false }),
  setActiveTab: (tab) => set({ activeTab: tab }),

  setTheme: (t) => {
    set({ theme: t });
    persistSettings({ ...get(), theme: t });
  },
  setDefaultExportFormat: (f) => {
    set({ defaultExportFormat: f });
    persistSettings({ ...get(), defaultExportFormat: f });
  },
  setShowTourOnLaunch: (v) => {
    set({ showTourOnLaunch: v });
    persistSettings({ ...get(), showTourOnLaunch: v });
  },
  toggleModelDisabled: (id) => {
    const current = get().disabledModelIds;
    const next = current.includes(id) ? current.filter((m) => m !== id) : [...current, id];
    set({ disabledModelIds: next });
    persistSettings({ ...get(), disabledModelIds: next });
  },
  setAgentAutoExecute: (v) => {
    set({ agentAutoExecute: v });
    persistSettings({ ...get(), agentAutoExecute: v });
  },
  setAgentContextSize: (n) => {
    set({ agentContextSize: n });
    persistSettings({ ...get(), agentContextSize: n });
  },
  setSearchIndexEnabled: (v) => {
    set({ searchIndexEnabled: v });
    persistSettings({ ...get(), searchIndexEnabled: v });
  },
  setNotificationsEnabled: (v) => {
    set({ notificationsEnabled: v });
    persistSettings({ ...get(), notificationsEnabled: v });
  },
  setAudioProcessingMode: (m) => {
    set({ audioProcessingMode: m });
    persistSettings({ ...get(), audioProcessingMode: m });
  },
}));
