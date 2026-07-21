import type { VideoJSON } from "@videoflow/core";

export type VideoFlowValidation = { valid: boolean; errors: string[] };

function finite(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeLayer(layer: any, index: number): any {
  const copy = JSON.parse(JSON.stringify(layer ?? {}));
  const settings = { ...(copy.settings ?? {}) };
  const startTime = Math.max(0, finite(settings.startTime ?? copy.startTime, 0));
  const sourceStart = Math.max(0, finite(settings.sourceStart ?? copy.sourceStart, 0));
  const sourceDuration = Math.max(0, finite(settings.sourceDuration ?? copy.sourceDuration ?? copy.duration, 0));
  const speed = Math.max(0.0001, Math.abs(finite(settings.speed ?? copy.speed, 1)));
  const track = Math.max(0, Math.floor(finite(copy.track, index)));

  copy.id = String(copy.id ?? `layer-${index}`);
  copy.track = track;
  copy.startTime = startTime;
  copy.sourceStart = sourceStart;
  copy.sourceDuration = sourceDuration;
  copy.duration = sourceDuration / speed;
  copy.settings = {
    ...settings,
    startTime,
    sourceStart,
    sourceDuration,
    speed,
    enabled: settings.enabled !== false,
  };

  if (Array.isArray(copy.animations)) {
    copy.animations = copy.animations
      .map((animation: any) => ({ ...animation, startTime: Math.max(0, finite(animation.startTime, 0)) }))
      .sort((a: any, b: any) => a.startTime - b.startTime);
  }
  if (Array.isArray(copy.children)) copy.children = copy.children.map((child: any, childIndex: number) => normalizeLayer(child, childIndex));
  return copy;
}

/** Keeps editor state portable between DOM, browser, and server renderers. */
export function normalizeVideoFlowDocument(video: any): VideoJSON {
  const copy = JSON.parse(JSON.stringify(video ?? {}));
  const fps = Math.max(1, finite(copy.fps, 30));
  const width = Math.max(1, Math.round(finite(copy.width, 1920)));
  const height = Math.max(1, Math.round(finite(copy.height, 1080)));
  const layers = Array.isArray(copy.layers) ? copy.layers.map(normalizeLayer) : [];
  const layerEnd = layers.reduce((end: number, layer: any) => Math.max(end, layer.startTime + layer.duration), 0);
  const duration = Math.max(0, finite(copy.duration, 0), layerEnd);
  return {
    name: String(copy.name ?? "Filmidi Project"),
    duration,
    width,
    height,
    fps,
    backgroundColor: String(copy.backgroundColor ?? "#000000"),
    layers,
    ...(Array.isArray(copy.tracks) ? { tracks: copy.tracks } : {}),
  } as VideoJSON;
}

export function validateVideoFlowDocument(video: any): VideoFlowValidation {
  const errors: string[] = [];
  if (!video || !Number.isFinite(Number(video.fps)) || Number(video.fps) <= 0) errors.push("fps must be a positive number");
  if (!video || !Number.isFinite(Number(video.width)) || Number(video.width) <= 0) errors.push("width must be positive");
  if (!video || !Number.isFinite(Number(video.height)) || Number(video.height) <= 0) errors.push("height must be positive");
  for (const [index, layer] of (Array.isArray(video?.layers) ? video.layers : []).entries()) {
    const start = Number(layer?.settings?.startTime ?? layer?.startTime);
    const duration = Number(layer?.settings?.sourceDuration ?? layer?.sourceDuration ?? layer?.duration);
    if (!Number.isFinite(start) || start < 0) errors.push(`layer ${index} has invalid startTime`);
    if (!Number.isFinite(duration) || duration < 0) errors.push(`layer ${index} has invalid duration`);
    if (layer?.type !== "text" && layer?.type !== "shape" && !String(layer?.settings?.source ?? layer?.source ?? "")) {
      errors.push(`layer ${index} is missing a media source`);
    }
  }
  return { valid: errors.length === 0, errors };
}
