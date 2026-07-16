import { useRef, useCallback, useState, useEffect } from "react";
import { useEditorStore } from "@videoflow/react-video-editor";

const HANDLE_SIZE = 8;
const SNAP_THRESHOLD_PX = 8;

type Corner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

interface ClipTransform {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  rotation: number;
}

interface Props {
  containerRect: DOMRect;
  videoWidth: number;
  videoHeight: number;
}

function computeVideoRect(containerW: number, containerH: number, videoW: number, videoH: number) {
  const containerAspect = containerW / containerH;
  const videoAspect = videoW / videoH;
  let w: number, h: number, x: number, y: number;
  if (videoAspect > containerAspect) {
    w = containerW;
    h = containerW / videoAspect;
    x = 0;
    y = (containerH - h) / 2;
  } else {
    h = containerH;
    w = containerH * videoAspect;
    x = (containerW - w) / 2;
    y = 0;
  }
  return { x, y, w, h };
}

function getSelectedClipTransform(): ClipTransform | null {
  const s = useEditorStore.getState();
  const ids = s.selection.layerIds;
  if (ids.length !== 1) return null;
  const layer = s.video.layers.find((l: any) => l.id === ids[0]);
  if (!layer) return null;
  const t = (layer as any).transform;
  if (!t) return { centerX: 0.5, centerY: 0.5, width: 1, height: 1, rotation: 0 };
  return {
    centerX: t.centerX ?? 0.5,
    centerY: t.centerY ?? 0.5,
    width: t.width ?? 1,
    height: t.height ?? 1,
    rotation: t.rotation ?? 0,
  };
}

function commitTransform(newTransform: ClipTransform) {
  const s = useEditorStore.getState();
  const ids = s.selection.layerIds;
  if (ids.length !== 1) return;
  s.commit((v: any) => {
    for (const layer of v.layers) {
      if (layer.id === ids[0]) {
        if (!layer.transform) layer.transform = {};
        layer.transform.centerX = newTransform.centerX;
        layer.transform.centerY = newTransform.centerY;
        layer.transform.width = newTransform.width;
        layer.transform.height = newTransform.height;
        layer.transform.rotation = newTransform.rotation;
        break;
      }
    }
  }, { label: "Transform clip" });
}

function snapToEdges(val: number, size: number, threshold: number): number {
  const half = size / 2;
  const left = val - half;
  const right = val + half;
  if (Math.abs(left) < threshold) return half;
  if (Math.abs(right - 1) < threshold) return 1 - half;
  if (Math.abs(val - 0.5) < threshold) return 0.5;
  return val;
}

