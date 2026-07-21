import { useMemo, useRef, useCallback, useEffect, useState } from "react";
import {
  useEditor,
  useActiveLayers,
  useSelection,
  usePlayhead,
  useEditorStore,
  commands,
  layerTimelineBounds,
  sourceTimeToTimelineTime,
  timeToFrame,
  frameToTime,
  formatTime,
  computeMagnets,
  snapTime,
  DEFAULT_SNAP_PIXELS,
  createLayerJSON,
  type LayerJSON,
  type Magnet,
} from "@videoflow/react-video-editor";
import { getLayerLinkId, findLinkedPartnerIn } from "@/lib/linkUtils";
import {
  AUDIO_TRACK_BASE,
  VIDEO_TRACK_BASE,
  clampMoveToTrack,
  clampTimeDeltaToFreeSpace,
  getTimelineTrackKind,
  localTrackForKind,
  normalizeTrackForKind,
  wouldOverlap,
  type TimelineTrackKind,
} from "@/lib/timelineMove";
import { useAppStore } from "@/store/useAppStore";
import { Lock, Unlock } from "lucide-react";
import "./CustomTimeline.css";

const PADDING_RIGHT = 800;
const HEADER_WIDTH = 180;
const RULER_HEIGHT = 26;
const MIN_SCALE = 20;
const MAX_SCALE = 2000;
// Keep long-form timelines responsive. The time model remains unbounded; this
// only limits the rendered pixel surface and therefore the browser DOM size.
const MAX_TIMELINE_WIDTH = 4_000_000;

type DragMoveItem = {
  id: string;
  startTime: number;
  track: number;
  kind: TimelineTrackKind;
  duration: number;
};

type DragMoveState = {
  pointerId: number;
  pointerTarget: HTMLElement;
  primaryId: string;
  ids: string[];
  initial: Map<string, DragMoveItem>;
  startClientX: number;
  startClientY: number;
  lastClientX: number;
  lastClientY: number;
};

type DragPreview = { timeDelta: number; trackDelta: number };

// ─── Tick generation ─────────────────────────────────────────
function niceStep(rawStep: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  if (norm <= 1.5) return mag;
  if (norm <= 3.5) return 2 * mag;
  if (norm <= 7.5) return 5 * mag;
  return 10 * mag;
}

function generateTicks(duration: number, scale: number) {
  const rawMinor = 40 / scale;
  // Bound ruler DOM work for long-form projects at high zoom.
  const maxTickCount = 1200;
  const durationInterval = duration > 0 ? duration / maxTickCount : rawMinor;
  const minorInterval = Math.max(niceStep(rawMinor), niceStep(durationInterval));
  const majorInterval = minorInterval * 5;
  const ticks: Array<{ time: number; major: boolean }> = [];
  for (let t = 0; t <= duration + minorInterval; t += minorInterval) {
    const major = Math.abs(t % majorInterval) < minorInterval * 0.5;
    ticks.push({ time: t, major });
  }
  return ticks;
}

// ─── Layer display name (same logic as VideoFlow) ────────────
function getDisplayName(layer: LayerJSON): string {
  if (layer.settings.name) return layer.settings.name;
  const source = layer.settings.source;
  if (typeof source === "string" && source) {
    // Extract filename from URL/path
    const parts = source.split("/");
    return decodeURIComponent(parts[parts.length - 1]) || layer.type;
  }
  if (layer.type === "text" && layer.properties?.text) {
    return String(layer.properties.text).slice(0, 32);
  }
  return layer.type;
}

// ─── Track header component ───────────────────────────────────
function TrackHeader({
  trackIdx,
  trackName,
  trackType,
  enabled,
  muted,
  soloed,
  onRename,
  onToggleEnabled,
  onToggleMute,
  onToggleSolo,
  locked,
  onToggleLock,
}: {
  trackIdx: number;
  trackName: string;
  trackType: "video" | "audio" | "other";
  enabled: boolean;
  muted?: boolean;
  soloed?: boolean;
  onRename: (name: string) => void;
  onToggleEnabled: () => void;
  onToggleMute?: () => void;
  onToggleSolo?: () => void;
  locked?: boolean;
  onToggleLock?: () => void;
}) {
  const typeColor = trackType === "video" ? "#4A90E2" : trackType === "audio" ? "#4CAF50" : "#9B59B6";
  const typeIcon = trackType === "video" ? "V" : trackType === "audio" ? "A" : "T";

  return (
    <div
      className="ct-track-header"
      data-disabled={!enabled || undefined}
      style={{ borderLeftColor: typeColor }}
    >
      <div className="ct-track-header-badge" style={{ background: typeColor }}>
        {typeIcon}{trackIdx + 1}
      </div>
      <div className="ct-track-header-label">
        <input
          type="text"
          value={trackName}
          onChange={(e) => onRename(e.target.value)}
          aria-label={`Track ${trackIdx + 1} name`}
        />
      </div>
      <div className="ct-track-header-toggles">
        <button
          data-variant="icon"
          data-active={locked ? "true" : "false"}
          onClick={onToggleLock}
          title={locked ? "Unlock track" : "Lock track"}
        >
          {locked ? <Lock size={12} /> : <Unlock size={12} />}
        </button>
        {trackType === "audio" && (
          <button
            data-variant="icon"
            data-active={soloed ? "true" : "false"}
            onClick={onToggleSolo}
            title={soloed ? "Unsolo track" : "Solo track"}
            className="ct-track-header-solo"
          >
            S
          </button>
        )}
        <button
          data-variant="icon"
          data-active={muted ? "true" : "false"}
          onClick={onToggleMute}
          title={muted ? "Unmute track" : "Mute track"}
        >
          {muted ? "🔇" : trackType === "audio" ? "🔊" : "👁"}
        </button>
        <button
          data-variant="icon"
          data-active={enabled ? "true" : "false"}
          onClick={onToggleEnabled}
          title={enabled ? "Disable track" : "Enable track"}
        >
          {enabled ? "👁" : "👁‍🗨"}
        </button>
      </div>
    </div>
  );
}

