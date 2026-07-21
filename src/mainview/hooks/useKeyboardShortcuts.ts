import { useEffect } from "react";
import { useAppStore } from "@/store/useAppStore";
import { layerTimelineBounds, useEditorStore } from "@videoflow/react-video-editor";
import { commands } from "@videoflow/react-video-editor";
import { findAvailableTrack, localTrackForKind, normalizeTrackForKind, validateMoveUpdates } from "@/lib/timelineMove";
import { generateLinkId, setLayerLinkId } from "@/lib/linkUtils";
import { clampTimelineFrame, getTimelineDuration } from "@/lib/timelineMetrics";

const { addLayerCommand } = commands;

function expandToPartners(ids: string[]): string[] {
  const layers = useEditorStore.getState().video.layers ?? [];
  const set = new Set(ids);
  for (const id of ids) {
    const layer = layers.find((l: any) => l.id === id);
    if (!layer) continue;
    const linkId = (layer as any).settings?.linkId;
    if (!linkId) continue;
    const partner = layers.find((l: any) => l.id !== id && (l as any).settings?.linkId === linkId);
    if (partner) set.add(partner.id);
  }
  return Array.from(set);
}

function nudgeSelectedClips(direction: "left" | "right" | "up" | "down", frames: number) {
  const s = useEditorStore.getState();
  const ids = expandToPartners(s.selection.layerIds);
  if (ids.length === 0) return;
  const fps = s.video.fps || 30;
  const timeDelta = direction === "left" ? -frames / fps : direction === "right" ? frames / fps : 0;
  const trackDelta = direction === "up" ? -1 : direction === "down" ? 1 : 0;
  const updates = ids.map((id) => {
    const layer = s.video.layers?.find((l: any) => l.id === id);
    if (!layer) return null;
    const kind = layer.type === "audio" ? "audio" : "video";
    const localTrack = localTrackForKind(layer.track, kind);
    return {
      id,
      startTime: Math.max(0, (layer.settings?.startTime ?? 0) + timeDelta),
      track: trackDelta === 0 ? undefined : normalizeTrackForKind(localTrack + trackDelta, kind),
    };
  }).filter(Boolean) as Array<{ id: string; startTime: number }>;
  if (updates.length === 0) return;
  const validation = validateMoveUpdates(s.video.layers ?? [], updates);
  if (!validation.ok) return;
  commands.moveLayersCommand(s.commit, updates);
  s.bridge?.seek(s.currentFrame);
}

