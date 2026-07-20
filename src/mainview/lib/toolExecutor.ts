import { useEditorStore } from "@videoflow/react-video-editor";
import { commands } from "@videoflow/react-video-editor";
import { useMediaPanelStore } from "@/store/useMediaPanelStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useAccountStore } from "@/store/useAccountStore";
import { useExportStore } from "@/store/useExportStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useProjectSaveStore } from "@/store/useProjectSaveStore";
import { useGenerationStore } from "@/store/useGenerationStore";
import { transcribeAudio } from "./cloudTranscription";
import { logTranscript } from "./transcriptLogger";
import { requestNativeMedia } from "./nativeMediaBridge";
import { getSecureApiKey } from "./secureApiKey";
import { submitGeneration, waitForTask } from "./generationApi";
import { getTimelineExportText, saveText, serializeFilmidiPackage } from "./exportHelpers";
import { findLinkedPartnerIn, getLayerLinkId } from "@/lib/linkUtils";
import { dbSaveProject } from "./dbIPC";
import { validateMoveUpdates } from "./timelineMove";
import { findAvailableTrack, localTrackForKind, normalizeTrackForKind, VIDEO_TRACK_BASE } from "./timelineMove";
import type { LayerJSON, VideoJSON } from "@videoflow/core";

const {
  addLayerCommand,
  removeLayersCommand,
  moveLayersCommand,
  setPropertyCommand,
  setProjectSettingsCommand,
  setKeyframeCommand,
  addEffectCommand,
  removeEffectCommand,
  setEffectParamCommand,
  setTransitionCommand,
  resizeLayerCommand,
  trimStartCommand,
  reorderLayersCommand,
  setTrackSettingsCommand,
  setSettingCommand,
} = commands;

export interface ToolResult {
  toolUseId: string;
  content: string;
  isError: boolean;
}

// ─── ID SHORTENING ────────────────────────────────────────────────

const ID_PREFIX_FLOOR = 8;

export function buildIdUniverse(): Set<string> {
  const s = useEditorStore.getState();
  const ids = new Set<string>();
  const layers = s.video.layers ?? [];
  for (const l of layers) {
    ids.add(l.id);
  }
  const mediaStore = useMediaPanelStore.getState();
  for (const a of mediaStore.assets) {
    ids.add(a.id);
  }
  return ids;
}

export function shortIdMap(ids: Set<string>): Map<string, string> {
  const sorted = Array.from(ids).sort();
  const map = new Map<string, string>();
  for (let i = 0; i < sorted.length; i++) {
    const id = sorted[i];
    let sharedLen = 0;
    if (i > 0) sharedLen = Math.max(sharedLen, commonPrefixLen(id, sorted[i - 1]));
    if (i < sorted.length - 1) sharedLen = Math.max(sharedLen, commonPrefixLen(id, sorted[i + 1]));
    const len = Math.min(id.length, Math.max(ID_PREFIX_FLOOR, sharedLen + 1));
    map.set(id, id.slice(0, len));
  }
  return map;
}

function commonPrefixLen(a: string, b: string): number {
  let count = 0;
  while (count < a.length && count < b.length && a[count] === b[count]) count++;
  return count;
}

export function shortenIdsInText(text: string, map: Map<string, string>): string {
  const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
  return text.replace(uuidRe, (match) => map.get(match) ?? match);
}

export function expandIdPrefix(ref: string, universe: Set<string>): string {
  if (universe.has(ref)) return ref;
  const matches = Array.from(universe).filter((id) => id.startsWith(ref));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`Ambiguous id '${ref}' matches ${matches.length} items`);
  return ref;
}

// ─── MUTATION DELTA ───────────────────────────────────────────────

interface ClipPlacement {
  track: number;
  start: number;
  duration: number;
}

function snapshotTimeline(): Map<string, ClipPlacement> {
  const s = useEditorStore.getState();
  const snap = new Map<string, ClipPlacement>();
  for (const l of s.video.layers ?? []) {
    snap.set(l.id, {
      track: l.track ?? 0,
      start: Math.round((l.settings?.startTime ?? 0) * (s.video.fps ?? 30)),
      duration: Math.round((l.settings?.sourceDuration ?? 0) * (s.video.fps ?? 30)),
    });
  }
  return snap;
}

function computeDelta(
  before: Map<string, ClipPlacement>,
  touched: string[],
  notes: string[] = [],
): Record<string, unknown> {
  const s = useEditorStore.getState();
  const fps = s.video.fps ?? 30;
  const after = new Map<string, ClipPlacement>();
  for (const l of s.video.layers ?? []) {
    after.set(l.id, {
      track: l.track ?? 0,
      start: Math.round((l.settings?.startTime ?? 0) * fps),
      duration: Math.round((l.settings?.sourceDuration ?? 0) * fps),
    });
  }

  const changed = new Set(touched.filter((id) => after.has(id)));
  for (const [id] of after) {
    if (!before.has(id)) changed.add(id);
  }

  const shifted: { id: string; from: number; delta: number }[] = [];
  for (const [id, p] of after) {
    const b = before.get(id);
    if (!b || changed.has(id)) continue;
    if (b.track === p.track && b.duration === p.duration && b.start !== p.start) {
      shifted.push({ id, from: b.start, delta: p.start - b.start });
    } else if (b.track !== p.track || b.duration !== p.duration) {
      changed.add(id);
    }
  }

  const removed = Array.from(before.keys()).filter((id) => !after.has(id));
  const payload: Record<string, unknown> = {};
  if (changed.size > 0) payload.changedCount = changed.size;
  if (shifted.length > 0) payload.shiftedCount = shifted.length;
  if (removed.length > 0) payload.removedClipIds = removed;
  if (notes.length > 0) payload.notes = notes;
  return payload;
}

// ─── CONTEXT HELPERS ──────────────────────────────────────────────

export function getTimelineContext(): string {
  const s = useEditorStore.getState();
  const v = s.video;
  const layers = v.layers ?? [];
  const selected = s.selection.layerIds;
  return JSON.stringify({
    fps: v.fps,
    width: v.width,
    height: v.height,
    duration: v.duration,
    totalFrames: Math.round((v.duration ?? 0) * (v.fps ?? 30)),
    currentFrame: s.currentFrame,
    canGenerate: true,
    layerCount: layers.length,
    selectedLayerIds: selected,
    tracks: (v.tracks ?? []).map((t: { name?: string; enabled?: boolean }, i: number) => ({
      index: i,
      name: t.name ?? `Track ${i + 1}`,
      enabled: t.enabled ?? true,
    })),
    layers: layers.map((l) => {
      const layer = l as any;
      return {
      id: l.id,
      type: layer.type ?? "unknown",
      name: layer.name ?? layer.id.slice(0, 8),
      startTime: getLayerTiming(l).startTime,
      sourceStart: getLayerTiming(l).sourceStart,
      sourceDuration: getLayerTiming(l).sourceDuration,
      enabled: layer.settings?.enabled ?? true,
      track: layer.track ?? 0,
      source: layer.settings?.source ?? layer.source,
    };
    }),
  });
}

export function getMediaContext(filterTypes?: unknown): string {
  const store = useMediaPanelStore.getState();
  const allowedTypes = Array.isArray(filterTypes)
    ? new Set(filterTypes.map((type) => String(type)))
    : null;
  return JSON.stringify({
    assets: store.assets
      .filter((a) => !allowedTypes || allowedTypes.has(a.type))
      .map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      url: a.url,
      duration: a.duration,
      thumbnailUrl: a.thumbnailUrl,
      folderId: a.folderId,
      createdAt: a.createdAt,
    })),
  });
}

function getLayerTiming(layer: any) {
  const settings = (layer?.settings ?? {}) as Record<string, unknown>;
  return {
    startTime: (settings.startTime as number | undefined) ?? layer?.startTime ?? 0,
    sourceStart: (settings.sourceStart as number | undefined) ?? layer?.sourceStart ?? 0,
    sourceDuration:
      (settings.sourceDuration as number | undefined) ??
      layer?.sourceDuration ??
      layer?.duration ??
      5,
    speed: (settings.speed as number | undefined) ?? layer?.speed ?? 1,
  };
}

function getLayerSource(layer: any): string | undefined {
  return (layer?.settings?.source as string | undefined) ?? (layer?.source as string | undefined);
}

