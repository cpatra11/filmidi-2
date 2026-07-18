import { useEffect } from "react";
import { useAppStore } from "@/store/useAppStore";
import { useEditorStore } from "@videoflow/react-video-editor";
import { commands } from "@videoflow/react-video-editor";

const { addLayerCommand } = commands;

function nudgeSelectedClips(direction: "left" | "right", frames: number) {
  const s = useEditorStore.getState();
  const ids = s.selection.layerIds;
  if (ids.length === 0) return;
  const fps = s.video.fps || 30;
  const delta = direction === "left" ? -frames : frames;
  const updates = ids.map((id) => {
    const layer = s.video.layers?.find((l: any) => l.id === id);
    if (!layer) return null;
    const newTime = Math.max(0, (layer.settings?.startTime ?? 0) + delta / fps);
    return { id, startTime: newTime };
  }).filter(Boolean) as Array<{ id: string; startTime: number }>;
  if (updates.length > 0) {
    commands.moveLayersCommand(s.commit, updates);
    s.bridge?.seek(s.currentFrame);
  }
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
            const lMax = Math.max(0, Math.floor(lState.video.duration * lFps) - 1);
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
          const maxFrame = Math.max(0, Math.floor(s.video.duration * fps) - 1);
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
          const f = Math.max(0, Math.floor(s.video.duration * (s.video.fps || 30)) - 1);
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
          const maxFrame = Math.max(0, Math.floor(s.video.duration * fps) - 1);
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
        if (e.key === "ArrowUp") { e.preventDefault(); nudgeSelectedClips("left", 1); return; }
        if (e.key === "ArrowDown") { e.preventDefault(); nudgeSelectedClips("right", 1); return; }
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
            const allIds = useEditorStore.getState().video.layers.map((l: any) => l.id);
            useEditorStore.getState().selectLayers(allIds);
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

function splitAtPlayhead() {
  const s = useEditorStore.getState();
  const frame = s.currentFrame;
  const fps = s.video.fps || 30;
  const ids = s.selection.layerIds;
  if (ids.length === 0) return;

  s.commit((v: any) => {
    const idSet = new Set(ids);
    const toAdd: any[] = [];
    const processLayers = (layers: any[]) => {
      for (const layer of layers) {
        if (idSet.has(layer.id)) {
          const startFrame = Math.round(layer.startTime * fps);
          const durFrames = Math.round((layer.duration || layer.sourceDuration || 5) * fps);
          const endFrame = startFrame + durFrames;
          if (frame > startFrame && frame < endFrame) {
            const splitOffset = (frame - startFrame) / fps;
            toAdd.push({
              ...layer,
              id: `${layer.id}-r-${Date.now()}`,
              name: `${layer.name} (R)`,
              startTime: layer.startTime + splitOffset,
              sourceStart: (layer.sourceStart || 0) + splitOffset,
              sourceDuration: (layer.duration || layer.sourceDuration || 5) - splitOffset,
              duration: (layer.duration || layer.sourceDuration || 5) - splitOffset,
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

function cutSelectedLayers() {
  const s = useEditorStore.getState();
  const ids = s.selection.layerIds;
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

function copySelectedLayers() {
  const s = useEditorStore.getState();
  const ids = s.selection.layerIds;
  if (ids.length === 0) return;
  const layers = s.video.layers.filter((l: any) => ids.includes(l.id));
  (window as any).__vfClipboard = { action: "copy", layers: JSON.parse(JSON.stringify(layers)) };
}

async function pasteLayers() {
  const clip = (window as any).__vfClipboard;
  if (!clip || !clip.layers?.length) return;
  const editor = useEditorStore.getState();
  const fps = editor.video.fps || 30;
  const pasteTime = editor.currentFrame / fps;
  for (const layer of clip.layers) {
    await addLayerCommand(editor.commit, {
      type: layer.type,
      source: layer.settings?.source ?? layer.source,
      sourceDuration: layer.settings?.sourceDuration ?? layer.sourceDuration ?? layer.duration ?? 5,
      startTime: pasteTime,
      properties: layer.properties,
    });
  }
  const s = useEditorStore.getState();
  s.bridge?.seek(s.currentFrame);
}

function deleteSelectedLayers() {
  const s = useEditorStore.getState();
  const ids = s.selection.layerIds;
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

function fitPreview() {
  useEditorStore.getState().setViewport({ previewZoom: 1, previewPanX: 0, previewPanY: 0 });
}

function zoomToEditor(scale: number) {
  const s = useEditorStore.getState();
  s.setViewport({
    timelineScale: scale,
    previewZoom: Math.max(0.05, Math.min(16, (s.viewport.previewZoom || 1) * (scale / s.viewport.timelineScale))),
  });
}
