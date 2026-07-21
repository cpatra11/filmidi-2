import { Group, Panel, Separator } from "react-resizable-panels";
import {
  Preview,
  useEditorStore,
  useVideo,
  usePlayhead,
  timeToFrame,
  formatTime,
  commands,
} from "@videoflow/react-video-editor";
import { CustomTimeline } from "./CustomTimeline";
import { InspectorSidebar } from "./InspectorSidebar";
const { addLayerCommand } = commands;
import { TitleBar } from "./TitleBar";
import { MediaPanel } from "./MediaPanel";
import { AgentPanel } from "./AgentPanel";
import { GenerationPanel } from "./GenerationPanel";
import { MediaContextMenu } from "./MediaContextMenu";
import { ClipContextMenu } from "./ClipContextMenu";
import { Toolbar } from "./Toolbar";
import { ExportDialog } from "./ExportDialog";
import { SettingsDialog } from "./SettingsDialog";
import { HelpDialog } from "./HelpDialog";
import { SaveAsDialog } from "./SaveAsDialog";
import { AboutDialog } from "./AboutDialog";
import { TourOverlay } from "./TourOverlay";
import { useAppStore } from "@/store/useAppStore";
import { useMediaPanelStore } from "@/store/useMediaPanelStore";
import { getMediaDuration } from "@/lib/mediaDuration";
import { findAvailableTrack, normalizeTrackForKind } from "@/lib/timelineMove";
import { storeImportedFile } from "@/lib/mediaStorage";
import { getImportedMediaType } from "@/lib/mediaType";
import { getAudioSourceForPlayback } from "@/lib/movAudio";
import { getTimelineDuration, clampTimelineFrame } from "@/lib/timelineMetrics";
import { addMatteLayerAtPlayhead, addTextLayerAtPlayhead } from "@/lib/timelineAddActions";
import { useState, useCallback, useRef, useEffect } from "react";
import { PreviewOverlays } from "./PreviewOverlays";
import { TimelineTabBar } from "./TimelineTabBar";
import type { ContextTarget } from "./ClipContextMenu";
import { pasteLayers, splitAtPlayhead } from "@/hooks/useKeyboardShortcuts";
import { importMediaFiles } from "@/lib/menuActions";

function getDisplayName(urlOrFile: string | File | undefined): string {
  if (!urlOrFile) return "Clip";
  if (typeof urlOrFile === "string") {
    const parts = urlOrFile.split("/");
    const last = parts[parts.length - 1];
    return decodeURIComponent(last).replace(/\.[^.]+$/, "") || "Clip";
  }
  return urlOrFile.name.replace(/\.[^.]+$/, "") || "Clip";
}

/** Set a layer's track via direct commit (not setPropertyCommand) */
function setLayerTrack(commit: any, layerId: string, track: number) {
  commit((draft: any) => {
    const l = draft.layers?.find((x: any) => x.id === layerId);
    if (l) l.track = normalizeTrackForKind(track, l.type === "audio" ? "audio" : "video");
  }, { label: "Set track" });
}

function VHandle() {
  return (
    <Separator className="w-[3px] bg-transparent hover:bg-white/20 active:bg-white/40 transition-colors cursor-col-resize shrink-0" />
  );
}

function HHandle() {
  return (
    <Separator className="h-[3px] bg-transparent hover:bg-white/20 active:bg-white/40 transition-colors cursor-row-resize shrink-0" />
  );
}

/**
 * Resizable layout.
 * Agent spans full height on the left.
 * Everything else is on the right, split top (Media/Preview/Sidebar) and bottom (Toolbar/Timeline).
 * Each VideoFlow component gets its own vf-editor ancestor for CSS scoping.
 */