// ─── Clip component ───────────────────────────────────────────
function TimelineClip({
  layer,
  scale,
  isSelected,
  groupOffset,
  onPointerDown,
  onHandlePointerDown,
  onDoubleClick,
  onContextMenu,
  preview,
  trackHeight,
}: {
  layer: LayerJSON;
  scale: number;
  isSelected: boolean;
  groupOffset: number;
  onPointerDown: (e: React.PointerEvent, layer: LayerJSON) => void;
  onHandlePointerDown: (e: React.PointerEvent, layer: LayerJSON, edge: "start" | "end") => void;
  onDoubleClick: (e: React.MouseEvent, layer: LayerJSON) => void;
  onContextMenu: (e: React.MouseEvent, layer: LayerJSON) => void;
  preview?: DragPreview;
  trackHeight: number;
}) {
  const bounds = layerTimelineBounds(layer);
  const start = bounds.start - groupOffset;
  const end = bounds.end - groupOffset;
  const left = start * scale;
  const width = Math.max(6, (end - start) * scale);
  const linkId = getLayerLinkId(layer);
  const hasLink = !!linkId;
  const isLocked = (layer.settings as any)?.locked === true;
  const isAudio = layer.type === "audio";
  const isVideo = layer.type === "video";
  const showThumbnail = (isVideo || layer.type === "image") && width > 60;
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  // Lazy-load thumbnail from first frame
  useEffect(() => {
    if (!showThumbnail) return;
    const source = layer.settings?.source as string;
    if (!source) return;
    let cancelled = false;
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.src = source;
    video.onloadeddata = () => {
      if (cancelled) return;
      video.currentTime = Math.min(video.duration || 0, (layer.settings?.sourceStart ?? 0) + 0.1);
    };
    video.onseeked = () => {
      if (cancelled) return;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 160;
      canvas.height = video.videoHeight || 90;
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      setThumbnailUrl(canvas.toDataURL("image/jpeg", 0.5));
      video.remove();
    };
    video.onerror = () => { video.remove(); };
    return () => { cancelled = true; video.remove(); };
  }, [layer.id, layer.settings?.source, layer.settings?.sourceStart, showThumbnail]);

  return (
    <div
      className="ct-clip"
      data-selected={isSelected || undefined}
      data-type={layer.type}
      data-linked={hasLink || undefined}
      data-locked={isLocked || undefined}
      data-disabled={!layer.settings.enabled || undefined}
      style={{
        left,
        width,
        transform: preview
          ? `translate(${preview.timeDelta * scale}px, ${-preview.trackDelta * trackHeight}px)`
          : undefined,
        zIndex: preview ? 20 : undefined,
      }}
      onPointerDown={(e) => onPointerDown(e, layer)}
      onDoubleClick={(e) => onDoubleClick(e, layer)}
      onContextMenu={(e) => onContextMenu(e, layer)}
    >
      <div
        className="ct-clip-handle"
        data-edge="start"
        onPointerDown={(e) => {
          e.stopPropagation();
          onHandlePointerDown(e, layer, "start");
        }}
      />
      {showThumbnail && thumbnailUrl && (
        <div
          className="ct-clip-thumb"
          style={{ backgroundImage: `url(${thumbnailUrl})` }}
        />
      )}
      <div className="ct-clip-label">
        {isLocked && <span className="ct-clip-lock-icon">🔒</span>}
        {hasLink && <span className="ct-chain-icon">🔗</span>}
        <span
          className="ct-clip-type-badge"
          style={{
            background: isVideo
              ? "rgba(74, 144, 226, 0.3)"
              : isAudio
                ? "rgba(76, 175, 80, 0.3)"
                : "rgba(255,255,255,0.08)",
          }}
        >
          {layer.type}
        </span>
        <span className="ct-clip-name">{getDisplayName(layer)}</span>
      </div>
      {/* Keyframes */}
      {layer.animations && layer.animations.length > 0 && (
        <div className="ct-clip-keyframes">
          {layer.animations.flatMap((anim) =>
            anim.keyframes.map((kf, i) => {
              const localTime =
                sourceTimeToTimelineTime(layer, kf.time) - bounds.start;
              return (
                <span
                  key={`${anim.property}-${i}`}
                  className="ct-clip-keyframe"
                  style={{ left: localTime * scale }}
                  title={`${anim.property} @ ${kf.time.toFixed(2)}s`}
                >
                  ◆
                </span>
              );
            }),
          )}
        </div>
      )}
      {/* Transitions */}
      {layer.transitionIn && (
        <div
          className="ct-clip-transition"
          data-edge="start"
          style={{
            width: Math.min(
              layer.transitionIn.duration * scale,
              width / 2,
            ),
          }}
        >
          <div className="ct-transition-handle" />
        </div>
      )}
      {layer.transitionOut && (
        <div
          className="ct-clip-transition"
          data-edge="end"
          style={{
            width: Math.min(
              layer.transitionOut.duration * scale,
              width / 2,
            ),
          }}
        >
          <div className="ct-transition-handle" />
        </div>
      )}
      <div
        className="ct-clip-handle"
        data-edge="end"
        onPointerDown={(e) => {
          e.stopPropagation();
          onHandlePointerDown(e, layer, "end");
        }}
      />
    </div>
  );
}

