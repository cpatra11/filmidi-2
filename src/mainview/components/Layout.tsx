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
import { TourOverlay } from "./TourOverlay";
import { useAppStore } from "@/store/useAppStore";
import { useMediaPanelStore } from "@/store/useMediaPanelStore";
import { getMediaDuration } from "@/lib/mediaDuration";
import { useState, useCallback, useRef, useEffect } from "react";
import { PreviewOverlays } from "./PreviewOverlays";
import { TimelineTabBar } from "./TimelineTabBar";
import type { ContextTarget } from "./ClipContextMenu";

// Track offsets for proper z-order: audio=0-9, video=10-19, text=20-29
function nextTrack(type: string, offset: number = 0): number {
  const layers = useEditorStore.getState().video.layers ?? [];
  const sameTypeCount = layers.filter((l: any) => l.type === type).length;
  return offset + sameTypeCount;
}

function getDisplayName(urlOrFile: string | File | undefined): string {
  if (!urlOrFile) return "Clip";
  if (typeof urlOrFile === "string") {
    const parts = urlOrFile.split("/");
    const last = parts[parts.length - 1];
    return decodeURIComponent(last).replace(/\.[^.]+$/, "") || "Clip";
  }
  return urlOrFile.name.replace(/\.[^.]+$/, "") || "Clip";
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
  const { showAgentPanel, showMediaPanel, showInspector } = useAppStore();
  const [isTimelineDragOver, setIsTimelineDragOver] = useState(false);
  const [contextTarget, setContextTarget] = useState<ContextTarget>("empty");
  const previewContainerRef = useRef<HTMLDivElement>(null);

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
            const audioTrack = nextTrack("audio", 0);
            const videoTrack = nextTrack("video", 10);
            cmds.setTrackSettingsCommand(editor.commit, audioTrack, { name: `A${audioTrack + 1}` });
            cmds.setTrackSettingsCommand(editor.commit, videoTrack, { name: `V${videoTrack - 9}` });
            const audioLayerId = await addLayerCommand(editor.commit, { type: "audio", source: asset.url, sourceDuration, startTime });
            await cmds.setPropertyCommand(editor.commit, audioLayerId, "track", audioTrack);
            await cmds.setPropertyCommand(editor.commit, audioLayerId, "name", `${clipName} Audio`);
            await setLayerLinkId(editor.commit, audioLayerId, linkId, setSettingCommand);
            const layerId = await addLayerCommand(editor.commit, { type, source: asset.url, sourceDuration, startTime });
            await cmds.setPropertyCommand(editor.commit, layerId, "track", videoTrack);
            await cmds.setPropertyCommand(editor.commit, layerId, "name", clipName);
            await setLayerLinkId(editor.commit, layerId, linkId, setSettingCommand);
            await cmds.setPropertyCommand(editor.commit, layerId, "mute", true);
          } else {
            const l = await addLayerCommand(editor.commit, { type, source: asset.url, sourceDuration, startTime });
            if (l) {
              const { commands: cmds } = await import("@videoflow/react-video-editor");
              await cmds.setPropertyCommand(editor.commit, l, "track", nextTrack("audio", 0));
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
          v.tracks = v.tracks || [];
          v.tracks.push({ id: `track-${Date.now()}`, name: `Track ${v.tracks.length + 1}`, layers: [] });
        }, { label: "Add track" });
        break;
      case "select-all":
        useEditorStore.getState().selectLayers(
          useEditorStore.getState().video.layers.map((l: any) => l.id)
        );
        break;
      case "paste": {
        const clip = (window as any).__vfClipboard;
        if (clip && clip.layers?.length > 0) {
          const editor = useEditorStore.getState();
          const fps = editor.video.fps || 30;
          const pasteTime = editor.currentFrame / fps;
          for (const layer of clip.layers) {
            await addLayerCommand(editor.commit, {
              type: layer.type,
              source: layer.source,
              sourceDuration: layer.sourceDuration || layer.duration || 5,
              startTime: pasteTime,
              properties: layer.properties,
            });
          }
          const s = useEditorStore.getState();
          s.bridge?.seek(s.currentFrame);
        }
        break;
      }
    }
  };

  const handleClipAction = async (action: string) => {
    switch (action) {
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
        const clip = (window as any).__vfClipboard;
        if (clip && clip.layers?.length > 0) {
          const editor = useEditorStore.getState();
          const fps = editor.video.fps || 30;
          const pasteTime = editor.currentFrame / fps;
          for (const layer of clip.layers) {
            await addLayerCommand(editor.commit, {
              type: layer.type,
              source: layer.source,
              sourceDuration: layer.sourceDuration || layer.duration || 5,
              startTime: pasteTime,
              properties: layer.properties,
            });
          }
          const ps = useEditorStore.getState();
          ps.bridge?.seek(ps.currentFrame);
        }
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
        const s3 = useEditorStore.getState();
        const frame = s3.currentFrame;
        const fps3 = s3.video.fps || 30;
        const ids3 = s3.selection.layerIds;
        // Expand to linked partners
        const { findLinkedPartnerIn } = await import("@/lib/linkUtils");
        const splitAllLayers = s3.video.layers ?? [];
        const splitIds = new Set(ids3);
        for (const id of ids3) {
          const partner = findLinkedPartnerIn(splitAllLayers, id);
          if (partner) splitIds.add(partner.id);
        }
        if (splitIds.size > 0) {
          s3.commit((v: any) => {
            const idSet = new Set(splitIds);
            const toAdd: any[] = [];
            const processLayers = (layers: any[]) => {
              for (const layer of layers) {
                if (idSet.has(layer.id)) {
                  const startFrame = Math.round(layer.startTime * fps3);
                  const durFrames = Math.round((layer.duration || layer.sourceDuration || 5) * fps3);
                  const endFrame = startFrame + durFrames;
                  if (frame > startFrame && frame < endFrame) {
                    const splitOffset = (frame - startFrame) / fps3;
                    const origDur = layer.duration || layer.sourceDuration || 5;
                    toAdd.push({
                      ...layer,
                      id: `${layer.id}-r-${Date.now()}`,
                      name: `${layer.name} (R)`,
                      startTime: layer.startTime + splitOffset,
                      sourceStart: (layer.sourceStart || 0) + splitOffset,
                      sourceDuration: origDur - splitOffset,
                      duration: origDur - splitOffset,
                    });
                    layer.duration = splitOffset;
                    layer.sourceDuration = splitOffset;
                  }
                } else if (layer.type === "group" && Array.isArray(layer.children)) {
                  processLayers(layer.children);
                }
              }
            };
            processLayers(v.layers);
            v.layers.push(...toAdd);
          }, { label: "Split at playhead" });
        }
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

    // OS file drop (from Finder / desktop)
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      const mediaStore = useMediaPanelStore.getState();
      const editor = useEditorStore.getState();
      const fps = editor.video.fps || 30;
      const startTime = editor.currentFrame / fps;
      for (const file of files) {
        const type = file.type.startsWith("video/") ? "video" as const
          : file.type.startsWith("audio/") ? "audio" as const
          : "image" as const;
        const duration = await getMediaDuration(file, type);
        const id = `asset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const url = URL.createObjectURL(file);
        mediaStore.addAsset({ id, name: file.name, type, url, duration, isGenerated: false, folderId: mediaStore.currentFolderId, createdAt: Date.now() });
        if (editor.mediaImporter) editor.mediaImporter([file], { startTime, track: 0 });
        const isVideoFile = type === "video";
        if (isVideoFile) {
          const { generateLinkId, setLayerLinkId } = await import("@/lib/linkUtils");
          const { commands: cmds } = await import("@videoflow/react-video-editor");
          const setSettingCommand = cmds.setSettingCommand;
          const linkId = generateLinkId();
          const clipName = getDisplayName(file);
          const audioTrack = nextTrack("audio", 0);
          const videoTrack = nextTrack("video", 10);
          cmds.setTrackSettingsCommand(editor.commit, audioTrack, { name: `A${audioTrack + 1}` });
          cmds.setTrackSettingsCommand(editor.commit, videoTrack, { name: `V${videoTrack - 9}` });
          const audioLayerId = await addLayerCommand(editor.commit, { type: "audio", source: url, sourceDuration: duration, startTime });
          await cmds.setPropertyCommand(editor.commit, audioLayerId, "track", audioTrack);
          await cmds.setPropertyCommand(editor.commit, audioLayerId, "name", `${clipName} Audio`);
          await setLayerLinkId(editor.commit, audioLayerId, linkId, setSettingCommand);
          const layerId = await addLayerCommand(editor.commit, { type, source: url, sourceDuration: duration, startTime });
          await cmds.setPropertyCommand(editor.commit, layerId, "track", videoTrack);
          await cmds.setPropertyCommand(editor.commit, layerId, "name", clipName);
          await setLayerLinkId(editor.commit, layerId, linkId, setSettingCommand);
          await cmds.setPropertyCommand(editor.commit, layerId, "mute", true);
        } else {
          const l = await addLayerCommand(editor.commit, { type, source: url, sourceDuration: duration, startTime });
          if (l) {
            const { commands: cmds } = await import("@videoflow/react-video-editor");
            await cmds.setPropertyCommand(editor.commit, l, "track", nextTrack("audio", 0));
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
    try {
      const raw = e.dataTransfer.getData("application/json");
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.kind !== "media-asset") return;
      const editor = useEditorStore.getState();
      const fps = editor.video.fps || 30;
      const startTime = editor.currentFrame / fps;
      if (data.type === "video") {
        const { generateLinkId, setLayerLinkId } = await import("@/lib/linkUtils");
        const { commands: cmds } = await import("@videoflow/react-video-editor");
        const setSettingCommand = cmds.setSettingCommand;
        const linkId = generateLinkId();
        const clipName = getDisplayName(data.url);
        const audioTrack = nextTrack("audio", 0);
        const videoTrack = nextTrack("video", 10);
        cmds.setTrackSettingsCommand(editor.commit, audioTrack, { name: `A${audioTrack + 1}` });
        cmds.setTrackSettingsCommand(editor.commit, videoTrack, { name: `V${videoTrack - 9}` });
        const audioLayerId = await addLayerCommand(editor.commit, {
          type: "audio", source: data.url, sourceDuration: data.duration || 5, startTime,
        });
        if (audioLayerId) {
          await cmds.setPropertyCommand(editor.commit, audioLayerId, "track", audioTrack);
          await cmds.setPropertyCommand(editor.commit, audioLayerId, "name", `${clipName} Audio`);
          await setLayerLinkId(editor.commit, audioLayerId, linkId, setSettingCommand);
        }
        const videoLayerId = await addLayerCommand(editor.commit, {
          type: data.type, source: data.url, sourceDuration: data.duration || 5, startTime,
        });
        if (videoLayerId) {
          await cmds.setPropertyCommand(editor.commit, videoLayerId, "track", videoTrack);
          await cmds.setPropertyCommand(editor.commit, videoLayerId, "name", clipName);
          await setLayerLinkId(editor.commit, videoLayerId, linkId, setSettingCommand);
          await cmds.setPropertyCommand(editor.commit, videoLayerId, "mute", true);
        }
      } else {
        await addLayerCommand(editor.commit, {
          type: data.type,
          source: data.url,
          sourceDuration: data.duration || 5,
          startTime,
        });
      }
      // Seek to refresh preview
      const s = useEditorStore.getState();
      s.bridge?.seek(s.currentFrame);
    } catch {}
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[var(--vf-bg,#0a0a0a)]">
      <TitleBar />

      <div className="flex-1 min-h-0">
        <Group orientation="horizontal">
          {/* ── Agent Panel (full height) ── */}
          {showAgentPanel && (
            <Panel defaultSize="19%" minSize="14%" maxSize="40%" id="panel-agent">
              <div className="h-full overflow-hidden bg-[var(--vf-panel)]" data-tour="agent">
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
                          <div className="min-h-0 overflow-auto flex-1">
                            <MediaPanel />
                          </div>
                          <div className="h-px bg-[var(--vf-panel-border)] shrink-0" />
                          <div className="min-h-0 overflow-auto flex-1">
                            <GenerationPanel />
                          </div>
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
                              const type = file.type.startsWith("video/") ? "video" as const : file.type.startsWith("audio/") ? "audio" as const : "image" as const;
                              const duration = await getMediaDuration(file, type);
                              const id = `asset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                              const url = URL.createObjectURL(file);
                              store.addAsset({ id, name: file.name, type, url, duration, isGenerated: false, folderId: store.currentFolderId, createdAt: Date.now() });
        if (editor.mediaImporter) editor.mediaImporter([file], { startTime, track: 0 });
                              if (type === "video") {
                                const { generateLinkId, setLayerLinkId } = await import("@/lib/linkUtils");
                                const { commands: cmds } = await import("@videoflow/react-video-editor");
                                const setSettingCommand = cmds.setSettingCommand;
                                const linkId = generateLinkId();
                                const clipName = getDisplayName(file);
                                const audioTrack = nextTrack("audio", 0);
                                const videoTrack = nextTrack("video", 10);
                                cmds.setTrackSettingsCommand(editor.commit, audioTrack, { name: `A${audioTrack + 1}` });
                                cmds.setTrackSettingsCommand(editor.commit, videoTrack, { name: `V${videoTrack - 9}` });
                                const audioLayerId2 = await addLayerCommand(editor.commit, { type: "audio", source: url, sourceDuration: duration, startTime });
                                await cmds.setPropertyCommand(editor.commit, audioLayerId2, "track", audioTrack);
                                await cmds.setPropertyCommand(editor.commit, audioLayerId2, "name", `${clipName} Audio`);
                                await setLayerLinkId(editor.commit, audioLayerId2, linkId, setSettingCommand);
                                const layerId2 = await addLayerCommand(editor.commit, { type, source: url, sourceDuration: duration, startTime });
                                await cmds.setPropertyCommand(editor.commit, layerId2, "track", videoTrack);
                                await cmds.setPropertyCommand(editor.commit, layerId2, "name", clipName);
                                await setLayerLinkId(editor.commit, layerId2, linkId, setSettingCommand);
                                await cmds.setPropertyCommand(editor.commit, layerId2, "mute", true);
                              } else {
                                await addLayerCommand(editor.commit, { type, source: url, sourceDuration: duration, startTime });
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
                    <ClipContextMenu contextTarget={contextTarget} onAction={handleClipAction}>
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
      <TourOverlay />
    </div>
  );
}

function EditorPlaybar() {
  const video = useVideo();
  const { playing } = usePlayhead();
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const fps = video.fps || 30;
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
    const f = Math.max(0, timeToFrame(video.duration, fps) - 1);
    s.setCurrentFrame(f);
    s.bridge?.seek(f);
  };

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
      <button onClick={goToStart} style={btn}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 3v8M5 7l5-4v8z" /></svg>
      </button>
      <button onClick={togglePlay} style={{ ...btn, color: "var(--vf-primary)" }}>
        {playing
          ? <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="2" width="4" height="12" rx="1" /><rect x="9" y="2" width="4" height="12" rx="1" /></svg>
          : <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2l10 6-10 6z" /></svg>}
      </button>
      <button onClick={goToEnd} style={btn}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M11 3v8M9 7L4 3v8z" /></svg>
      </button>

      <span style={{ fontFamily: "var(--vf-font-mono)", minWidth: 70, textAlign: "center", fontSize: 11 }}>{timeStr}</span>

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

      <button onClick={() => zoomBy(0.8)} style={btn}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25"><circle cx="6" cy="6" r="4" /><line x1="9" y1="9" x2="12" y2="12" /><line x1="4" y1="6" x2="8" y2="6" /></svg>
      </button>
      <button onClick={zoomFit} style={{ ...btn, fontSize: 11, fontFamily: "var(--vf-font-mono)", padding: "4px 8px" }}>Fit</button>
      <button onClick={() => zoomBy(1.25)} style={btn}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25"><circle cx="6" cy="6" r="4" /><line x1="9" y1="9" x2="12" y2="12" /><line x1="4" y1="6" x2="8" y2="6" /><line x1="6" y1="4" x2="6" y2="8" /></svg>
      </button>
    </div>
  );
}
