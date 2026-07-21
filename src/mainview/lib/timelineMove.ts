import { layerTimelineBounds } from "@videoflow/react-video-editor";

export const AUDIO_TRACK_BASE = 0;
export const VIDEO_TRACK_BASE = 10;
export type TimelineTrackKind = "audio" | "video";
export type TimelineMoveMode = "move" | "swap";

export type TimelineMoveUpdate = {
  id: string;
  startTime: number;
  track?: number;
};

export function getTimelineTrackKind(layer: any): TimelineTrackKind {
  return layer?.type === "audio" ? "audio" : "video";
}

export function normalizeTrackForKind(track: unknown, kind: TimelineTrackKind): number {
  const raw = typeof track === "number" && Number.isFinite(track) ? Math.floor(track) : 0;
  if (kind === "audio") return Math.max(AUDIO_TRACK_BASE, raw >= VIDEO_TRACK_BASE ? raw - VIDEO_TRACK_BASE : raw);
  return Math.max(VIDEO_TRACK_BASE, raw < VIDEO_TRACK_BASE ? VIDEO_TRACK_BASE + raw : raw);
}

export function localTrackForKind(track: unknown, kind: TimelineTrackKind): number {
  return normalizeTrackForKind(track, kind) - (kind === "audio" ? AUDIO_TRACK_BASE : VIDEO_TRACK_BASE);
}

/**
 * Pick the first compatible lane that can contain a placement without
 * overlapping another clip. A preferred lane is tried first, which preserves
 * the user's drop target when it has room and creates a new lane when it does
 * not.
 */
export function findAvailableTrack(
  layers: any[],
  kind: TimelineTrackKind,
  startTime: number,
  duration: number,
  preferredTrack?: unknown,
): number {
  const preferredLocal = preferredTrack === undefined
    ? 0
    : Math.max(0, localTrackForKind(preferredTrack, kind));
  const maxLocal = layers.reduce((max, layer) => {
    if (getTimelineTrackKind(layer) !== kind) return max;
    return Math.max(max, localTrackForKind(layer.track, kind));
  }, -1);
  const candidates: number[] = [];
  const addCandidate = (local: number) => {
    if (local >= 0 && !candidates.includes(local)) candidates.push(local);
  };
  addCandidate(preferredLocal);
  for (let local = 0; local <= Math.max(maxLocal + 1, preferredLocal + 1); local++) {
    addCandidate(local);
  }

  const selectedIds = new Set<string>();
  for (const local of candidates) {
    const track = normalizeTrackForKind(local, kind);
    if (!wouldOverlap(layers, track, Math.max(0, startTime), Math.max(0, duration), selectedIds)) {
      return track;
    }
  }

  // The loop always includes one lane beyond the current maximum, but keep a
  // deterministic fallback if a malformed timeline contains unusual tracks.
  return normalizeTrackForKind(Math.max(maxLocal + 1, preferredLocal), kind);
}

export function trackBelongsToKind(track: unknown, kind: TimelineTrackKind): boolean {
  if (typeof track !== "number" || !Number.isFinite(track)) return false;
  const normalized = Math.floor(track);
  return kind === "audio"
    ? normalized >= AUDIO_TRACK_BASE && normalized < VIDEO_TRACK_BASE
    : normalized >= VIDEO_TRACK_BASE;
}

function getTrackIndex(layer: any): number {
  const track = layer?.track;
  return typeof track === "number" && Number.isFinite(track) ? Math.max(0, Math.floor(track)) : 0;
}

export function getLayerTrackIndex(layer: any): number {
  return getTrackIndex(layer);
}

export function getLayerDuration(layer: any): number {
  const bounds = layerTimelineBounds(layer);
  return Math.max(0, bounds.end - bounds.start);
}

export function getLayerStart(layer: any): number {
  const bounds = layerTimelineBounds(layer);
  return Number.isFinite(bounds.start) ? bounds.start : 0;
}

export function expandLinkedLayerIds(layers: any[], ids: string[]): string[] {
  const expanded = new Set(ids);
  for (const id of ids) {
    const layer = layers.find((candidate) => candidate.id === id);
    const linkId = layer?.settings?.linkId;
    if (!linkId) continue;
    for (const candidate of layers) {
      if (candidate.id !== id && candidate?.settings?.linkId === linkId) {
        expanded.add(candidate.id);
      }
    }
  }
  return Array.from(expanded);
}

export function normalizeMoveUpdates(layers: any[], updates: TimelineMoveUpdate[]): TimelineMoveUpdate[] {
  return updates.map((update) => {
    const layer = layers.find((candidate) => candidate.id === update.id);
    if (!layer || update.track === undefined) return update;
    return {
      ...update,
      track: normalizeTrackForKind(update.track, getTimelineTrackKind(layer)),
    };
  });
}