// ─── Main Custom Timeline ─────────────────────────────────────
export function CustomTimeline({ onContextMenuTarget }: { onContextMenuTarget?: (target: "clip" | "empty") => void }) {
  const video = useEditor((s) => s.video);
  const selection = useEditor((s) => s.selection);
  const viewport = useEditor((s) => s.viewport);
  const setViewport = useEditor((s) => s.setViewport);
  const bridge = useEditor((s) => s.bridge);
  const currentFrame = useEditor((s) => s.currentFrame);
  const commit = useEditor((s) => s.commit);
  const activeGroupPath = useEditor((s) => s.activeGroupPath);
  const enterGroup = useEditor((s) => s.enterGroup);
  const layers = useActiveLayers();
  const activeGroup = useEditor((s) => s.activeGroupPath);

  const bodyRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const scrollLeftRef = useRef(0);
  const [snapGuideTime, setSnapGuideTime] = useState<number | null>(null);
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number } | null>(null);
  const [markers, setMarkers] = useState<Array<{ time: number; label: string }>>([]);
  const [dragPreview, setDragPreview] = useState<Map<string, DragPreview>>(new Map());
  const dragPreviewRef = useRef<Map<string, DragPreview>>(new Map());
  const dragMoveStateRef = useRef<DragMoveState | null>(null);
  const dragMoveRafRef = useRef<number | null>(null);
  const lastSnapGuideRef = useRef<number | null>(null);

  const { fps, duration: videoDuration } = video;
  const requestedScale = viewport.timelineScale;
  const isPlaying = useEditor((s) => s.isPlaying);
  const trackHeight = useAppStore((s) => s.trackHeight);

  // Group offset for nested group editing
  const groupOffset = useMemo(() => {
    let offset = 0;
    // activeGroupPath is the chain of ancestor groups
    // We need to read from the store directly since useActiveGroupChain isn't imported
    const state = useEditorStore.getState();
    const chain = state.activeGroupPath ?? [];
    // For simplicity, offset is 0 at root level
    return offset;
  }, [activeGroupPath]);

  // VideoFlow normally maintains video.duration, but older imported projects
  // can have a stale value. Always include the furthest layer edge so a long
  // source is never clipped by the ruler or drag clamps.
  const layerContentDuration = useMemo(() => {
    return (video.layers ?? []).reduce((max, layer) => {
      const bounds = layerTimelineBounds(layer);
      return Math.max(max, Number.isFinite(bounds.end) ? bounds.end : 0);
    }, 0);
  }, [video.layers]);

  // Available duration inside current group
  const availableDuration = useMemo(() => {
    if (activeGroupPath && activeGroupPath.length > 0) {
      // Inside a group — find the active group layer
      const allLayers = video.layers ?? [];
      let groupLayer: LayerJSON | undefined;
      for (const id of activeGroupPath) {
        const found = (groupLayer ? groupLayer.children : allLayers)?.find(
          (l) => l.id === id,
        );
        if (!found) break;
        groupLayer = found as LayerJSON;
      }
      const groupDuration = groupLayer?.settings?.sourceDuration ?? videoDuration;
      return Math.max(groupDuration, layerContentDuration);
    }
    return Math.max(videoDuration, layerContentDuration);
  }, [video, activeGroupPath, videoDuration, layerContentDuration]);

  // A 2-hour clip at a highly zoomed-in scale can otherwise create a multi-
  // million-pixel layout and make pointer events appear to freeze. Reduce the
  // display scale only in that pathological case; all clip times stay exact.
  const scale = Math.min(
    requestedScale,
    availableDuration > 0 ? MAX_TIMELINE_WIDTH / availableDuration : requestedScale,
  );

  // Track metadata
  const trackMeta = useMemo(() => {
    return video.tracks ?? [];
  }, [video.tracks]);

  // Audio and visual layers use separate track bands. An empty project starts
  // with one video lane; typed lanes appear as media is added.
  const timelineTrackCounts = (video as any).timelineTrackCounts ?? {};
  const { audioRows, videoRows } = useMemo(() => {
    const hasAudio = layers.some((layer) => layer.type === "audio");
    const hasVideo = layers.some((layer) => layer.type !== "audio");
    const maxAudioTrack = layers.reduce((max, layer) => {
      if (layer.type !== "audio") return max;
      return Math.max(max, localTrackForKind(layer.track, "audio"));
    }, 0);
    const maxVideoTrack = layers.reduce((max, layer) => {
      if (layer.type === "audio") return max;
      return Math.max(max, localTrackForKind(layer.track, "video"));
    }, 0);
    // Track metadata can contain sparse/legacy entries (for example, assigning
    // a video clip to virtual track 10 used to materialize tracks 0..10).
    // Rows are a view of actual clip placement, so empty metadata must not
    // create visible tracks.
    const requestedAudioCount = Number(timelineTrackCounts.audio) || 0;
    const requestedVideoCount = Number(timelineTrackCounts.video) || 0;
    const audioCount = hasAudio
      ? Math.max(maxAudioTrack + 1, requestedAudioCount)
      : requestedAudioCount;
    const videoCount = hasVideo
      ? Math.max(maxVideoTrack + 1, requestedVideoCount)
      : hasAudio
        ? requestedVideoCount
        : Math.max(1, requestedVideoCount);
    const makeRows = (kind: TimelineTrackKind, count: number) => Array.from({ length: count }, (_, localIdx) => {
      const trackIdx = (kind === "audio" ? AUDIO_TRACK_BASE : VIDEO_TRACK_BASE) + localIdx;
      return {
        trackIdx,
        kind,
        layers: layers
          .filter((layer) => getTimelineTrackKind(layer) === kind)
          .filter((layer) => localTrackForKind(layer.track, kind) === localIdx)
          .sort((a, b) => (a.settings.startTime ?? 0) - (b.settings.startTime ?? 0)),
      };
    });
    return {
      audioRows: makeRows("audio", audioCount),
      videoRows: makeRows("video", videoCount),
    };
  }, [layers, trackMeta.length, timelineTrackCounts.audio, timelineTrackCounts.video]);


  // Repair timelines created by the previous mixed-track drag behavior. This
  // runs only when a layer is outside its typed band.
  useEffect(() => {
    const repairs = layers
      .map((layer) => ({
        id: layer.id,
        track: normalizeTrackForKind(layer.track, getTimelineTrackKind(layer)),
      }))
      .filter((repair, index) => repair.track !== layers[index]?.track);
    if (repairs.length === 0) return;
    void commit((draft: any) => {
      for (const repair of repairs) {
        const layer = draft.layers?.find((candidate: any) => candidate.id === repair.id);
        if (layer) layer.track = repair.track;
      }
    }, { label: "Repair typed track assignments" });
  }, [layers, commit]);

  // Ticks
  const ticks = useMemo(
    () => generateTicks(availableDuration, scale),
    [availableDuration, scale],
  );

  // Playhead
  const playheadTime = currentFrame / fps - groupOffset;
  const playheadLeft = playheadTime * scale;

  // Total scrollable width
  const totalWidth = Math.max(
    200,
    availableDuration * scale + PADDING_RIGHT,
  );

  // ─── Scroll sync ─────────────────────────────────────────────
  const handleScroll = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    scrollLeftRef.current = body.scrollLeft;
    // Sync ruler position
    if (rulerRef.current) {
      rulerRef.current.style.transform = `translateX(${-body.scrollLeft}px)`;
    }
  }, []);

  // ─── Zoom (Cmd+wheel) ────────────────────────────────────────
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();

      const body = bodyRef.current;
      if (!body) return;

      const headerWidth = HEADER_WIDTH;
      const mouseX = e.clientX - body.getBoundingClientRect().left;
      const scrollLeft = body.scrollLeft;
      const timeUnderCursor = (mouseX - headerWidth + scrollLeft) / scale;

      const factor = e.deltaY > 0 ? 1 / 1.1 : 1.1;
      const newScale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, scale * factor),
      );
      const newScroll = Math.max(
        0,
        timeUnderCursor * newScale - (mouseX - headerWidth),
      );

      setViewport({
        timelineScale: newScale,
        timelineScroll: newScroll,
      });

      // Apply scroll
      requestAnimationFrame(() => {
        if (bodyRef.current) {
          bodyRef.current.scrollLeft = newScroll;
          handleScroll();
        }
      });
    },
    [scale, setViewport, handleScroll],
  );

  // ─── Auto-scroll during playback ─────────────────────────────
  useEffect(() => {
    if (!isPlaying) return;
    const body = bodyRef.current;
    if (!body) return;
    const headerWidth = HEADER_WIDTH;
    const bodyWidth = body.clientWidth - headerWidth;
    const playheadPx = playheadTime * scale;
    const scrollLeft = body.scrollLeft;
    const margin = 40;

    if (playheadPx > scrollLeft + bodyWidth - margin) {
      body.scrollLeft = playheadPx - bodyWidth + margin;
    } else if (playheadPx < scrollLeft + margin) {
      body.scrollLeft = Math.max(0, playheadPx - margin);
    }
    handleScroll();
  }, [currentFrame, isPlaying, playheadTime, scale, handleScroll]);

  // ─── Ruler scrubbing ─────────────────────────────────────────
  const isScrubbingRef = useRef(false);

  const handleRulerPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const body = bodyRef.current;
      if (!body || !bridge) return;

      // M+click on ruler places a marker at that position
      if ((window as any).__markerMode) {
        const rect = body.getBoundingClientRect();
        const x = e.clientX - rect.left + body.scrollLeft - HEADER_WIDTH;
        const time = Math.max(0, Math.min(availableDuration, x / scale));
        const label = prompt("Marker label:", `Marker ${markers.length + 1}`);
        if (label !== null) {
          setMarkers((prev) => [...prev, { time, label }].sort((a, b) => a.time - b.time));
        }
        return;
      }

      // Shift+drag on ruler creates a time selection range
      if (e.shiftKey) {
        const startRange = (e: PointerEvent) => {
          const rect = body.getBoundingClientRect();
          const x = e.clientX - rect.left + body.scrollLeft - HEADER_WIDTH;
          return Math.max(0, Math.min(availableDuration, x / scale));
        };
        const rangeStart = startRange(e.nativeEvent);
        setSelectionRange({ start: rangeStart, end: rangeStart });
        const onMove = (ev: PointerEvent) => {
          const rangeEnd = startRange(ev);
          setSelectionRange({ start: Math.min(rangeStart, rangeEnd), end: Math.max(rangeStart, rangeEnd) });
        };
        const onUp = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        return;
      }

      // Normal ruler scrub
      isScrubbingRef.current = true;
      setSelectionRange(null); // Clear range on normal click

      const seekFromEvent = (ev: PointerEvent) => {
        const rect = body.getBoundingClientRect();
        const x = ev.clientX - rect.left + body.scrollLeft - HEADER_WIDTH;
        const time = Math.max(0, Math.min(availableDuration, x / scale));
        const frame = timeToFrame(time + groupOffset, fps);
        useEditorStore.getState().setCurrentFrame(frame);
        bridge.seek(frame);
      };

      seekFromEvent(e.nativeEvent);

      const onMove = (ev: PointerEvent) => {
        if (!isScrubbingRef.current) return;
        seekFromEvent(ev);
      };
      const onUp = () => {
        isScrubbingRef.current = false;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [bridge, fps, scale, availableDuration, groupOffset],
  );

  // ─── Click on empty track space → deselect + seek playhead ──
  const handleTracksPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const target = e.target as HTMLElement;
      const isTrack = target === tracksRef.current || target.classList.contains("ct-track-row");
      if (!isTrack) return;

      useEditorStore.getState().clearSelection();

      // Seek playhead to click position
      if (!bodyRef.current || !bridge) return;
      const rect = bodyRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left + bodyRef.current.scrollLeft - HEADER_WIDTH;
      const time = Math.max(0, Math.min(availableDuration, x / scale));
      const frame = timeToFrame(time + groupOffset, fps);
      useEditorStore.getState().setCurrentFrame(frame);
      bridge.seek(frame);

      // Drag to scrub
      const onMove = (ev: PointerEvent) => {
        const mx = ev.clientX - rect.left + bodyRef.current!.scrollLeft - HEADER_WIDTH;
        const mt = Math.max(0, Math.min(availableDuration, mx / scale));
        const mf = timeToFrame(mt + groupOffset, fps);
        useEditorStore.getState().setCurrentFrame(mf);
        bridge?.seek(mf);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [bridge, fps, scale, availableDuration, groupOffset],
  );

  const trackAtPointer = useCallback((clientX: number, clientY: number, kind: TimelineTrackKind): number | null => {
    const tracks = tracksRef.current;
    if (!tracks) return null;
    const rows = Array.from(
      tracks.querySelectorAll<HTMLElement>(`.ct-track-row[data-track-kind="${kind}"]`),
    );
    if (rows.length === 0) return null;
    const hovered = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>(".ct-track-row");
    if (
      hovered?.dataset.trackKind === kind &&
      hovered.dataset.trackIndex &&
      hovered.dataset.disabled !== "true"
    ) {
      return Number(hovered.dataset.trackIndex);
    }
    let nearest: { track: number; distance: number } | null = null;
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      const distance = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
      const track = Number(row.dataset.trackIndex);
      if (row.dataset.disabled === "true") continue;
      if (Number.isFinite(track) && (!nearest || distance < nearest.distance)) {
        nearest = { track, distance };
      }
    }
    return nearest?.track ?? null;
  }, []);

  // ─── Clip selection — also handles razor/blade tool ──────────
  const handleClipPointerDown = useCallback(
    (e: React.PointerEvent, layer: LayerJSON) => {
      e.stopPropagation();
      e.preventDefault();

      // Block interaction on locked clips
      if ((layer.settings as any)?.locked) return;
      if ((video.tracks?.[layer.track ?? 0] as any)?.locked) return;

      // Razor/blade tool: split clip at click position
      const toolMode = useAppStore.getState().toolMode;
      if (toolMode === "razor") {
        const bounds = layerTimelineBounds(layer);
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const clickTime = (e.clientX - rect.left) / scale + bounds.start;
        const frame = Math.round(clickTime * fps);
        const startFrame = Math.round(bounds.start * fps);
        const endFrame = Math.round(bounds.end * fps);
        if (frame > startFrame + 1 && frame < endFrame - 1) {
          const splitDur = (frame - startFrame) / fps;
          const remainDur = (endFrame - frame) / fps;
          const linkId = getLayerLinkId(layer);
          const rightLinkId = linkId ? `${linkId}-r-${Date.now()}` : "";
          const partner = findLinkedPartnerIn(video.layers ?? [], layer.id);
          const razorEditor = useEditorStore.getState();
          // Single commit for atomic undo
          const commitData: any = {
            primary: { id: layer.id, splitDur, remainDur, startTime: bounds.start + splitDur },
            partner: partner ? {
              id: partner.id,
              pBounds: layerTimelineBounds(partner),
              pSplitDur: frame / fps - layerTimelineBounds(partner).start,
              pRemainDur: layerTimelineBounds(partner).end - frame / fps,
              pStartTime: layerTimelineBounds(partner).start + (frame / fps - layerTimelineBounds(partner).start),
            } : null,
            rightLinkId,
            type: layer.type,
            source: layer.settings?.source as string,
            partnerType: partner?.type,
            partnerSource: partner?.settings?.source as string,
          };
          // Use a single commit to do all mutations atomically
          razorEditor.commit((draft: any) => {
            // Resize primary
            const pri = draft.layers?.find((x: any) => x.id === commitData.primary.id);
            if (pri) pri.settings.sourceDuration = commitData.primary.splitDur;
            // Add the right part while preserving source position and clip attributes.
            const newLayer = {
              ...createLayerJSON({
                ...layer,
                type: commitData.type,
                source: commitData.source,
                sourceDuration: commitData.primary.remainDur,
                startTime: commitData.primary.startTime,
                properties: layer.properties,
              } as any),
              ...JSON.parse(JSON.stringify(layer)),
              id: `split-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              track: layer.track ?? 0,
              settings: {
                ...JSON.parse(JSON.stringify(layer.settings)),
                startTime: commitData.primary.startTime,
                sourceStart: (layer.settings.sourceStart ?? 0) + commitData.primary.splitDur * Math.abs(layer.settings.speed ?? 1),
                sourceDuration: commitData.primary.remainDur,
                ...(commitData.rightLinkId ? { linkId: commitData.rightLinkId } : {}),
              },
            };
            draft.layers?.push(newLayer);
            // Handle partner
            if (commitData.partner) {
              const part = draft.layers?.find((x: any) => x.id === commitData.partner.id);
              if (part) part.settings.sourceDuration = commitData.partner.pSplitDur;
              const pNew = {
                ...JSON.parse(JSON.stringify(partner)),
                id: `split-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                track: partner.track ?? 0,
                settings: {
                  ...JSON.parse(JSON.stringify(partner.settings)),
                  startTime: commitData.partner.pStartTime,
                  sourceStart: (partner.settings.sourceStart ?? 0) + (frame / fps - layerTimelineBounds(partner).start) * Math.abs(partner.settings.speed ?? 1),
                  sourceDuration: commitData.partner.pRemainDur,
                  ...(commitData.rightLinkId ? { linkId: commitData.rightLinkId } : {}),
                },
              };
              draft.layers?.push(pNew);
            }
          }, { label: "Razor split" });
        }
        return;
      }

      const editor = useEditorStore.getState();
      const isSelected = selection.layerIds.includes(layer.id);

      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        editor.toggleLayerSelection(layer.id, true);
      } else if (!isSelected) {
        editor.selectLayers([layer.id]);
      }

      // Start drag detection
      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const pointerId = e.pointerId;
      const pointerTarget = e.currentTarget as HTMLElement;
      try {
        pointerTarget.setPointerCapture(pointerId);
      } catch {}

      // Store initial positions of all selected layers + their linked partners
      const selectedIds = (e.shiftKey || e.metaKey || e.ctrlKey || isSelected)
        ? useEditorStore.getState().selection.layerIds
        : [layer.id];

      // Expand selection to include linked partners from the live store. The
      // render snapshot can be stale immediately after a linked pair is added.
      const allLayers = useEditorStore.getState().video.layers ?? [];
      const moveIds = new Set<string>(selectedIds);
      for (const id of selectedIds) {
        const partner = findLinkedPartnerIn(allLayers, id);
        if (partner) moveIds.add(partner.id);
      }
      const moveIdArray = Array.from(moveIds);

      const initialPositions = new Map<string, DragMoveItem>();
      for (const id of moveIdArray) {
        const l = allLayers.find((x) => x.id === id);
        if (l) {
          const kind = getTimelineTrackKind(l);
          initialPositions.set(id, {
            id,
            startTime: l.settings.startTime ?? 0,
            track: normalizeTrackForKind(l.track, kind),
            kind,
            duration: layerTimelineBounds(l).end - layerTimelineBounds(l).start,
          });
        }
      }
      const moveItemsForCommit = moveIdArray
        .map((id) => initialPositions.get(id))
        .filter((item): item is DragMoveItem => !!item);

      dragMoveStateRef.current = {
        pointerId,
        pointerTarget,
        primaryId: layer.id,
        ids: moveIdArray,
        initial: initialPositions,
        startClientX,
        startClientY,
        lastClientX: startClientX,
        lastClientY: startClientY,
      };

      const setSnapGuide = (time: number | null) => {
        if (lastSnapGuideRef.current === time) return;
        lastSnapGuideRef.current = time;
        setSnapGuideTime(time);
      };

      const previewMove = (timeDelta: number, trackDelta: number) => {
        const next = new Map<string, DragPreview>();
        for (const id of moveIdArray) next.set(id, { timeDelta, trackDelta });
        dragPreviewRef.current = next;
        setDragPreview(next);
      };

      const runDragMove = () => {
        const drag = dragMoveStateRef.current;
        if (!drag || drag.pointerId !== pointerId) return;

        const liveEditor = useEditorStore.getState();
        const liveLayers = liveEditor.video.layers ?? [];
        const fpsNow = liveEditor.video.fps || fps;
        const currentPlayheadTime = liveEditor.currentFrame / fpsNow - groupOffset;
        const snapEnabled = useAppStore.getState().snapEnabled;
        const dx = drag.lastClientX - drag.startClientX;
        const primary = drag.initial.get(drag.primaryId);
        if (!primary) return;

        const magnets = snapEnabled
          ? computeMagnets(liveLayers, new Set(drag.ids), currentPlayheadTime)
          : [];

        const primaryDesired = primary.startTime + dx / scale;
        let primaryDelta = primaryDesired - primary.startTime;
        if (snapEnabled) {
          const snap = snapTime(primaryDesired, magnets, scale, DEFAULT_SNAP_PIXELS);
          if (snap) {
            primaryDelta = snap.time - primary.startTime;
            setSnapGuide(snap.time);
          } else {
            setSnapGuide(null);
          }
        } else {
          setSnapGuide(null);
        }

        const targetTrack = trackAtPointer(drag.lastClientX, drag.lastClientY, primary.kind);
        if (targetTrack === null) return;
        const trackDelta =
          localTrackForKind(targetTrack, primary.kind) - localTrackForKind(primary.track, primary.kind);

        const moveItems = drag.ids
          .map((id) => drag.initial.get(id))
          .filter((item): item is DragMoveItem => !!item);
        const selectedSet = new Set(drag.ids);
        const fits = (timeDelta: number, deltaTrack: number) =>
          moveItems.every((item) => {
            const nextTrack = normalizeTrackForKind(item.track + deltaTrack, item.kind);
            const nextStart = Math.max(0, item.startTime + timeDelta);
            return !wouldOverlap(liveLayers, nextTrack, nextStart, item.duration, selectedSet);
          });

        const timeOnly = primaryDelta;
        const trackOnly = trackDelta;
        if (fits(timeOnly, trackOnly)) {
          previewMove(timeOnly, trackOnly);
          return;
        }
        if (trackOnly !== 0 && fits(0, trackOnly)) {
          previewMove(0, trackOnly);
          return;
        }
        if (fits(timeOnly, 0)) {
          previewMove(timeOnly, 0);
          return;
        }

        const clampedTime = clampTimeDeltaToFreeSpace(liveLayers, moveItems, trackOnly, timeOnly, selectedSet);
        if (clampedTime !== timeOnly || trackOnly !== 0) {
          const clampedFits = fits(clampedTime, trackOnly);
          if (clampedFits) {
            previewMove(clampedTime, trackOnly);
            return;
          }
          if (clampedTime !== 0 && fits(clampedTime, 0)) {
            previewMove(clampedTime, 0);
            return;
          }
        }

        if (moveItems.length === 1) {
          const item = moveItems[0];
          const desiredTrack = normalizeTrackForKind(item.track + trackOnly, item.kind);
          const desiredStart = Math.max(0, item.startTime + timeOnly);
          const clampedStart = clampMoveToTrack(liveLayers, desiredTrack, desiredStart, item.duration, selectedSet);
          if (clampedStart !== null) {
            previewMove(clampedStart - item.startTime, desiredTrack - item.track);
            return;
          }
        }

        setSnapGuide(null);
        previewMove(0, 0);
      };

      const scheduleDragMove = () => {
        if (dragMoveRafRef.current !== null) return;
        dragMoveRafRef.current = window.requestAnimationFrame(() => {
          dragMoveRafRef.current = null;
          runDragMove();
        });
      };

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const drag = dragMoveStateRef.current;
        if (!drag || drag.pointerId !== pointerId) return;
        drag.lastClientX = ev.clientX;
        drag.lastClientY = ev.clientY;
        const body = bodyRef.current;
        if (body) {
          const rect = body.getBoundingClientRect();
          const edge = 48;
          if (ev.clientX > rect.right - edge) {
            body.scrollLeft = Math.min(body.scrollWidth, body.scrollLeft + 24);
          } else if (ev.clientX < rect.left + HEADER_WIDTH + edge) {
            body.scrollLeft = Math.max(0, body.scrollLeft - 24);
          }
          handleScroll();
        }
        scheduleDragMove();
      };

      // Clear snap guide when pointer comes up
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        if (dragMoveRafRef.current !== null) {
          window.cancelAnimationFrame(dragMoveRafRef.current);
          dragMoveRafRef.current = null;
        }
        const preview = dragPreviewRef.current;
        const firstPreview = preview.get(moveIdArray[0]);
        if (firstPreview) {
          void commands.moveLayersCommand(
            editor.commit,
            moveItemsForCommit.map((item) => ({
              id: item.id,
              startTime: Math.max(0, item.startTime + firstPreview.timeDelta),
              track: Math.max(0, item.track + firstPreview.trackDelta),
            })),
          );
        }
        dragPreviewRef.current = new Map();
        setDragPreview(new Map());
        dragMoveStateRef.current = null;
        try {
          pointerTarget.releasePointerCapture(pointerId);
        } catch {}
        lastSnapGuideRef.current = null;
        setSnapGuideTime(null);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [selection, video, scale, playheadTime, availableDuration, trackHeight, handleScroll, trackAtPointer],
  );

  // ─── Trim/resize handle — also trims linked partner ──────────
  const handleHandlePointerDown = useCallback(
    (
      e: React.PointerEvent,
      layer: LayerJSON,
      edge: "start" | "end",
    ) => {
      e.stopPropagation();
      // Block trim on locked clips
      if ((layer.settings as any)?.locked) return;
      if ((video.tracks?.[layer.track ?? 0] as any)?.locked) return;
      const editor = useEditorStore.getState();
      const startClientX = e.clientX;
      const bounds = layerTimelineBounds(layer);
      const initialStart = bounds.start;
      const initialEnd = bounds.end;
      const initialSourceStart = layer.settings.sourceStart ?? 0;
      const initialSourceDuration = layer.settings.sourceDuration ?? 0;
      const speed = Math.abs(layer.settings.speed ?? 1);

      // Find linked partner
      const allLayers = video.layers ?? [];
      const partner = findLinkedPartnerIn(allLayers, layer.id);
      const partnerBounds = partner ? layerTimelineBounds(partner) : null;
      const partnerInitialStart = partnerBounds?.start ?? initialStart;
      const partnerInitialEnd = partnerBounds?.end ?? initialEnd;
      const partnerSourceStart = partner?.settings.sourceStart ?? 0;
      const partnerSourceDuration = partner?.settings.sourceDuration ?? 0;
      const partnerSpeed = Math.abs(partner?.settings.speed ?? 1);
      let pendingTrim: (() => void) | null = null;
      let trimFrame: number | null = null;
      const queueTrim = (operation: () => void) => {
        pendingTrim = operation;
        if (trimFrame !== null) return;
        trimFrame = window.requestAnimationFrame(() => {
          trimFrame = null;
          const next = pendingTrim;
          pendingTrim = null;
          next?.();
        });
      };
      const flushTrim = () => {
        if (trimFrame !== null) {
          window.cancelAnimationFrame(trimFrame);
          trimFrame = null;
        }
        const next = pendingTrim;
        pendingTrim = null;
        next?.();
      };

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startClientX;
        const deltaTime = dx / scale;

        // Snap
        const magnets = computeMagnets(
          allLayers,
          new Set([layer.id]),
          playheadTime,
        );

        if (edge === "start") {
          let newStart = initialStart + deltaTime;
          const snap = snapTime(newStart, magnets, scale, DEFAULT_SNAP_PIXELS);
          if (snap) newStart = snap.time;
          newStart = Math.max(0, newStart);
          const shift = newStart - initialStart;
          const newSourceStart = initialSourceStart + shift * speed;
          const newStartTime = initialStart + shift;
          const newSourceDuration = initialSourceDuration - shift * speed;
          if (newSourceDuration > 0.01) {
            const pNewSourceStart = partnerSourceStart + shift * partnerSpeed;
            const pNewStartTime = partnerInitialStart + shift;
            const pNewSourceDuration = partnerSourceDuration - shift * partnerSpeed;
            queueTrim(() => {
              commands.trimStartCommand(editor.commit, layer.id, newSourceStart, newStartTime, newSourceDuration);
              if (partner && pNewSourceDuration > 0.01) {
                commands.trimStartCommand(editor.commit, partner.id, pNewSourceStart, pNewStartTime, pNewSourceDuration);
              }
            });
          }
        } else {
          let newEnd = initialEnd + deltaTime;
          const snap = snapTime(newEnd, magnets, scale, DEFAULT_SNAP_PIXELS);
          if (snap) newEnd = snap.time;
          const newDuration = Math.max(0.01, newEnd - initialStart);
          const newSourceDuration = newDuration * speed;
          const pNewDuration = Math.max(0.01, partnerInitialEnd + deltaTime - partnerInitialStart);
          const pNewSourceDuration = pNewDuration * partnerSpeed;
          queueTrim(() => {
            commands.resizeLayerCommand(editor.commit, layer.id, newSourceDuration);
            if (partner) commands.resizeLayerCommand(editor.commit, partner.id, pNewSourceDuration);
          });
        }
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        flushTrim();
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [video, scale, playheadTime],
  );

  // ─── Double-click → enter group ──────────────────────────────
  const handleClipDoubleClick = useCallback(
    (_e: React.MouseEvent, layer: LayerJSON) => {
      if (layer.type === "group") {
        enterGroup(layer.id);
      }
    },
    [enterGroup],
  );

  // ─── Context menu on clip → set target ──────────────────────
  const handleClipContextMenu = useCallback(
    (_e: React.MouseEvent, layer: LayerJSON) => {
      // Select the clip if not already selected
      const editor = useEditorStore.getState();
      if (!editor.selection.layerIds.includes(layer.id)) {
        editor.selectLayers([layer.id]);
      }
      onContextMenuTarget?.("clip");
    },
    [onContextMenuTarget],
  );

  // ─── Track rename ────────────────────────────────────────────
  const updateTrackSettings = useCallback(
    (trackIdx: number, patch: Record<string, unknown>) => {
      void commit((draft: any) => {
        if (!Array.isArray(draft.tracks)) draft.tracks = [];
        while (draft.tracks.length <= trackIdx) {
          const index = draft.tracks.length;
          draft.tracks.push({ id: `track-${index}`, name: `Track ${index + 1}` });
        }
        Object.assign(draft.tracks[trackIdx], patch);
      }, { label: "Update track settings" });
    },
    [commit],
  );

  const handleTrackRename = useCallback(
    (trackIdx: number, name: string) => updateTrackSettings(trackIdx, { name }),
    [updateTrackSettings],
  );

  // ─── Track toggle enabled ────────────────────────────────────
  const handleTrackToggle = useCallback(
    (trackIdx: number, currentEnabled: boolean) => {
      updateTrackSettings(trackIdx, { enabled: !currentEnabled });
    },
    [updateTrackSettings],
  );

  // ─── Track mute toggle ───────────────────────────────────────
  const handleTrackMute = useCallback(
    (trackIdx: number, currentMuted: boolean) => {
      updateTrackSettings(trackIdx, { muted: !currentMuted });
    },
    [updateTrackSettings],
  );

  // ─── Track solo toggle ───────────────────────────────────────
  const handleTrackSolo = useCallback(
    (trackIdx: number, currentSoloed: boolean) => {
      updateTrackSettings(trackIdx, { solo: !currentSoloed });
    },
    [updateTrackSettings],
  );

  const handleTrackLock = useCallback(
    (trackIdx: number, currentLocked: boolean) => updateTrackSettings(trackIdx, { locked: !currentLocked }),
    [updateTrackSettings],
  );

  // ─── Render ──────────────────────────────────────────────────
  const selectionSet = useMemo(
    () => new Set(selection.layerIds),
    [selection.layerIds],
  );

  // Determine track type for each section
  const getTrackType = (section: "video" | "audio"): "video" | "audio" => section;

  return (
    <div className="ct-timeline">
      {/* Corner (timecode) */}
      <div className="ct-corner">
        <div className="ct-timecode">{formatTime(playheadTime, fps)}</div>
      </div>

      {/* Ruler */}
      <div
        className="ct-ruler"
        ref={rulerRef}
        onPointerDown={handleRulerPointerDown}
      >
        <div className="ct-ruler-inner" style={{ width: totalWidth }}>
          {ticks.map((tick, i) => (
            <div
              key={i}
              className="ct-ruler-tick"
              data-major={tick.major || undefined}
              style={{ left: tick.time * scale }}
            />
          ))}
          {ticks
            .filter((t) => t.major)
            .map((tick, i) => (
              <div
                key={`l-${i}`}
                className="ct-ruler-label"
                style={{ left: tick.time * scale }}
              >
                {formatTime(tick.time, fps)}
              </div>
            ))}
          {/* Markers on ruler */}
          {markers.map((m, i) => (
            <div
              key={i}
              className="ct-ruler-marker"
              style={{ left: m.time * scale }}
              title={m.label}
              onClick={(e) => { e.stopPropagation(); if (confirm(`Remove marker "${m.label}"?`)) setMarkers((prev) => prev.filter((_, j) => j !== i)); }}
            />
          ))}
        </div>
      </div>

      {/* Body (headers + tracks, scrollable) */}
      <div
        className="ct-body"
        ref={bodyRef}
        onScroll={handleScroll}
        onWheel={handleWheel}
      >
        {/* Sticky headers column. Audio and video use separate typed bands. */}
        <div className="ct-headers">
          {videoRows.slice().reverse().map(({ trackIdx }) => {
            const meta = trackMeta[trackIdx];
            const enabled = meta?.enabled !== false;
            return (
              <TrackHeader
                key={`track-${trackIdx}`}
                trackIdx={trackIdx}
                trackName={meta?.name ?? `V${localTrackForKind(trackIdx, "video") + 1}`}
                trackType="video"
                enabled={enabled}
                muted={(meta as any)?.muted === true}
                onRename={(n) => handleTrackRename(trackIdx, n)}
                onToggleEnabled={() => handleTrackToggle(trackIdx, enabled)}
                onToggleMute={() => handleTrackMute(trackIdx, (meta as any)?.muted === true)}
                locked={(meta as any)?.locked === true}
                onToggleLock={() => handleTrackLock(trackIdx, (meta as any)?.locked === true)}
              />
            );
          })}
          <div className="ct-track-separator" />
          {audioRows.slice().reverse().map(({ trackIdx }) => {
            const meta = trackMeta[trackIdx];
            const enabled = meta?.enabled !== false;
            return (
              <TrackHeader
                key={`track-${trackIdx}`}
                trackIdx={trackIdx}
                trackName={meta?.name ?? `A${localTrackForKind(trackIdx, "audio") + 1}`}
                trackType="audio"
                enabled={enabled}
                muted={(meta as any)?.muted === true}
                soloed={(meta as any)?.solo === true}
                onRename={(n) => handleTrackRename(trackIdx, n)}
                onToggleEnabled={() => handleTrackToggle(trackIdx, enabled)}
                onToggleMute={() => handleTrackMute(trackIdx, (meta as any)?.muted === true)}
                onToggleSolo={() => handleTrackSolo(trackIdx, (meta as any)?.solo === true)}
                locked={(meta as any)?.locked === true}
                onToggleLock={() => handleTrackLock(trackIdx, (meta as any)?.locked === true)}
              />
            );
          })}
        </div>

        {/* Tracks area */}
        <div
          className="ct-tracks-inner"
          ref={tracksRef}
          style={{ width: totalWidth }}
          onPointerDown={handleTracksPointerDown}
          onContextMenu={(e) => {
            // If right-click was on a clip, it will be set by the clip's handler
            // If right-click was on empty area, set target to empty
            const target = e.target as HTMLElement;
            if (!target.closest(".ct-clip")) {
              onContextMenuTarget?.("empty");
            }
          }}
        >
          {/* Video rows are above the separator; audio rows are below it. */}
          {videoRows.slice().reverse().map(({ trackIdx, layers: row, kind }) => {
            const meta = trackMeta[trackIdx];
            const disabled = meta?.enabled === false;
            const locked = (meta as any)?.locked === true;
            return (
              <div
                key={`track-${trackIdx}`}
                className="ct-track-row"
                data-track-index={trackIdx}
                data-track-kind={kind}
                data-disabled={disabled || locked || undefined}
                style={{ height: trackHeight }}
              >
                {row.map((layer) => (
                  <TimelineClip
                    key={layer.id}
                    layer={layer}
                    scale={scale}
                    isSelected={selectionSet.has(layer.id)}
                    groupOffset={groupOffset}
                    onPointerDown={handleClipPointerDown}
                    onHandlePointerDown={handleHandlePointerDown}
                    onDoubleClick={handleClipDoubleClick}
                    onContextMenu={handleClipContextMenu}
                    preview={dragPreview.get(layer.id)}
                    trackHeight={trackHeight}
                  />
                ))}
              </div>
            );
          })}
          <div className="ct-section-separator" />
          {audioRows.slice().reverse().map(({ trackIdx, layers: row, kind }) => {
            const meta = trackMeta[trackIdx];
            const disabled = meta?.enabled === false;
            const locked = (meta as any)?.locked === true;
            return (
              <div
                key={`track-${trackIdx}`}
                className="ct-track-row ct-track-row-audio"
                data-track-index={trackIdx}
                data-track-kind={kind}
                data-disabled={disabled || locked || undefined}
                style={{ height: trackHeight }}
              >
                {row.map((layer) => (
                  <TimelineClip
                    key={layer.id}
                    layer={layer}
                    scale={scale}
                    isSelected={selectionSet.has(layer.id)}
                    groupOffset={groupOffset}
                    onPointerDown={handleClipPointerDown}
                    onHandlePointerDown={handleHandlePointerDown}
                    onDoubleClick={handleClipDoubleClick}
                    onContextMenu={handleClipContextMenu}
                    preview={dragPreview.get(layer.id)}
                    trackHeight={trackHeight}
                  />
                ))}
              </div>
            );
          })}

          {/* Time selection range */}
          {selectionRange && (
            <div
              className="ct-selection-range"
              style={{
                left: selectionRange.start * scale,
                width: (selectionRange.end - selectionRange.start) * scale,
              }}
            />
          )}

          {/* Snap guide line */}
          {snapGuideTime !== null && (
            <div
              className="ct-snap-guide"
              style={{ left: snapGuideTime * scale }}
            />
          )}

          {/* End marker */}
          <div
            className="ct-end-marker"
            style={{ left: availableDuration * scale }}
          />

          {/* Playhead */}
          <div
            className="ct-playhead"
            style={{ left: playheadLeft }}
          />

          {/* Empty timeline state */}
          {layers.length === 0 && (
            <div className="ct-empty-state">
              <p>No clips on timeline</p>
              <p className="ct-empty-state-hint">Drag media here or use the Media panel to add clips</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
