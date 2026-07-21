import { create } from "zustand";

export type PanelTab = "media" | "captions" | "music";
export type ViewMode = "folder" | "flat" | "grouped";
export type SortMode = "name" | "dateAdded" | "duration" | "type";
export type FilterType = "video" | "audio" | "image";

export interface MediaAsset {
  id: string;
  name: string;
  type: FilterType;
  url: string;
  duration: number;
  isGenerated: boolean;
  folderId: string | null;
  thumbnailUrl?: string;
  sourcePath?: string;
  createdAt: number;
  tags?: string[];
}

export interface MediaFolder {
  id: string;
  name: string;
  parentFolderId: string | null;
}

interface MediaPanelState {
  panelTab: PanelTab;
  setPanelTab: (tab: PanelTab) => void;

  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;

  sortMode: SortMode;
  setSortMode: (mode: SortMode) => void;

  filterTypes: Set<FilterType>;
  toggleFilterType: (type: FilterType) => void;
  clearFilters: () => void;

  filterAI: boolean;
  toggleFilterAI: () => void;

  searchQuery: string;
  setSearchQuery: (q: string) => void;

  thumbnailSize: number;
  setThumbnailSize: (size: number) => void;

  currentFolderId: string | null;
  setCurrentFolderId: (id: string | null) => void;

  selectedAssetIds: Set<string>;
  setSelectedAssetIds: (ids: Set<string>) => void;
  toggleAssetSelection: (id: string, multi?: boolean) => void;
  clearSelection: () => void;

  selectedFolderIds: Set<string>;
  setSelectedFolderIds: (ids: Set<string>) => void;

  // Media assets & folders
  assets: MediaAsset[];
  setAssets: (assets: MediaAsset[]) => void;
  addAsset: (asset: MediaAsset) => void;
  removeAsset: (id: string) => void;

  folders: MediaFolder[];
  setFolders: (folders: MediaFolder[]) => void;
  addFolder: (folder: MediaFolder) => void;
  removeFolder: (id: string) => void;

  // Toast
  toast: { message: string; kind: "success" | "warning" } | null;
  showToast: (message: string, kind?: "success" | "warning") => void;
  dismissToast: () => void;

  // Swap
  pendingSwapClipId: string | null;
  setPendingSwapClipId: (id: string | null) => void;
  cancelMediaSwap: () => void;
}

export const useMediaPanelStore = create<MediaPanelState>((set, get) => ({
  panelTab: "media",
  setPanelTab: (tab) => set({ panelTab: tab }),

  viewMode: "folder",
  setViewMode: (mode) => set({ viewMode: mode }),

  sortMode: "dateAdded",
  setSortMode: (mode) => set({ sortMode: mode }),

  filterTypes: new Set<FilterType>(),
  toggleFilterType: (type) =>
    set((s) => {
      const next = new Set(s.filterTypes);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return { filterTypes: next };
    }),
  clearFilters: () => set({ filterTypes: new Set(), filterAI: false }),

  filterAI: false,
  toggleFilterAI: () => set((s) => ({ filterAI: !s.filterAI })),

  searchQuery: "",
  setSearchQuery: (q) => set({ searchQuery: q }),

  thumbnailSize: 80,
  setThumbnailSize: (size) => set({ thumbnailSize: size }),

  currentFolderId: null,
  setCurrentFolderId: (id) => set({ currentFolderId: id }),

  selectedAssetIds: new Set<string>(),
  setSelectedAssetIds: (ids) => set({ selectedAssetIds: ids }),
  toggleAssetSelection: (id, multi) =>
    set((s) => {
      const next = new Set(multi ? s.selectedAssetIds : []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedAssetIds: next };
    }),
  clearSelection: () =>
    set({ selectedAssetIds: new Set(), selectedFolderIds: new Set() }),

  selectedFolderIds: new Set<string>(),
  setSelectedFolderIds: (ids) => set({ selectedFolderIds: ids }),

  assets: [],
  setAssets: (assets) => set({ assets }),
  addAsset: (asset) => set((s) => ({ assets: [...s.assets, asset] })),
  removeAsset: (id) =>
    set((s) => ({ assets: s.assets.filter((a) => a.id !== id) })),

  folders: [],
  setFolders: (folders) => set({ folders }),
  addFolder: (folder) => set((s) => ({ folders: [...s.folders, folder] })),
  removeFolder: (id) =>
    set((s) => ({ folders: s.folders.filter((f) => f.id !== id) })),

  toast: null,
  showToast: (message, kind = "warning") =>
    set({ toast: { message, kind } }),
  dismissToast: () => set({ toast: null }),

  pendingSwapClipId: null,
  setPendingSwapClipId: (id) => set({ pendingSwapClipId: id }),
  cancelMediaSwap: () => set({ pendingSwapClipId: null }),
}));
