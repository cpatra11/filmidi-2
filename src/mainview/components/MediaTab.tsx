import { useState, useMemo, useRef, useCallback } from "react";
import {
  Plus,
  Sparkles,
  Search,
  X,
  LayoutGrid,
  Rows3,
  FolderOpen,
  ArrowUpDown,
  Filter,
  SlidersHorizontal,
  FolderPlus,
  Square,
  Wand2,
  Film,
  Music,
  ImageIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMediaPanelStore, type FilterType } from "@/store/useMediaPanelStore";
import { useAppStore } from "@/store/useAppStore";
import { useEditorStore } from "@videoflow/react-video-editor";
import { cn } from "@/lib/utils";
import { getMediaDuration } from "@/lib/mediaDuration";
import { AssetThumbnail } from "./AssetThumbnail";
import { FolderTile } from "./FolderTile";

const thumbnailSizes = [
  { label: "Small", value: 80 },
  { label: "Medium", value: 110 },
  { label: "Large", value: 150 },
  { label: "Extra Large", value: 200 },
];

const filterableTypes: { type: FilterType; icon: typeof Film; label: string }[] = [
  { type: "video", icon: Film, label: "Video" },
  { type: "audio", icon: Music, label: "Audio" },
  { type: "image", icon: ImageIcon, label: "Image" },
];