export function useKeyboardShortcuts() {
  const { setToolMode, toggleCropEditing } = useAppStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      const isMod = e.metaKey || e.ctrlKey;

      if (isInput) return;

      // Space — play/pause
      if (e.code === "Space" && !isInput) {
        e.preventDefault();
        const s = useEditorStore.getState();
        if (!s.bridge) return;
        if (s.isPlaying) {
          s.bridge.stop();
          s.setPlaying(false);
        } else {
          s.setPlaying(true);
          s.bridge.play();
        }
        return;
      }

      // No modifier, not in input
      if (!isMod && !isInput) {
        // Escape — exit crop mode
        if (e.key === "Escape") {
          if (useAppStore.getState().cropEditingActive) {
            e.preventDefault();
            useAppStore.getState().toggleCropEditing();
            return;
          }
        }

        switch (e.key.toLowerCase()) {
          case "v":
            setToolMode("pointer");
            return;
          case "b":
            setToolMode("razor");
            return;
          case "c":
            e.preventDefault();
            toggleCropEditing();
            return;
          case "s":
            e.preventDefault();
            splitAtPlayhead();
            return;
          case "x":
            e.preventDefault();
            cutSelectedLayers();
            return;
          case "z":
            e.preventDefault();
            fitPreview();
            return;
          // J/K/L shuttle speeds
          case "j": {
            e.preventDefault();
            const jState = useEditorStore.getState();
            const jFps = jState.video.fps || 30;
            const jFrame = Math.max(0, jState.currentFrame - jFps * 2);
            jState.setCurrentFrame(jFrame);
            jState.bridge?.seek(jFrame);
            return;
          }
          case "k": {
            e.preventDefault();
            const kState = useEditorStore.getState();
            if (kState.isPlaying) { kState.bridge?.stop(); kState.setPlaying(false); }
            return;
          }
          case "l": {
            e.preventDefault();
            const lState = useEditorStore.getState();
            const lFps = lState.video.fps || 30;
            const lMax = clampTimelineFrame(lState.video, Math.ceil(getTimelineDuration(lState.video) * lFps));
            const lFrame = Math.min(lMax, lState.currentFrame + lFps * 2);
            lState.setCurrentFrame(lFrame);
            lState.bridge?.seek(lFrame);
            return;
          }
        }

        if (e.key === "ArrowLeft") {
          e.preventDefault();
          const s = useEditorStore.getState();
          const f = Math.max(0, s.currentFrame - 1);
          s.setCurrentFrame(f);
          s.bridge?.seek(f);
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          const s = useEditorStore.getState();
          const fps = s.video.fps || 30;
          const maxFrame = clampTimelineFrame(s.video, Math.ceil(getTimelineDuration(s.video) * fps));
          const f = Math.min(maxFrame, s.currentFrame + 1);
          s.setCurrentFrame(f);
          s.bridge?.seek(f);
          return;
        }
        if (e.key === "Home") {
          e.preventDefault();
          const s = useEditorStore.getState();
          s.setCurrentFrame(0);
          s.bridge?.seek(0);
          return;
        }
        if (e.key === "End") {
          e.preventDefault();
          const s = useEditorStore.getState();
          const f = clampTimelineFrame(s.video, Math.ceil(getTimelineDuration(s.video) * (s.video.fps || 30)));
          s.setCurrentFrame(f);
          s.bridge?.seek(f);
          return;
        }
        if (e.key === "Delete" || e.key === "Backspace") {
          deleteSelectedLayers();
          return;
        }
      }

      // Shift+Arrow — jump 1 second
      if (!isMod && e.shiftKey && !isInput) {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          const s = useEditorStore.getState();
          const fps = s.video.fps || 30;
          const f = Math.max(0, s.currentFrame - fps);
          s.setCurrentFrame(f);
          s.bridge?.seek(f);
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          const s = useEditorStore.getState();
          const fps = s.video.fps || 30;
          const maxFrame = clampTimelineFrame(s.video, Math.ceil(getTimelineDuration(s.video) * fps));
          const f = Math.min(maxFrame, s.currentFrame + fps);
          s.setCurrentFrame(f);
          s.bridge?.seek(f);
          return;
        }
      }

      // Alt+Arrow — nudge selected clips by 1 frame
      if (e.altKey && !isMod && !isInput) {
        if (e.key === "ArrowLeft") { e.preventDefault(); nudgeSelectedClips("left", 1); return; }
        if (e.key === "ArrowRight") { e.preventDefault(); nudgeSelectedClips("right", 1); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); nudgeSelectedClips("up", 1); return; }
        if (e.key === "ArrowDown") { e.preventDefault(); nudgeSelectedClips("down", 1); return; }
      }

      // Cmd/Ctrl shortcuts — only intercept keys we actually handle,
      // let everything else (Cmd+H, Cmd+Q, etc.) reach the native menu
      if (isMod) {
        switch (e.key.toLowerCase()) {
          case "z":
            e.preventDefault();
            if (e.shiftKey) useEditorStore.getState().redo();
            else useEditorStore.getState().undo();
            return;
          case "x":
            e.preventDefault();
            cutSelectedLayers();
            return;
          case "c":
            e.preventDefault();
            copySelectedLayers();
            return;
          case "v":
            e.preventDefault();
            pasteLayers();
            return;
          case "a":
            e.preventDefault();
            selectAllLayers();
            return;
        }
        // Don't call preventDefault or return for unhandled Cmd combinations
        // — they need to reach the native menu (Cmd+H, Cmd+Q, etc.)
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setToolMode, toggleCropEditing]);
}

