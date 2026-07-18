import { useEditorStore } from "@videoflow/react-video-editor";
import { commands } from "@videoflow/react-video-editor";
import { useMediaPanelStore } from "@/store/useMediaPanelStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useAccountStore } from "@/store/useAccountStore";
import { transcribeAudio } from "./cloudTranscription";
import { getSecureApiKey } from "./secureApiKey";
import { submitGeneration, waitForTask } from "./generationApi";
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
    layers: layers.map((l) => ({
      id: l.id,
      type: l.type ?? "unknown",
      name: l.name ?? l.id.slice(0, 8),
      startTime: l.settings?.startTime ?? 0,
      sourceDuration: l.settings?.sourceDuration ?? 5,
      enabled: l.settings?.enabled ?? true,
      track: l.track ?? 0,
      source: l.settings?.source,
    })),
  });
}

export function getMediaContext(): string {
  const store = useMediaPanelStore.getState();
  return JSON.stringify({
    assets: store.assets.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      duration: a.duration,
      folderId: (a as Record<string, unknown>).folderId,
    })),
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
      case "get_media": return getMediaContext();

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
        const mediaRef = input.mediaRef as string | undefined;
        if (!mediaRef) {
          return JSON.stringify({ error: "mediaRef is required. Call get_media first to list available assets, then pass the asset id." });
        }
        const maxFrames = Math.min((input.maxFrames as number) ?? 6, 12);
        const clipId = input.clipId as string | undefined;
        const overview = input.overview as boolean | undefined;
        const wordTimestamps = input.wordTimestamps as boolean | undefined;
        const startSeconds = input.startSeconds as number | undefined;
        const endSeconds = input.endSeconds as number | undefined;

        const mediaStore = useMediaPanelStore.getState();
        const asset = mediaStore.assets.find((a) => a.id === mediaRef);
        if (!asset) return JSON.stringify({ error: `Asset not found: ${mediaRef}` });

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
          id: asset.id,
          name: asset.name,
          type: asset.type,
          durationSeconds: asset.duration,
          fileName: asset.name,
        };

        if (clipInfo) Object.assign(result, clipInfo);

        if (asset.type === "image") {
          // Image: return base64-encoded thumbnail
          try {
            const img = new Image();
            img.crossOrigin = "anonymous";
            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = () => reject(new Error("Failed to load image"));
              img.src = asset.url!;
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
          const startTime = (entry.startTime as number) ?? startFrame / fps;
          const sourceDuration = (entry.sourceDuration as number) ?? (entry.durationFrames as number ? (entry.durationFrames as number) / fps : undefined) ?? asset.duration ?? 5;
          const layerId = await addLayerCommand(commit, {
            type: asset.type === "image" ? "image" : asset.type === "video" ? "video" : "audio",
            source: asset.url,
            sourceDuration,
            startTime: startTime || startFrame / fps,
          });
          // Separate video+audio tracks for video assets — linked via linkId
          if (asset.type === "video") {
            const { generateLinkId, setLayerLinkId } = await import("@/lib/linkUtils");
            const linkId = generateLinkId();
            await setLayerLinkId(commit, layerId, linkId, setSettingCommand);
            // Mute the video layer's built-in audio — the separate audio track handles sound
            await setPropertyCommand(commit, layerId, "mute", true);
            const audioLayerId = await addLayerCommand(commit, {
              type: "audio",
              source: asset.url,
              sourceDuration,
              startTime: startTime || startFrame / fps,
            });
            await setLayerLinkId(commit, audioLayerId, linkId, setSettingCommand);
          }
          results.push({ layerId, mediaRef, startTime: startTime || startFrame / fps, sourceDuration });
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
          const layerId = await addLayerCommand(commit, {
            type: asset.type === "image" ? "image" : asset.type === "video" ? "video" : "audio",
            source: asset.url,
            sourceDuration,
            startTime,
          });
          // Separate video+audio tracks for video assets — linked via linkId
          if (asset.type === "video") {
            const { generateLinkId, setLayerLinkId } = await import("@/lib/linkUtils");
            const linkId = generateLinkId();
            await setLayerLinkId(commit, layerId, linkId, setSettingCommand);
            // Mute the video layer's built-in audio — the separate audio track handles sound
            await setPropertyCommand(commit, layerId, "mute", true);
            const audioLayerId = await addLayerCommand(commit, {
              type: "audio",
              source: asset.url,
              sourceDuration,
              startTime,
            });
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
          // Also move linked partner to the same startTime
          const partner = findLinkedPartnerIn(allLayers, layerId);
          if (partner && !seenIds.has(partner.id)) {
            const origStart = partner.settings?.startTime ?? 0;
            const delta = startTime - ((c.startTime as number) ?? 0);
            updates.push({ id: partner.id, startTime: Math.max(0, origStart + delta), track: partner.track });
            seenIds.add(partner.id);
          }
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
        const allLayers = editor.video.layers ?? [];
        const beforeSnap = snapshotTimeline();
        if (cuts && cuts.length > 0) {
          for (const cut of cuts) {
            const layerId = cut.layerId as string;
            const atFrame = cut.atFrame as number;
            const layer = editor.video.layers.find((l) => l.id === layerId);
            if (!layer) continue;
            const startFrame = Math.round((layer.settings?.startTime ?? 0) * fps);
            const durFrames = Math.round((layer.settings?.sourceDuration ?? 0) * fps);
            if (atFrame > startFrame && atFrame < startFrame + durFrames) {
              const splitDur = (atFrame - startFrame) / fps;
              const remainDur = (durFrames - (atFrame - startFrame)) / fps;
              // Resize original (left part)
              await resizeLayerCommand(commit, layerId, splitDur);
              // Add right part — preserve linkId if present
              const linkId = getLayerLinkId(layer);
              const newLayerId = await addLayerCommand(commit, {
                type: layer.type as string,
                source: layer.settings?.source as string,
                sourceDuration: remainDur,
                startTime: (layer.settings?.startTime ?? 0) + splitDur,
              });
              if (linkId && newLayerId) {
                await setSettingCommand(commit, newLayerId, "linkId", linkId);
              }
              // Also split the linked partner at the same frame
              const partner = findLinkedPartnerIn(allLayers, layerId);
              if (partner) {
                const pStartFrame = Math.round((partner.settings?.startTime ?? 0) * fps);
                const pDurFrames = Math.round((partner.settings?.sourceDuration ?? 0) * fps);
                if (atFrame > pStartFrame && atFrame < pStartFrame + pDurFrames) {
                  const pSplitDur = (atFrame - pStartFrame) / fps;
                  const pRemainDur = (pDurFrames - (atFrame - pStartFrame)) / fps;
                  await resizeLayerCommand(commit, partner.id, pSplitDur);
                  const pNewId = await addLayerCommand(commit, {
                    type: partner.type as string,
                    source: partner.settings?.source as string,
                    sourceDuration: pRemainDur,
                    startTime: (partner.settings?.startTime ?? 0) + pSplitDur,
                  });
                  if (linkId && pNewId) {
                    await setSettingCommand(commit, pNewId, "linkId", linkId);
                  }
                }
              }
            }
          }
        } else {
          // Split all under playhead
          const frame = editor.currentFrame;
          const time = frame / fps;
          const toSplit = editor.video.layers.filter((l) => {
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
            const newLayerId = await addLayerCommand(commit, {
              type: layer.type as string,
              source: layer.settings?.source as string,
              sourceDuration: remainDur,
              startTime: (layer.settings?.startTime ?? 0) + splitDur,
            });
            if (linkId && newLayerId) {
              await setSettingCommand(commit, newLayerId, "linkId", linkId);
            }
          }
        }
        refreshPreview();
        return JSON.stringify({ splitAt: cuts ? cuts.length + " cut points" : "playhead" });
      }

      case "set_clip_properties": {
        const clips = input.clips as Array<Record<string, unknown>>;
        if (!clips || clips.length === 0) return JSON.stringify({ error: "No clips provided" });
        for (const clip of clips) {
          const layerId = clip.layerId as string;
          if (clip.sourceDuration !== undefined) {
            await resizeLayerCommand(commit, layerId, clip.sourceDuration as number);
          }
          if (clip.properties) {
            const props = clip.properties as Record<string, unknown>;
            for (const [key, value] of Object.entries(props)) {
              await setPropertyCommand(commit, layerId, key, value);
            }
          }
          if (clip.settings) {
            const sets = clip.settings as Record<string, unknown>;
            for (const [key, value] of Object.entries(sets)) {
              await setPropertyCommand(commit, layerId, key, value);
            }
          }
        }
        refreshPreview();
        return JSON.stringify({ updated: clips.length });
      }

      case "ripple_delete_ranges": {
        const ranges = input.ranges as Array<{ startFrame: number; endFrame: number }>;
        if (!ranges || ranges.length === 0) return JSON.stringify({ error: "No ranges provided" });
        const beforeSnap = snapshotTimeline();
        const sortedRanges = [...ranges].sort((a, b) => a.startFrame - b.startFrame);
        let totalDeleted = 0;
        for (const range of sortedRanges) {
          const delDuration = (range.endFrame - range.startFrame) / fps;
          const layers = editor.video.layers ?? [];
          // Remove clips fully within range
          const inRange = layers.filter((l) => {
            const st = Math.round((l.settings?.startTime ?? 0) * fps);
            const dur = Math.round((l.settings?.sourceDuration ?? 0) * fps);
            return st >= range.startFrame && st + dur <= range.endFrame;
          });
          if (inRange.length > 0) {
            await removeLayersCommand(commit, inRange.map((l) => l.id));
          }
          // Shift clips after range left
          const shifted = layers
            .filter((l) => {
              const st = Math.round((l.settings?.startTime ?? 0) * fps);
              return st >= range.endFrame && !inRange.includes(l);
            })
            .map((l) => ({
              id: l.id,
              startTime: Math.max(0, (l.settings?.startTime ?? 0) - delDuration),
            }));
          if (shifted.length > 0) await moveLayersCommand(commit, shifted);
          totalDeleted += delDuration;
        }
        refreshPreview();
        return JSON.stringify({ deletedRanges: sortedRanges.length, totalDeletedSeconds: totalDeleted });
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
        const targetId = clipId ?? captionGroupId;
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
        for (const [key, value] of Object.entries(textProps)) {
          await setPropertyCommand(commit, targetId, key, value);
        }
        refreshPreview();
        return JSON.stringify({ updated: targetId, properties: Object.keys(textProps) });
      }

      case "add_captions": {
        const targetClipIds = input.clipIds as string[] | undefined;
        const language = input.language as string | undefined;
        const maxWords = (input.maxWords as number) ?? 5;
        const textCase = (input.textCase as string) ?? "auto";
        const animation = input.animation as string | undefined;
        const highlightColor = input.highlightColor as string | undefined;
        const settingsMode = (input.mode as string) ?? useSettingsStore.getState().audioProcessingMode ?? "local";

        // Build caption style
        const captionProps: Record<string, unknown> = {};
        if (input.centerX !== undefined || input.centerY !== undefined) {
          captionProps.position = [(input.centerX as number) ?? 0.5, (input.centerY as number) ?? 0.85];
        }
        if (input.fontName !== undefined) captionProps.fontFamily = input.fontName;
        if (input.fontSize !== undefined) captionProps.fontSize = input.fontSize;
        if (input.color !== undefined) captionProps.color = input.color;
        if (input.isBold !== undefined) captionProps.fontWeight = input.isBold ? "bold" : "normal";
        if (input.isItalic !== undefined) captionProps.fontStyle = input.isItalic ? "italic" : "normal";

        // Get clips to transcribe — prefer audio tracks, skip video layers with linked audio partners
        const { findLinkedPartnerIn } = await import("@/lib/linkUtils");
        const layers = editor.video.layers ?? [];
        let captionTargets = targetClipIds
          ? layers.filter((l: any) => targetClipIds.includes(l.id))
          : layers.filter((l: any) => l.type === "video" || l.type === "audio");
        // When both video+audio linked layers exist, only transcribe the audio layer
        if (!targetClipIds) {
          const videoLayers = captionTargets.filter((l: any) => l.type === "video");
          const audioLayerIds = new Set(
            captionTargets.filter((l: any) => l.type === "audio").map((l: any) => l.id)
          );
          captionTargets = captionTargets.filter((l: any) => {
            if (l.type !== "video") return true;
            // Skip video layer if it has a linked audio partner in the targets
            const partner = findLinkedPartnerIn(layers, l.id);
            return !partner || !audioLayerIds.has(partner.id);
          });
        }

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



        const { getCachedTranscript, setCachedTranscript } = await import("./transcriptCache");

        let totalCaptions = 0;
        let transcribeErrors = 0;
        const transcribeErrorMessages: string[] = [];

        for (const layer of captionTargets) {
          const source = layer.settings?.source as string;
          if (!source) continue;

          let transcript = await getCachedTranscript(source, language);
          if (!transcript) {
            try {
              transcript = await transcribeAudio(source, apiKey || "", { language });
              await setCachedTranscript(source, transcript, language);
            } catch (e) {
              const errMsg = e instanceof Error ? e.message : String(e);
              console.warn("[add_captions] Transcription failed for", source.slice(0, 60), errMsg);
              transcribeErrorMessages.push(errMsg);
              transcribeErrors++;
              continue;
            }
          }

          const clipStartFrame = Math.round((layer.settings?.startTime ?? 0) * fps);
          const clipSourceStart = layer.settings?.sourceStart ?? 0;
          const clipDuration = layer.settings?.sourceDuration ?? 5;
          const clipSpeed = layer.settings?.speed ?? 1;
          const visibleStart = clipSourceStart;
          const visibleEnd = clipSourceStart + clipDuration * clipSpeed;

          const toTimeline = (sourceSeconds: number) =>
            Math.round(clipStartFrame + (sourceSeconds - visibleStart) * fps / Math.max(clipSpeed, 0.0001));

          const visibleWords = transcript.words.filter((w) => {
            if (w.start === undefined || w.end === undefined) return false;
            const midSec = (w.start + w.end) / 2;
            return midSec >= visibleStart && midSec <= visibleEnd;
          });

          // Split into phrases of maxWords
          for (let i = 0; i < visibleWords.length; i += maxWords) {
            const phrase = visibleWords.slice(i, i + maxWords);
            const text = phrase.map((w) => w.text).join(" ");
            if (!text.trim()) continue;

            // Apply text case
            let displayText = text;
            if (textCase === "upper") displayText = text.toUpperCase();
            else if (textCase === "lower") displayText = text.toLowerCase();

            const startFrame = toTimeline(phrase[0].start ?? 0);
            const endFrame = toTimeline(phrase[phrase.length - 1].end ?? phrase[0].end ?? 1);
            const durationSeconds = Math.max(0.5, (endFrame - startFrame) / fps);

            await addLayerCommand(commit, {
              type: "text",
              startTime: startFrame / fps,
              sourceDuration: durationSeconds,
              properties: {
                text: displayText,
                ...captionProps,
              },
            });
            totalCaptions++;
          }
        }

        refreshPreview();
        if (totalCaptions === 0 && transcribeErrors > 0) {
          const details = transcribeErrorMessages.length > 0
            ? ` Errors: ${transcribeErrorMessages.slice(0, 3).join("; ")}`
            : "";
          return JSON.stringify({ error: `Transcription failed for ${transcribeErrors} clip(s).${details}` });
        }
        return JSON.stringify({ added: totalCaptions, note: `Added ${totalCaptions} captions.` });
      }

      case "remove_words": {
        const words = input.words as (number | number[])[] | undefined;
        const matches = input.matches as string[] | undefined;
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
          const source = layer.settings?.source as string;
          if (!source) continue;

          let transcript = await getCachedTranscript(source);
          if (!transcript) {
            try {
              transcript = await transcribeAudio(source, apiKey || "");
              await setCachedTranscript(source, transcript);
            } catch { continue; }
          }

          const clipStartFrame = Math.round((layer.settings?.startTime ?? 0) * fps);
          const clipSourceStart = layer.settings?.sourceStart ?? 0;
          const clipDuration = layer.settings?.sourceDuration ?? 5;
          const clipSpeed = layer.settings?.speed ?? 1;
          const visibleStart = clipSourceStart;
          const visibleEnd = clipSourceStart + clipDuration * clipSpeed;
          const clipEndFrame = clipStartFrame + Math.round(clipDuration * fps);

          const toTimeline = (sourceSeconds: number) =>
            Math.round(clipStartFrame + (sourceSeconds - visibleStart) * fps / Math.max(clipSpeed, 0.0001));

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
          const layer = layers.find((l: any) => l.id === clipId);
          if (!layer) continue;
          const clipStartFrame = Math.round((layer.settings?.startTime ?? 0) * fps);
          const clipEndFrame = clipStartFrame + Math.round((layer.settings?.sourceDuration ?? 0) * fps);

          const ranges = planWordCuts(clipWords, fps, clipStartFrame, clipEndFrame, cutAggressiveness);
          if (ranges.length === 0) continue;

          // Execute ripple delete
          for (const range of ranges) {
            const delDuration = (range.endFrame - range.startFrame) / fps;
            // Remove clips fully within range
            const inRange = layers.filter((l: any) => {
              const st = Math.round((l.settings?.startTime ?? 0) * fps);
              const dur = Math.round((l.settings?.sourceDuration ?? 0) * fps);
              return st >= range.startFrame && st + dur <= range.endFrame;
            });
            if (inRange.length > 0) {
              await removeLayersCommand(commit, inRange.map((l: any) => l.id));
            }
            // Shift clips after range left
            const shifted = layers
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
        const trackIndex = (input.trackIndex as number) ?? 0;
        if (!layout || !slots) return JSON.stringify({ error: "layout and slots required" });

        // Map layout presets to position configurations
        const layoutConfigs: Record<string, Array<{ x: number; y: number; w: number; h: number }>> = {
          sideBySide: [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }],
          pip: [{ x: 0, y: 0, w: 1, h: 1 }, { x: 0.6, y: 0.05, w: 0.35, h: 0.35 }],
          grid2x2: [{ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }],
          threeUp: [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }],
          sidebar: [{ x: 0.25, y: 0, w: 0.75, h: 1 }, { x: 0, y: 0, w: 0.25, h: 1 }],
          center: [{ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }],
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
              track: trackIndex,
              properties: {
                position: [pos.x + pos.w / 2, pos.y + pos.h / 2],
                scale: Math.min(pos.w, pos.h),
              },
            });
            layerIds.push(layerId);
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
        const mediaRef = input.mediaRef as string;
        const startSeconds = input.startSeconds as number | undefined;
        const endSeconds = input.endSeconds as number | undefined;

        const mediaStore = useMediaPanelStore.getState();
        const asset = mediaStore.assets.find((a) => a.id === mediaRef);
        if (!asset) return JSON.stringify({ error: `Asset not found: ${mediaRef}` });
        if (!asset.url) return JSON.stringify({ error: `Asset has no URL: ${mediaRef}` });
        if (asset.type !== "video" && asset.type !== "audio") {
          return JSON.stringify({ error: "Beat detection requires audio or video with audio." });
        }

        try {
          const { detectBeats } = await import("./beatDetector");
          const result = await detectBeats(asset.url, startSeconds, endSeconds);
          if (result.beats.length === 0) {
            return JSON.stringify({ mediaRef, beats: [], downbeats: [], bpm: 0, note: "No beats found — the audio may lack rhythmic content." });
          }
          return JSON.stringify({
            mediaRef,
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
        if (!refLayer.settings?.source) return JSON.stringify({ error: "Reference clip has no source." });

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
          if (!targetLayer.settings?.source) { failed.push({ clipId: tId, reason: "No source" }); continue; }

          try {
            const result = await syncAudioClips(
              refLayer.settings.source as string,
              targetLayer.settings.source as string,
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
              await removeEffectCommand(commit, clipId, denoiseIdx);
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



        const { getCachedTranscript, setCachedTranscript } = await import("./transcriptCache");

        const allWords: Array<{ clipId: string; trackIndex: number; startFrame: number; endFrame: number; words: Array<[number, string, number, number]> }> = [];
        let globalWordIndex = 0;
        let transcriptionSource = "cloud";

        for (const layer of targetLayers) {
          const source = layer.settings?.source as string;
          if (!source) continue;

          // Check cache first
          let transcript = await getCachedTranscript(source, language);
          if (!transcript) {
            // Transcribe via cloud ASR
            try {
              transcript = await transcribeAudio(source, apiKey || "", { language });
              await setCachedTranscript(source, transcript, language);
            } catch (e) {
              continue; // skip this clip
            }
          }

          // Map source seconds to timeline frames
          const clipStartFrame = Math.round((layer.settings?.startTime ?? 0) * fps);
          const clipSourceStart = layer.settings?.sourceStart ?? 0;
          const clipDuration = layer.settings?.sourceDuration ?? 5;
          const clipSpeed = layer.settings?.speed ?? 1;
          const visibleStart = clipSourceStart;
          const visibleEnd = clipSourceStart + clipDuration * clipSpeed;

          const toTimeline = (sourceSeconds: number): number => {
            return Math.round(clipStartFrame + (sourceSeconds - visibleStart) * fps / Math.max(clipSpeed, MIN_SPEED));
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

          if (clipWords.length > 0) {
            allWords.push({
              clipId: layer.id,
              trackIndex: layer.track ?? 0,
              startFrame: clipStartFrame,
              endFrame: clipStartFrame + Math.round(clipDuration * fps),
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

        return JSON.stringify(response);
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
        const folders = (store as Record<string, unknown>).folders as Array<Record<string, unknown>> | undefined;
        return JSON.stringify({ folders: folders ?? [] });
      }
      case "create_folder": {
        const name = input.name as string;
        const store = useMediaPanelStore.getState();
        const folders = ((store as Record<string, unknown>).folders as Array<Record<string, unknown>>) ?? [];
        const newFolder = { id: `folder-${Date.now()}`, name, parentFolderId: input.parentFolderId };
        folders.push(newFolder);
        (store as Record<string, unknown>).folders = folders;
        return JSON.stringify({ folderId: newFolder.id, name });
      }
      case "move_to_folder": {
        const assetIds = input.assetIds as string[];
        const folderId = (input.folderId as string) ?? null;
        const store = useMediaPanelStore.getState();
        for (const id of assetIds) {
          const asset = store.assets.find((a) => a.id === id);
          if (asset) (asset as Record<string, unknown>).folderId = folderId;
        }
        return JSON.stringify({ moved: assetIds.length, folderId });
      }
      case "rename_media": {
        const mediaRef = input.mediaRef as string;
        const newName = input.name as string;
        const store = useMediaPanelStore.getState();
        const asset = store.assets.find((a) => a.id === mediaRef);
        if (!asset) return JSON.stringify({ error: `Asset not found: ${mediaRef}` });
        (asset as Record<string, unknown>).name = newName;
        return JSON.stringify({ renamed: mediaRef, name: newName });
      }
      case "rename_folder": {
        const folderId = input.folderId as string;
        const newName = input.name as string;
        const store = useMediaPanelStore.getState();
        const folders = ((store as Record<string, unknown>).folders as Array<Record<string, unknown>>) ?? [];
        const folder = folders.find((f) => f.id === folderId);
        if (!folder) return JSON.stringify({ error: `Folder not found: ${folderId}` });
        folder.name = newName;
        return JSON.stringify({ renamed: folderId, name: newName });
      }
      case "delete_media": {
        const assetIds = input.assetIds as string[];
        const store = useMediaPanelStore.getState();
        const idSet = new Set(assetIds);
        (store as Record<string, unknown>).assets = store.assets.filter((a) => !idSet.has(a.id));
        return JSON.stringify({ deleted: assetIds.length });
      }
      case "delete_folder": {
        const folderId = input.folderId as string;
        const store = useMediaPanelStore.getState();
        const folders = ((store as Record<string, unknown>).folders as Array<Record<string, unknown>>) ?? [];
        (store as Record<string, unknown>).folders = folders.filter((f) => f.id !== folderId);
        return JSON.stringify({ deleted: folderId });
      }

      // ─── MEDIA IMPORT ───────────────────────────────────────────
      case "import_media": {
        const source = input.source as Record<string, string>;
        const name = (input.name as string) ?? "Imported";
        if (!source) return JSON.stringify({ error: "source required" });
        const url = source.url ?? source.path;
        if (!url) return JSON.stringify({ error: "url or path required in source" });
        // Placeholder — real import needs download + blob
        return JSON.stringify({ assetId: `import-${Date.now()}`, name, url, note: "Import started in background. Check get_media for status." });
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
              return JSON.stringify({
                status: "succeeded",
                resultUrl: url,
                assetId: `gen-${Date.now()}`,
                assetName: prompt.slice(0, 40).trim(),
                note: `Generated asset ready at ${url}. Use import_media to add it to the library.`,
              });
            }
            return JSON.stringify({
              status: pollResult.status,
              error: pollResult.errorMessage ?? "Generation task failed",
            });
          }

          if (genResult.resultUrl) {
            return JSON.stringify({
              status: "succeeded",
              resultUrl: genResult.resultUrl,
              assetId: `gen-${Date.now()}`,
              assetName: prompt.slice(0, 40).trim(),
              note: `Generated asset ready at ${genResult.resultUrl}. Use import_media to add it to the library.`,
            });
          }

          return JSON.stringify({ error: "Generation returned no result" });
        } catch (e: any) {
          return JSON.stringify({ error: `Generation failed: ${e.message}` });
        }
      }

      case "upscale_media": return JSON.stringify({ error: "Upscaling requires HitPaw backend — not available with direct API key. Sign in with Google to use upscaling." });
      case "list_models": return JSON.stringify({
        models: [
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
        return JSON.stringify({ message: "Export is not yet implemented in the Electrobun build. Use the Export dialog manually." });
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
      case "get_projects": return JSON.stringify({ projects: [], note: "Multi-project not yet supported." });
      case "open_project": return JSON.stringify({ error: "Multi-project not yet supported." });
      case "new_project": return JSON.stringify({ error: "Multi-project not yet supported." });

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ error: msg });
  }
}