export function readLayerTracks(layers: any[]): number[] {
  return layers.map((layer) => getTrackIndex(layer));
}

export function wouldOverlap(
  layers: any[],
  trackIdx: number,
  start: number,
  duration: number,
  selectedIds: Set<string>,
): boolean {
  const tracks = readLayerTracks(layers);
  const end = start + duration;
  for (let i = 0; i < layers.length; i++) {
    if (tracks[i] !== trackIdx) continue;
    const layer = layers[i];
    if (selectedIds.has(layer.id)) continue;
    const bounds = layerTimelineBounds(layer);
    if (start < bounds.end - 1e-9 && bounds.start < end - 1e-9) {
      return true;
    }
  }
  return false;
}

export function validateMoveUpdates(
  layers: any[],
  updates: TimelineMoveUpdate[],
): { ok: true } | { ok: false; layerId: string; reason: string } {
  const normalizedUpdates = normalizeMoveUpdates(layers, updates);
  const selectedIds = new Set(normalizedUpdates.map((update) => update.id));
  for (const update of normalizedUpdates) {
    const layer = layers.find((candidate) => candidate.id === update.id);
    if (!layer) return { ok: false, layerId: update.id, reason: "Layer not found" };
    const bounds = layerTimelineBounds(layer);
    const duration = Math.max(0, bounds.end - bounds.start);
    const kind = getTimelineTrackKind(layer);
    if (update.track !== undefined && !trackBelongsToKind(update.track, kind)) {
      return { ok: false, layerId: update.id, reason: `${kind} clips must stay on ${kind} tracks` };
    }
    const track = update.track === undefined ? getTrackIndex(layer) : Math.max(0, Math.floor(update.track));
    if (wouldOverlap(layers, track, Math.max(0, update.startTime), duration, selectedIds)) {
      return { ok: false, layerId: update.id, reason: "Destination overlaps another clip" };
    }
  }
  return { ok: true };
}

export function buildLinkedMoveUpdates(
  layers: any[],
  primaryId: string,
  startTime: number,
  track?: number,
): TimelineMoveUpdate[] {
  const primary = layers.find((layer) => layer.id === primaryId);
  if (!primary) return [];
  const primaryStart = getLayerStart(primary);
  const primaryTrack = getTrackIndex(primary);
  const timeDelta = Math.max(0, startTime) - primaryStart;
  const kind = getTimelineTrackKind(primary);
  const trackDelta = track === undefined
    ? 0
    : localTrackForKind(track, kind) - localTrackForKind(primaryTrack, kind);
  const ids = expandLinkedLayerIds(layers, [primaryId]);

  return normalizeMoveUpdates(
    layers,
    ids.map((id) => {
      const layer = layers.find((candidate) => candidate.id === id);
      const itemKind = getTimelineTrackKind(layer);
      const itemTrack = getTrackIndex(layer);
      return {
        id,
        startTime: Math.max(0, getLayerStart(layer) + timeDelta),
        track: track === undefined
          ? undefined
          : normalizeTrackForKind(localTrackForKind(itemTrack, itemKind) + trackDelta, itemKind),
      };
    }),
  );
}

export function findSwapTarget(
  layers: any[],
  primaryId: string,
  targetTrack: number,
  desiredStart: number,
): any | null {
  const primary = layers.find((layer) => layer.id === primaryId);
  if (!primary) return null;
  const kind = getTimelineTrackKind(primary);
  const primaryUnitIds = new Set(expandLinkedLayerIds(layers, [primaryId]));
  const duration = getLayerDuration(primary);
  const desiredMid = desiredStart + duration / 2;
  const candidates = layers
    .filter((layer) => layer.id !== primaryId)
    .filter((layer) => !primaryUnitIds.has(layer.id))
    .filter((layer) => getTimelineTrackKind(layer) === kind)
    .filter((layer) => getTrackIndex(layer) === targetTrack)
    .map((layer) => ({ layer, bounds: layerTimelineBounds(layer) }))
    .filter(({ bounds }) => desiredMid >= bounds.start && desiredMid <= bounds.end)
    .sort((a, b) => Math.abs(desiredMid - ((a.bounds.start + a.bounds.end) / 2)) - Math.abs(desiredMid - ((b.bounds.start + b.bounds.end) / 2)));

  return candidates[0]?.layer ?? null;
}

