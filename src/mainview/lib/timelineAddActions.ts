import { commands, useEditorStore } from "@videoflow/react-video-editor";
import { findAvailableTrack, normalizeTrackForKind } from "@/lib/timelineMove";

const { addLayerCommand } = commands;

function setLayerTrack(commit: any, layerId: string, track: number, kind: "audio" | "video") {
  commit((draft: any) => {
    const layer = draft.layers?.find((item: any) => item.id === layerId);
    if (layer) layer.track = normalizeTrackForKind(track, kind);
  }, { label: "Set track" });
}

export async function addTextLayerAtPlayhead(): Promise<void> {
  const editor = useEditorStore.getState();
  const fps = editor.video.fps || 30;
  const text = window.prompt("Text to add:", "Text");
  if (!text?.trim()) return;

  const startTime = editor.currentFrame / fps;
  const duration = 3;
  const layerId = await addLayerCommand(editor.commit, {
    type: "text",
    startTime,
    sourceDuration: duration,
    properties: {
      text: text.trim(),
      fontSize: 0.12,
      fontFamily: "Inter",
      color: "#ffffff",
      fontWeight: "700",
      textAlign: "center",
      position: [0.5, 0.5],
    },
  });

  if (!layerId) return;
  const track = findAvailableTrack(editor.video.layers ?? [], "video", startTime, duration);
  setLayerTrack(editor.commit, layerId, track, "video");
  editor.selectLayers([layerId]);
  editor.bridge?.seek(editor.currentFrame);
}

export async function addMatteLayerAtPlayhead(): Promise<void> {
  const editor = useEditorStore.getState();
  const fps = editor.video.fps || 30;
  const hex = (window.prompt("Matte color (hex):", "#000000") || "#000000").trim() || "#000000";
  const startTime = editor.currentFrame / fps;
  const duration = editor.video.duration || 5;
  const layerId = await addLayerCommand(editor.commit, {
    type: "shape",
    startTime,
    sourceDuration: duration,
    properties: {
      fill: hex,
      width: "100%",
      height: "100%",
      position: [0.5, 0.5],
    },
    extraSettings: { shapeType: "rectangle" },
  });

  if (!layerId) return;
  const track = findAvailableTrack(editor.video.layers ?? [], "video", startTime, duration);
  setLayerTrack(editor.commit, layerId, track, "video");
  editor.selectLayers([layerId]);
  editor.bridge?.seek(editor.currentFrame);
}

export function addVideoTrack(): void {
  useEditorStore.getState().commit((video: any) => {
    const layers = Array.isArray(video.layers) ? video.layers : [];
    const maxTrack = layers.reduce((max: number, layer: any) => {
      if (layer.type === "audio") return max;
      const raw = Number(layer.track);
      const local = Number.isFinite(raw) && raw >= 10 ? Math.floor(raw) - 10 : 0;
      return Math.max(max, local);
    }, 0);
    video.timelineTrackCounts = video.timelineTrackCounts || {};
    video.timelineTrackCounts.video = Math.max(
      Number(video.timelineTrackCounts.video) || 0,
      layers.some((layer: any) => layer.type !== "audio") ? maxTrack + 1 : 1,
    ) + 1;
  }, { label: "Add track" });
}