export function Layout() {
  const { showAgentPanel, showMediaPanel, showInspector, showGenerationPanel } = useAppStore();
  const [isTimelineDragOver, setIsTimelineDragOver] = useState(false);
  const timelineDropInFlightRef = useRef(false);
  const [contextTarget, setContextTarget] = useState<ContextTarget>("empty");
  const previewContainerRef = useRef<HTMLDivElement>(null);

  // VideoFlow's add-layer popover calls this importer. The app uses a custom
  // timeline shell, so the callback must be registered here explicitly.
  useEffect(() => {
    const editor = useEditorStore.getState();
    editor.setMediaImporter(async (files, options) => {
      const fps = useEditorStore.getState().video.fps || 30;
      const current = useEditorStore.getState();
      await importMediaFiles(files, {
        startTime: options?.startTime ?? current.currentFrame / fps,
        track: options?.track,
      });
    });
    return () => useEditorStore.getState().setMediaImporter(null);
  }, []);

  const handleMediaAction = async (action: string) => {
    const store = useMediaPanelStore.getState();
    const selectedIds = Array.from(store.selectedAssetIds);
    switch (action) {
      case "add-to-timeline": {
        if (selectedIds.length === 0) {
          store.showToast("Select media first");
          return;
        }
        const editor = useEditorStore.getState();
        const fps = editor.video.fps || 30;
        const startTime = editor.currentFrame / fps;
        for (const id of selectedIds) {
          const asset = store.assets.find((a) => a.id === id);
          if (!asset || !asset.url) continue;
          const type = asset.type === "image" ? "image" : asset.type === "video" ? "video" : "audio";
          const sourceDuration = asset.duration || 5;
          const isVideoType = type === "video";
          if (isVideoType) {
            const { generateLinkId, setLayerLinkId } = await import("@/lib/linkUtils");
            const { commands: cmds } = await import("@videoflow/react-video-editor");
            const setSettingCommand = cmds.setSettingCommand;
            const linkId = generateLinkId();
            const clipName = getDisplayName(asset.name);
            const audioTrack = findAvailableTrack(useEditorStore.getState().video.layers ?? [], "audio", startTime, sourceDuration);
            const videoTrack = findAvailableTrack(useEditorStore.getState().video.layers ?? [], "video", startTime, sourceDuration);
            const audioLayerId = await addLayerCommand(editor.commit, { type: "audio", source: asset.audioUrl ?? asset.url, sourceDuration, startTime });
            setLayerTrack(editor.commit, audioLayerId, audioTrack);
            await cmds.setSettingCommand(editor.commit, audioLayerId, "name", `${clipName} Audio`);
            await cmds.setPropertyCommand(editor.commit, audioLayerId, "mute", false);
            await cmds.setPropertyCommand(editor.commit, audioLayerId, "volume", 1);
            await setLayerLinkId(editor.commit, audioLayerId, linkId, setSettingCommand);
            const layerId = await addLayerCommand(editor.commit, { type, source: asset.url, sourceDuration, startTime });
            setLayerTrack(editor.commit, layerId, videoTrack);
            await cmds.setSettingCommand(editor.commit, layerId, "name", clipName);
            await setLayerLinkId(editor.commit, layerId, linkId, setSettingCommand);
            await cmds.setPropertyCommand(editor.commit, layerId, "mute", false);
          } else {
            const track = findAvailableTrack(
              useEditorStore.getState().video.layers ?? [],
              type === "audio" ? "audio" : "video",
              startTime,
              sourceDuration,
            );
            const l = await addLayerCommand(editor.commit, { type, source: asset.url, sourceDuration, startTime });
            if (l) {
              const { commands: cmds } = await import("@videoflow/react-video-editor");
              setLayerTrack(editor.commit, l, track);
            }
          }
        }
        // Seek to refresh preview
        const s = useEditorStore.getState();
        s.bridge?.seek(s.currentFrame);
        break;
      }
      case "rename":
        if (selectedIds.length > 0) {
          const name = prompt("Rename media:", store.assets.find((a) => a.id === selectedIds[0])?.name);
          if (name && name.trim()) {
            store.addAsset({
              ...store.assets.find((a) => a.id === selectedIds[0])!,
              name: name.trim(),
            });
          }
        }
        break;
      case "show-in-finder":
        store.showToast("Show in Finder (not available in web)");
        break;
      case "delete":
        for (const id of selectedIds) store.removeAsset(id);
        store.clearSelection();
        break;
    }
  };

  const handleTimelineAction = async (action: string) => {
    switch (action) {
      case "add-track":
        useEditorStore.getState().commit((v: any) => {
          const layers = Array.isArray(v.layers) ? v.layers : [];
          const hasVideo = layers.some((layer: any) => layer.type !== "audio");
          const maxVideoTrack = layers.reduce((max: number, layer: any) => {
            if (layer.type === "audio") return max;
            const raw = Number(layer.track);
            const local = Number.isFinite(raw) && raw >= 10 ? Math.floor(raw) - 10 : 0;
            return Math.max(max, local);
          }, 0);
          v.timelineTrackCounts = v.timelineTrackCounts || {};
          v.timelineTrackCounts.video = Math.max(
            Number(v.timelineTrackCounts.video) || 0,
            hasVideo ? maxVideoTrack + 1 : 1,
          ) + 1;
        }, { label: "Add track" });
        break;
      case "add-text":
        await addTextLayerAtPlayhead();
        break;
      case "add-matte":
        await addMatteLayerAtPlayhead();
        break;
      case "select-all":
        useEditorStore.getState().selectLayers(
          useEditorStore.getState().video.layers.map((l: any) => l.id)
        );
        break;
      case "paste": {
        await pasteLayers();
        break;
      }
    }
  };

  const handleClipAction = async (action: string) => {
    switch (action) {
      case "add-text":
        await addTextLayerAtPlayhead();
        break;
      case "add-matte":
        await addMatteLayerAtPlayhead();
        break;
      case "cut":
      case "copy": {
        const s = useEditorStore.getState();
        const ids = s.selection.layerIds;
        if (ids.length > 0) {
          // Expand to linked partners
          const { findLinkedPartnerIn } = await import("@/lib/linkUtils");
          const allLayers = s.video.layers ?? [];
          const idsToCut = new Set(ids);
          for (const id of ids) {
            const partner = findLinkedPartnerIn(allLayers, id);
            if (partner) idsToCut.add(partner.id);
          }
          const cutIds = Array.from(idsToCut);
          const layers = s.video.layers.filter((l: any) => cutIds.includes(l.id));
          (window as any).__vfClipboard = { action, layers: JSON.parse(JSON.stringify(layers)) };
          if (action === "cut") {
            s.commit((v: any) => {
              const idSet = new Set(cutIds);
              const remove = (layers: any[]) => {
                for (let i = layers.length - 1; i >= 0; i--) {
                  if (idSet.has(layers[i].id)) layers.splice(i, 1);
                  else if (layers[i].type === "group" && Array.isArray(layers[i].children)) remove(layers[i].children);
                }
              };
              remove(v.layers);
            }, { label: "Cut layers" });
            s.clearSelection();
          }
        }
        break;
      }
      case "paste": {
        await pasteLayers();
        break;
      }
      case "delete": {
        const s2 = useEditorStore.getState();
        const ids2 = s2.selection.layerIds;
        if (ids2.length > 0) {
          // Also delete linked partners
          const { findLinkedPartnerIn } = await import("@/lib/linkUtils");
          const allLayers = s2.video.layers ?? [];
          const idsToDelete = new Set(ids2);
          for (const id of ids2) {
            const partner = findLinkedPartnerIn(allLayers, id);
            if (partner && !idsToDelete.has(partner.id)) {
              idsToDelete.add(partner.id);
            }
          }
          s2.commit((v: any) => {
            const idSet = new Set(idsToDelete);
            const remove = (layers: any[]) => {
              for (let i = layers.length - 1; i >= 0; i--) {
                if (idSet.has(layers[i].id)) layers.splice(i, 1);
                else if (layers[i].type === "group" && Array.isArray(layers[i].children)) remove(layers[i].children);
              }
            };
            remove(v.layers);
          }, { label: "Delete layers" });
          s2.clearSelection();
        }
        break;
      }
      case "split": {
        splitAtPlayhead();
        break;
      }
      default:
        if (action === "unlink") {
          const { unlinkLayers } = await import("@/lib/linkUtils");
          const { commands: cmds } = await import("@videoflow/react-video-editor"); const setSettingCommand = cmds.setSettingCommand;
          const sel = useEditorStore.getState();
          const ids = sel.selection.layerIds;
          if (ids.length > 0) {
            for (const id of ids) {
              await unlinkLayers(id, sel.commit, setSettingCommand);
            }
            useMediaPanelStore.getState().showToast("Tracks unlinked");
          }
        } else if (action === "sync-lock") {
          const { generateLinkId, setLayerLinkId, findLinkedPartnerIn } = await import("@/lib/linkUtils");
          const { commands: cmds } = await import("@videoflow/react-video-editor"); const setSettingCommand = cmds.setSettingCommand;
          const sel = useEditorStore.getState();
          const ids = sel.selection.layerIds;
          if (ids.length >= 2) {
            const linkId = generateLinkId();
            for (const id of ids) {
              await setLayerLinkId(sel.commit, id, linkId, setSettingCommand);
            }
            useMediaPanelStore.getState().showToast(`Linked ${ids.length} tracks`);
          } else {
            useMediaPanelStore.getState().showToast("Select 2+ tracks to link");
          }
        } else if (action === "lock") {
          const { commands: cmds } = await import("@videoflow/react-video-editor");
          const sel = useEditorStore.getState();
          for (const id of sel.selection.layerIds) {
            await cmds.setPropertyCommand(sel.commit, id, "locked", true);
          }
          useMediaPanelStore.getState().showToast("Clip(s) locked");
        } else if (action === "unlock") {
          const { commands: cmds } = await import("@videoflow/react-video-editor");
          const sel = useEditorStore.getState();
          for (const id of sel.selection.layerIds) {
            await cmds.setPropertyCommand(sel.commit, id, "locked", false);
          }
          useMediaPanelStore.getState().showToast("Clip(s) unlocked");
        } else if (action.startsWith("ai-") || action.startsWith("detect") || action.startsWith("show-beat") || action.startsWith("snap-to") || action.startsWith("sync-")) {
          useMediaPanelStore.getState().showToast(`${action}: coming soon`);
        }
        break;
    }
  };

  const handleTimelineDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    setIsTimelineDragOver(true);
  }, []);

  const handleTimelineDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsTimelineDragOver(false);
  }, []);

  const handleTimelineDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsTimelineDragOver(false);
    if (timelineDropInFlightRef.current) return;
    timelineDropInFlightRef.current = true;

    try {
    const editor = useEditorStore.getState();
    const timelineSurface = e.currentTarget.querySelector<HTMLElement>(".ct-tracks-inner");
    const surfaceRect = timelineSurface?.getBoundingClientRect();
    const scale = editor.viewport.timelineScale || 100;
    const dropStartTime = surfaceRect
      ? Math.max(0, (e.clientX - surfaceRect.left) / scale)
      : editor.currentFrame / (editor.video.fps || 30);
    const row = (e.target as HTMLElement).closest<HTMLElement>(".ct-track-row");
    const rowKind = row?.dataset.trackKind;
    const trackAtDrop = (kind: "audio" | "video") => {
      const rows = Array.from(
        timelineSurface?.querySelectorAll<HTMLElement>(`.ct-track-row[data-track-kind="${kind}"]`) ?? [],
      );
      const hoveredTrack = rowKind === kind && row?.dataset.trackIndex ? Number(row.dataset.trackIndex) : null;
        if (
          hoveredTrack !== null &&
          Number.isFinite(hoveredTrack) &&
          row?.dataset.disabled !== "true"
        ) return hoveredTrack;
      let nearest: { track: number; distance: number } | null = null;
      for (const candidate of rows) {
        const rect = candidate.getBoundingClientRect();
        const distance = e.clientY < rect.top ? rect.top - e.clientY : e.clientY > rect.bottom ? e.clientY - rect.bottom : 0;
        const track = Number(candidate.dataset.trackIndex);
        if (candidate.dataset.disabled === "true") continue;
        if (Number.isFinite(track) && (!nearest || distance < nearest.distance)) nearest = { track, distance };
      }
      return nearest?.track ?? 0;
    };

    // OS file drop (from Finder / desktop)
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      const mediaStore = useMediaPanelStore.getState();
      const fps = editor.video.fps || 30;
      const startTime = dropStartTime;
      for (const file of files) {
        const type = getImportedMediaType(file);
        const duration = await getMediaDuration(file, type);
        const id = `asset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const stored = await storeImportedFile(file, id);
        let url = stored?.url ?? URL.createObjectURL(file);
        // Do not block the drop on MOV/audio companion extraction. Place the
        // clip immediately, then swap the audio source in when it is ready.
        const audioPromise = type === "video"
          ? getAudioSourceForPlayback(file, id, url).catch((error) => {
              console.warn("[timeline-import] companion audio deferred", error);
              return null;
            })
          : Promise.resolve<string | null>(null);
        mediaStore.addAsset({ id, name: file.name, type, url, sourcePath: stored?.path, duration, isGenerated: false, folderId: mediaStore.currentFolderId, createdAt: Date.now() });
        const isVideoFile = type === "video";
        if (isVideoFile) {
          const { generateLinkId, setLayerLinkId } = await import("@/lib/linkUtils");
          const { commands: cmds } = await import("@videoflow/react-video-editor");
          const setSettingCommand = cmds.setSettingCommand;
          const linkId = generateLinkId();
          const clipName = getDisplayName(file);
          const videoTrack = findAvailableTrack(
            useEditorStore.getState().video.layers ?? [], "video", startTime, duration, trackAtDrop("video"),
          );
          const audioTrack = findAvailableTrack(
            useEditorStore.getState().video.layers ?? [], "audio", startTime, duration, trackAtDrop("audio"),
          );
          const audioLayerId = await addLayerCommand(editor.commit, { type: "audio", source: url, sourceDuration: duration, startTime });
          setLayerTrack(editor.commit, audioLayerId, audioTrack);
          await cmds.setSettingCommand(editor.commit, audioLayerId, "name", `${clipName} Audio`);
          await cmds.setPropertyCommand(editor.commit, audioLayerId, "mute", false);
          await cmds.setPropertyCommand(editor.commit, audioLayerId, "volume", 1);
          await setLayerLinkId(editor.commit, audioLayerId, linkId, setSettingCommand);
          void audioPromise.then((audioSource) => {
            if (!audioSource || audioSource === url) return;
            editor.commit((draft: any) => {
              const audioLayer = draft.layers?.find((layer: any) => layer.id === audioLayerId);
              if (audioLayer) {
                audioLayer.settings = { ...(audioLayer.settings ?? {}), source: audioSource };
                audioLayer.source = audioSource;
              }
            }, { label: "Attach companion audio" });
            const currentMedia = useMediaPanelStore.getState();
            currentMedia.setAssets(currentMedia.assets.map((asset) => asset.id === id ? { ...asset, audioUrl: audioSource } : asset));
            useEditorStore.getState().bridge?.seek(useEditorStore.getState().currentFrame);
          });
          const layerId = await addLayerCommand(editor.commit, { type, source: url, sourceDuration: duration, startTime });
          setLayerTrack(editor.commit, layerId, videoTrack);
          await cmds.setSettingCommand(editor.commit, layerId, "name", clipName);
          await setLayerLinkId(editor.commit, layerId, linkId, setSettingCommand);
          await cmds.setPropertyCommand(editor.commit, layerId, "mute", false);
        } else {
          const track = findAvailableTrack(
            useEditorStore.getState().video.layers ?? [], type === "audio" ? "audio" : "video", startTime, duration, trackAtDrop(type === "audio" ? "audio" : "video"),
          );
          const l = await addLayerCommand(editor.commit, { type, source: url, sourceDuration: duration, startTime });
          if (l) {
            const { commands: cmds } = await import("@videoflow/react-video-editor");
            setLayerTrack(editor.commit, l, track);
          }
        }
      }
      mediaStore.showToast(`Imported ${files.length} file${files.length > 1 ? "s" : ""}`);
      // Seek to refresh preview
      const s = useEditorStore.getState();
      s.bridge?.seek(s.currentFrame);
      return;
    }

    // Media asset drag from panel
      const raw = e.dataTransfer.getData("application/json");
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.kind !== "media-asset") return;
      const fps = editor.video.fps || 30;
      const startTime = dropStartTime;
      if (data.type === "video") {
        const { generateLinkId, setLayerLinkId } = await import("@/lib/linkUtils");
        const { commands: cmds } = await import("@videoflow/react-video-editor");
        const setSettingCommand = cmds.setSettingCommand;
        const linkId = generateLinkId();
        const clipName = getDisplayName(data.url);
        const videoTrack = findAvailableTrack(
          useEditorStore.getState().video.layers ?? [], "video", startTime, data.duration || 5, trackAtDrop("video"),
        );
        const audioTrack = findAvailableTrack(
          useEditorStore.getState().video.layers ?? [], "audio", startTime, data.duration || 5, trackAtDrop("audio"),
        );
        const audioLayerId = await addLayerCommand(editor.commit, {
            type: "audio", source: data.audioUrl ?? data.url, sourceDuration: data.duration || 5, startTime,
        });
        if (audioLayerId) {
          setLayerTrack(editor.commit, audioLayerId, audioTrack);
          await cmds.setSettingCommand(editor.commit, audioLayerId, "name", `${clipName} Audio`);
          await cmds.setPropertyCommand(editor.commit, audioLayerId, "mute", false);
          await cmds.setPropertyCommand(editor.commit, audioLayerId, "volume", 1);
          await setLayerLinkId(editor.commit, audioLayerId, linkId, setSettingCommand);
        }
        const videoLayerId = await addLayerCommand(editor.commit, {
          type: data.type, source: data.url, sourceDuration: data.duration || 5, startTime,
        });
        if (videoLayerId) {
          setLayerTrack(editor.commit, videoLayerId, videoTrack);
          await cmds.setSettingCommand(editor.commit, videoLayerId, "name", clipName);
          await setLayerLinkId(editor.commit, videoLayerId, linkId, setSettingCommand);
          await cmds.setPropertyCommand(editor.commit, videoLayerId, "mute", false);
        }
      } else {
        const track = findAvailableTrack(
          useEditorStore.getState().video.layers ?? [], data.type === "audio" ? "audio" : "video", startTime, data.duration || 5, trackAtDrop(data.type === "audio" ? "audio" : "video"),
        );
        const layerId = await addLayerCommand(editor.commit, {
          type: data.type,
          source: data.url,
          sourceDuration: data.duration || 5,
          startTime,
        });
        if (layerId) setLayerTrack(editor.commit, layerId, track);
      }
      // Seek to refresh preview
      const s = useEditorStore.getState();
      s.bridge?.seek(s.currentFrame);
    } catch (error) {
      console.error("[timeline-import] failed to add media asset", error);
      useMediaPanelStore.getState().showToast(
        `Could not add media: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    finally {
      timelineDropInFlightRef.current = false;
    }
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[var(--vf-bg,#0a0a0a)]">
      <TitleBar />

      <div className="flex-1 min-h-0">
        <style>{`#panel-agent > div { overflow: visible !important; }`}</style>
        <Group orientation="horizontal">
          {/* ── Agent Panel (full height) ── */}
          {showAgentPanel && (
            <Panel defaultSize="19%" minSize="14%" maxSize="40%" id="panel-agent">
              <div className="h-full bg-[var(--vf-panel)]" data-tour="agent">
                <AgentPanel />
              </div>
            </Panel>
          )}

          {showAgentPanel && <VHandle />}

          {/* ── Right side ── */}
          <Panel defaultSize="81%" minSize="50%" id="panel-main">
            <Group orientation="vertical">
              {/* ── Top row: Media | Preview+Playbar | Sidebar ── */}
              <Panel defaultSize="47%" minSize="25%" id="panel-top">
                <Group orientation="horizontal">
                  {/* Media + Generation panels */}
                  {showMediaPanel && (
                    <Panel defaultSize="27%" minSize="12%" maxSize="40%" id="panel-media">
                      <MediaContextMenu onAction={handleMediaAction}>
                        <div className="h-full flex flex-col overflow-hidden bg-[var(--vf-panel)]" data-tour="media-panel">
                          <div className={`${showGenerationPanel ? "h-1/2" : "h-full"} min-h-0 overflow-auto`}>
                            <MediaPanel />
                          </div>
                          {showGenerationPanel && (
                            <>
                              <div className="h-px bg-[var(--vf-panel-border)] shrink-0" />
                              <div className="h-1/2 min-h-0 overflow-hidden">
                                <GenerationPanel />
                              </div>
                            </>
                          )}
                        </div>
                      </MediaContextMenu>
                    </Panel>
                  )}

                  {showMediaPanel && <VHandle />}

                  {/* Preview + Playbar */}
                  <Panel defaultSize="53%" minSize="25%" id="panel-preview">
                    <div className="h-full flex flex-col overflow-hidden" data-tour="preview">
                      <div
                        ref={previewContainerRef}
                        className="flex-1 min-h-0 relative"
                        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const files = Array.from(e.dataTransfer.files);
                          if (files.length === 0) return;
                          const store = useMediaPanelStore.getState();
                          const editor = useEditorStore.getState();
                          const fps = editor.video.fps || 30;
                          const startTime = editor.currentFrame / fps;
                          (async () => {
                            for (const file of files) {
                              const type = getImportedMediaType(file);
                              const duration = await getMediaDuration(file, type);
                              const id = `asset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                              const stored = await storeImportedFile(file, id);
                              let url = stored?.url ?? URL.createObjectURL(file);
                              const audioUrl = type === "video" ? await getAudioSourceForPlayback(file, id, url) : null;
                              store.addAsset({ id, name: file.name, type, url, audioUrl: audioUrl && audioUrl !== url ? audioUrl : undefined, sourcePath: stored?.path, duration, isGenerated: false, folderId: store.currentFolderId, createdAt: Date.now() });
                              if (type === "video") {
                                const { generateLinkId, setLayerLinkId } = await import("@/lib/linkUtils");
                                const { commands: cmds } = await import("@videoflow/react-video-editor");
                                const setSettingCommand = cmds.setSettingCommand;
                                const linkId = generateLinkId();
                                const clipName = getDisplayName(file);
                                const audioTrack = findAvailableTrack(useEditorStore.getState().video.layers ?? [], "audio", startTime, duration);
                                const videoTrack = findAvailableTrack(useEditorStore.getState().video.layers ?? [], "video", startTime, duration);
                                const audioLayerId2 = await addLayerCommand(editor.commit, { type: "audio", source: audioUrl ?? url, sourceDuration: duration, startTime });
                                setLayerTrack(editor.commit, audioLayerId2, audioTrack);
                                await cmds.setSettingCommand(editor.commit, audioLayerId2, "name", `${clipName} Audio`);
                                await cmds.setPropertyCommand(editor.commit, audioLayerId2, "mute", false);
                                await cmds.setPropertyCommand(editor.commit, audioLayerId2, "volume", 1);
                                await setLayerLinkId(editor.commit, audioLayerId2, linkId, setSettingCommand);
                                const layerId2 = await addLayerCommand(editor.commit, { type, source: url, sourceDuration: duration, startTime });
                                setLayerTrack(editor.commit, layerId2, videoTrack);
                                await cmds.setSettingCommand(editor.commit, layerId2, "name", clipName);
                                await setLayerLinkId(editor.commit, layerId2, linkId, setSettingCommand);
                                await cmds.setPropertyCommand(editor.commit, layerId2, "mute", false);
                              } else {
                                const track = findAvailableTrack(useEditorStore.getState().video.layers ?? [], type === "audio" ? "audio" : "video", startTime, duration);
                                const layerId = await addLayerCommand(editor.commit, { type, source: url, sourceDuration: duration, startTime });
                                if (layerId) setLayerTrack(editor.commit, layerId, track);
                              }
                            }
                            store.showToast(`Imported ${files.length} file${files.length > 1 ? "s" : ""}`);
                            const s = useEditorStore.getState();
                            s.bridge?.seek(s.currentFrame);
                          })();
                        }}
                      >
                        <vf-editor data-theme="dark" style={{ display: "contents" }}>
                          <Preview />
                        </vf-editor>
                        <PreviewOverlays containerRef={previewContainerRef} />
                      </div>
                      <div className="shrink-0">
                        <EditorPlaybar />
                      </div>
                    </div>
                  </Panel>

                  {showInspector && <VHandle />}

                  {/* Sidebar (inspector tools) */}
                  {showInspector && (
                    <Panel defaultSize="20%" minSize="8%" maxSize="35%" id="panel-sidebar">
                      <vf-editor data-theme="dark" style={{ display: "contents" }} data-tour="inspector">
                        <InspectorSidebar />
                      </vf-editor>
                    </Panel>
                  )}
                </Group>
              </Panel>

              <HHandle />

              {/* ── Bottom row: Toolbar + Timeline ── */}
              <Panel defaultSize="53%" minSize="20%" id="panel-timeline">
                <div className="h-full flex flex-col overflow-hidden" data-tour="timeline">
                  <div className="shrink-0">
                    <Toolbar />
                  </div>
                  <div className="shrink-0">
                    <TimelineTabBar />
                  </div>
                  <div
                    className={`flex-1 min-h-0 relative ${isTimelineDragOver ? "ring-2 ring-inset ring-white/20" : ""}`}
                    onDragOver={handleTimelineDragOver}
                    onDragLeave={handleTimelineDragLeave}
                    onDrop={handleTimelineDrop}
                  >
                    {isTimelineDragOver && (
                      <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/5 backdrop-blur-sm pointer-events-none rounded">
                        <p className="text-sm font-medium text-white/80">Drop to add to timeline</p>
                      </div>
                    )}
                    <ClipContextMenu
                      contextTarget={contextTarget}
                      onAction={contextTarget === "clip" ? handleClipAction : handleTimelineAction}
                    >
                      <vf-editor data-theme="dark" style={{ display: "contents" }}>
                        <CustomTimeline onContextMenuTarget={setContextTarget} />
                      </vf-editor>
                    </ClipContextMenu>
                  </div>
                </div>
              </Panel>
            </Group>
          </Panel>
        </Group>
      </div>
      <ExportDialog />
      <SettingsDialog />
      <HelpDialog />
      <SaveAsDialog />
      <AboutDialog />
      <TourOverlay />
    </div>
  );
}

function EditorPlaybar() {
  const video = useVideo();
  const { playing } = usePlayhead();
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const fps = video.fps || 30;
  const timelineDuration = getTimelineDuration(video);
  const timeStr = formatTime(currentFrame / fps, fps);
  const selection = useEditorStore((s) => s.selection);
  const [volume, setVolume] = useState(1);

  // Sync volume slider with selected layer's volume
  useEffect(() => {
    if (selection.layerIds.length === 1) {
      const s = useEditorStore.getState();
      const selLayer = s.video.layers?.find((l: any) => l.id === selection.layerIds[0]);
      if (selLayer) {
        const v = (selLayer.settings as any)?.volume;
        if (typeof v === "number") setVolume(v);
      }
    }
  }, [selection.layerIds.join(",")]);

  const togglePlay = () => {
    const s = useEditorStore.getState();
    if (!s.bridge) return;
    if (s.isPlaying) { s.bridge.stop(); s.setPlaying(false); }
    else { s.setPlaying(true); s.bridge.play(); }
  };

  const goToStart = () => {
    const s = useEditorStore.getState();
    s.setCurrentFrame(0);
    s.bridge?.seek(0);
  };

  const goToEnd = () => {
    const s = useEditorStore.getState();
    const f = clampTimelineFrame(s.video, timeToFrame(getTimelineDuration(s.video), fps));
    s.setCurrentFrame(f);
    s.bridge?.seek(f);
  };

  const seekValue = Math.max(0, Math.min(timelineDuration, currentFrame / fps));

  const zoomBy = (factor: number) => {
    const s = useEditorStore.getState();
    s.setViewport({
      timelineScale: Math.max(0.1, Math.min(5, s.viewport.timelineScale * factor)),
      previewZoom: Math.max(0.05, Math.min(16, (s.viewport.previewZoom || 1) * factor)),
    });
  };

  const zoomFit = () => {
    useEditorStore.getState().setViewport({ timelineScale: 1, previewZoom: 1, previewPanX: 0, previewPanY: 0 });
  };

  const btn: React.CSSProperties = { background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 4, display: "flex", alignItems: "center" };

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6, padding: "0 12px",
      height: 38, background: "var(--vf-panel)", borderTop: "1px solid var(--vf-panel-border)",
      userSelect: "none", fontSize: 12, color: "var(--vf-text-dim)",
    }}>
      <button onClick={goToStart} style={btn} aria-label="Go to start" title="Go to start">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 3v8M5 7l5-4v8z" /></svg>
      </button>
      <button onClick={togglePlay} style={{ ...btn, color: "var(--vf-primary)" }} aria-label={playing ? "Pause preview" : "Play preview"} title={playing ? "Pause preview" : "Play preview"}>
        {playing
          ? <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="2" width="4" height="12" rx="1" /><rect x="9" y="2" width="4" height="12" rx="1" /></svg>
          : <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2l10 6-10 6z" /></svg>}
      </button>
      <button onClick={goToEnd} style={btn} aria-label="Go to end" title="Go to end">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M11 3v8M9 7L4 3v8z" /></svg>
      </button>

      <span style={{ fontFamily: "var(--vf-font-mono)", minWidth: 70, textAlign: "center", fontSize: 11 }}>{timeStr}</span>

      <input className="vf-preview-seek" type="range" min="0" max={Math.max(0.001, timelineDuration)} step={1 / fps} value={seekValue} aria-label="Seek preview" title="Seek preview" onChange={(e) => {
        const s = useEditorStore.getState();
        const frame = clampTimelineFrame(s.video, timeToFrame(Number(e.target.value), fps));
        s.setCurrentFrame(frame);
        s.bridge?.seek(frame);
      }} />

      {/* Volume control */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 8 }}>
        <span style={{ fontSize: 13, cursor: "default", opacity: 0.6 }}>🔊</span>
        <input
          type="range"
          min="0" max="1" step="0.05"
          value={volume}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            setVolume(v);
            const s = useEditorStore.getState();
            for (const id of selection.layerIds) {
              commands.setPropertyCommand(s.commit, id, "volume", v);
            }
          }}
          style={{ width: 60, accentColor: "var(--vf-primary, #888)", cursor: "pointer" }}
          title={`Volume: ${Math.round(volume * 100)}%`}
        />
      </div>

      <div style={{ flex: 1 }} />

      <button onClick={() => zoomBy(0.8)} style={btn} aria-label="Zoom out preview" title="Zoom out preview">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25"><circle cx="6" cy="6" r="4" /><line x1="9" y1="9" x2="12" y2="12" /><line x1="4" y1="6" x2="8" y2="6" /></svg>
      </button>
      <button onClick={zoomFit} style={{ ...btn, fontSize: 11, fontFamily: "var(--vf-font-mono)", padding: "4px 8px" }} aria-label="Fit preview" title="Fit preview">Fit</button>
      <button onClick={() => zoomBy(1.25)} style={btn} aria-label="Zoom in preview" title="Zoom in preview">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25"><circle cx="6" cy="6" r="4" /><line x1="9" y1="9" x2="12" y2="12" /><line x1="4" y1="6" x2="8" y2="6" /><line x1="6" y1="4" x2="6" y2="8" /></svg>
      </button>
    </div>
  );
}
