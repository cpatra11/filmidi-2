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
  packLayersIntoTracks,
  type LayerJSON,
  type Magnet,
} from "@videoflow/react-video-editor";
import { getLayerLinkId, findLinkedPartnerIn } from "@/lib/linkUtils";
import { useAppStore } from "@/store/useAppStore";
import "./CustomTimeline.css";

const TRACK_HEIGHT = 40;
const PADDING_RIGHT = 800;
const HEADER_WIDTH = 180;
const RULER_HEIGHT = 26;
const MIN_SCALE = 20;
const MAX_SCALE = 2000;

// VideoFlow's own valid source types
const VIDEO_TYPES = new Set(["video", "image", "text", "shape", "captions", "group"]);

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
  const minorInterval = niceStep(rawMinor);
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
  onRename,
  onToggleEnabled,
}: {
  trackIdx: number;
  trackName: string;
  trackType: "video" | "audio" | "other";
  enabled: boolean;
  onRename: (name: string) => void;
  onToggleEnabled: () => void;
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
}: {
  layer: LayerJSON;
  scale: number;
  isSelected: boolean;
  groupOffset: number;
  onPointerDown: (e: React.PointerEvent, layer: LayerJSON) => void;
  onHandlePointerDown: (e: React.PointerEvent, layer: LayerJSON, edge: "start" | "end") => void;
  onDoubleClick: (e: React.MouseEvent, layer: LayerJSON) => void;
  onContextMenu: (e: React.MouseEvent, layer: LayerJSON) => void;
}) {
  const bounds = layerTimelineBounds(layer);
  const start = bounds.start - groupOffset;
  const end = bounds.end - groupOffset;
  const left = start * scale;
  const width = Math.max(6, (end - start) * scale);
  const linkId = getLayerLinkId(layer);
  const hasLink = !!linkId;
  const isAudio = layer.type === "audio";
  const isVideo = layer.type === "video";

  return (
    <div
      className="ct-clip"
      data-selected={isSelected || undefined}
      data-type={layer.type}
      data-linked={hasLink || undefined}
      data-disabled={!layer.settings.enabled || undefined}
      style={{ left, width }}
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
      <div className="ct-clip-label">
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

  const { fps, duration: videoDuration } = video;
  const scale = viewport.timelineScale;
  const isPlaying = useEditor((s) => s.isPlaying);

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
      return groupLayer?.settings?.sourceDuration ?? videoDuration;
    }
    return videoDuration;
  }, [video, activeGroupPath, videoDuration]);

  // Track metadata
  const trackMeta = useMemo(() => {
    return video.tracks ?? [];
  }, [video.tracks]);

  // Separate layers into video/audio sections
  const { videoLayers, audioLayers, videoTrackMap, audioTrackMap } = useMemo(() => {
    const vLayers: LayerJSON[] = [];
    const aLayers: LayerJSON[] = [];
    for (const l of layers) {
      if (l.type === "audio") {
        aLayers.push(l);
      } else {
        vLayers.push(l);
      }
    }

    // Compute track assignments for each section
    const vTracks = packLayersIntoTracks(vLayers);
    const aTracks = packLayersIntoTracks(aLayers);

    const vMap = new Map<LayerJSON, number>();
    const aMap = new Map<LayerJSON, number>();
    vLayers.forEach((l, i) => vMap.set(l, vTracks[i]));
    aLayers.forEach((l, i) => aMap.set(l, aTracks[i]));

    return {
      videoLayers: vLayers,
      audioLayers: aLayers,
      videoTrackMap: vMap,
      audioTrackMap: aMap,
    };
  }, [layers]);

  // Group video/audio layers into track rows
  const { videoRows, audioRows } = useMemo(() => {
    const groupIntoRows = (
      ls: LayerJSON[],
      trackMap: Map<LayerJSON, number>,
    ): LayerJSON[][] => {
      if (ls.length === 0) return [];
      const maxTrack = ls.reduce(
        (max, l) => Math.max(max, trackMap.get(l) ?? 0),
        0,
      );
      const rows: LayerJSON[][] = Array.from(
        { length: maxTrack + 1 },
        () => [],
      );
      for (const l of ls) {
        const t = trackMap.get(l) ?? 0;
        rows[t].push(l);
      }
      rows.forEach((row) =>
        row.sort(
          (a, b) =>
            (a.settings.startTime ?? 0) - (b.settings.startTime ?? 0),
        ),
      );
      return rows;
    };

    return {
      videoRows: groupIntoRows(videoLayers, videoTrackMap),
      audioRows: groupIntoRows(audioLayers, audioTrackMap),
    };
  }, [videoLayers, audioLayers, videoTrackMap, audioTrackMap]);

  const videoTrackCount = videoRows.length;
  const audioTrackCount = audioRows.length;
  const totalTrackCount = videoTrackCount + audioTrackCount;

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

  // ─── Auto-fit on video change ────────────────────────────────
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const clientWidth = body.clientWidth - HEADER_WIDTH;
    if (clientWidth <= 0) return;
    const newScale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, clientWidth / (availableDuration * 1.2)),
    );
    setViewport({ timelineScale: newScale, timelineScroll: 0 });
    body.scrollLeft = 0;
    handleScroll();
  }, [availableDuration]); // eslint-disable-line react-hooks/exhaustive-deps

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
      isScrubbingRef.current = true;
      const body = bodyRef.current;
      if (!body || !bridge) return;

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

  // ─── Click on empty track space → deselect ───────────────────
  const handleTracksClick = useCallback(
    (e: React.PointerEvent) => {
      if (e.target === tracksRef.current || (e.target as HTMLElement).classList.contains("ct-track-row")) {
        useEditorStore.getState().clearSelection();
      }
    },
    [],
  );

  // ─── Clip selection — also handles razor/blade tool ──────────
  const handleClipPointerDown = useCallback(
    (e: React.PointerEvent, layer: LayerJSON) => {
      e.stopPropagation();

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
          const partner = findLinkedPartnerIn(video.layers ?? [], layer.id);
          const razorEditor = useEditorStore.getState();
          commands.resizeLayerCommand(razorEditor.commit, layer.id, splitDur);
          // Fire-and-forget the rest (async addLayerCommand calls)
          (async () => {
            const { addLayerCommand: addCmd } = commands;
            const newId = await addCmd(razorEditor.commit, {
              type: layer.type, source: layer.settings?.source as string,
              sourceDuration: remainDur, startTime: bounds.start + splitDur,
            });
            if (linkId && newId) {
              const { commands: cmds } = await import("@videoflow/react-video-editor");
              await cmds.setSettingCommand(razorEditor.commit, newId, "linkId", linkId);
            }
            if (partner) {
              const pBounds = layerTimelineBounds(partner);
              const pSplitDur = frame / fps - pBounds.start;
              const pRemainDur = pBounds.end - frame / fps;
              commands.resizeLayerCommand(razorEditor.commit, partner.id, pSplitDur);
              const pNewId = await addCmd(razorEditor.commit, {
                type: partner.type, source: partner.settings?.source as string,
                sourceDuration: pRemainDur, startTime: pBounds.start + pSplitDur,
              });
              if (linkId && pNewId) {
                const { commands: cmds } = await import("@videoflow/react-video-editor");
                await cmds.setSettingCommand(razorEditor.commit, pNewId, "linkId", linkId);
              }
            }
          })();
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
      let moved = false;

      // Store initial positions of all selected layers + their linked partners
      const selectedIds = e.shiftKey || e.metaKey || e.ctrlKey
        ? useEditorStore.getState().selection.layerIds
        : [layer.id];

      // Expand selection to include linked partners
      const allLayers = video.layers ?? [];
      const moveIds = new Set<string>(selectedIds);
      for (const id of selectedIds) {
        const partner = findLinkedPartnerIn(allLayers, id);
        if (partner) moveIds.add(partner.id);
      }
      const moveIdArray = Array.from(moveIds);

      const initialPositions = new Map<string, { startTime: number; track: number }>();
      for (const id of moveIdArray) {
        const l = allLayers.find((x) => x.id === id);
        if (l) {
          initialPositions.set(id, {
            startTime: l.settings.startTime ?? 0,
            track: l.track ?? 0,
          });
        }
      }

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startClientX;
        const dy = ev.clientY - startClientY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          moved = true;
        }
        if (!moved) return;

        const deltaTime = dx / scale;
        const deltaTrack = Math.round(-dy / TRACK_HEIGHT);

        // Compute new positions with snapping
        const magnets = computeMagnets(
          allLayers,
          new Set(moveIdArray),
          playheadTime,
        );

        const newPositions: Array<{ id: string; startTime: number; track: number }> = [];
        for (const id of moveIdArray) {
          const initial = initialPositions.get(id);
          if (!initial) continue;
          let newTime = initial.startTime + deltaTime;
          const snap = snapTime(newTime, magnets, scale, DEFAULT_SNAP_PIXELS);
          if (snap) {
            newTime = snap.time;
            setSnapGuideTime(snap.time);
          } else {
            setSnapGuideTime(null);
          }
          newTime = Math.max(0, Math.min(availableDuration, newTime));
          const newTrack = Math.max(0, initial.track + deltaTrack);
          newPositions.push({ id, startTime: newTime, track: newTrack });
        }

        editor.commit((draft) => {
          for (const pos of newPositions) {
            const l = draft.layers.find((x: any) => x.id === pos.id);
            if (l) {
              l.settings.startTime = pos.startTime;
              l.track = pos.track;
            }
          }
        }, { label: "move", mergeKey: `move:${moveIdArray.sort().join(",")}` });
      };

      // Clear snap guide when pointer comes up
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setSnapGuideTime(null);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [selection, video, scale, playheadTime, availableDuration],
  );

  // ─── Trim/resize handle — also trims linked partner ──────────
  const handleHandlePointerDown = useCallback(
    (
      e: React.PointerEvent,
      layer: LayerJSON,
      edge: "start" | "end",
    ) => {
      e.stopPropagation();
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
            commands.trimStartCommand(editor.commit, layer.id, newSourceStart, newStartTime, newSourceDuration);
          }
          // Trim linked partner by same delta
          if (partner) {
            const pNewSourceStart = partnerSourceStart + shift * partnerSpeed;
            const pNewStartTime = partnerInitialStart + shift;
            const pNewSourceDuration = partnerSourceDuration - shift * partnerSpeed;
            if (pNewSourceDuration > 0.01) {
              commands.trimStartCommand(editor.commit, partner.id, pNewSourceStart, pNewStartTime, pNewSourceDuration);
            }
          }
        } else {
          let newEnd = initialEnd + deltaTime;
          const snap = snapTime(newEnd, magnets, scale, DEFAULT_SNAP_PIXELS);
          if (snap) newEnd = snap.time;
          const newDuration = Math.max(0.01, newEnd - initialStart);
          const newSourceDuration = newDuration * speed;
          commands.resizeLayerCommand(editor.commit, layer.id, newSourceDuration);
          // Trim linked partner end by same delta
          if (partner) {
            const pNewDuration = Math.max(0.01, partnerInitialEnd + deltaTime - partnerInitialStart);
            const pNewSourceDuration = pNewDuration * partnerSpeed;
            commands.resizeLayerCommand(editor.commit, partner.id, pNewSourceDuration);
          }
        }
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
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
  const handleTrackRename = useCallback(
    (trackIdx: number, name: string) => {
      commands.setTrackSettingsCommand(commit, trackIdx, { name });
    },
    [commit],
  );

  // ─── Track toggle enabled ────────────────────────────────────
  const handleTrackToggle = useCallback(
    (trackIdx: number, currentEnabled: boolean) => {
      commands.setTrackSettingsCommand(commit, trackIdx, {
        enabled: !currentEnabled,
      });
    },
    [commit],
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
        </div>
      </div>

      {/* Body (headers + tracks, scrollable) */}
      <div
        className="ct-body"
        ref={bodyRef}
        onScroll={handleScroll}
        onWheel={handleWheel}
      >
        {/* Sticky headers column */}
        <div className="ct-headers">
          {/* Video track headers (reverse order: highest index = top) */}
          {Array.from({ length: videoTrackCount }, (_, i) => videoTrackCount - 1 - i).map(
            (trackIdx) => {
              const meta = trackMeta[trackIdx];
              const name = meta?.name ?? `V${trackIdx + 1}`;
              const enabled = meta?.enabled !== false;
              return (
                <TrackHeader
                  key={`v-${trackIdx}`}
                  trackIdx={trackIdx}
                  trackName={name}
                  trackType="video"
                  enabled={enabled}
                  onRename={(n) => handleTrackRename(trackIdx, n)}
                  onToggleEnabled={() => handleTrackToggle(trackIdx, enabled)}
                />
              );
            },
          )}

          {/* Separator */}
          {videoTrackCount > 0 && audioTrackCount > 0 && (
            <div className="ct-track-separator" />
          )}

          {/* Audio track headers (reverse order: highest index = top) */}
          {Array.from({ length: audioTrackCount }, (_, i) => audioTrackCount - 1 - i).map(
            (i) => {
              const trackIdx = i + videoTrackCount;
              const meta = trackMeta[trackIdx];
              const name = meta?.name ?? `A${i + 1}`;
              const enabled = meta?.enabled !== false;
              return (
                <TrackHeader
                  key={`a-${trackIdx}`}
                  trackIdx={trackIdx}
                  trackName={name}
                  trackType="audio"
                  enabled={enabled}
                  onRename={(n) => handleTrackRename(trackIdx, n)}
                  onToggleEnabled={() => handleTrackToggle(trackIdx, enabled)}
                />
              );
            },
          )}
        </div>

        {/* Tracks area */}
        <div
          className="ct-tracks-inner"
          ref={tracksRef}
          style={{ width: totalWidth }}
          onPointerDown={handleTracksClick}
          onContextMenu={(e) => {
            // If right-click was on a clip, it will be set by the clip's handler
            // If right-click was on empty area, set target to empty
            const target = e.target as HTMLElement;
            if (!target.closest(".ct-clip")) {
              onContextMenuTarget?.("empty");
            }
          }}
        >
          {/* Video track rows (reverse order) */}
          {videoRows.map((row, displayIdx) => {
            const trackIdx = videoTrackCount - 1 - displayIdx;
            const meta = trackMeta[trackIdx];
            const disabled = meta?.enabled === false;
            return (
              <div
                key={`vt-${trackIdx}`}
                className="ct-track-row"
                data-disabled={disabled || undefined}
                style={{ height: TRACK_HEIGHT }}
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
                  />
                ))}
              </div>
            );
          })}

          {/* Separator line */}
          {videoTrackCount > 0 && audioTrackCount > 0 && (
            <div className="ct-section-separator" />
          )}

          {/* Audio track rows (reverse order) */}
          {audioRows.map((row, displayIdx) => {
            const trackIdx = audioTrackCount - 1 - displayIdx;
            const globalTrackIdx = trackIdx + videoTrackCount;
            const meta = trackMeta[globalTrackIdx];
            const disabled = meta?.enabled === false;
            return (
              <div
                key={`at-${trackIdx}`}
                className="ct-track-row ct-track-row-audio"
                data-disabled={disabled || undefined}
                style={{ height: TRACK_HEIGHT }}
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
                  />
                ))}
              </div>
            );
          })}

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
          {totalTrackCount === 0 && (
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