export function splitAtPlayhead() {
  const s = useEditorStore.getState();
  const frame = s.currentFrame;
  const fps = s.video.fps || 30;
  const ids = expandToPartners(s.selection.layerIds);
  if (ids.length === 0) return;

  s.commit((v: any) => {
    const idSet = new Set(ids);
    const toAdd: any[] = [];
    const rightLinks = new Map<string, string>();
    const splitTime = frame / fps;
    const processLayers = (layers: any[]) => {
      for (const layer of layers) {
        if (idSet.has(layer.id)) {
          const settings = layer.settings ?? (layer.settings = {});
          const bounds = layerTimelineBounds(layer);
          if (splitTime > bounds.start && splitTime < bounds.end) {
            const speedValue = Number(settings.speed) || 1;
            const speed = Math.abs(speedValue);
            const splitSourceDuration = (splitTime - bounds.start) * speed;
            const oldSourceStart = Number(settings.sourceStart) || 0;
            const oldSourceDuration = Math.max(0.01, Number(settings.sourceDuration) || bounds.end - bounds.start);
            const rightSourceDuration = Math.max(0.01, oldSourceDuration - splitSourceDuration);
            const rightSourceStart = speedValue >= 0 ? oldSourceStart + splitSourceDuration : oldSourceStart;
            const linkId = settings.linkId as string | undefined;
            let rightLinkId = linkId ? rightLinks.get(linkId) : undefined;
            if (linkId && !rightLinkId) {
              rightLinkId = generateLinkId();
              rightLinks.set(linkId, rightLinkId);
            }
            toAdd.push({
              ...layer,
              id: `${layer.id}-r-${Date.now()}`,
              settings: {
                ...settings,
                startTime: splitTime,
                sourceStart: rightSourceStart,
                sourceDuration: rightSourceDuration,
                ...(rightLinkId ? { linkId: rightLinkId } : {}),
              },
            });
            settings.sourceDuration = Math.max(0.01, splitSourceDuration);
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

/** Keep the selected clips on the requested side of the playhead. */
export function trimSelectedToPlayhead(side: "left" | "right") {
  const s = useEditorStore.getState();
  const ids = expandToPartners(s.selection.layerIds);
  if (ids.length === 0) return;
  const playhead = s.currentFrame / (s.video.fps || 30);

  s.commit((v: any) => {
    const idSet = new Set(ids);
    const processLayers = (layers: any[]) => {
      for (const layer of layers) {
        if (idSet.has(layer.id)) {
          const settings = layer.settings ?? (layer.settings = {});
          const bounds = layerTimelineBounds(layer);
          if (playhead > bounds.start && playhead < bounds.end) {
            const speedValue = Number(settings.speed) || 1;
            const speed = Math.abs(speedValue);
            const oldSourceStart = Number(settings.sourceStart) || 0;
            const oldSourceDuration = Math.max(0.01, Number(settings.sourceDuration) || bounds.end - bounds.start);
            const splitSourceDuration = (playhead - bounds.start) * speed;
            if (side === "left") {
              settings.sourceDuration = Math.max(0.01, splitSourceDuration);
            } else {
              settings.startTime = playhead;
              settings.sourceDuration = Math.max(0.01, oldSourceDuration - splitSourceDuration);
              settings.sourceStart = speedValue >= 0 ? oldSourceStart + splitSourceDuration : oldSourceStart;
            }
          }
        } else if (layer.type === "group" && Array.isArray(layer.children)) {
          processLayers(layer.children);
        }
      }
    };
    processLayers(v.layers);
  }, { label: side === "left" ? "Trim end at playhead" : "Trim start at playhead" });
}

/** Remove the portion of each selected clip before the playhead. */
export function removeLeftAtPlayhead() {
  trimSelectedToPlayhead("right");
}

/** Remove the portion of each selected clip after the playhead. */
export function removeRightAtPlayhead() {
  trimSelectedToPlayhead("left");
}

export function cutSelectedLayers() {
  const s = useEditorStore.getState();
  const ids = expandToPartners(s.selection.layerIds);
  if (ids.length === 0) return;
  // Copy to clipboard
  const layers = s.video.layers.filter((l: any) => ids.includes(l.id));
  (window as any).__vfClipboard = { action: "cut", layers: JSON.parse(JSON.stringify(layers)) };
  // Remove from timeline
  s.commit((v: any) => {
    const idSet = new Set(ids);
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

export function copySelectedLayers() {
  const s = useEditorStore.getState();
  const ids = expandToPartners(s.selection.layerIds);
  if (ids.length === 0) return;
  const layers = s.video.layers.filter((l: any) => ids.includes(l.id));
  (window as any).__vfClipboard = { action: "copy", layers: JSON.parse(JSON.stringify(layers)) };
}

export async function pasteLayers() {
  const clip = (window as any).__vfClipboard;
  if (!clip || !clip.layers?.length) return;
  const editor = useEditorStore.getState();
  const fps = editor.video.fps || 30;
  const pasteTime = editor.currentFrame / fps;
  const baseTime = Math.min(...clip.layers.map((layer: any) => layer.settings?.startTime ?? layer.startTime ?? 0));
  const copiedLinks = new Map<string, string>();
  const newIds: string[] = [];
  for (const layer of clip.layers) {
    const oldSettings = layer.settings ?? {};
    const oldStart = oldSettings.startTime ?? layer.startTime ?? 0;
    const startTime = pasteTime + (oldStart - baseTime);
    const sourceDuration = oldSettings.sourceDuration ?? layer.sourceDuration ?? layer.duration ?? 5;
    const kind = layer.type === "audio" ? "audio" : "video";
    const preferredTrack = normalizeTrackForKind(layer.track, kind);
    const track = findAvailableTrack(
      useEditorStore.getState().video.layers ?? [],
      kind,
      startTime,
      sourceDuration,
      preferredTrack,
    );
    const { source, startTime: _ignoredStart, sourceDuration: _ignoredDuration, linkId: oldLinkId, ...extraSettings } = oldSettings;
    const newId = await addLayerCommand(editor.commit, {
      type: layer.type,
      source: source ?? layer.source,
      sourceDuration,
      startTime,
      properties: JSON.parse(JSON.stringify(layer.properties ?? {})),
      extraSettings: {
        ...extraSettings,
        sourceStart: oldSettings.sourceStart ?? 0,
        speed: oldSettings.speed ?? 1,
      },
    });
    editor.commit((draft: any) => {
      const pasted = draft.layers?.find((candidate: any) => candidate.id === newId);
      if (pasted) pasted.track = track;
    }, { label: "Place pasted layer" });
    newIds.push(newId);
    if (oldLinkId) {
      let newLinkId = copiedLinks.get(oldLinkId);
      if (!newLinkId) {
        newLinkId = generateLinkId();
        copiedLinks.set(oldLinkId, newLinkId);
      }
      await setLayerLinkId(editor.commit, newId, newLinkId, commands.setSettingCommand);
    }
  }
  editor.selectLayers(newIds);
  const s = useEditorStore.getState();
  s.bridge?.seek(s.currentFrame);
}

export function deleteSelectedLayers() {
  const s = useEditorStore.getState();
  const ids = expandToPartners(s.selection.layerIds);
  if (ids.length === 0) return;
  s.commit((v: any) => {
    const idSet = new Set(ids);
    const remove = (layers: any[]) => {
      for (let i = layers.length - 1; i >= 0; i--) {
        if (idSet.has(layers[i].id)) {
          layers.splice(i, 1);
        } else if (layers[i].type === "group" && Array.isArray(layers[i].children)) {
          remove(layers[i].children);
        }
      }
    };
    remove(v.layers);
  }, { label: "Delete layers" });
  s.clearSelection();
}

export function fitPreview() {
  useEditorStore.getState().setViewport({ previewZoom: 1, previewPanX: 0, previewPanY: 0 });
}

export function selectAllLayers() {
  const allIds = useEditorStore.getState().video.layers.map((l: any) => l.id);
  useEditorStore.getState().selectLayers(allIds);
}

function zoomToEditor(scale: number) {
  const s = useEditorStore.getState();
  s.setViewport({
    timelineScale: scale,
    previewZoom: Math.max(0.05, Math.min(16, (s.viewport.previewZoom || 1) * (scale / s.viewport.timelineScale))),
  });
}
