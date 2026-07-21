import { layerTimelineBounds } from "@videoflow/react-video-editor";

export function getTimelineDuration(video: any): number {
  const documentDuration = Number(video?.duration);
  const layerDuration = (Array.isArray(video?.layers) ? video.layers : []).reduce((max: number, layer: any) => {
    const bounds = layerTimelineBounds(layer);
    return Math.max(max, Number.isFinite(bounds.end) ? bounds.end : 0);
  }, 0);
  return Math.max(Number.isFinite(documentDuration) ? documentDuration : 0, layerDuration);
}

export function clampTimelineFrame(video: any, frame: number): number {
  const fps = Math.max(1, Number(video?.fps) || 30);
  const totalFrames = Math.ceil(getTimelineDuration(video) * fps);
  return Math.max(0, Math.min(Math.max(0, totalFrames - 1), Math.round(frame)));
}