export function buildSwapMoveUpdates(
  layers: any[],
  primaryId: string,
  targetId: string,
): TimelineMoveUpdate[] {
  const primary = layers.find((layer) => layer.id === primaryId);
  const target = layers.find((layer) => layer.id === targetId);
  if (!primary || !target) return [];
  if (getTimelineTrackKind(primary) !== getTimelineTrackKind(target)) return [];

  const primaryIds = expandLinkedLayerIds(layers, [primaryId]);
  const targetIds = expandLinkedLayerIds(layers, [targetId]);
  const primaryStart = getLayerStart(primary);
  const targetStart = getLayerStart(target);
  const primaryDelta = targetStart - primaryStart;
  const targetDelta = primaryStart - targetStart;

  const updates: TimelineMoveUpdate[] = [];
  for (const id of primaryIds) {
    const layer = layers.find((candidate) => candidate.id === id);
    if (!layer) continue;
    updates.push({ id, startTime: Math.max(0, getLayerStart(layer) + primaryDelta) });
  }
  for (const id of targetIds) {
    const layer = layers.find((candidate) => candidate.id === id);
    if (!layer) continue;
    updates.push({ id, startTime: Math.max(0, getLayerStart(layer) + targetDelta) });
  }

  return updates;
}

export function buildTimelineMovePlan(
  layers: any[],
  primaryId: string,
  desiredStart: number,
  targetTrack?: number,
  mode: TimelineMoveMode = "move",
): { mode: TimelineMoveMode; updates: TimelineMoveUpdate[]; swapTargetId?: string; error?: string } {
  const primary = layers.find((layer) => layer.id === primaryId);
  if (!primary) return { mode, updates: [], error: "Layer not found" };
  const kind = getTimelineTrackKind(primary);
  const normalizedTrack = targetTrack === undefined
    ? getTrackIndex(primary)
    : normalizeTrackForKind(targetTrack, kind);

  if (mode === "swap" && normalizedTrack === getTrackIndex(primary)) {
    const swapTarget = findSwapTarget(layers, primaryId, normalizedTrack, Math.max(0, desiredStart));
    if (swapTarget) {
      return {
        mode: "swap",
        swapTargetId: swapTarget.id,
        updates: buildSwapMoveUpdates(layers, primaryId, swapTarget.id),
      };
    }
  }

  const updates = buildLinkedMoveUpdates(layers, primaryId, Math.max(0, desiredStart), normalizedTrack);
  return { mode: "move", updates };
}

export function clampMoveToTrack(
  layers: any[],
  trackIdx: number,
  desiredStart: number,
  duration: number,
  selectedIds: Set<string>,
): number | null {
  const tracks = readLayerTracks(layers);
  const intervals: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < layers.length; i++) {
    if (tracks[i] !== trackIdx) continue;
    const layer = layers[i];
    if (selectedIds.has(layer.id)) continue;
    intervals.push(layerTimelineBounds(layer));
  }
  intervals.sort((a, b) => a.start - b.start);

  let prevEnd = 0;
  let nextStart = Number.POSITIVE_INFINITY;
  for (const interval of intervals) {
    if (interval.start >= desiredStart + duration - 1e-9) {
      nextStart = Math.min(nextStart, interval.start);
      break;
    }
    if (interval.end <= desiredStart + 1e-9) {
      prevEnd = Math.max(prevEnd, interval.end);
      continue;
    }
    return null;
  }

  if (nextStart - prevEnd < duration) return null;
  return Math.min(Math.max(desiredStart, prevEnd), nextStart - duration);
}

export function clampTimeDeltaToFreeSpace(
  layers: any[],
  moveItems: Array<{ id: string; startTime: number; track: number; duration: number }>,
  trackDelta: number,
  desiredTimeDelta: number,
  selectedIds: Set<string>,
): number {
  if (desiredTimeDelta === 0) return 0;

  const tracks = readLayerTracks(layers);
  const epsilon = 1e-9;
  let clamped = desiredTimeDelta;

  for (const item of moveItems) {
    const targetTrack = Math.max(0, item.track + trackDelta);
    const intervals: Array<{ start: number; end: number }> = [];
    for (let i = 0; i < layers.length; i++) {
      if (tracks[i] !== targetTrack) continue;
      const layer = layers[i];
      if (selectedIds.has(layer.id)) continue;
      intervals.push(layerTimelineBounds(layer));
    }
    intervals.sort((a, b) => a.start - b.start);

    if (desiredTimeDelta > 0) {
      for (const interval of intervals) {
        if (interval.end <= item.startTime + item.duration + epsilon) continue;
        if (interval.start >= item.startTime + item.duration - epsilon) {
          clamped = Math.min(clamped, interval.start - (item.startTime + item.duration));
          break;
        }
      }
    } else {
      for (let i = intervals.length - 1; i >= 0; i--) {
        const interval = intervals[i];
        if (interval.start >= item.startTime - epsilon) continue;
        if (interval.end <= item.startTime + epsilon) {
          clamped = Math.max(clamped, interval.end - item.startTime);
          break;
        }
      }
    }
  }

  return clamped;
}
