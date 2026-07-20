import { commands, useEditorStore } from "@videoflow/react-video-editor";
import { findAvailableTrack } from "@/lib/timelineMove";

const { addLayerCommand } = commands;

function forceLayerTrack(commit: any, layerId: string, track: number) {
  return commit((draft: any) => {
    const layer = draft.layers?.find((item: any) => item.id === layerId);
    if (layer) layer.track = track;
  }, { label: "Place layer on free track" });
}

export async function addTextLayerAtPlayhead(text = "Text"): Promise<void> {
  const editor = useEditorStore.getState();
  const fps = editor.video.fps || 30;
  const startTime = editor.currentFrame / fps;
  const duration = 3;
  const track = findAvailableTrack(editor.video.layers ?? [], "video", startTime, duration);
  const layerId = await addLayerCommand(editor.commit, {
    type: "text",
    track,
    startTime,
    sourceDuration: duration,
    settings: { startTime, sourceDuration: duration, enabled: true },
    properties: {
      text: text.trim() || "Text",
      fontSize: 6,
      fontFamily: "Inter",
      color: "#ffffff",
      fontWeight: "700",
      textAlign: "center",
      position: [0.5, 0.5],
    },
  });

  if (!layerId) return;
  await forceLayerTrack(editor.commit, layerId, track);
  editor.selectLayers([layerId]);
  editor.bridge?.seek(editor.currentFrame);
}

export async function addMatteLayerAtPlayhead(shapeType: string = "rectangle"): Promise<void> {
  const editor = useEditorStore.getState();
  const fps = editor.video.fps || 30;
  const hex = "#000000";
  const startTime = editor.currentFrame / fps;
  const duration = editor.video.duration || 5;
  const track = findAvailableTrack(editor.video.layers ?? [], "video", startTime, duration);
  const layerId = await addLayerCommand(editor.commit, {
    type: "shape",
    track,
    startTime,
    sourceDuration: duration,
    settings: { startTime, sourceDuration: duration, enabled: true },
    properties: {
      fill: hex,
      width: "100%",
      height: "100%",
      position: [0.5, 0.5],
    },
    extraSettings: { shapeType },
  });

  if (!layerId) return;
  await forceLayerTrack(editor.commit, layerId, track);
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