export function MediaTab() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleImport = () => {
    fileInputRef.current?.click();
  };

  const importFiles = useCallback(async (files: FileList | File[]) => {
    const store = useMediaPanelStore.getState();
    const editor = useEditorStore.getState();
    const fileArr = Array.from(files);
    for (let i = 0; i < fileArr.length; i++) {
      const file = fileArr[i];
      const type = file.type.startsWith("video/") ? "video" as const : file.type.startsWith("audio/") ? "audio" as const : "image" as const;
      const duration = await getMediaDuration(file, type);
      const id = `asset-${Date.now()}-${i}`;
      const url = URL.createObjectURL(file);
      store.addAsset({
        id,
        name: file.name,
        type,
        url,
        duration,
        isGenerated: false,
        folderId: store.currentFolderId,
        createdAt: Date.now(),
      });
      if (editor.mediaImporter) {
        editor.mediaImporter([file], { startTime: 0, track: 0 });
      }
    }
    store.showToast(`Imported ${fileArr.length} file${fileArr.length > 1 ? "s" : ""}`);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      importFiles(e.dataTransfer.files);
    }
  }, [importFiles]);

  const {
    viewMode,
    setViewMode,
    sortMode,
    setSortMode,
    filterTypes,
    toggleFilterType,
    clearFilters,
    filterAI,
    toggleFilterAI,
    searchQuery,
    setSearchQuery,
    thumbnailSize,
    setThumbnailSize,
    currentFolderId,
    setCurrentFolderId,
    assets,
    folders,
    selectedAssetIds,
    toggleAssetSelection,
    clearSelection,
    showToast,
  } = useMediaPanelStore();
  const { showGenerationPanel, toggleGenerationPanel } = useAppStore();

  const hasActiveFilters = filterTypes.size > 0 || filterAI;

  const filteredAssets = useMemo(() => {
    let result = assets.filter((a) => a.folderId === currentFolderId);
    if (filterTypes.size > 0) {
      result = result.filter((a) => filterTypes.has(a.type));
    }
    if (filterAI) {
      result = result.filter((a) => a.isGenerated);
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((a) => a.name.toLowerCase().includes(q));
    }
    switch (sortMode) {
      case "name":
        result.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "dateAdded":
        result.sort((a, b) => b.createdAt - a.createdAt);
        break;
      case "duration":
        result.sort((a, b) => b.duration - a.duration);
        break;
      case "type":
        result.sort((a, b) => a.type.localeCompare(b.type));
        break;
    }
    return result;
  }, [assets, currentFolderId, filterTypes, filterAI, searchQuery, sortMode]);

  const visibleFolders = useMemo(() => {
    let result = folders.filter((f) => f.parentFolderId === currentFolderId);
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((f) => f.name.toLowerCase().includes(q));
    }
    return result;
  }, [folders, currentFolderId, searchQuery]);

  const itemCount = visibleFolders.length + filteredAssets.length;

  const breadcrumbPath = useMemo(() => {
    const path: { id: string | null; name: string }[] = [{ id: null, name: "Library" }];
    let id = currentFolderId;
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      const folder = folders.find((f) => f.id === id);
      if (folder) {
        path.push({ id: folder.id, name: folder.name });
        id = folder.parentFolderId;
      } else break;
    }
    return path;
  }, [currentFolderId, folders]);

  const getCols = (width: number) => {
    const spacing = 8;
    const padding = 16;
    const usable = Math.max(0, width - padding * 2);
    return Math.max(1, Math.floor((usable + spacing) / (thumbnailSize + spacing)));
  };

  return (
    <div className="h-full flex flex-col bg-[#0A0A0A]">
      {/* Toolbar */}
      <div className="px-2 pt-2 pb-1 space-y-1">
        <div className="flex items-center gap-1 h-8">
          <input ref={fileInputRef} type="file" multiple accept="video/*,audio/*,image/*" onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) importFiles(e.target.files);
            e.target.value = "";
          }} className="hidden" />
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={handleImport}>
            <Plus size={14} />
            Import
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs bg-gradient-to-r bg-white/8 hover:bg-white/12"
            onClick={toggleGenerationPanel}
          >
            <Sparkles size={14} className="text-white/70" />
            Generate
          </Button>
          <div className="flex-1" />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" className="text-white/30" />
              }
            >
              <SlidersHorizontal size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => showToast("New folder")}>
                <FolderPlus size={14} />
                New Folder
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => showToast("Create matte")}>
                <Square size={14} />
                Create Matte
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => showToast("Organize with agent")}>
                <Wand2 size={14} />
                Organize with Agent
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-1 h-8">
          <div className="flex-1 flex items-center gap-1.5 px-2 h-7 rounded-full bg-white/5 border border-white/10">
            <Search size={12} className="text-white/30 shrink-0" />
            <input
              type="text"
              placeholder="Search"
              value={searchQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent text-xs text-white outline-none placeholder:text-white/30"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="text-white/30 hover:text-white/60">
                <X size={12} />
              </button>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" className="text-white/30" />
              }
            >
              {viewMode === "folder" ? <FolderOpen size={14} /> : viewMode === "flat" ? <LayoutGrid size={14} /> : <Rows3 size={14} />}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setViewMode("folder")}>
                <FolderOpen size={14} />
                Folders {viewMode === "folder" && "✓"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setViewMode("flat")}>
                <LayoutGrid size={14} />
                Flat {viewMode === "flat" && "✓"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setViewMode("grouped")}>
                <Rows3 size={14} />
                Grouped {viewMode === "grouped" && "✓"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {thumbnailSizes.map((preset) => (
                <DropdownMenuItem key={preset.value} onClick={() => setThumbnailSize(preset.value)}>
                  {preset.label} {thumbnailSize === preset.value && "✓"}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" className="text-white/30" />
              }
            >
              <ArrowUpDown size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setSortMode("dateAdded")}>Date Added {sortMode === "dateAdded" && "✓"}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortMode("name")}>Name {sortMode === "name" && "✓"}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortMode("duration")}>Duration {sortMode === "duration" && "✓"}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortMode("type")}>Type {sortMode === "type" && "✓"}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" className={cn(hasActiveFilters ? "text-white/70" : "text-white/30")} />
              }
            >
              <Filter size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {filterableTypes.map(({ type, icon: Icon, label }) => (
                <DropdownMenuItem key={type} onClick={() => toggleFilterType(type)}>
                  <Icon size={14} />
                  {label} {filterTypes.has(type) && "✓"}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={toggleFilterAI}>
                AI Generated {filterAI && "✓"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={clearFilters}>Clear Filters</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Context bar */}
      <div className="flex items-center justify-between px-3 h-6 text-[11px]">
        {viewMode === "folder" ? (
          <div className="flex items-center gap-1 overflow-hidden">
            {breadcrumbPath.map((item, idx) => (
              <span key={item.id ?? "__root__"} className="flex items-center gap-1 shrink-0">
                {idx > 0 && <span className="text-white/20">/</span>}
                <button
                  onClick={() => {
                    if (idx < breadcrumbPath.length - 1) setCurrentFolderId(item.id);
                  }}
                  className={cn(
                    "hover:text-white transition-colors truncate max-w-[100px]",
                    idx === breadcrumbPath.length - 1 ? "text-white/60 font-semibold" : "text-white/30"
                  )}
                >
                  {item.name}
                </button>
              </span>
            ))}
          </div>
        ) : (
          <span className="text-white/40 font-semibold">{viewMode === "flat" ? "Flat" : "Grouped"}</span>
        )}
        <span className="text-white/20 tabular-nums shrink-0">
          {itemCount} {itemCount === 1 ? "item" : "items"}
        </span>
      </div>

      {/* Content */}
      <div
        className={cn(
          "flex-1 min-h-0 overflow-hidden relative",
          isDragOver && "ring-2 ring-inset ring-white/20 bg-white/3"
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={(e) => {
          if (e.target === e.currentTarget) clearSelection();
        }}
      >
        {isDragOver && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/5 backdrop-blur-sm pointer-events-none">
            <div className="text-center">
              <p className="text-sm font-medium text-white/80">Drop files to import</p>
              <p className="text-xs text-white/70/60 mt-1">Video, audio, or image files</p>
            </div>
          </div>
        )}
        <ScrollArea className="h-full">
          <div className="p-2">
            {itemCount === 0 ? (
              <EmptyState />
            ) : (
              <GridView
                folders={viewMode === "folder" ? visibleFolders : []}
                assets={filteredAssets}
                thumbnailSize={thumbnailSize}
                cols={getCols(300)}
              />
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function GridView({
  folders,
  assets,
  thumbnailSize,
  cols,
}: {
  folders: { id: string; name: string }[];
  assets: ReturnType<typeof useMediaPanelStore.getState>["assets"];
  thumbnailSize: number;
  cols: number;
}) {
  const { setCurrentFolderId, selectedAssetIds, toggleAssetSelection } = useMediaPanelStore();
  const items = [
    ...folders.map((f) => ({ kind: "folder" as const, id: f.id, name: f.name })),
    ...assets.map((a) => ({ kind: "asset" as const, id: a.id, asset: a })),
  ];

  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(1, cols)}, minmax(0, 1fr))` }}>
      {items.map((item) =>
        item.kind === "folder" ? (
          <FolderTile key={item.id} name={item.name} onOpen={() => setCurrentFolderId(item.id)} />
        ) : (
          <AssetThumbnail
            key={item.id}
            asset={item.asset}
            selected={selectedAssetIds.has(item.id)}
            onSelect={(multi) => toggleAssetSelection(item.id, multi)}
            size={thumbnailSize}
          />
        )
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <FolderOpen size={48} className="text-white/15 mb-4" strokeWidth={1} />
      <p className="text-sm font-light text-white/40 tracking-tight">No media yet</p>
      <p className="text-xs text-white/20 mt-1">Drop files here or import from disk</p>
    </div>
  );
}