export function TransformOverlay({ containerRect, videoWidth, videoHeight }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    type: "move" | "resize";
    corner?: Corner;
    startX: number;
    startY: number;
    origTransform: ClipTransform;
    origClipX: number;
    origClipY: number;
    origClipW: number;
    origClipH: number;
  } | null>(null);

  const [, forceRender] = useState(0);
  const transformRef = useRef<ClipTransform | null>(null);

  useEffect(() => {
    const check = () => {
      const t = getSelectedClipTransform();
      const prev = transformRef.current;
      if (JSON.stringify(t) !== JSON.stringify(prev)) {
        transformRef.current = t;
        forceRender((n) => n + 1);
      }
    };
    check();
    const id = setInterval(check, 100);
    return () => clearInterval(id);
  }, []);

  const transform = transformRef.current;
  const vr = (containerRect.width > 0 && videoWidth > 0)
    ? computeVideoRect(containerRect.width, containerRect.height, videoWidth, videoHeight)
    : { x: 0, y: 0, w: 0, h: 0 };

  const clipX = transform ? vr.x + (transform.centerX - transform.width / 2) * vr.w : 0;
  const clipY = transform ? vr.y + (transform.centerY - transform.height / 2) * vr.h : 0;
  const clipW = transform ? transform.width * vr.w : 0;
  const clipH = transform ? transform.height * vr.h : 0;

  const snapThreshold = vr.w > 0 ? (SNAP_THRESHOLD_PX / Math.max(vr.w, vr.h)) : 0;

  const handlePointerDown = useCallback((e: React.PointerEvent, type: "move" | "resize", corner?: Corner) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const t = transformRef.current;
    if (!t) return;
    const cX = vr.x + (t.centerX - t.width / 2) * vr.w;
    const cY = vr.y + (t.centerY - t.height / 2) * vr.h;
    const cW = t.width * vr.w;
    const cH = t.height * vr.h;
    dragRef.current = {
      type,
      corner,
      startX: e.clientX,
      startY: e.clientY,
      origTransform: { ...t },
      origClipX: cX,
      origClipY: cY,
      origClipW: cW,
      origClipH: cH,
    };
  }, [vr.x, vr.y, vr.w, vr.h]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const orig = drag.origTransform;

    if (drag.type === "move") {
      let newCX = orig.centerX + dx / vr.w;
      let newCY = orig.centerY + dy / vr.h;
      newCX = snapToEdges(newCX, orig.width, snapThreshold);
      newCY = snapToEdges(newCY, orig.height, snapThreshold);
      transformRef.current = { ...orig, centerX: newCX, centerY: newCY };
    } else if (drag.type === "resize" && drag.corner) {
      let newW = orig.width;
      let newH = orig.height;
      let newCX = orig.centerX;
      let newCY = orig.centerY;

      const dwn = dx / vr.w;
      const dhn = dy / vr.h;

      if (drag.corner === "topLeft") {
        newW = Math.max(0.05, orig.width - dwn);
        newH = Math.max(0.05, orig.height - dhn);
        newCX = orig.centerX + (orig.width - newW) / 2;
        newCY = orig.centerY + (orig.height - newH) / 2;
      } else if (drag.corner === "topRight") {
        newW = Math.max(0.05, orig.width + dwn);
        newH = Math.max(0.05, orig.height - dhn);
        newCX = orig.centerX + (orig.width - newW) / 2;
        newCY = orig.centerY + (orig.height - newH) / 2;
      } else if (drag.corner === "bottomLeft") {
        newW = Math.max(0.05, orig.width - dwn);
        newH = Math.max(0.05, orig.height + dhn);
        newCX = orig.centerX + (orig.width - newW) / 2;
        newCY = orig.centerY + (orig.height - newH) / 2;
      } else if (drag.corner === "bottomRight") {
        newW = Math.max(0.05, orig.width + dwn);
        newH = Math.max(0.05, orig.height + dhn);
        newCX = orig.centerX + (orig.width - newW) / 2;
        newCY = orig.centerY + (orig.height - newH) / 2;
      }

      transformRef.current = { ...orig, width: newW, height: newH, centerX: newCX, centerY: newCY };
    }
    forceRender((n) => n + 1);
  }, [vr.w, vr.h, snapThreshold]);

  const handlePointerUp = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (transformRef.current) {
      commitTransform(transformRef.current);
    }
  }, []);

  if (!transform) return null;

  const corners: { key: Corner; x: number; y: number }[] = [
    { key: "topLeft", x: clipX, y: clipY },
    { key: "topRight", x: clipX + clipW, y: clipY },
    { key: "bottomLeft", x: clipX, y: clipY + clipH },
    { key: "bottomRight", x: clipX + clipW, y: clipY + clipH },
  ];

  const showCenterSnapX = Math.abs(transform.centerX - 0.5) < snapThreshold;
  const showCenterSnapY = Math.abs(transform.centerY - 0.5) < snapThreshold;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-40 pointer-events-none"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Center snap guides */}
      {showCenterSnapX && (
        <div
          className="absolute top-0 bottom-0 w-px bg-white/40 pointer-events-none"
          style={{ left: vr.x + vr.w / 2 }}
        />
      )}
      {showCenterSnapY && (
        <div
          className="absolute left-0 right-0 h-px bg-white/40 pointer-events-none"
          style={{ top: vr.y + vr.h / 2 }}
        />
      )}

      {/* Clip border */}
      <div
        className="absolute border border-white/80 pointer-events-auto cursor-move"
        style={{
          left: clipX,
          top: clipY,
          width: clipW,
          height: clipH,
          transform: transform.rotation ? `rotate(${transform.rotation}deg)` : undefined,
        }}
        onPointerDown={(e) => handlePointerDown(e, "move")}
      />

      {/* Corner handles */}
      {corners.map(({ key, x, y }) => (
        <div
          key={key}
          className="absolute bg-white border border-gray-600 pointer-events-auto cursor-nwse-resize"
          style={{
            left: x - HANDLE_SIZE / 2,
            top: y - HANDLE_SIZE / 2,
            width: HANDLE_SIZE,
            height: HANDLE_SIZE,
            transform: transform.rotation ? `rotate(${transform.rotation}deg)` : undefined,
          }}
          onPointerDown={(e) => handlePointerDown(e, "resize", key)}
        />
      ))}
    </div>
  );
}