function inferImportedMediaType(source: string): "video" | "audio" | "image" {
  const lower = source.toLowerCase().split(/[?#]/)[0];
  if (lower.startsWith("data:video/")) return "video";
  if (lower.startsWith("data:audio/")) return "audio";
  if (/\.(mp4|mov|m4v|webm|mkv|avi|ogv|3gp)$/.test(lower)) return "video";
  if (/\.(mp3|wav|m4a|aac|ogg|flac|opus)$/.test(lower)) return "audio";
  // Stock image services commonly omit an extension from the URL.
  if (lower.includes("images.unsplash.com") || lower.includes("images.pexels.com")) return "image";
  return "image";
}

function importedAssetName(source: string, fallback: string, type: "video" | "audio" | "image"): string {
  if (fallback.trim() && fallback.trim() !== "Imported") return fallback.trim();
  try {
    const pathname = new URL(source, "http://filmidi.local").pathname;
    const filename = decodeURIComponent(pathname.split("/").filter(Boolean).pop() ?? "");
    if (filename && !/^https?$/i.test(filename)) return filename.replace(/\.[^.]+$/, "");
  } catch {}
  return type === "image" ? "Imported Image" : type === "video" ? "Imported Video" : "Imported Audio";
}

async function searchInternetMedia(
  query: string,
  type: "audio" | "image" | "video",
  limit: number,
): Promise<Array<{ title: string; type: string; url: string; thumbnailUrl?: string; source: string; license?: string }>> {
  const count = Math.max(1, Math.min(20, limit));
  if (type === "image" || type === "audio") {
    const endpoint = new URL("https://commons.wikimedia.org/w/api.php");
    endpoint.search = new URLSearchParams({
      action: "query",
      generator: "search",
      gsrsearch: type === "audio" ? `${query} filetype:audio` : query,
      gsrnamespace: "6",
      gsrlimit: String(count),
      prop: "imageinfo",
      iiprop: "url|mime",
      iiurlwidth: "1600",
      format: "json",
      origin: "*",
    }).toString();
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error(`Wikimedia search failed (${response.status})`);
    const data = await response.json() as any;
    const commonsResults = Object.values(data.query?.pages ?? {})
      .map((page: any) => {
        const info = page.imageinfo?.[0];
        const mime = String(info?.mime ?? "").toLowerCase();
        const matchesType = type === "image" ? mime.startsWith("image/") : mime.startsWith("audio/");
        return info?.url && matchesType ? {
          title: String(page.title ?? "Wikimedia image").replace(/^File:/i, ""),
          type,
          url: String(info.url),
          ...(type === "image" ? { thumbnailUrl: info.thumburl ? String(info.thumburl) : String(info.url) } : {}),
          source: "Wikimedia Commons",
          license: "Wikimedia Commons free-license repository; verify the file license and attribution",
        } : null;
      })
      .filter(Boolean) as Array<{ title: string; type: string; url: string; thumbnailUrl?: string; source: string; license?: string }>;
    if (commonsResults.length > 0 || type === "image") return commonsResults;
  }

  const mediaType = type === "video" ? "movies" : "audio";
  const searchUrl = new URL("https://archive.org/advancedsearch.php");
  const queryTerms = query.toLowerCase().match(/[a-z0-9]+/g)?.filter((term) => term.length > 2) ?? [];
  const titleExpression = queryTerms.length > 0
    ? `(${queryTerms.map((term) => `title:${term}`).join(" OR ")})`
    : query;
  const searchParams = new URLSearchParams({
    q: `${titleExpression} AND mediatype:${mediaType}`,
    rows: String(count),
    page: "1",
    output: "json",
  });
  searchParams.append("fl[]", "identifier");
  searchParams.append("fl[]", "title");
  searchUrl.search = searchParams.toString();
  const searchResponse = await fetch(searchUrl);
  if (!searchResponse.ok) throw new Error(`Internet Archive search failed (${searchResponse.status})`);
  const searchData = await searchResponse.json() as any;
  let docs = (searchData.response?.docs ?? []) as Array<{ identifier?: string; title?: string }>;
  // If title search is too narrow, retry with the full-text query. This keeps
  // exact SFX searches useful without returning unrelated recordings first.
  if (docs.length === 0) {
    const fallbackUrl = new URL("https://archive.org/advancedsearch.php");
    const fallbackParams = new URLSearchParams({
      q: `(${query}) AND mediatype:${mediaType}`,
      rows: String(count),
      page: "1",
      output: "json",
    });
    fallbackParams.append("fl[]", "identifier");
    fallbackParams.append("fl[]", "title");
    fallbackUrl.search = fallbackParams.toString();
    const fallbackResponse = await fetch(fallbackUrl);
    if (fallbackResponse.ok) {
      const fallbackData = await fallbackResponse.json() as any;
      docs = (fallbackData.response?.docs ?? []) as Array<{ identifier?: string; title?: string }>;
    }
  }
  const effectTerms = /\b(sfx|sound|effect|riser|whoosh|swish|sweep|transition|impact|hit|boom|pop|click|beep|chime|footstep|foley)\b/i;
  const requiresEffectMatch = type === "audio" && effectTerms.test(query);
  if (requiresEffectMatch && !docs.some((doc) => effectTerms.test(`${doc.title ?? ""} ${doc.identifier ?? ""}`))) {
    const targetedUrl = new URL("https://archive.org/advancedsearch.php");
    const targetedTerms = ["riser", "whoosh", "swish", "sweep", "transition", "impact", "foley", "sound", "effect"];
    const targetedParams = new URLSearchParams({
      q: `(${targetedTerms.map((term) => `title:${term}`).join(" OR ")}) AND mediatype:${mediaType}`,
      rows: String(count),
      page: "1",
      output: "json",
    });
    targetedParams.append("fl[]", "identifier");
    targetedParams.append("fl[]", "title");
    targetedUrl.search = targetedParams.toString();
    const targetedResponse = await fetch(targetedUrl);
    if (targetedResponse.ok) {
      const targetedData = await targetedResponse.json() as any;
      docs = (targetedData.response?.docs ?? []) as Array<{ identifier?: string; title?: string }>;
    }
  }
  const results = await Promise.all(docs.map(async (doc) => {
    if (!doc.identifier) return null;
    const searchableTitle = `${doc.title ?? ""} ${doc.identifier}`.toLowerCase();
    if (requiresEffectMatch && !effectTerms.test(searchableTitle)) return null;
    try {
      const metadataResponse = await fetch(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`);
      if (!metadataResponse.ok) return null;
      const metadata = await metadataResponse.json() as any;
      const files = Array.isArray(metadata.files) ? metadata.files : [];
      const file = files.find((candidate: any) => {
        const format = String(candidate.format ?? "").toLowerCase();
        const name = String(candidate.name ?? "").toLowerCase();
        if (candidate.private === "true" || candidate.size === "0") return false;
        return type === "audio"
          ? format.includes("mp3") || format.includes("ogg") || format.includes("wav") || /\.(mp3|ogg|wav|flac)$/i.test(name)
          : format.includes("mp4") || format.includes("webm") || /\.(mp4|webm|mov)$/i.test(name);
      });
      if (!file?.name) return null;
      const path = String(file.name).split("/").map((part) => encodeURIComponent(part)).join("/");
      return {
        title: String(doc.title ?? doc.identifier),
        type,
        url: `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${path}`,
        source: "Internet Archive",
        license: "Verify the item license before publishing",
      };
    } catch {
      return null;
    }
  }));
  return results.filter(Boolean) as Array<{ title: string; type: string; url: string; thumbnailUrl?: string; source: string; license?: string }>;
}

function resolveMediaTarget(explicitMediaRef?: string): { mediaRef?: string; sourceUrl?: string; asset?: any | null } {
  const mediaStore = useMediaPanelStore.getState();
  const editor = useEditorStore.getState();
  let mediaRef = explicitMediaRef?.trim() || "";

  if (!mediaRef) {
    const selectedAssetIds = Array.from(mediaStore.selectedAssetIds ?? []);
    if (selectedAssetIds.length === 1) {
      mediaRef = selectedAssetIds[0];
    }
  }

  if (!mediaRef) {
    const selectedLayerIds = editor.selection?.layerIds ?? [];
    if (selectedLayerIds.length === 1) {
      const layer = editor.video.layers?.find((l: any) => l.id === selectedLayerIds[0]);
      const source = layer ? getLayerSource(layer) : undefined;
      if (source) mediaRef = source;
    }
  }

  const asset = mediaStore.assets.find((a) => a.id === mediaRef || a.url === mediaRef) ?? null;
  const sourceUrl = asset?.url ?? (mediaRef || undefined);
  return { mediaRef: mediaRef || undefined, sourceUrl, asset };
}

function getCaptionTrack(layers: any[]): number {
  const existing = layers
    .filter((l: any) => l.type === "text" || l.type === "captions")
    .map((l: any) => Number.isFinite(l.track) ? Math.max(0, Math.floor(l.track)) : 20)
    .filter((track: number) => Number.isFinite(track));
  if (existing.length > 0) {
    return Math.min(...existing);
  }
  return 20;
}

function getDefaultCaptionCenterY(width: number, height: number): number {
  const aspect = width / Math.max(1, height);
  // Portrait captions wrap into more lines, so lift them slightly while
  // keeping every format in the lower portion of the frame.
  if (aspect < 0.8) return 0.78;
  if (aspect < 1.2) return 0.82;
  if (aspect < 1.6) return 0.85;
  return 0.88;
}

function getTranscriptTargetKey(layer: any, fps: number): string {
  const linkId = getLayerLinkId(layer);
  if (linkId) return `link:${linkId}`;
  const timing = getLayerTiming(layer);
  const source = getLayerSource(layer) ?? "";
  return [
    `source:${source}`,
    `track:${Math.max(0, Math.floor(layer?.track ?? 0))}`,
    `start:${Math.round(timing.startTime * fps)}`,
    `sourceStart:${Math.round(timing.sourceStart * fps)}`,
    `sourceDuration:${Math.round(timing.sourceDuration * fps)}`,
  ].join("|");
}

function selectTranscriptTargets(layers: any[], targetClipIds: string[] | undefined, fps: number): any[] {
  const candidates = targetClipIds?.length
    ? layers.filter((l: any) => targetClipIds.includes(l.id))
    : layers.filter((l: any) => l.type === "video" || l.type === "audio");

  const grouped = new Map<string, any>();
  for (const layer of candidates) {
    const key = getTranscriptTargetKey(layer, fps);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, layer);
      continue;
    }
    if (existing.type !== "audio" && layer.type === "audio") {
      grouped.set(key, layer);
      continue;
    }
    if (existing.type === layer.type && (getLayerTiming(layer).startTime ?? 0) < (getLayerTiming(existing).startTime ?? 0)) {
      grouped.set(key, layer);
    }
  }

  return Array.from(grouped.values()).sort((a, b) => getLayerTiming(a).startTime - getLayerTiming(b).startTime);
}

function getCaptionTrackIndex(layers: any[], tracks: any[]): number {
  const generatedCaptionTracks = layers
    .filter((l: any) => l.type === "text" && (l.settings as any)?.generatedBy === "add_captions")
    .map((l: any) => normalizeTrackForKind(l.track, "video"));
  if (generatedCaptionTracks.length > 0) {
    return Math.min(...generatedCaptionTracks);
  }

  const namedCaptionTrack = tracks.findIndex((t) => typeof t?.name === "string" && /caption/i.test(t.name));
  if (namedCaptionTrack >= 0) return Math.max(VIDEO_TRACK_BASE, namedCaptionTrack);

  const maxTrackFromLayers = layers.reduce((max: number, layer: any) => {
    if (layer.type === "audio") return max;
    return Math.max(max, normalizeTrackForKind(layer.track, "video"));
  }, VIDEO_TRACK_BASE);
  const maxTrackFromTracks = Math.max(VIDEO_TRACK_BASE, tracks.length - 1);
  return Math.max(maxTrackFromLayers, maxTrackFromTracks) + 1;
}

function findGeneratedCaptionLayersForTarget(layers: any[], targetLayer: any, fpsValue: number): string[] {
  const targetSource = getLayerSource(targetLayer);
  if (!targetSource) return [];
  const targetBounds = getLayerTimelineBoundsFrames(targetLayer, fpsValue);
  const targetStart = targetBounds.startFrame;
  const targetEnd = targetBounds.endFrame;

  return layers
    .filter((l: any) => {
      if (l.type !== "text") return false;
      if ((l.settings as any)?.generatedBy !== "add_captions") return false;
      if ((l.settings as any)?.captionSource !== targetSource && (l.settings as any)?.captionTargetId !== targetLayer.id) return false;
      const bounds = getLayerTimelineBoundsFrames(l, fpsValue);
      return bounds.startFrame < targetEnd && targetStart < bounds.endFrame;
    })
    .map((l: any) => l.id);
}

async function removeExistingGeneratedCaptions(commitFn: any, targetLayer: any, fpsValue: number): Promise<void> {
  const layers = useEditorStore.getState().video.layers ?? [];
  const ids = findGeneratedCaptionLayersForTarget(layers, targetLayer, fpsValue);
  if (ids.length > 0) {
    await removeLayersCommand(commitFn, ids);
  }
}

function hasExistingAudioMirror(layer: any, layers: any[]): boolean {
  const source = getLayerSource(layer);
  if (!source) return false;
  const timing = getLayerTiming(layer);
  const sourceStartFrames = Math.round(timing.sourceStart * 1000);
  const sourceDurFrames = Math.round(timing.sourceDuration * 1000);
  const linkId = getLayerLinkId(layer);
  return layers.some((other: any) => {
    if (other.id === layer.id) return false;
    if (other.type !== "audio") return false;
    if (linkId && getLayerLinkId(other) === linkId) return true;
    if (getLayerSource(other) !== source) return false;
    const otherTiming = getLayerTiming(other);
    return (
      Math.round(otherTiming.sourceStart * 1000) === sourceStartFrames &&
      Math.round(otherTiming.sourceDuration * 1000) === sourceDurFrames &&
      Math.round(otherTiming.startTime * 1000) === Math.round(timing.startTime * 1000)
    );
  });
}

function refreshPreview() {
  const s = useEditorStore.getState();
  s.bridge?.seek(s.currentFrame);
}

/** Simple fuzzy string match returning 0-1 score. */
function fuzzyMatch(a: string, b: string): number {
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.8;

  // Token overlap scoring
  const aTokens = new Set(a.split(/\s+/));
  const bTokens = new Set(b.split(/\s+/));
  let overlap = 0;
  for (const t of bTokens) {
    for (const at of aTokens) {
      if (at.includes(t) || t.includes(at)) { overlap++; break; }
    }
  }
  return bTokens.size > 0 ? overlap / bTokens.size : 0;
}

const MIN_SPEED = 0.0001;

// ─── INPUT NORMALIZATION ────────────────────────────────────────────
// The agent model sometimes passes stringified JSON instead of real objects/arrays.
// e.g. `"cuts": "[{\"layerId\":\"id\",\"atFrame\":66}]"` instead of `"cuts": [{"layerId":"id","atFrame":66}]`
// This helper recursively walks the input and parses any string that looks like JSON.

function tryParseJSON(val: unknown): unknown {
  if (typeof val !== "string") return val;
  const trimmed = val.trim();
  if (!(trimmed.startsWith("[") || trimmed.startsWith("{"))) return val;
  try {
    return JSON.parse(trimmed);
  } catch {
    return val;
  }
}

function normalizeInput(input: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(input)) {
    const parsed = tryParseJSON(val);
    if (Array.isArray(parsed)) {
      result[key] = parsed.map((item: unknown) =>
        typeof item === "object" && item !== null && !Array.isArray(item)
          ? normalizeInput(item as Record<string, unknown>)
          : item
      );
    } else if (typeof parsed === "object" && parsed !== null) {
      result[key] = normalizeInput(parsed as Record<string, unknown>);
    } else {
      result[key] = parsed;
    }
  }
  return result;
}

/** Set a layer's track — must mutate layer.track directly, not layer.properties.track */
function setTrack(commitFn: any, layerId: string, track: number) {
  commitFn((draft: any) => {
    const l = draft.layers?.find((x: any) => x.id === layerId);
    if (l) l.track = normalizeTrackForKind(track, l.type === "audio" ? "audio" : "video");
  }, { label: "Set track" });
}

async function placeAssetOnTimeline(
  commitFn: any,
  asset: { id: string; name?: string; type: "video" | "audio" | "image"; url: string; duration?: number },
  fps: number,
  options: { startFrame: number; durationFrames?: number; trackIndex?: number },
): Promise<{ layerId: string; audioLayerId?: string; startFrame: number; durationFrames: number; track: number } | null> {
  const editor = useEditorStore.getState();
  const startFrame = Math.max(0, Math.floor(options.startFrame));
  const startTime = startFrame / fps;
  const durationFrames = Math.max(
    1,
    Math.floor(options.durationFrames ?? ((asset.duration ?? 5) * fps)),
  );
  const sourceDuration = durationFrames / fps;
  const kind = asset.type === "audio" ? "audio" : "video";
  const requestedTrack = options.trackIndex === undefined
    ? undefined
    : normalizeTrackForKind(options.trackIndex, kind);
  const track = findAvailableTrack(
    editor.video.layers ?? [],
    kind,
    startTime,
    sourceDuration,
    requestedTrack,
  );
  const layerId = await addLayerCommand(commitFn, {
    type: asset.type === "image" ? "image" : asset.type,
    source: asset.url,
    sourceDuration,
    startTime,
  });
  if (!layerId) return null;
  setTrack(commitFn, layerId, track);

  let audioLayerId: string | undefined;
  if (asset.type === "video") {
    const { generateLinkId, setLayerLinkId } = await import("@/lib/linkUtils");
    const linkId = generateLinkId();
    await setLayerLinkId(commitFn, layerId, linkId, setSettingCommand);
    await setPropertyCommand(commitFn, layerId, "mute", true);
    const audioTrack = findAvailableTrack(
      useEditorStore.getState().video.layers ?? [],
      "audio",
      startTime,
      sourceDuration,
      localTrackForKind(track, "video"),
    );
    audioLayerId = await addLayerCommand(commitFn, {
      type: "audio",
      source: asset.url,
      sourceDuration,
      startTime,
    });
    if (audioLayerId) {
      setTrack(commitFn, audioLayerId, audioTrack);
      await setLayerLinkId(commitFn, audioLayerId, linkId, setSettingCommand);
    }
  }

  return { layerId, audioLayerId, startFrame, durationFrames, track };
}

function copySplitLayer(
  commitFn: any,
  newLayerId: string,
  sourceLayer: LayerJSON,
  sourceStart: number,
  sourceDuration: number,
  startTime: number,
  linkId?: string,
) {
  commitFn((draft: any) => {
    const created = draft.layers?.find((layer: any) => layer.id === newLayerId);
    if (!created) return;
    created.track = sourceLayer.track ?? 0;
    created.properties = JSON.parse(JSON.stringify(sourceLayer.properties ?? {}));
    if (sourceLayer.effects) created.effects = JSON.parse(JSON.stringify(sourceLayer.effects));
    if (sourceLayer.animations) created.animations = JSON.parse(JSON.stringify(sourceLayer.animations));
    if (sourceLayer.transitionIn) created.transitionIn = JSON.parse(JSON.stringify(sourceLayer.transitionIn));
    if (sourceLayer.transitionOut) created.transitionOut = JSON.parse(JSON.stringify(sourceLayer.transitionOut));
    created.settings = {
      ...created.settings,
      ...JSON.parse(JSON.stringify(sourceLayer.settings ?? {})),
      startTime,
      sourceStart,
      sourceDuration,
      ...(linkId ? { linkId } : {}),
    };
  }, { label: "Copy split layer attributes" });
}

function getLayerTimelineBoundsFrames(layer: any, fps: number): { startFrame: number; endFrame: number } {
  const timing = getLayerTiming(layer);
  const effectiveSpeed = Math.max(Math.abs(timing.speed || 1), MIN_SPEED);
  const startFrame = Math.round(timing.startTime * fps);
  const endFrame = Math.round((timing.startTime + timing.sourceDuration / effectiveSpeed) * fps);
  return { startFrame, endFrame };
}

async function splitLayerAtFrame(commitFn: any, fps: number, layerId: string, atFrame: number): Promise<boolean> {
  const currentEditor = useEditorStore.getState();
  const currentLayers = currentEditor.video.layers ?? [];
  const layer = currentLayers.find((l: any) => l.id === layerId);
  if (!layer) return false;

  const bounds = getLayerTimelineBoundsFrames(layer, fps);
  if (!(atFrame > bounds.startFrame && atFrame < bounds.endFrame)) return false;

  const timing = getLayerTiming(layer);
  const splitDur = (atFrame - bounds.startFrame) / fps;
  const remainDur = (bounds.endFrame - atFrame) / fps;
  const linkId = getLayerLinkId(layer);
  const rightLinkId = linkId ? `${linkId}-r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` : "";

  await resizeLayerCommand(commitFn, layerId, splitDur);

  const newLayerId = await addLayerCommand(commitFn, {
    type: layer.type as string,
    source: getLayerSource(layer),
    sourceDuration: remainDur,
    startTime: timing.startTime + splitDur,
    properties: layer.properties,
  });
  if (newLayerId) {
    copySplitLayer(
      commitFn,
      newLayerId,
      layer,
      timing.sourceStart + splitDur * Math.abs(timing.speed || 1),
      remainDur,
      timing.startTime + splitDur,
      rightLinkId || undefined,
    );
  }

  const partner = findLinkedPartnerIn(currentLayers, layerId);
  if (partner) {
    const partnerBounds = getLayerTimelineBoundsFrames(partner, fps);
    if (atFrame > partnerBounds.startFrame && atFrame < partnerBounds.endFrame) {
      const pTiming = getLayerTiming(partner);
      const pSplitDur = (atFrame - partnerBounds.startFrame) / fps;
      const pRemainDur = (partnerBounds.endFrame - atFrame) / fps;
      await resizeLayerCommand(commitFn, partner.id, pSplitDur);
      const pNewId = await addLayerCommand(commitFn, {
        type: partner.type as string,
        source: getLayerSource(partner),
        sourceDuration: pRemainDur,
        startTime: pTiming.startTime + pSplitDur,
        properties: partner.properties,
      });
      if (pNewId) {
        copySplitLayer(
          commitFn,
          pNewId,
          partner,
          pTiming.sourceStart + pSplitDur * Math.abs(pTiming.speed || 1),
          pRemainDur,
          pTiming.startTime + pSplitDur,
          rightLinkId || undefined,
        );
      }
    }
  }

  return true;
}

async function applyRippleDeleteRanges(
  commitFn: any,
  fps: number,
  rawRanges: Array<Record<string, unknown>>,
): Promise<{ deletedRanges: number; totalDeletedSeconds: number }> {
  const ranges = rawRanges
    .map((range) => ({
      startFrame: Number(range.startFrame ?? range.start ?? 0),
      endFrame: Number(range.endFrame ?? range.end ?? 0),
      trackIndex: range.trackIndex !== undefined ? Number(range.trackIndex) : undefined,
    }))
    .filter((range) => Number.isFinite(range.startFrame) && Number.isFinite(range.endFrame) && range.endFrame > range.startFrame);
  if (ranges.length === 0) {
    throw new Error("No valid ranges provided");
  }

  let totalDeleted = 0;
  const sortedRanges = [...ranges].sort((a, b) => b.startFrame - a.startFrame);
  for (const range of sortedRanges) {
    const delDuration = (range.endFrame - range.startFrame) / fps;

    let changed = true;
    while (changed) {
      changed = false;
      const layers = useEditorStore.getState().video.layers ?? [];
      for (const layer of layers) {
        if (range.trackIndex !== undefined && Math.max(0, Math.floor(layer.track ?? 0)) !== range.trackIndex) continue;
        const bounds = getLayerTimelineBoundsFrames(layer, fps);
        if (bounds.startFrame < range.startFrame && range.startFrame < bounds.endFrame) {
          if (await splitLayerAtFrame(commitFn, fps, layer.id, range.startFrame)) {
            changed = true;
            break;
          }
        }
      }
    }

    changed = true;
    while (changed) {
      changed = false;
      const layers = useEditorStore.getState().video.layers ?? [];
      for (const layer of layers) {
        if (range.trackIndex !== undefined && Math.max(0, Math.floor(layer.track ?? 0)) !== range.trackIndex) continue;
        const bounds = getLayerTimelineBoundsFrames(layer, fps);
        if (bounds.startFrame < range.endFrame && range.endFrame < bounds.endFrame) {
          if (await splitLayerAtFrame(commitFn, fps, layer.id, range.endFrame)) {
            changed = true;
            break;
          }
        }
      }
    }

    const layers = useEditorStore.getState().video.layers ?? [];
    const inRangeIds = layers
      .filter((layer) => {
        if (range.trackIndex !== undefined && Math.max(0, Math.floor(layer.track ?? 0)) !== range.trackIndex) return false;
        const bounds = getLayerTimelineBoundsFrames(layer, fps);
        return bounds.startFrame >= range.startFrame && bounds.endFrame <= range.endFrame;
      })
      .map((layer) => layer.id);
    if (inRangeIds.length > 0) {
      await removeLayersCommand(commitFn, inRangeIds);
    }

    const currentLayers = useEditorStore.getState().video.layers ?? [];
    const shifted = currentLayers
      .filter((layer) => {
        if (range.trackIndex !== undefined && Math.max(0, Math.floor(layer.track ?? 0)) !== range.trackIndex) return false;
        if (inRangeIds.includes(layer.id)) return false;
        const bounds = getLayerTimelineBoundsFrames(layer, fps);
        return bounds.startFrame >= range.endFrame;
      })
      .map((layer) => ({
        id: layer.id,
        startTime: Math.max(0, (getLayerTiming(layer).startTime ?? 0) - delDuration),
      }));
    if (shifted.length > 0) await moveLayersCommand(commitFn, shifted);
    totalDeleted += delDuration;
  }

  refreshPreview();
  return { deletedRanges: ranges.length, totalDeletedSeconds: totalDeleted };
}

function mapTranscriptWordsToTimeline(layer: any, transcript: { words: Array<{ text: string; start: number; end: number }> }, fps: number) {
  const { startTime: clipStartTime, sourceStart: clipSourceStart, sourceDuration: clipSourceDuration, speed: clipSpeed } = getLayerTiming(layer);
  const effectiveSpeed = Math.max(Math.abs(clipSpeed), MIN_SPEED);
  const clipStartFrame = Math.round(clipStartTime * fps);
  const visibleStart = clipSourceStart;
  const visibleEnd = clipSourceStart + clipSourceDuration;

  const toTimeline = (sourceSeconds: number) =>
    Math.round(clipStartFrame + (sourceSeconds - visibleStart) * fps / effectiveSpeed);

  const words = transcript.words
    .filter((word) => {
      if (word.start === undefined || word.end === undefined) return false;
      const wordMidSec = (word.start + word.end) / 2;
      return wordMidSec >= visibleStart && wordMidSec <= visibleEnd;
    })
    .map((word) => ({
      text: word.text,
      startFrame: toTimeline(word.start),
      endFrame: Math.max(toTimeline(word.end), toTimeline(word.start) + 1),
      start: word.start,
      end: word.end,
    }))
    .filter((word) => word.endFrame > word.startFrame);

  return { words, clipStartFrame, visibleStart, visibleEnd, effectiveSpeed };
}

// ─── TOOL EXECUTOR ────────────────────────────────────────────────

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  // Normalize inputs before dispatching — fixes agent sending stringified JSON
  input = normalizeInput(input);

  const editor = useEditorStore.getState();
  const commit = editor.commit;
  const fps = editor.video.fps || 30;

  try {
    switch (name) {

      // ─── TIMELINE INSPECTION ────────────────────────────────────
      case "get_timeline": return getTimelineContext();
      case "get_media": return getMediaContext(input.filterTypes);

      case "inspect_timeline": {
        const maxFrames = (input.maxFrames as number) ?? 4;
        const startFrame = (input.startFrame as number) ?? editor.currentFrame;
        const frames: string[] = [];
        for (let i = 0; i < maxFrames; i++) {
          const frame = startFrame + i * 30;
          editor.setCurrentFrame(frame);
          // Try to capture canvas
          const canvas = document.querySelector("canvas") as HTMLCanvasElement | null;
          if (canvas) {
            frames.push(canvas.toDataURL("image/jpeg", 0.6));
          }
        }
        refreshPreview();
        return JSON.stringify({ frames, count: frames.length });
      }

      case "inspect_media": {
        const resolved = resolveMediaTarget(input.mediaRef as string | undefined);
        const mediaRef = resolved.mediaRef;
        if (!mediaRef && !resolved.sourceUrl) {
          return JSON.stringify({ error: "mediaRef is required. Call get_media first, or select a clip/asset and try again." });
        }
        const maxFrames = Math.min((input.maxFrames as number) ?? 6, 12);
        const clipId = input.clipId as string | undefined;
        const overview = input.overview as boolean | undefined;
        const wordTimestamps = input.wordTimestamps as boolean | undefined;
        const startSeconds = input.startSeconds as number | undefined;
        const endSeconds = input.endSeconds as number | undefined;

        const mediaStore = useMediaPanelStore.getState();
        const asset = resolved.asset ?? mediaStore.assets.find((a) => a.id === mediaRef || a.url === resolved.sourceUrl);
        const assetSource = asset?.url ?? resolved.sourceUrl;
        if (!assetSource) return JSON.stringify({ error: `Asset not found: ${mediaRef ?? "selected media"}` });

        // Find the clip on timeline if clipId provided
        let clipInfo: Record<string, unknown> | undefined;
        if (clipId) {
          const layer = editor.video.layers.find((l: any) => l.id === clipId);
          if (layer) {
            clipInfo = {
              clipId: layer.id,
              trackIndex: layer.track ?? 0,
              startFrame: Math.round((layer.settings?.startTime ?? 0) * fps),
              endFrame: Math.round(((layer.settings?.startTime ?? 0) + (layer.settings?.sourceDuration ?? 0)) * fps),
            };
          }
        }

        const result: Record<string, unknown> = {
          id: asset?.id ?? mediaRef ?? assetSource,
          name: asset?.name ?? mediaRef ?? "Selected media",
          type: asset?.type ?? "video",
          durationSeconds: asset?.duration ?? 0,
          fileName: asset?.name ?? mediaRef ?? "Selected media",
        };

        if (clipInfo) Object.assign(result, clipInfo);

        if (asset?.type === "image") {
          // Image: return base64-encoded thumbnail
          try {
            const img = new Image();
            img.crossOrigin = "anonymous";
            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = () => reject(new Error("Failed to load image"));
              img.src = assetSource!;
            });
            const canvas = document.createElement("canvas");
            const scale = Math.min(1, 1568 / Math.max(img.width, img.height));
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            result.width = img.width;
            result.height = img.height;
            result.frameTimestamps = [0];
            // Return as text metadata (images can't be returned as image blocks easily)
            result.note = "Image loaded. Use inspect_timeline to see it in the preview.";
          } catch {
            result.note = "Could not encode image thumbnail.";
          }
        } else if (asset.type === "video" && asset.url) {
          // Video: sample frames for storyboard
          try {
            const nativeFrames = await requestNativeMedia<{
              frameTimestamps?: number[];
              frames?: Array<{ timestamp?: number; dataUrl?: string; width?: number; height?: number }>;
              frameCount?: number;
              note?: string;
            }>("sample-frames", {
              url: asset.url,
              maxFrames: overview ? Math.min(36, maxFrames * 6) : maxFrames,
              startSeconds,
              endSeconds,
            });
            if (nativeFrames?.frames?.length) {
              result.frameTimestamps = nativeFrames.frameTimestamps ?? nativeFrames.frames.map((f) => f.timestamp ?? 0);
              result.frameCount = nativeFrames.frameCount ?? nativeFrames.frames.length;
              result.frames = nativeFrames.frames;
              if (overview) result.overviewMode = true;
              result.note = nativeFrames.note ?? `Sampled ${nativeFrames.frames.length} frames natively.`;
            } else {
              const { sampleVideoFrames } = await import("./webAudio");
              const { frames, timestamps } = await sampleVideoFrames(
                asset.url,
                overview ? Math.min(36, maxFrames * 6) : maxFrames,
                startSeconds,
                endSeconds
              );
              result.frameTimestamps = timestamps;
              result.frameCount = frames.length;
              if (overview) result.overviewMode = true;
              result.note = `Sampled ${frames.length} frames. Canvas frames available for agent vision.`;
            }
          } catch (e) {
            result.note = `Frame sampling failed: ${e instanceof Error ? e.message : String(e)}`;
          }
        }

        // Transcription (if available)
        if (wordTimestamps && (asset.type === "video" || asset.type === "audio")) {
          try {
            const { getCachedTranscript } = await import("./transcriptCache");
            const cached = await getCachedTranscript(asset.url!);
            if (cached) {
              result.transcription = {
                timing: "sourceSeconds",
                segments: cached.segments.map((s) => [s.text, s.start, s.end]),
                words: cached.words.map((w) => [w.text, w.start, w.end]),
              };
            } else {
              result.transcription = { note: "No cached transcript. Use get_transcript to generate." };
            }
          } catch {
            result.transcription = { note: "Transcript lookup failed." };
          }
        }

        return JSON.stringify(result);
      }

      case "inspect_color": {
        const canvas = document.querySelector("canvas") as HTMLCanvasElement | null;
        if (!canvas) return JSON.stringify({ error: "No canvas available for color inspection" });
        const ctx = canvas.getContext("2d");
        if (!ctx) return JSON.stringify({ error: "Cannot get canvas context" });
        const region = input.region as { x?: number; y?: number; width?: number; height?: number } | undefined;
        const x = Math.floor((region?.x ?? 0.4) * canvas.width);
        const y = Math.floor((region?.y ?? 0.4) * canvas.height);
        const w = Math.floor((region?.width ?? 0.2) * canvas.width);
        const h = Math.floor((region?.height ?? 0.2) * canvas.height);
        const data = ctx.getImageData(x, y, Math.max(1, w), Math.max(1, h)).data;
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
        }
        if (count > 0) { r = Math.round(r / count); g = Math.round(g / count); b = Math.round(b / count); }
        return JSON.stringify({ dominantColor: `rgb(${r},${g},${b})`, hex: `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`, sampleCount: count });
      }

      // ─── CLIP OPERATIONS ────────────────────────────────────────
      case "add_clips": {
        const entries = (input.entries as Array<Record<string, unknown>>) ?? (input.clips as Array<Record<string, unknown>>);
        if (!entries || entries.length === 0) return JSON.stringify({ error: "No clips provided" });
        const mediaStore = useMediaPanelStore.getState();
        const results: Record<string, unknown>[] = [];
        for (const entry of entries) {
          const mediaRef = entry.mediaRef as string;
          const asset = mediaStore.assets.find((a) => a.id === mediaRef);
          if (!asset) { results.push({ error: `Asset not found: ${mediaRef}` }); continue; }
          const startFrame = (entry.startFrame as number) ?? 0;
          const durationFrames = (entry.durationFrames as number) ?? ((entry.sourceDuration as number | undefined) !== undefined
            ? Math.round((entry.sourceDuration as number) * fps)
            : undefined);
          const requestedTrack = entry.trackIndex ?? entry.track;
          const placement = await placeAssetOnTimeline(commit, asset, fps, {
            startFrame,
            durationFrames,
            trackIndex: requestedTrack === undefined ? undefined : Number(requestedTrack),
          });
          if (!placement) {
            results.push({ error: `Unable to place asset: ${mediaRef}` });
            continue;
          }
          results.push({
            layerId: placement.layerId,
            audioLayerId: placement.audioLayerId,
            mediaRef,
            startFrame: placement.startFrame,
            durationFrames: placement.durationFrames,
            track: placement.track,
          });
        }
        refreshPreview();
        return JSON.stringify({ added: results });
      }

      case "insert_clips": {
        const entries = input.entries as Array<Record<string, unknown>>;
        if (!entries || entries.length === 0) return JSON.stringify({ error: "No clips provided" });
        // Insert is add_clips + ripple shift
        const insertFrame = (entries[0].startFrame as number) ?? 0;
        const insertDuration = entries.reduce((sum, e) => sum + ((e.durationFrames as number) ?? 30), 0) / fps;
        const beforeSnap = snapshotTimeline();
        // Shift existing clips right
        const layers = editor.video.layers ?? [];
        const toShift = layers
          .filter((l) => Math.round((l.settings?.startTime ?? 0) * fps) >= insertFrame)
          .map((l) => ({ id: l.id, startTime: (l.settings?.startTime ?? 0) + insertDuration }));
        if (toShift.length > 0) await moveLayersCommand(commit, toShift);
        // Add new clips
        const mediaStore = useMediaPanelStore.getState();
        for (const entry of entries) {
          const asset = mediaStore.assets.find((a) => a.id === (entry.mediaRef as string));
          if (!asset) continue;
          const startTime = ((entry.startFrame as number) ?? 0) / fps;
          const sourceDuration = (entry.durationFrames as number ? (entry.durationFrames as number) / fps : undefined) ?? asset.duration ?? 5;
          const requestedTrack = entry.trackIndex ?? entry.track;
          const requestedTrackValue = requestedTrack === undefined
            ? undefined
            : normalizeTrackForKind(Number(requestedTrack), asset.type === "audio" ? "audio" : "video");
          const requestedKind = asset.type === "audio" ? "audio" : "video";
          const placementTrack = findAvailableTrack(
            useEditorStore.getState().video.layers ?? [],
            requestedKind,
            startTime,
            sourceDuration,
            requestedTrackValue,
          );
          const layerId = await addLayerCommand(commit, {
            type: asset.type === "image" ? "image" : asset.type === "video" ? "video" : "audio",
            source: asset.url,
            sourceDuration,
            startTime,
          });
          setTrack(commit, layerId, placementTrack);
          // Separate video+audio tracks for video assets — linked via linkId
          if (asset.type === "video") {
            const { generateLinkId, setLayerLinkId } = await import("@/lib/linkUtils");
            const linkId = generateLinkId();
            await setLayerLinkId(commit, layerId, linkId, setSettingCommand);
            // Mute the video layer's built-in audio — the separate audio track handles sound
            await setPropertyCommand(commit, layerId, "mute", true);
            const audioTrack = findAvailableTrack(
              useEditorStore.getState().video.layers ?? [],
              "audio",
              startTime,
              sourceDuration,
              localTrackForKind(placementTrack, "video"),
            );
            const audioLayerId = await addLayerCommand(commit, {
              type: "audio",
              source: asset.url,
              sourceDuration,
              startTime,
            });
            setTrack(commit, audioLayerId, audioTrack);
            await setLayerLinkId(commit, audioLayerId, linkId, setSettingCommand);
          }
        }
        refreshPreview();
        return JSON.stringify({ inserted: entries.length, shifted: toShift.length });
      }

      case "remove_clips": {
        let layerIds = input.layerIds as string[];
        // Accept clipIds as alias
        if (!layerIds || layerIds.length === 0) {
          layerIds = input.clipIds as string[];
        }
        if (!layerIds || layerIds.length === 0) return JSON.stringify({ error: "No layerIds provided" });
        const { findLinkedPartnerIn } = await import("@/lib/linkUtils");
        const allLayers = editor.video.layers ?? [];
        // Resolve linked partners — remove them too
        const idsToRemove = new Set(layerIds);
        for (const id of layerIds) {
          const partner = findLinkedPartnerIn(allLayers, id);
          if (partner && !idsToRemove.has(partner.id)) {
            idsToRemove.add(partner.id);
          }
        }
        const beforeSnap = snapshotTimeline();
        await removeLayersCommand(commit, Array.from(idsToRemove));
        refreshPreview();
        return JSON.stringify({ removed: Array.from(idsToRemove) });
      }

      case "remove_tracks": {
        const trackIndices = input.trackIndices as number[];
        if (!trackIndices || trackIndices.length === 0) return JSON.stringify({ error: "No trackIndices provided" });
        const layers = editor.video.layers ?? [];
        const idsToRemove = layers
          .filter((l) => trackIndices.includes(l.track ?? 0))
          .map((l) => l.id);
        if (idsToRemove.length === 0) return JSON.stringify({ message: "No clips on specified tracks" });
        await removeLayersCommand(commit, idsToRemove);
        refreshPreview();
        return JSON.stringify({ removedTracks: trackIndices, removedClipCount: idsToRemove.length });
      }

      case "move_clips": {
        const clips = input.clips as Array<Record<string, unknown>>;
        if (!clips || clips.length === 0) return JSON.stringify({ error: "No clips provided" });
        const { findLinkedPartnerIn } = await import("@/lib/linkUtils");
        const allLayers = editor.video.layers ?? [];
        const updates: Array<{ id: string; startTime: number; track?: number }> = [];
        const seenIds = new Set<string>();
        for (const c of clips) {
          const layerId = c.layerId as string;
          const startTime = Math.max(0, c.startTime as number);
          const track = c.track !== undefined ? Math.max(0, c.track as number) : undefined;
          if (!seenIds.has(layerId)) {
            updates.push({ id: layerId, startTime, track });
            seenIds.add(layerId);
          }
          // Also move linked partner by the same delta
          const partner = findLinkedPartnerIn(allLayers, layerId);
          if (partner && !seenIds.has(partner.id)) {
            const actualStart = (allLayers.find((l: any) => l.id === layerId))?.settings?.startTime ?? 0;
            const delta = startTime - actualStart;
            const origStart = partner.settings?.startTime ?? 0;
            const originalTrack = (allLayers.find((l: any) => l.id === layerId))?.track ?? 0;
            const trackDelta = track === undefined ? 0 : track - originalTrack;
            updates.push({
              id: partner.id,
              startTime: Math.max(0, origStart + delta),
              track: Math.max(0, Math.floor((partner.track ?? 0) + trackDelta)),
            });
            seenIds.add(partner.id);
          }
        }
        const validation = validateMoveUpdates(allLayers, updates);
        if (!validation.ok) {
          return JSON.stringify({ error: validation.reason, layerId: validation.layerId, moved: [] });
        }
        await moveLayersCommand(commit, updates);
        refreshPreview();
        return JSON.stringify({ moved: updates });
      }

      case "split_clips": {
        let cuts = input.cuts as Array<Record<string, unknown>> | undefined;
        // Accept aliases: clipId → layerId, frame → atFrame
        if (cuts) {
          cuts = cuts.map((c) => ({
            layerId: (c.layerId ?? c.clipId) as string,
            atFrame: (c.atFrame ?? c.frame) as number,
          }));
        }
        const { findLinkedPartnerIn, getLayerLinkId } = await import("@/lib/linkUtils");
        const beforeSnap = snapshotTimeline();
        if (cuts && cuts.length > 0) {
          for (const cut of cuts) {
            const layerId = cut.layerId as string;
            const atFrame = cut.atFrame as number;
            const currentEditor = useEditorStore.getState();
            const currentLayers = currentEditor.video.layers ?? [];
            const layer = currentLayers.find((l) => l.id === layerId);
            if (!layer) continue;
            const startFrame = Math.round((layer.settings?.startTime ?? 0) * fps);
            const durFrames = Math.round((layer.settings?.sourceDuration ?? 0) * fps);
            if (atFrame > startFrame && atFrame < startFrame + durFrames) {
              const splitDur = (atFrame - startFrame) / fps;
              const remainDur = (durFrames - (atFrame - startFrame)) / fps;
              // Resize original (left part)
              await resizeLayerCommand(commit, layerId, splitDur);
              // Add right part — generate NEW linkId so right parts don't share with left parts
              const linkId = getLayerLinkId(layer);
              const rightLinkId = linkId ? `${linkId}-r-${Date.now()}` : "";
              const newLayerId = await addLayerCommand(commit, {
                type: layer.type as string,
                source: getLayerSource(layer),
                sourceDuration: remainDur,
                startTime: (layer.settings?.startTime ?? 0) + splitDur,
                properties: layer.properties,
              });
              if (newLayerId) copySplitLayer(commit, newLayerId, layer,
                (layer.settings?.sourceStart ?? 0) + splitDur * Math.abs(layer.settings?.speed ?? 1),
                remainDur,
                (layer.settings?.startTime ?? 0) + splitDur,
                rightLinkId || undefined);
              // Also split the linked partner at the same frame
              const partner = findLinkedPartnerIn(currentLayers, layerId);
              if (partner) {
                const pStartFrame = Math.round((partner.settings?.startTime ?? 0) * fps);
                const pDurFrames = Math.round((partner.settings?.sourceDuration ?? 0) * fps);
                if (atFrame > pStartFrame && atFrame < pStartFrame + pDurFrames) {
                  const pSplitDur = (atFrame - pStartFrame) / fps;
                  const pRemainDur = (pDurFrames - (atFrame - pStartFrame)) / fps;
                  await resizeLayerCommand(commit, partner.id, pSplitDur);
                  const pNewId = await addLayerCommand(commit, {
                    type: partner.type as string,
                    source: getLayerSource(partner),
                    sourceDuration: pRemainDur,
                    startTime: (partner.settings?.startTime ?? 0) + pSplitDur,
                    properties: partner.properties,
                  });
                  if (pNewId) copySplitLayer(commit, pNewId, partner,
                    (partner.settings?.sourceStart ?? 0) + pSplitDur * Math.abs(partner.settings?.speed ?? 1),
                    pRemainDur,
                    (partner.settings?.startTime ?? 0) + pSplitDur,
                    rightLinkId || undefined);
                }
              }
            }
          }
        } else {
          // Split all under playhead
          const frame = editor.currentFrame;
          const time = frame / fps;
          const toSplit = useEditorStore.getState().video.layers.filter((l) => {
            const st = l.settings?.startTime ?? 0;
            const dur = l.settings?.sourceDuration ?? 5;
            return time > st && time < st + dur;
          });
          for (const layer of toSplit) {
            const startFrame = Math.round((layer.settings?.startTime ?? 0) * fps);
            const splitDur = (frame - startFrame) / fps;
            const durFrames = Math.round((layer.settings?.sourceDuration ?? 0) * fps);
            const remainDur = (durFrames - (frame - startFrame)) / fps;
            await resizeLayerCommand(commit, layer.id, splitDur);
            const linkId = getLayerLinkId(layer);
            const rightLinkId = linkId ? `${linkId}-r-${Date.now()}` : "";
            const newLayerId = await addLayerCommand(commit, {
              type: layer.type as string,
              source: getLayerSource(layer),
              sourceDuration: remainDur,
              startTime: (layer.settings?.startTime ?? 0) + splitDur,
              properties: layer.properties,
            });
            if (newLayerId) copySplitLayer(commit, newLayerId, layer,
              (layer.settings?.sourceStart ?? 0) + splitDur * Math.abs(layer.settings?.speed ?? 1),
              remainDur,
              (layer.settings?.startTime ?? 0) + splitDur,
              rightLinkId || undefined);
          }
        }
        refreshPreview();
        return JSON.stringify({ splitAt: cuts ? cuts.length + " cut points" : "playhead" });
      }

      case "set_clip_properties": {
        const clips = input.clips as Array<Record<string, unknown>>;
        if (!clips || clips.length === 0) return JSON.stringify({ error: "No clips provided" });
        const { findLinkedPartnerIn } = await import("@/lib/linkUtils");
        const allLayers2 = editor.video.layers ?? [];
        for (const clip of clips) {
          const layerId = clip.layerId as string;
          const partner = findLinkedPartnerIn(allLayers2, layerId);
          if (clip.sourceDuration !== undefined) {
            await resizeLayerCommand(commit, layerId, clip.sourceDuration as number);
            if (partner) await resizeLayerCommand(commit, partner.id, clip.sourceDuration as number);
          }
          if (clip.properties) {
            const props = clip.properties as Record<string, unknown>;
            for (const [key, value] of Object.entries(props)) {
              await setPropertyCommand(commit, layerId, key, value);
              if (partner) await setPropertyCommand(commit, partner.id, key, value);
            }
          }
          if (clip.settings) {
            const sets = clip.settings as Record<string, unknown>;
            for (const [key, value] of Object.entries(sets)) {
              await setSettingCommand(commit, layerId, key, value);
              if (partner) await setSettingCommand(commit, partner.id, key, value);
            }
          }
        }
        refreshPreview();
        return JSON.stringify({ updated: clips.length });
      }

      case "ripple_delete_ranges": {
        const rawRanges = (input.ranges as Array<Record<string, unknown>>) ?? [];
        if (!rawRanges || rawRanges.length === 0) return JSON.stringify({ error: "No ranges provided" });
        try {
          const result = await applyRippleDeleteRanges(commit, fps, rawRanges);
          return JSON.stringify(result);
        } catch (err) {
          return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
        }
      }

      case "remove_silence": {
        const clipIds = input.clipIds as string[] | undefined;
        const minPauseSeconds = Math.max(0.15, Number(input.minPauseSeconds ?? 0.5));
        const language = input.language as string | undefined;

        const apiKey = await getSecureApiKey();
        const hasCloudAccess = !!apiKey || useAccountStore.getState().isSignedIn();
        if (!hasCloudAccess) {
          return JSON.stringify({ error: "Qwen API key or Filmidi Pro account required for transcription." });
        }

        const { findLinkedPartnerIn } = await import("@/lib/linkUtils");
        const { getCachedTranscript, setCachedTranscript } = await import("./transcriptCache");

        const allLayers = editor.video.layers ?? [];
        const targets = selectTranscriptTargets(allLayers, clipIds, fps);

        if (targets.length === 0) {
          return JSON.stringify({ error: "No audio/video clips found for silence removal." });
        }

        const minPauseFrames = Math.max(1, Math.round(minPauseSeconds * fps));
        const ranges: Array<Record<string, unknown>> = [];

        for (const layer of targets) {
          const source = getLayerSource(layer);
          if (!source) continue;

          let transcript = await getCachedTranscript(source, language);
          if (!transcript) {
            try {
              transcript = await transcribeAudio(source, apiKey || "", { language });
              await setCachedTranscript(source, transcript, language);
            } catch (err) {
              logTranscript("warn", "remove_silence", "transcription failed", {
                clipId: layer.id,
                error: err instanceof Error ? err.message : String(err),
              });
              continue;
            }
          }

          const mapped = mapTranscriptWordsToTimeline(layer, transcript, fps);
          if (mapped.words.length === 0) continue;

          const addRange = (startFrame: number, endFrame: number) => {
            if (endFrame - startFrame >= minPauseFrames) {
              ranges.push({ startFrame, endFrame });
            }
          };

          addRange(mapped.clipStartFrame, mapped.words[0].startFrame);
          for (let i = 0; i < mapped.words.length - 1; i++) {
            addRange(mapped.words[i].endFrame, mapped.words[i + 1].startFrame);
          }

          const timing = getLayerTiming(layer);
          const clipEndFrame = Math.round((timing.startTime + timing.sourceDuration / Math.max(Math.abs(timing.speed || 1), MIN_SPEED)) * fps);
          addRange(mapped.words[mapped.words.length - 1].endFrame, clipEndFrame);
        }

        if (ranges.length === 0) {
          return JSON.stringify({
            removedRanges: 0,
            note: `No silence longer than ${minPauseSeconds.toFixed(2)}s was found.`,
          });
        }

        const result = await applyRippleDeleteRanges(commit, fps, ranges);
        return JSON.stringify({
          ...result,
          note: `Removed pauses longer than ${minPauseSeconds.toFixed(2)}s and closed the gaps.`,
        });
      }

      // ─── KEYFRAMES ──────────────────────────────────────────────
      case "set_keyframes": {
        const clipId = input.clipId as string;
        const property = input.property as string;
        const keyframes = input.keyframes as Array<{ time: number; value: unknown; easing?: string }>;
        if (!clipId || !property) return JSON.stringify({ error: "clipId and property required" });
        for (const kf of keyframes) {
          await setKeyframeCommand(commit, clipId, property, kf.time, kf.value, kf.easing as string);
        }
        refreshPreview();
        return JSON.stringify({ keyframesSet: keyframes.length, property });
      }

      // ─── TEXT / CAPTIONS ────────────────────────────────────────
      case "extract_audio": {
        const targetIds = input.clipIds as string[] | undefined;
        const nativeExtract = await requestNativeMedia<{ audioUrl?: string; outputUrl?: string; note?: string }>("extract-audio", {
          clipIds: targetIds ?? [],
        });
        const extractedAudioUrl = nativeExtract?.audioUrl ?? nativeExtract?.outputUrl;
        if (nativeExtract?.note) {
          console.log("[extract_audio][sidecar]", nativeExtract.note);
        }

        const allLayers = editor.video.layers ?? [];
        const selectedTargets = selectTranscriptTargets(allLayers, targetIds, fps).filter((l: any) => l.type === "video");

        let extracted = 0;
        let skipped = 0;
        for (const layer of selectedTargets) {
          const source = getLayerSource(layer);
          if (!source) continue;
          if (hasExistingAudioMirror(layer, allLayers)) {
            skipped++;
            continue;
          }
          try {
            let publicUrl = extractedAudioUrl;
            if (!publicUrl) {
              const resp = await fetch(source);
              const blob = await resp.blob();
              const dataUrl: string = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
              });
              const [_, base64] = dataUrl.split(",");
              const { uploadAudioForASR } = await import("@/lib/agentIPC");
              publicUrl = await uploadAudioForASR(base64, blob.type || "video/mp4");
            }
            if (!publicUrl) {
              throw new Error("No extracted audio URL returned");
            }

            const linkId = `link-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const { setLayerLinkId } = await import("@/lib/linkUtils");
            const { commands: cmds } = await import("@videoflow/react-video-editor");
            const setSettingCommand = cmds.setSettingCommand;
            const clipName = (layer.settings?.name as string) || "Clip";
            const audioTrack = (editor.video.layers ?? []).filter((l: any) => l.type === "audio").length;
            cmds.setTrackSettingsCommand(commit, audioTrack, { name: `A${audioTrack + 1}` });
            const newAudioId = await addLayerCommand(commit, {
              type: "audio",
              source: publicUrl,
              sourceDuration: layer.settings?.sourceDuration ?? 5,
              startTime: layer.settings?.startTime ?? 0,
            });
            if (newAudioId) {
              setTrack(commit, newAudioId, audioTrack);
              await cmds.setSettingCommand(commit, newAudioId, "name", `${clipName} Audio`);
              await setLayerLinkId(commit, newAudioId, linkId, setSettingCommand);
            }
            await setLayerLinkId(commit, layer.id, linkId, setSettingCommand);
            await cmds.setPropertyCommand(commit, layer.id, "mute", true);
            extracted++;
          } catch (e) {
            console.warn("[extract_audio] failed for", (source as string)?.slice(0, 60), e);
          }
        }
        refreshPreview();
        return JSON.stringify({ extracted, skipped });
      }

      case "add_texts": {
        const texts = input.texts as Array<Record<string, unknown>>;
        if (!texts || texts.length === 0) return JSON.stringify({ error: "No texts provided" });
        const results: string[] = [];
        for (const t of texts) {
          const layerId = await addLayerCommand(commit, {
            type: "text",
            startTime: ((t.startFrame as number) ?? 0) / fps,
            sourceDuration: ((t.durationFrames as number) ?? 90) / fps,
            properties: {
              text: t.content as string,
              fontSize: (t.fontSize as number) ?? 0.1,
              fontFamily: (t.fontName as string) ?? "sans-serif",
              color: (t.color as string) ?? "#ffffff",
              fontWeight: t.isBold ? "bold" : "normal",
              fontStyle: t.isItalic ? "italic" : "normal",
              textAlign: (t.alignment as string) ?? "center",
              position: [
                (t.centerX as number) ?? 0.5,
                (t.centerY as number) ?? 0.5,
              ],
            },
          });
          results.push(layerId);
        }
        refreshPreview();
        return JSON.stringify({ added: results });
      }

      case "update_text": {
        const clipId = input.clipId as string;
        const captionGroupId = input.captionGroupId as string;
        if (!clipId && !captionGroupId) return JSON.stringify({ error: "clipId or captionGroupId required" });
        const textProps: Record<string, unknown> = {};
        if (input.content !== undefined) textProps.text = input.content;
        if (input.fontName !== undefined) textProps.fontFamily = input.fontName;
        if (input.fontSize !== undefined) textProps.fontSize = input.fontSize;
        if (input.color !== undefined) textProps.color = input.color;
        if (input.isBold !== undefined) textProps.fontWeight = input.isBold ? "bold" : "normal";
        if (input.isItalic !== undefined) textProps.fontStyle = input.isItalic ? "italic" : "normal";
        if (input.alignment !== undefined) textProps.textAlign = input.alignment;
        if (input.borderColor !== undefined) textProps.textStrokeColor = input.borderColor;
        if (input.backgroundColor !== undefined) textProps.backgroundColor = input.backgroundColor;

        const canvasWidth = Math.max(1, editor.video.width || 1920);
        const canvasHeight = Math.max(1, editor.video.height || 1080);
        const hasPositionUpdate = input.x !== undefined || input.y !== undefined
          || input.centerX !== undefined || input.centerY !== undefined;

        // Text layers store position as normalized [x, y]. Accept pixel
        // coordinates from the agent while preserving the other coordinate.
        if (hasPositionUpdate) {
          const candidates = (editor.video.layers ?? []).filter((layer: any) => {
            if (layer.type !== "text") return false;
            if (clipId) return layer.id === clipId;
            return layer.settings?.captionGroupId === captionGroupId
              || layer.settings?.captionKey === captionGroupId
              || layer.settings?.captionTargetId === captionGroupId;
          });
          for (const layer of candidates) {
            const current = Array.isArray(layer.properties?.position) ? layer.properties.position : [0.5, 0.5];
            const currentX = Number(current[0]) || 0.5;
            const currentY = Number(current[1]) || 0.5;
            const nextX = input.centerX !== undefined
              ? Number(input.centerX)
              : input.x !== undefined ? Number(input.x) / canvasWidth : currentX;
            const nextY = input.centerY !== undefined
              ? Number(input.centerY)
              : input.y !== undefined ? Number(input.y) / canvasHeight : currentY;
            textProps.position = [
              Math.max(0, Math.min(1, Number.isFinite(nextX) ? nextX : currentX)),
              Math.max(0, Math.min(1, Number.isFinite(nextY) ? nextY : currentY)),
            ];
            await setPropertyCommand(commit, layer.id, "position", textProps.position);
          }
        }

        const propertyEntries = Object.entries(textProps).filter(([key]) => key !== "position");
        const targetIds = clipId
          ? [clipId]
          : (editor.video.layers ?? [])
            .filter((layer: any) => layer.type === "text" && (
              layer.settings?.captionGroupId === captionGroupId
              || layer.settings?.captionKey === captionGroupId
              || layer.settings?.captionTargetId === captionGroupId
            ))
            .map((layer: any) => layer.id);
        for (const targetId of targetIds) {
          for (const [key, value] of propertyEntries) {
            await setPropertyCommand(commit, targetId, key, value);
          }
        }
        refreshPreview();
        return JSON.stringify({ updated: clipId ?? captionGroupId, properties: Object.keys(textProps) });
      }

      case "add_captions": {
        const targetClipIds = input.clipIds as string[] | undefined;
        const language = input.language as string | undefined;
        const maxWords = (input.maxWords as number) ?? 6;
        const textCase = (input.textCase as string) ?? "auto";
        const animation = input.animation as string | undefined;
        const highlightColor = input.highlightColor as string | undefined;
        const settingsMode = (input.mode as string) ?? useSettingsStore.getState().audioProcessingMode ?? "local";

        // Build caption style. Position is always explicit so VideoFlow's
        // default center placement cannot override the caption-safe location.
        const defaultCenterY = getDefaultCaptionCenterY(editor.video.width || 1920, editor.video.height || 1080);
        const requestedCenterX = input.centerX !== undefined ? Number(input.centerX) : 0.5;
        const requestedCenterY = input.centerY !== undefined ? Number(input.centerY) : defaultCenterY;
        const captionProps: Record<string, unknown> = {
          position: [
            Math.max(0, Math.min(1, Number.isFinite(requestedCenterX) ? requestedCenterX : 0.5)),
            Math.max(0, Math.min(1, Number.isFinite(requestedCenterY) ? requestedCenterY : defaultCenterY)),
          ],
        };
        if (input.fontName !== undefined) captionProps.fontFamily = input.fontName;
        if (input.fontSize !== undefined) captionProps.fontSize = input.fontSize;
        if (input.color !== undefined) captionProps.color = input.color;
        if (input.isBold !== undefined) captionProps.fontWeight = input.isBold ? "bold" : "normal";
        if (input.isItalic !== undefined) captionProps.fontStyle = input.isItalic ? "italic" : "normal";

        // Get clips to transcribe — prefer audio tracks, skip video layers with linked audio partners
        const layers = editor.video.layers ?? [];
        const captionTargets = selectTranscriptTargets(layers, targetClipIds, fps);

        if (captionTargets.length === 0) {
          return JSON.stringify({ error: "No audio/video clips found for captioning." });
        }

        // Get API key or backend status — if either is present, cloud mode is available
        const apiKey = (await getSecureApiKey());
        const hasCloudAccess = !!apiKey || useAccountStore.getState().isSignedIn();
        const mode = hasCloudAccess ? "cloud" : settingsMode;

        if (mode === "local" || !hasCloudAccess) {
          return JSON.stringify({ error: "A Qwen API key or Filmidi Pro account is required for captions. Add a key in Settings > Agent." });
        }

        logTranscript("info", "add_captions", "start", {
          clipIds: targetClipIds ?? "entire timeline",
          language: language ?? null,
          maxWords,
          textCase,
        });



        const { getCachedTranscript, setCachedTranscript } = await import("./transcriptCache");

        let totalCaptions = 0;
        let transcribeErrors = 0;
        const transcribeErrorMessages: string[] = [];
        const sentenceEndRe = /[.?!…]+["')\]]*$/;
        const pauseThresholdSeconds = 0.7;

        const buildCaptionPhrases = (words: Array<{ text: string; start: number; end: number }>, limit: number) => {
          const phrases: Array<Array<{ text: string; start: number; end: number }>> = [];
          let current: Array<{ text: string; start: number; end: number }> = [];
          let lastEnd = 0;

          const flush = () => {
            if (current.length > 0) phrases.push(current);
            current = [];
          };

          for (const word of words) {
            const gap = current.length > 0 ? word.start - lastEnd : 0;
            const prevText = current[current.length - 1]?.text ?? "";
            const hardBreak = current.length >= limit;
            const sentenceBreak = current.length > 0 && sentenceEndRe.test(prevText);
            const pauseBreak = current.length > 0 && gap >= pauseThresholdSeconds;
            if (current.length > 0 && (hardBreak || sentenceBreak || pauseBreak)) {
              flush();
            }
            current.push(word);
            lastEnd = word.end;
          }

          flush();
          return phrases;
        };

        const tracks = editor.video.tracks ?? [];
        const captionTrack = getCaptionTrackIndex(layers, tracks);
        if (captionTrack >= tracks.length) {
          const { commands: cmds } = await import("@videoflow/react-video-editor");
          cmds.setTrackSettingsCommand(commit, captionTrack, { name: "Captions" });
        }

        for (const layer of captionTargets) {
          const source = getLayerSource(layer);
          if (!source) continue;

          let transcript = await getCachedTranscript(source, language);
          if (!transcript) {
            try {
              transcript = await transcribeAudio(source, apiKey || "", { language });
              await setCachedTranscript(source, transcript, language);
              logTranscript("info", "add_captions", "transcribed clip", {
                clipId: layer.id,
                source: source.slice(0, 80),
                wordCount: transcript.words.length,
                segmentCount: transcript.segments.length,
              });
            } catch (e) {
              const errMsg = e instanceof Error ? e.message : String(e);
              logTranscript("error", "add_captions", "transcription failed", {
                clipId: layer.id,
                source: source.slice(0, 80),
                error: errMsg,
              });
              transcribeErrorMessages.push(errMsg);
              transcribeErrors++;
              continue;
            }
          } else {
            logTranscript("info", "add_captions", "cache hit", {
              clipId: layer.id,
              source: source.slice(0, 80),
              wordCount: transcript.words.length,
              segmentCount: transcript.segments.length,
            });
          }

          const { startTime: clipStartTime, sourceStart: clipSourceStart, sourceDuration: clipSourceDuration, speed: clipSpeed } = getLayerTiming(layer);
          const effectiveSpeed = Math.max(Math.abs(clipSpeed), MIN_SPEED);
          const clipStartFrame = Math.round(clipStartTime * fps);
          const visibleStart = clipSourceStart;
          const visibleEnd = clipSourceStart + clipSourceDuration;

          const toTimeline = (sourceSeconds: number) =>
            Math.round(clipStartFrame + (sourceSeconds - visibleStart) * fps / effectiveSpeed);

          const visibleWords = transcript.words.filter((w) => {
            if (w.start === undefined || w.end === undefined) return false;
            if (w.end <= w.start) return false; // bad/zero timestamps
            return w.end >= visibleStart && w.start <= visibleEnd;
          });
          logTranscript("debug", "add_captions", "clip window", {
            clipId: layer.id,
            sourceStart: visibleStart,
            sourceEnd: visibleEnd,
            clipStartFrame,
            effectiveSpeed,
            matchedWords: visibleWords.length,
            totalWords: transcript.words.length,
          });

          // Fallback: if time-filtering yields nothing, use ALL words
          const wordsToUse = visibleWords.length > 0 ? visibleWords : transcript.words.filter((w) => {
            if (w.start === undefined || w.end === undefined) return false;
            return w.end > w.start; // at least has valid duration
          });

          if (wordsToUse.length === 0) {
            logTranscript("warn", "add_captions", "no transcribable words", {
              clipId: layer.id,
              source: source.slice(0, 80),
            });
            continue;
          }
          if (visibleWords.length === 0) {
            logTranscript("warn", "add_captions", "using full transcript fallback", {
              clipId: layer.id,
              source: source.slice(0, 80),
              wordCount: transcript.words.length,
            });
          }

          const captionKey = `${getTranscriptTargetKey(layer, fps)}|lang:${language ?? ""}|words:${Math.max(2, maxWords)}|case:${textCase}`;
          await removeExistingGeneratedCaptions(commit, layer, fps);

          const phrases = buildCaptionPhrases(
            wordsToUse.map((w) => ({
              text: w.text,
              start: w.start ?? 0,
              end: w.end ?? 0,
            })),
            Math.max(2, maxWords)
          );

          const normalizeCaptionText = (text: string) =>
            text
              .replace(/\s+([,.;:!?%])/g, "$1")
              .replace(/\s+'\s+/g, "'")
              .trim();

          for (const phrase of phrases) {
            const text = normalizeCaptionText(phrase.map((w) => w.text).join(" "));
            if (!text.trim()) continue;

            // Apply text case
            let displayText = text;
            if (textCase === "upper") displayText = text.toUpperCase();
            else if (textCase === "lower") displayText = text.toLowerCase();

            const startFrame = Math.max(0, toTimeline(phrase[0].start ?? 0));
            const endFrame = Math.max(startFrame + 1, toTimeline(phrase[phrase.length - 1].end ?? phrase[0].end ?? 1));
            const durationSeconds = Math.max(0.5, (endFrame - startFrame) / fps);

            const captionLayerId = await addLayerCommand(commit, {
              type: "text",
              startTime: startFrame / fps,
              sourceDuration: durationSeconds,
              properties: {
                text: displayText,
                ...captionProps,
              },
            });
            if (captionLayerId) {
              setTrack(commit, captionLayerId, captionTrack);
              const { commands: cmds } = await import("@videoflow/react-video-editor");
              await cmds.setSettingCommand(commit, captionLayerId, "name", displayText.slice(0, 40));
              await cmds.setSettingCommand(commit, captionLayerId, "generatedBy", "add_captions");
              await cmds.setSettingCommand(commit, captionLayerId, "captionKey", captionKey);
              await cmds.setSettingCommand(commit, captionLayerId, "captionTargetId", layer.id);
              await cmds.setSettingCommand(commit, captionLayerId, "captionSource", source);
              await cmds.setSettingCommand(commit, captionLayerId, "captionTrack", captionTrack);
            }
            totalCaptions++;
          }
        }

        refreshPreview();
        logTranscript("info", "add_captions", "done", {
          totalCaptions,
          transcribeErrors,
        });
        if (totalCaptions === 0 && transcribeErrors > 0) {
          const details = transcribeErrorMessages.length > 0
            ? ` Errors: ${transcribeErrorMessages.slice(0, 3).join("; ")}`
            : "";
          return JSON.stringify({ error: `Transcription failed for ${transcribeErrors} clip(s).${details}` });
        }
        return JSON.stringify({ added: totalCaptions, note: `Added ${totalCaptions} captions.` });
      }

      case "remove_words": {
        const words = (input.words as (number | number[])[] | undefined) ?? (input.removals as (number | number[])[] | undefined);
        const matches = (input.matches as string[] | undefined) ?? (input.removalTokens as string[] | undefined);
        const cutAggressiveness = (input.cutAggressiveness as string) ?? "balanced";

        if (!words && !matches) return JSON.stringify({ error: "Provide words (indices) or matches (tokens) to remove" });

        // First, get the transcript to resolve word indices
        const apiKey = (await getSecureApiKey());
        const hasCloudAccess = !!apiKey || useAccountStore.getState().isSignedIn();
        if (!hasCloudAccess) return JSON.stringify({ error: "Qwen API key or Filmidi Pro account required for transcription." });



        const { getCachedTranscript, setCachedTranscript } = await import("./transcriptCache");
        const { planWordCuts, findMatchingWords } = await import("./wordCutPlanner");

        const layers = editor.video.layers ?? [];
        const audioLayers = layers.filter((l: any) => l.type === "video" || l.type === "audio");
        if (audioLayers.length === 0) return JSON.stringify({ error: "No audio/video clips on timeline." });

        // Build word list across all clips
        const allWords: Array<{ clipId: string; text: string; index: number; startFrame: number; endFrame: number; selected: boolean }> = [];
        let globalIndex = 0;

        for (const layer of audioLayers) {
          const source = getLayerSource(layer);
          if (!source) continue;

          let transcript = await getCachedTranscript(source);
          if (!transcript) {
            try {
              transcript = await transcribeAudio(source, apiKey || "");
              await setCachedTranscript(source, transcript);
            } catch { continue; }
          }

          const { startTime: clipStartTime, sourceStart: clipSourceStart, sourceDuration: clipSourceDuration, speed: clipSpeed } = getLayerTiming(layer);
          const effectiveSpeed = Math.max(Math.abs(clipSpeed), MIN_SPEED);
          const clipStartFrame = Math.round(clipStartTime * fps);
          const visibleStart = clipSourceStart;
          const visibleEnd = clipSourceStart + clipSourceDuration;
          const clipEndFrame = clipStartFrame + Math.round((clipSourceDuration / effectiveSpeed) * fps);

          const toTimeline = (sourceSeconds: number) =>
            Math.round(clipStartFrame + (sourceSeconds - visibleStart) * fps / effectiveSpeed);

          for (const word of transcript.words) {
            if (word.start === undefined || word.end === undefined) continue;
            const wordMidSec = (word.start + word.end) / 2;
            if (wordMidSec < visibleStart || wordMidSec > visibleEnd) continue;

            const timelineStart = toTimeline(word.start);
            const timelineEnd = toTimeline(word.end);
            allWords.push({
              clipId: layer.id,
              text: word.text,
              index: globalIndex,
              startFrame: timelineStart,
              endFrame: timelineEnd,
              selected: false,
            });
            globalIndex++;
          }
        }

        // Mark selected words
        if (words) {
          for (const w of words) {
            if (Array.isArray(w)) {
              const [start, end] = w;
              for (const word of allWords) {
                if (word.index >= start && word.index <= end) word.selected = true;
              }
            } else {
              const word = allWords.find((w2) => w2.index === w);
              if (word) word.selected = true;
            }
          }
        }

        if (matches) {
          const matchingIndices = findMatchingWords(
            allWords.map((w) => ({ text: w.text, index: w.index })),
            matches
          );
          for (const idx of matchingIndices) {
            const word = allWords.find((w) => w.index === idx);
            if (word) word.selected = true;
          }
        }

        const selectedCount = allWords.filter((w) => w.selected).length;
        if (selectedCount === 0) return JSON.stringify({ error: "No matching words found.", indicesIgnored: words });

        // Plan cuts per clip
        const removedTexts: string[] = [];
        const removedFrames: string[] = [];
        const tracksEdited = new Set<number>();

        // Group words by clip
        const byClip = new Map<string, typeof allWords>();
        for (const w of allWords) {
          const arr = byClip.get(w.clipId) ?? [];
          arr.push(w);
          byClip.set(w.clipId, arr);
        }

        for (const [clipId, clipWords] of byClip) {
          const liveLayers = useEditorStore.getState().video.layers ?? [];
          const layer = liveLayers.find((l: any) => l.id === clipId);
          if (!layer) continue;
          const { startTime: clipStartTime, sourceDuration: clipSourceDuration, speed: clipSpeed } = getLayerTiming(layer);
          const effectiveSpeed = Math.max(Math.abs(clipSpeed), MIN_SPEED);
          const clipStartFrame = Math.round(clipStartTime * fps);
          const clipEndFrame = clipStartFrame + Math.round((clipSourceDuration / effectiveSpeed) * fps);

          const ranges = planWordCuts(clipWords, fps, clipStartFrame, clipEndFrame, cutAggressiveness);
          if (ranges.length === 0) continue;

          // Execute ripple delete
          for (const range of ranges) {
            const delDuration = (range.endFrame - range.startFrame) / fps;
            // Remove clips fully within range
            const liveBeforeDelete = useEditorStore.getState().video.layers ?? [];
            const inRange = liveBeforeDelete.filter((l: any) => {
              const st = Math.round((l.settings?.startTime ?? 0) * fps);
              const dur = Math.round((l.settings?.sourceDuration ?? 0) * fps);
              return st >= range.startFrame && st + dur <= range.endFrame;
            });
            if (inRange.length > 0) {
              await removeLayersCommand(commit, inRange.map((l: any) => l.id));
            }
            // Shift clips after range left
            const liveAfterDelete = useEditorStore.getState().video.layers ?? [];
            const shifted = liveAfterDelete
              .filter((l: any) => {
                const st = Math.round((l.settings?.startTime ?? 0) * fps);
                return st >= range.endFrame && !inRange.some((r) => r.id === l.id);
              })
              .map((l: any) => ({
                id: l.id,
                startTime: Math.max(0, (l.settings?.startTime ?? 0) - delDuration),
              }));
            if (shifted.length > 0) await moveLayersCommand(commit, shifted);
            tracksEdited.add(layer.track ?? 0);
          }

          for (const w of clipWords.filter((w) => w.selected)) {
            removedTexts.push(w.text);
          }
        }

        refreshPreview();
        return JSON.stringify({
          removedWords: selectedCount,
          removedFrames: removedFrames.length,
          tracksEdited: Array.from(tracksEdited),
          cutAggressiveness,
          transcriptionSource: "cloud",
          note: "Removed and closed the gaps. Re-read get_transcript before another remove_words.",
          removedText: removedTexts.join(" "),
        });
      }

      // ─── LAYOUT ─────────────────────────────────────────────────
      case "apply_layout": {
        const layout = input.layout as string;
        const slots = input.slots as Array<Record<string, unknown>>;
        const trackIndex = normalizeTrackForKind((input.trackIndex as number) ?? VIDEO_TRACK_BASE, "video");
        if (!layout || !slots) return JSON.stringify({ error: "layout and slots required" });

        // Map layout presets to position configurations
        const layoutConfigs: Record<string, Array<{ x: number; y: number; w: number; h: number }>> = {
          sideBySide: [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }],
          pip: [{ x: 0, y: 0, w: 1, h: 1 }, { x: 0.6, y: 0.05, w: 0.35, h: 0.35 }],
          grid2x2: [{ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }],
          threeUp: [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }],
          sidebar: [{ x: 0.25, y: 0, w: 0.75, h: 1 }, { x: 0, y: 0, w: 0.25, h: 1 }],
          center: [{ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }],
          letterbox: [{ x: 0, y: 0.1, w: 1, h: 0.8 }],
        };
        const positions = layoutConfigs[layout] ?? layoutConfigs.sideBySide;

        const mediaStore = useMediaPanelStore.getState();
        const layerIds: string[] = [];
        for (let i = 0; i < Math.min(slots.length, positions.length); i++) {
          const slot = slots[i];
          const pos = positions[i];
          const mediaRef = slot.mediaRef as string;
          const existingClipIds = slot.clipIds as string[] | undefined;
          if (existingClipIds && existingClipIds.length > 0) {
            // Reposition existing clips
            for (const cid of existingClipIds) {
              await setPropertyCommand(commit, cid, "position", [pos.x + pos.w / 2, pos.y + pos.h / 2]);
              await setPropertyCommand(commit, cid, "scale", Math.min(pos.w, pos.h));
              layerIds.push(cid);
            }
          } else if (mediaRef) {
            const asset = mediaStore.assets.find((a) => a.id === mediaRef);
            if (!asset) continue;
            const layerId = await addLayerCommand(commit, {
              type: asset.type === "image" ? "image" : asset.type === "video" ? "video" : "audio",
              source: asset.url,
              sourceDuration: asset.duration ?? 5,
              startTime: 0,
              properties: {
                position: [pos.x + pos.w / 2, pos.y + pos.h / 2],
                scale: Math.min(pos.w, pos.h),
              },
            });
            setTrack(commit, layerId, normalizeTrackForKind(
              trackIndex,
              asset.type === "audio" ? "audio" : "video",
            ));
            layerIds.push(layerId);
          }
        }

        // Add black matte bars for letterbox layout
        if (layout === "letterbox") {
          const barHeight = 0.1;
          const projectDuration = editor.video.duration || 30;
          for (const barPos of [{ y: 0 }, { y: 1 - barHeight }]) {
            const matteId = await addLayerCommand(commit, {
              type: "shape",
              source: "color",
              sourceDuration: projectDuration,
              startTime: 0,
              properties: {
                color: "#000000",
                position: [0.5, barPos.y + barHeight / 2],
                scale: 0.5,
                width: 1,
                height: barHeight,
              },
            });
            if (matteId) layerIds.push(matteId);
          }
        }

        refreshPreview();
        return JSON.stringify({ layout, layersPlaced: layerIds.length, layerIds });
      }

      // ─── COLOR / EFFECTS ────────────────────────────────────────
      case "apply_color": {
        const clipIds = input.clipIds as string[];
        if (!clipIds || clipIds.length === 0) return JSON.stringify({ error: "No clipIds provided" });
        for (const id of clipIds) {
          if (input.brightness !== undefined) await setPropertyCommand(commit, id, "filterBrightness", 1 + (input.brightness as number));
          if (input.contrast !== undefined) await setPropertyCommand(commit, id, "filterContrast", input.contrast as number);
          if (input.saturation !== undefined) await setPropertyCommand(commit, id, "filterSaturate", input.saturation as number);
        }
        refreshPreview();
        return JSON.stringify({ colorApplied: clipIds.length });
      }

      case "apply_effect": {
        const clipIds = input.clipIds as string[];
        const effectName = input.effect as string;
        if (!clipIds || clipIds.length === 0 || !effectName) return JSON.stringify({ error: "clipIds and effect required" });
        for (const id of clipIds) {
          await addEffectCommand(commit, id, effectName);
          if (input.params) {
            const params = input.params as Record<string, unknown>;
            const layers = editor.video.layers ?? [];
            const layer = layers.find((l) => l.id === id);
            if (layer?.effects) {
              const idx = layer.effects.length - 1;
              for (const [k, v] of Object.entries(params)) {
                await setEffectParamCommand(commit, id, idx, k, v);
              }
            }
          }
        }
        refreshPreview();
        return JSON.stringify({ effectApplied: effectName, clipCount: clipIds.length });
      }

      // ─── AUDIO ANALYSIS ─────────────────────────────────────────
      case "detect_beats": {
        const resolved = resolveMediaTarget(input.mediaRef as string | undefined);
        const mediaRef = resolved.mediaRef;
        const startSeconds = input.startSeconds as number | undefined;
        const endSeconds = input.endSeconds as number | undefined;

        const mediaStore = useMediaPanelStore.getState();
        const asset = resolved.asset ?? mediaStore.assets.find((a) => a.id === mediaRef || a.url === resolved.sourceUrl);
        const assetSource = asset?.url ?? resolved.sourceUrl;
        if (!assetSource) return JSON.stringify({ error: `Asset not found: ${mediaRef ?? "selected media"}` });
        if (asset && asset.type !== "video" && asset.type !== "audio") {
          return JSON.stringify({ error: "Beat detection requires audio or video with audio." });
        }

        try {
          const { detectBeats } = await import("./beatDetector");
          const result = await detectBeats(assetSource, startSeconds, endSeconds);
          if (result.beats.length === 0) {
            return JSON.stringify({ mediaRef: mediaRef ?? asset?.id ?? assetSource, beats: [], downbeats: [], bpm: 0, note: "No beats found — the audio may lack rhythmic content." });
          }
          return JSON.stringify({
            mediaRef: mediaRef ?? asset?.id ?? assetSource,
            units: "source seconds — multiply by fps for frame values",
            beats: result.beats.map((b) => Math.round(b * 1000) / 1000),
            downbeats: result.downbeats.map((d) => Math.round(d * 1000) / 1000),
            bpm: result.bpm,
          });
        } catch (e) {
          return JSON.stringify({ error: `Beat detection failed: ${e instanceof Error ? e.message : String(e)}` });
        }
      }
      case "sync_audio": {
        const referenceClipId = input.referenceClipId as string;
        const targetClipId = input.targetClipId as string | undefined;
        const targetClipIds = input.targetClipIds as string[] | undefined;
        const searchWindowSeconds = (input.searchWindowSeconds as number) ?? 30;
        const minConfidence = (input.minConfidence as number) ?? 0.5;

        const layers = editor.video.layers ?? [];
        const refLayer = layers.find((l: any) => l.id === referenceClipId);
        if (!refLayer) return JSON.stringify({ error: `Reference clip not found: ${referenceClipId}` });
        const refSource = getLayerSource(refLayer);
        if (!refSource) return JSON.stringify({ error: "Reference clip has no source." });

        const targets = targetClipId
          ? [targetClipId]
          : targetClipIds ?? [];

        if (targets.length === 0) return JSON.stringify({ error: "No target clips specified." });

        const { syncAudioClips } = await import("./audioSync");
        const synced: Array<{ clipId: string; offsetFrames: number; confidence: number; method: string }> = [];
        const failed: Array<{ clipId: string; reason: string }> = [];

        const refStartFrame = Math.round((refLayer.settings?.startTime ?? 0) * fps);
        const refSpeed = refLayer.settings?.speed ?? 1;

        for (const tId of targets) {
          const targetLayer = layers.find((l: any) => l.id === tId);
          if (!targetLayer) { failed.push({ clipId: tId, reason: "Clip not found" }); continue; }
          const targetSource = getLayerSource(targetLayer);
          if (!targetSource) { failed.push({ clipId: tId, reason: "No source" }); continue; }

          try {
            const result = await syncAudioClips(
              refSource,
              targetSource,
              tId,
              {
                searchWindowSeconds,
                minConfidence,
                referenceStartFrame: refStartFrame,
                referenceSpeed: refSpeed,
                targetStartFrame: Math.round((targetLayer.settings?.startTime ?? 0) * fps),
                fps,
              }
            );

            if (!result) {
              failed.push({ clipId: tId, reason: "Below confidence threshold" });
            } else {
              synced.push(result);
            }
          } catch (e) {
            failed.push({ clipId: tId, reason: e instanceof Error ? e.message : String(e) });
          }
        }

        // Apply sync: move target clips
        if (synced.length > 0) {
          const updates = synced.map((s) => {
            const layer = layers.find((l: any) => l.id === s.clipId);
            const currentStart = layer?.settings?.startTime ?? 0;
            return {
              id: s.clipId,
              startTime: Math.max(0, currentStart + s.offsetFrames / fps),
            };
          });
          await moveLayersCommand(commit, updates);
          refreshPreview();
        }

        return JSON.stringify({
          referenceClipId,
          synced,
          shiftedFrames: synced.reduce((sum, s) => sum + Math.abs(s.offsetFrames), 0),
          failed,
          notes: synced.length > 0 ? ["Track positions updated. Re-read get_timeline for new positions."] : [],
        });
      }
      case "denoise_audio": {
        const clipIds = input.clipIds as string[];
        const enabled = (input.enabled as boolean) ?? true;
        const strength = (input.strength as number) ?? 0.5;
        const mode = (input.mode as string) ?? useSettingsStore.getState().audioProcessingMode ?? "local";

        if (!clipIds || clipIds.length === 0) return JSON.stringify({ error: "No clipIds provided" });

        const layers = editor.video.layers ?? [];

        if (!enabled) {
          // Restore original: remove denoise effect
          for (const clipId of clipIds) {
            const layer = layers.find((l: any) => l.id === clipId);
            if (!layer) continue;
            // Remove audio.denoise effect if present
            const effects = (layer as any).effects ?? [];
            const denoiseIdx = effects.findIndex((e: any) => e.type === "audio.denoise");
            if (denoiseIdx >= 0) {
              commit((draft: any) => {
                const target = draft.layers?.find((x: any) => x.id === clipId);
                if (target?.effects) target.effects.splice(denoiseIdx, 1);
              }, { label: "Remove denoise effect" });
            }
          }
          refreshPreview();
          return JSON.stringify({ notes: ["Denoising disabled. Original audio restored."] });
        }

        // Apply denoise as an effect
        for (const clipId of clipIds) {
          const layer = layers.find((l: any) => l.id === clipId);
          if (!layer) continue;
          if (layer.type !== "audio" && layer.type !== "video") continue;

          // Add denoise effect
          await addEffectCommand(commit, clipId, "audio.denoise");
          // Set strength parameter
          const updatedLayer = editor.video.layers.find((l: any) => l.id === clipId);
          if (updatedLayer?.effects) {
            const idx = updatedLayer.effects.length - 1;
            await setEffectParamCommand(commit, clipId, idx, "amount", strength);
          }
        }

        refreshPreview();
        return JSON.stringify({
          notes: ["Denoise effect applied. Preview will update with denoised audio."],
          clipIds,
          strength,
          mode,
        });
      }

      // ─── MEDIA INTELLIGENCE ─────────────────────────────────────
      case "get_transcript": {
        const clipId = input.clipId as string | undefined;
        const language = input.language as string | undefined;
        const startFrame = input.startFrame as number | undefined;
        const endFrame = input.endFrame as number | undefined;
        const settingsMode = (input.mode as string) ?? useSettingsStore.getState().audioProcessingMode ?? "local";

        // Get clips to transcribe — prefer audio tracks, skip video layers with linked audio
        const { findLinkedPartnerIn } = await import("@/lib/linkUtils");
        const layers = editor.video.layers ?? [];
        let targetLayers = clipId
          ? layers.filter((l: any) => l.id === clipId)
          : layers.filter((l: any) => l.type === "video" || l.type === "audio");
        // When both video+audio linked layers exist, only transcribe the audio layer
        if (!clipId) {
          const audioLayerIds = new Set(
            targetLayers.filter((l: any) => l.type === "audio").map((l: any) => l.id)
          );
          targetLayers = targetLayers.filter((l: any) => {
            if (l.type !== "video") return true;
            const partner = findLinkedPartnerIn(layers, l.id);
            return !partner || !audioLayerIds.has(partner.id);
          });
        }

        if (targetLayers.length === 0) {
          return JSON.stringify({ error: "No audio/video clips found to transcribe." });
        }

        // Get API key or backend status — if either is present, cloud mode is available
        const apiKey = (await getSecureApiKey());
        const hasCloudAccess = !!apiKey || useAccountStore.getState().isSignedIn();
        const mode = hasCloudAccess ? "cloud" : settingsMode;

        if (mode === "local" || !hasCloudAccess) {
          return JSON.stringify({ error: "A Qwen API key or Filmidi Pro account is required for transcription. Add a key in Settings > Agent." });
        }


        logTranscript("info", "get_transcript", "start", {
          clipId: clipId ?? "entire timeline",
          startFrame: startFrame ?? null,
          endFrame: endFrame ?? null,
          language: language ?? null,
        });

        const { getCachedTranscript, setCachedTranscript } = await import("./transcriptCache");

        const allWords: Array<{ clipId: string; trackIndex: number; startFrame: number; endFrame: number; words: Array<[number, string, number, number]> }> = [];
        let globalWordIndex = 0;
        let transcriptionSource = "cloud";

        for (const layer of targetLayers) {
          const source = getLayerSource(layer);
          if (!source) continue;

          // Check cache first
          let transcript = await getCachedTranscript(source, language);
          if (!transcript) {
            // Transcribe via cloud ASR
            try {
              transcript = await transcribeAudio(source, apiKey || "", { language });
              await setCachedTranscript(source, transcript, language);
              logTranscript("info", "get_transcript", "transcribed clip", {
                clipId: layer.id,
                source: source.slice(0, 80),
                wordCount: transcript.words.length,
                segmentCount: transcript.segments.length,
              });
            } catch (e) {
              logTranscript("error", "get_transcript", "transcription failed", {
                clipId: layer.id,
                source: source.slice(0, 80),
                error: e instanceof Error ? e.message : String(e),
              });
              continue; // skip this clip
            }
          } else {
            logTranscript("info", "get_transcript", "cache hit", {
              clipId: layer.id,
              source: source.slice(0, 80),
              wordCount: transcript.words.length,
              segmentCount: transcript.segments.length,
            });
          }

          // Map source seconds to timeline frames
          const { startTime: clipStartTime, sourceStart: clipSourceStart, sourceDuration: clipSourceDuration, speed: clipSpeed } = getLayerTiming(layer);
          const effectiveSpeed = Math.max(Math.abs(clipSpeed), MIN_SPEED);
          const clipStartFrame = Math.round(clipStartTime * fps);
          const visibleStart = clipSourceStart;
          const visibleEnd = clipSourceStart + clipSourceDuration;

          const toTimeline = (sourceSeconds: number): number => {
            return Math.round(clipStartFrame + (sourceSeconds - visibleStart) * fps / effectiveSpeed);
          };

          const clipWords: Array<[number, string, number, number]> = [];
          for (const word of transcript.words) {
            if (word.start === undefined || word.end === undefined) continue;
            const wordMidSec = (word.start + word.end) / 2;
            if (wordMidSec < visibleStart || wordMidSec > visibleEnd) continue;

            const timelineStart = toTimeline(word.start);
            const timelineEnd = toTimeline(word.end);

            // Apply window filter
            if (startFrame !== undefined && timelineEnd < startFrame) continue;
            if (endFrame !== undefined && timelineStart > endFrame) continue;

            clipWords.push([globalWordIndex, word.text, timelineStart, timelineEnd]);
            globalWordIndex++;
          }
          logTranscript("debug", "get_transcript", "clip window", {
            clipId: layer.id,
            sourceStart: visibleStart,
            sourceEnd: visibleEnd,
            clipStartFrame,
            clipEndFrame: clipStartFrame + Math.round((clipSourceDuration / effectiveSpeed) * fps),
            matchedWords: clipWords.length,
            totalWords: transcript.words.length,
          });

          if (clipWords.length > 0) {
            allWords.push({
              clipId: layer.id,
              trackIndex: layer.track ?? 0,
              startFrame: clipStartFrame,
              endFrame: clipStartFrame + Math.round((clipSourceDuration / effectiveSpeed) * fps),
              words: clipWords,
            });
          }
        }

        const totalWords = allWords.reduce((sum, c) => sum + c.words.length, 0);
        const WORD_LIMIT = 10000;
        const capped = totalWords > WORD_LIMIT;

        const response: Record<string, unknown> = {
          fps,
          timing: "projectFrames",
          transcriptionSource,
          wordFormat: ["index", "text", "start", "end"],
          clips: capped ? allWords.map((c) => ({ ...c, words: c.words.slice(0, WORD_LIMIT) })) : allWords,
        };

        if (capped) {
          response.totalWords = totalWords;
          response.wordsNote = `First ${WORD_LIMIT} of ${totalWords} words returned. Use startFrame/endFrame to page.`;
        }

        logTranscript("info", "get_transcript", "done", {
          clipCount: allWords.length,
          totalWords,
          capped,
          transcriptionSource,
        });
        return JSON.stringify(response);
      }
      case "search_web_media": {
        const query = String(input.query ?? "").trim();
        const type = String(input.type ?? "audio") as "audio" | "image" | "video";
        const limit = Math.min(20, Math.max(1, Number(input.limit) || 8));
        if (!query) return JSON.stringify({ error: "query is required" });
        if (!["audio", "image", "video"].includes(type)) {
          return JSON.stringify({ error: "type must be audio, image, or video" });
        }
        try {
          const results = await searchInternetMedia(query, type, limit);
          return JSON.stringify({
            status: "ready",
            query,
            type,
            results,
            note: "Choose a result, import its URL with import_media, then place the returned asset with add_clips. Verify licensing before publishing.",
          });
        } catch (error: any) {
          return JSON.stringify({ error: `Web media search failed: ${error?.message ?? String(error)}` });
        }
      }
      case "search_media": {
        const query = (input.query as string) ?? "";
        const scope = (input.scope as string) ?? "both";
        const mediaRefFilter = input.mediaRef as string | undefined;
        const limit = Math.min((input.limit as number) ?? 10, 50);

        const mediaStore = useMediaPanelStore.getState();
        let assets = mediaStore.assets;
        if (mediaRefFilter) {
          assets = assets.filter((a) => a.id === mediaRefFilter);
        }

        const moments: Array<{ mediaRef: string; name: string; score: number; startSeconds?: number; endSeconds?: number; type: string }> = [];
        const spoken: Array<{ mediaRef: string; name: string; startSeconds: number; endSeconds: number; text: string }> = [];

        if (scope === "visual" || scope === "both") {
          // Visual search: name-based fuzzy matching (SigLIP 2 not available in web)
          const queryLower = query.toLowerCase();
          for (const asset of assets) {
            if (asset.type === "audio") continue; // skip audio-only for visual
            const nameScore = fuzzyMatch(asset.name.toLowerCase(), queryLower);
            if (nameScore > 0.2) {
              moments.push({
                mediaRef: asset.id,
                name: asset.name,
                score: nameScore,
                type: asset.type,
              });
            }
          }
        }

        if (scope === "spoken" || scope === "both") {
          // Spoken search: transcript keyword matching
          const { getCachedTranscript } = await import("./transcriptCache");
          const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);

          for (const asset of assets) {
            if (asset.type !== "video" && asset.type !== "audio") continue;
            if (!asset.url) continue;

            const transcript = await getCachedTranscript(asset.url);
            if (!transcript) continue;

            for (const seg of transcript.segments) {
              const segLower = seg.text.toLowerCase();
              const allMatch = terms.every((t) => segLower.includes(t));
              if (allMatch) {
                spoken.push({
                  mediaRef: asset.id,
                  name: asset.name,
                  startSeconds: seg.start,
                  endSeconds: seg.end,
                  text: seg.text,
                });
              }
            }
          }
        }

        // Sort and limit
        moments.sort((a, b) => b.score - a.score);
        const topMoments = moments.slice(0, limit);
        const topSpoken = spoken.slice(0, limit);

        return JSON.stringify({
          status: "ready",
          indexableAssets: mediaStore.assets.length,
          indexedAssets: mediaStore.assets.length,
          moments: topMoments,
          spoken: topSpoken,
        });
      }

      // ─── MEDIA ORGANIZATION ─────────────────────────────────────
      case "list_folders": {
        const store = useMediaPanelStore.getState();
        const folders = (store as any).folders as Array<Record<string, unknown>> | undefined;
        return JSON.stringify({ folders: folders ?? [] });
      }
      case "create_folder": {
        const name = input.name as string;
        const store = useMediaPanelStore.getState();
        const newFolder = { id: `folder-${Date.now()}`, name, parentFolderId: (input.parentFolderId as string) ?? null };
        store.addFolder(newFolder as any);
        return JSON.stringify({ folderId: newFolder.id, name });
      }
      case "move_to_folder": {
        const assetIds = input.assetIds as string[];
        const folderId = (input.folderId as string) ?? null;
        const store = useMediaPanelStore.getState();
        const updatedAssets = store.assets.map((a) =>
          assetIds.includes(a.id) ? { ...a, folderId } : a
        );
        store.setAssets(updatedAssets as any);
        return JSON.stringify({ moved: assetIds.length, folderId });
      }
      case "rename_media": {
        const mediaRef = input.mediaRef as string;
        const newName = input.name as string;
        const store = useMediaPanelStore.getState();
        const updatedAssets = store.assets.map((a) =>
          a.id === mediaRef ? { ...a, name: newName } : a
        );
        store.setAssets(updatedAssets as any);
        return JSON.stringify({ renamed: mediaRef, name: newName });
      }
      case "rename_folder": {
        const folderId = input.folderId as string;
        const newName = input.name as string;
        const store = useMediaPanelStore.getState();
        const updatedFolders = store.folders.map((f: any) =>
          f.id === folderId ? { ...f, name: newName } : f
        );
        store.setFolders(updatedFolders);
        return JSON.stringify({ renamed: folderId, name: newName });
      }
      case "delete_media": {
        const assetIds = input.assetIds as string[];
        const store = useMediaPanelStore.getState();
        const idSet = new Set(assetIds);
        store.setAssets(store.assets.filter((a) => !idSet.has(a.id)));
        return JSON.stringify({ deleted: assetIds.length });
      }
      case "delete_folder": {
        const folderId = input.folderId as string;
        const store = useMediaPanelStore.getState();
        store.removeFolder(folderId);
        return JSON.stringify({ deleted: folderId });
      }

      case "organize_media": {
        const store = useMediaPanelStore.getState();
        const byType = input.byType !== false;
        const byGenerated = input.byGenerated === true;
        let createdFolders = 0;
        let movedAssets = 0;

        // Ensure type-based folders exist
        const typeFolders: Record<string, string> = {};
        if (byType) {
          for (const folderName of ["Video", "Audio", "Images"]) {
            let folder = store.folders.find((f) => f.name === folderName && !f.parentFolderId);
            if (!folder) {
              const id = `folder-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              store.addFolder({ id, name: folderName, parentFolderId: null });
              folder = { id, name: folderName, parentFolderId: null };
              createdFolders++;
            }
            typeFolders[folderName.toLowerCase()] = folder.id;
          }
        }

        // Move assets to folders
        const updatedAssets = store.assets.map((a) => {
          let targetFolderId = a.folderId;
          if (byType) {
            const typeKey = a.type === "video" ? "video" : a.type === "audio" ? "audio" : "images";
            if (typeFolders[typeKey]) targetFolderId = typeFolders[typeKey];
          }
          if (byGenerated && a.isGenerated) {
            let genFolder = store.folders.find((f) => f.name === "AI Generated" && !f.parentFolderId);
            if (!genFolder) {
              const id = `folder-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              store.addFolder({ id, name: "AI Generated", parentFolderId: null });
              genFolder = { id, name: "AI Generated", parentFolderId: null };
              createdFolders++;
            }
            targetFolderId = genFolder.id;
          }
          if (targetFolderId !== a.folderId) movedAssets++;
          return { ...a, folderId: targetFolderId };
        });
        store.setAssets(updatedAssets as any);
        return JSON.stringify({ createdFolders, movedAssets, note: `Created ${createdFolders} folder(s), moved ${movedAssets} asset(s).` });
      }

      // ─── TAGGING ──────────────────────────────────────────────────
      case "tag_media": {
        const mediaRef = input.mediaRef as string;
        const tags = input.tags as string[];
        const action = input.action as string;
        const store = useMediaPanelStore.getState();
        const updatedAssets = store.assets.map((a) => {
          if (a.id !== mediaRef) return a;
          let newTags = [...(a.tags ?? [])];
          if (action === "add") {
            for (const t of tags) { if (!newTags.includes(t)) newTags.push(t); }
          } else if (action === "remove") {
            newTags = newTags.filter((t) => !tags.includes(t));
          } else if (action === "set") {
            newTags = [...tags];
          }
          return { ...a, tags: newTags };
        });
        store.setAssets(updatedAssets as any);
        return JSON.stringify({ mediaRef, tags: (updatedAssets.find((a: any) => a.id === mediaRef) as any)?.tags ?? [], action });
      }
      case "tag_clip": {
        const clipId = input.clipId as string;
        const tags = input.tags as string[];
        const action = input.action as string;
        const s = useEditorStore.getState();
        const layer = s.video.layers?.find((l: any) => l.id === clipId);
        if (!layer) return JSON.stringify({ error: `Clip not found: ${clipId}` });
        let currentTags: string[] = [];
        try { const raw = (layer.settings as any)?.tags; currentTags = Array.isArray(raw) ? raw : []; } catch {}
        let newTags: string[];
        if (action === "add") {
          newTags = [...currentTags];
          for (const t of tags) { if (!newTags.includes(t)) newTags.push(t); }
        } else if (action === "remove") {
          newTags = currentTags.filter((t) => !tags.includes(t));
        } else {
          newTags = [...tags];
        }
        await setSettingCommand(commit, clipId, "tags", newTags);
        return JSON.stringify({ clipId, tags: newTags, action });
      }
      case "search_by_tag": {
        const searchTags = input.tags as string[];
        const match = (input.match as string) ?? "any";
        const scope = (input.scope as string) ?? "both";
        const result: { mediaAssets: string[]; timelineClips: string[] } = { mediaAssets: [], timelineClips: [] };
        if (scope === "media" || scope === "both") {
          const store = useMediaPanelStore.getState();
          for (const a of store.assets) {
            const assetTags = a.tags ?? [];
            if (match === "all" ? searchTags.every((t) => assetTags.includes(t)) : searchTags.some((t) => assetTags.includes(t))) {
              result.mediaAssets.push(a.id);
            }
          }
        }
        if (scope === "timeline" || scope === "both") {
          const s = useEditorStore.getState();
          for (const l of s.video.layers ?? []) {
            let layerTags: string[] = [];
            try { const raw = (l.settings as any)?.tags; layerTags = Array.isArray(raw) ? raw : []; } catch {}
            if (match === "all" ? searchTags.every((t) => layerTags.includes(t)) : searchTags.some((t) => layerTags.includes(t))) {
              result.timelineClips.push(l.id);
            }
          }
        }
        return JSON.stringify(result);
      }

      // ─── MEDIA IMPORT ───────────────────────────────────────────
      case "import_media": {
        const rawSource = input.source;
        const sourceObject = rawSource && typeof rawSource === "object"
          ? rawSource as Record<string, unknown>
          : null;
        const base64Bytes = sourceObject?.bytes ?? input.bytes;
        const source = typeof rawSource === "string"
          ? rawSource
          : sourceObject
            ? String(sourceObject.url ?? sourceObject.path ?? (base64Bytes ? `data:${String(input.mimeType ?? "application/octet-stream")};base64,${String(base64Bytes)}` : ""))
            : String(input.url ?? input.path ?? (base64Bytes ? `data:${String(input.mimeType ?? "application/octet-stream")};base64,${String(base64Bytes)}` : ""));
        const name = String(input.name ?? "Imported");
        if (!source.trim()) return JSON.stringify({ error: "Provide a URL or local path in source" });

        const url = source.trim();
        const isRemoteUrl = /^https?:\/\//i.test(url) || /^data:/i.test(url) || /^blob:/i.test(url);
        if (!isRemoteUrl && !url.startsWith("/") && !/^file:\/\//i.test(url)) {
          return JSON.stringify({ error: "source must be an http(s) URL, data URL, file URL, or absolute local path" });
        }

        const mediaStore = useMediaPanelStore.getState();
        const addToTimeline = input.addToTimeline === true;
        const placementOptions = {
          startFrame: Number.isFinite(Number(input.startFrame))
            ? Number(input.startFrame)
            : editor.currentFrame,
          durationFrames: Number.isFinite(Number(input.durationFrames))
            ? Number(input.durationFrames)
            : undefined,
          trackIndex: Number.isFinite(Number(input.trackIndex))
            ? Number(input.trackIndex)
            : undefined,
        };
        const existing = mediaStore.assets.find((asset) => asset.url === url);
        if (existing) {
          const timeline = addToTimeline
            ? await placeAssetOnTimeline(commit, existing, fps, placementOptions)
            : null;
          if (timeline) refreshPreview();
          mediaStore.setPanelTab("media");
          mediaStore.showToast(`${existing.name} is already in the media library`, "success");
          return JSON.stringify({
            status: "ready",
            assetId: existing.id,
            name: existing.name,
            type: existing.type,
            url: existing.url,
            alreadyImported: true,
            timeline,
          });
        }

        const type = inferImportedMediaType(url);
        const assetId = `import-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const assetName = importedAssetName(url, name, type);
        const folderId = typeof input.folderId === "string"
          ? input.folderId
          : mediaStore.currentFolderId;
        mediaStore.addAsset({
          id: assetId,
          name: assetName,
          type,
          url,
          duration: type === "image" ? 5 : 10,
          isGenerated: false,
          folderId,
          thumbnailUrl: type === "image" ? url : undefined,
          createdAt: Date.now(),
        });
        mediaStore.setPanelTab("media");
        mediaStore.showToast(`${assetName} imported`, "success");
        const timeline = addToTimeline
          ? await placeAssetOnTimeline(commit, {
              id: assetId,
              name: assetName,
              type,
              url,
              duration: type === "image" ? 5 : 10,
            }, fps, placementOptions)
          : null;
        if (timeline) refreshPreview();

        return JSON.stringify({
          status: "ready",
          assetId,
          name: assetName,
          type,
          url,
          folderId,
          timeline,
          note: timeline
            ? "Asset added to the Media panel and timeline."
            : "Asset added to the Media panel. Use this assetId with add_clips to place it on the timeline.",
        });
      }

      // ─── SHAPE ──────────────────────────────────────────────────
      case "create_matte": {
        const hex = input.hex as string;
        const layerId = await addLayerCommand(commit, {
          type: "shape",
          startTime: 0,
          sourceDuration: editor.video.duration ?? 10,
          properties: {
            fill: hex,
            width: "100%",
            height: "100%",
            position: [0.5, 0.5],
          },
          extraSettings: { shapeType: "rectangle" },
        });
        refreshPreview();
        return JSON.stringify({ layerId, color: hex });
      }

      // ─── AI GENERATION ──────────────────────────────────────────
      case "generate_video":
      case "generate_image":
      case "generate_audio": {
        const apiKey = await getSecureApiKey();
        const hasCloudAccess = !!apiKey || useAccountStore.getState().isSignedIn();
        if (!hasCloudAccess) {
          return JSON.stringify({ error: "No API key configured. Add one in Settings > Agent, or sign in with Google." });
        }

        const prompt = input.prompt as string;
        const model = (input.model as string) || (name === "generate_image" ? "qwen-image-2.0-pro" : "");
        const duration = input.duration as number | undefined;
        const aspectRatio = input.aspectRatio as string | undefined;
        const resolution = input.resolution as string | undefined;
        const voice = input.voice as string | undefined;

        const type = name === "generate_video" ? "video" : name === "generate_image" ? "image" : "audio";

        const params: Record<string, unknown> = {
          prompt,
          model,
          duration,
          aspectRatio,
          resolution,
          voice,
        };

        if (name === "generate_video") {
          params.referenceImageUrls = input.referenceMediaRefs ?? input.referenceImageUrls;
          params.startFrameUrl = input.startFrameMediaRef ?? input.startFrameUrl;
          params.endFrameUrl = input.endFrameMediaRef ?? input.endFrameUrl;
          params.sourceVideoUrl = input.sourceVideoUrl;
          params.negativePrompt = input.negativePrompt;
          params.seed = input.seed;
        }

        if (name === "generate_image") {
          params.referenceImageUrls = input.referenceMediaRefs ?? input.referenceImageUrls;
          params.negativePrompt = input.negativePrompt;
          params.seed = input.seed;
          params.numImages = 1;
        }

        if (name === "generate_audio") {
          params.styleInstructions = input.styleInstructions;
          params.lyrics = input.lyrics;
          params.instrumental = input.instrumental;
          params.videoUrl = input.videoSourceMediaRef as string | undefined;
          params.segments = input.segments as string | undefined;
        }

        try {
          const genResult = await submitGeneration(apiKey || "", type, params as any);

          if (genResult.taskId) {
            const pollResult = await waitForTask(apiKey || "", genResult.taskId);
            if (pollResult.status === "succeeded" && pollResult.resultUrls?.length) {
              const url = pollResult.resultUrls[0];
              // Auto-import to media library
              const mediaStore = useMediaPanelStore.getState();
              const assetId = `gen-${Date.now()}`;
              mediaStore.addAsset({
                id: assetId,
                name: prompt.slice(0, 40).trim(),
                type: type === "video" ? "video" : type === "image" ? "image" : "audio",
                url,
                duration: duration ?? 5,
                isGenerated: true,
                folderId: mediaStore.currentFolderId,
                thumbnailUrl: type === "image" ? url : undefined,
                createdAt: Date.now(),
              });
              return JSON.stringify({
                status: "succeeded",
                resultUrl: url,
                assetId,
                assetName: prompt.slice(0, 40).trim(),
                note: `Generated ${type} added to library as "${prompt.slice(0, 40).trim()}". Use add_clips to place it on the timeline.`,
              });
            }
            return JSON.stringify({
              status: pollResult.status,
              error: pollResult.errorMessage ?? "Generation task failed",
            });
          }

          if (genResult.resultUrl) {
            const url = genResult.resultUrl;
            const mediaStore = useMediaPanelStore.getState();
            const assetId = `gen-${Date.now()}`;
            mediaStore.addAsset({
              id: assetId,
              name: prompt.slice(0, 40).trim(),
              type: type === "video" ? "video" : type === "image" ? "image" : "audio",
              url,
              duration: duration ?? 5,
              isGenerated: true,
              folderId: mediaStore.currentFolderId,
              thumbnailUrl: type === "image" ? url : undefined,
              createdAt: Date.now(),
            });
            return JSON.stringify({
              status: "succeeded",
              resultUrl: url,
              assetId,
              assetName: prompt.slice(0, 40).trim(),
              note: `Generated ${type} added to library as "${prompt.slice(0, 40).trim()}". Use add_clips to place it on the timeline.`,
            });
          }

          return JSON.stringify({ error: "Generation returned no result" });
        } catch (e: any) {
          return JSON.stringify({ error: `Generation failed: ${e.message}` });
        }
      }

      case "cancel_generation": {
        return JSON.stringify({ status: "cancelled", note: "Generation cancellation not implemented yet — the task will complete in the background." });
      }

      case "upscale_media": return JSON.stringify({ error: "Upscaling requires HitPaw backend — not available with direct API key. Sign in with Google to use upscaling." });
      case "list_models": return JSON.stringify({
        models: [
          // Chat — Qwen
          { id: "qwen3.8-max-preview", name: "Qwen 3.8 Max Preview", type: "chat", description: "Newest flagship, preview" },
          { id: "qwen3.7-max", name: "Qwen 3.7 Max", type: "chat", description: "Highest intelligence, best for complex tasks" },
          { id: "qwen3.7-plus", name: "Qwen 3.7 Plus", type: "chat", description: "Balanced performance and speed" },
          { id: "qwen3.6-max-preview", name: "Qwen 3.6 Max Preview", type: "chat", description: "Strong reasoning and coding" },
          { id: "qwen3.6-plus", name: "Qwen 3.6 Plus", type: "chat", description: "Strong reasoning with vision" },
          { id: "qwen3.6-flash", name: "Qwen 3.6 Flash", type: "chat", description: "Fast and cost-effective" },
          { id: "qwen3.5-flash", name: "Qwen 3.5 Flash", type: "chat", description: "Economical, good for simple tasks" },
          // Chat — Third-party on Qwen Cloud
          { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", type: "chat", description: "High-performance reasoning" },
          { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", type: "chat", description: "Fast reasoning" },
          { id: "kimi-k2.7-code", name: "Kimi K2.7 Code", type: "chat", description: "Code-specialized" },
          { id: "glm-5.2", name: "GLM 5.2", type: "chat", description: "General purpose" },
          { id: "minimax-m2.5", name: "MiniMax M2.5", type: "chat", description: "General purpose" },
          // Image
          { id: "qwen-image-2.0-pro", name: "Qwen-Image 2.0 Pro", type: "image", description: "High-quality image generation" },
          { id: "qwen-image-2.0-turbo", name: "Qwen-Image 2.0 Turbo", type: "image", description: "Fast image generation" },
          { id: "wan2.7-image-pro", name: "Wan 2.7 Image Pro", type: "image", description: "High-quality text-to-image" },
          { id: "wan2.6-t2i", name: "Wan 2.6 T2I", type: "image", description: "Efficient text-to-image" },
          { id: "wan2.7-t2v", name: "Wan 2.7 T2V", type: "video", description: "Text-to-video 5s" },
          { id: "wan2.7-i2v", name: "Wan 2.7 I2V", type: "video", description: "Image-to-video 5s" },
          { id: "wan2.7-r2v", name: "Wan 2.7 R2V", type: "video", description: "Reference-to-video 5s" },
          { id: "wan2.7-videoedit", name: "Wan 2.7 Video Edit", type: "video", description: "Video-to-video editing" },
          { id: "happyhorse-1.1-t2v", name: "HappyHorse 1.1 T2V", type: "video", description: "High-quality text-to-video" },
          { id: "happyhorse-1.1-i2v", name: "HappyHorse 1.1 I2V", type: "video", description: "Image-to-video" },
          { id: "happyhorse-1.1-r2v", name: "HappyHorse 1.1 R2V", type: "video", description: "Reference-to-video" },
          { id: "qwen3-tts-flash", name: "Qwen3 TTS Flash", type: "audio", description: "Fast text-to-speech" },
          { id: "qwen3-tts-instruct-flash", name: "Qwen3 TTS Instruct", type: "audio", description: "Instruction-following TTS" },
          { id: "cosyvoice-v3-plus", name: "CosyVoice v3 Plus", type: "audio", description: "High-quality TTS" },
          { id: "cosyvoice-v3-flash", name: "CosyVoice v3 Flash", type: "audio", description: "Fast TTS" },
          { id: "fun-music-v1", name: "FunMusic v1", type: "audio", description: "Music generation" },
          { id: "fun-music-preview", name: "FunMusic Preview", type: "audio", description: "Music generation preview" },
          // Transcription
          { id: "fun-asr", name: "Fun ASR", type: "transcription", description: "Batch file transcription with speaker diarization" },
          { id: "fun-asr-realtime", name: "Fun ASR Realtime", type: "transcription", description: "Real-time ASR with hotwords" },
          { id: "qwen3-asr-flash-realtime", name: "Qwen3 ASR Flash", type: "transcription", description: "Real-time ASR with emotion recognition" },
          { id: "qwen3-asr-flash-filetrans", name: "Qwen3 ASR File", type: "transcription", description: "Batch file transcription" },
          // Upscale
          { id: "hitpaw-upscaler-v2", name: "HitPaw Upscaler v2", type: "upscale", description: "AI upscaling" },
        ],
      });

      // ─── PROJECT ────────────────────────────────────────────────
      case "set_project_settings": {
        const patch: Record<string, unknown> = {};
        if (input.width !== undefined) patch.width = input.width;
        if (input.height !== undefined) patch.height = input.height;
        if (input.fps !== undefined) patch.fps = input.fps;
        if (input.name !== undefined) patch.name = input.name;
        if (Object.keys(patch).length > 0) {
          await setProjectSettingsCommand(commit, patch);
        }
        return JSON.stringify({ updated: Object.keys(patch) });
      }

      case "export_project": {
        const mode = String(input.mode ?? "video");
        const fileName = String(input.fileName ?? editor.video?.name ?? "Untitled");
        const savedFileHandle = useExportStore.getState().savedFileHandle;
        if (mode === "video") {
          const exportStore = useExportStore.getState();
          if (typeof input.codec === "string") exportStore.setCodec(input.codec as any);
          if (typeof input.resolution === "string") exportStore.setResolution(input.resolution as any);
          exportStore.setDestination("video");
          exportStore.open();
          return JSON.stringify({ opened: true, mode, message: "Opened export dialog for video export." });
        }
        if (mode === "xml") {
          const timelineFormat = input.format === "xmeml" ? "xmeml" : "fcpxml";
          const content = getTimelineExportText(editor.video, timelineFormat);
          const ext = timelineFormat === "fcpxml" ? "fcpxml" : "xml";
          const saved = await saveText(content, fileName, ext, "Timeline", "application/xml", savedFileHandle);
          return JSON.stringify(saved
            ? { saved: true, mode, format: timelineFormat, fileName: `${fileName}.${ext}` }
            : { cancelled: true, mode, format: timelineFormat });
        }
        if (mode === "filmidi") {
          const content = await serializeFilmidiPackage();
          const saved = await saveText(content, fileName, "filmidi", "Filmidi Project", "application/json", savedFileHandle);
          return JSON.stringify(saved
            ? { saved: true, mode, fileName: `${fileName}.filmidi` }
            : { cancelled: true, mode });
        }
        return JSON.stringify({ error: `Unsupported export mode: ${mode}` });
      }

      // ─── MULTICAM ───────────────────────────────────────────────
      case "list_multicam_sources": return JSON.stringify({ sources: [], note: "Multicam not yet implemented." });
      case "add_multicam_source": return JSON.stringify({ error: "Multicam not yet implemented." });
      case "remove_multicam_source": return JSON.stringify({ error: "Multicam not yet implemented." });
      case "rename_multicam_source": return JSON.stringify({ error: "Multicam not yet implemented." });
      case "assign_clip_to_source": return JSON.stringify({ error: "Multicam not yet implemented." });

      // ─── UNDO ───────────────────────────────────────────────────
      case "undo": {
        await editor.undo();
        refreshPreview();
        return JSON.stringify({ undone: true });
      }

      // ─── SKILLS / FEEDBACK ─────────────────────────────────────
      case "read_skill": {
        const id = input.id as string;
        return JSON.stringify({ skillId: id, content: null, note: "Skill catalog not yet available." });
      }
      case "send_feedback": {
        const type = input.type as string;
        const summary = input.summary as string;
        const toolName = input.toolName as string;
        console.log(`[Agent Feedback] ${type}: ${summary}${toolName ? ` (tool: ${toolName})` : ""}`);
        return JSON.stringify({ sent: true });
      }

      // ─── PROJECT NAVIGATION ─────────────────────────────────────
      case "save_project": {
        const { useAgentStore } = await import("@/store/useAgentStore");
        const projectStore = useProjectStore.getState();
        const saveStore = useProjectSaveStore.getState();
        const projectId = projectStore.currentProjectId;
        if (!projectId) return JSON.stringify({ error: "No active project to save." });
        const currentProject = projectStore.projects.find((p) => p.id === projectId);
        const timeline = editor.video;
        await dbSaveProject({
          id: projectId,
          name: currentProject?.name ?? timeline.name ?? "Untitled Project",
          width: timeline.width ?? currentProject?.width ?? 1920,
          height: timeline.height ?? currentProject?.height ?? 1080,
          fps: timeline.fps ?? currentProject?.fps ?? 30,
        });
        await saveStore.saveProject({
          timeline,
          mediaManifest: {
            assets: useMediaPanelStore.getState().assets,
            folders: useMediaPanelStore.getState().folders,
          },
          generationLog: useGenerationStore.getState().history,
          chatHistory: useAgentStore.getState().sessions,
        });
        return JSON.stringify({ saved: projectId });
      }
      case "save_project_as": {
        const { useAgentStore } = await import("@/store/useAgentStore");
        const projectStore = useProjectStore.getState();
        const saveStore = useProjectSaveStore.getState();
        const currentId = projectStore.currentProjectId;
        if (!currentId) return JSON.stringify({ error: "No active project to duplicate." });
        const current = projectStore.projects.find((p) => p.id === currentId);
        const baseName = current?.name ?? editor.video?.name ?? "Untitled Project";
        const name = String(input.name ?? `${baseName} Copy`).trim() || `${baseName} Copy`;
        const timeline = editor.video;
        const newId = projectStore.addProject(name, {
          width: timeline.width ?? current?.width ?? 1920,
          height: timeline.height ?? current?.height ?? 1080,
          fps: timeline.fps ?? current?.fps ?? 30,
        }, { select: false });
        await saveStore.importProject(newId, {
          timeline,
          mediaManifest: {
            assets: useMediaPanelStore.getState().assets,
            folders: useMediaPanelStore.getState().folders,
          },
          generationLog: useGenerationStore.getState().history,
          chatHistory: useAgentStore.getState().sessions,
        });
        projectStore.openProject(newId);
        return JSON.stringify({ savedAs: newId, name });
      }
      case "get_projects": {
        const projects = useProjectStore.getState().projects;
        return JSON.stringify({ projects });
      }
      case "open_project": {
        const id = String(input.projectId ?? input.id ?? "");
        const path = String(input.path ?? "");
        if (id) {
          useProjectStore.getState().openProject(id);
          return JSON.stringify({ opened: id });
        }
        if (path) {
          return JSON.stringify({ error: "Path-based project opening is not supported in this build. Use projectId from get_projects." });
        }
        return JSON.stringify({ error: "projectId or path is required" });
      }
      case "new_project": {
        const name = String(input.name ?? "Untitled Project");
        const id = useProjectStore.getState().addProject(name, {
          width: Number(input.width ?? editor.video.width ?? 1920),
          height: Number(input.height ?? editor.video.height ?? 1080),
          fps: Number(input.fps ?? editor.video.fps ?? 30),
        });
        return JSON.stringify({ created: id, name });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ error: msg });
  }
}
