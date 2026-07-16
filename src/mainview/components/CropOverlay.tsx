import { useRef, useCallback, useState, useEffect } from "react";
import { useEditorStore } from "@videoflow/react-video-editor";

const HANDLE_SIZE = 8;

type Corner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

interface ClipCrop {
  left: number;
  top: number;
  right: number;
  bottom: number;
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

function getSelectedClipCrop(): ClipCrop | null {
  const s = useEditorStore.getState();
  const ids = s.selection.layerIds;
  if (ids.length !== 1) return null;
  const layer = s.video.layers.find((l: any) => l.id === ids[0]);
  if (!layer) return null;
  if ((layer as any).type === "text") return null;
  const c = (layer as any).crop;
  if (!c) return { left: 0, top: 0, right: 0, bottom: 0 };
  return {
    left: c.left ?? 0,
    top: c.top ?? 0,
    right: c.right ?? 0,
    bottom: c.bottom ?? 0,
  };
}

function commitCrop(newCrop: ClipCrop) {
  const s = useEditorStore.getState();
  const ids = s.selection.layerIds;
  if (ids.length !== 1) return;
  s.commit((v: any) => {
    for (const layer of v.layers) {
      if (layer.id === ids[0]) {
        if (!layer.crop) layer.crop = {};
        layer.crop.left = newCrop.left;
        layer.crop.top = newCrop.top;
        layer.crop.right = newCrop.right;
        layer.crop.bottom = newCrop.bottom;
        break;
      }
    }
  }, { label: "Crop clip" });
}

export function CropOverlay({ containerRect, videoWidth, videoHeight }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    type: "pan" | "resize";
    corner?: Corner;
    startX: number;
    startY: number;
    origCrop: ClipCrop;
  } | null>(null);

  const [, forceRender] = useState(0);
  const cropRef = useRef<ClipCrop | null>(null);

  useEffect(() => {
    const check = () => {
      const c = getSelectedClipCrop();
      const prev = cropRef.current;
      if (JSON.stringify(c) !== JSON.stringify(prev)) {
        cropRef.current = c;
        forceRender((n) => n + 1);
      }
    };
    check();
    const id = setInterval(check, 100);
    return () => clearInterval(id);
  }, []);

  const crop = cropRef.current;
  if (!crop) return null;

  const vr = computeVideoRect(containerRect.width, containerRect.height, videoWidth, videoHeight);

  const cropLeft = vr.x + crop.left * vr.w;
  const cropTop = vr.y + crop.top * vr.h;
  const cropRight = vr.x + (1 - crop.right) * vr.w;
  const cropBottom = vr.y + (1 - crop.bottom) * vr.h;
  const cropW = cropRight - cropLeft;
  const cropH = cropBottom - cropTop;

  const handlePointerDown = useCallback((e: React.PointerEvent, type: "pan" | "resize", corner?: Corner) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      type,
      corner,
      startX: e.clientX,
      startY: e.clientY,
      origCrop: { ...crop },
    };
  }, [crop]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const orig = drag.origCrop;
    const maxCrop = 0.45;

    if (drag.type === "pan") {
      const dxn = dx / vr.w;
      const dyn = dy / vr.h;
      const newLeft = Math.max(0, Math.min(maxCrop, orig.left + dxn));
      const newRight = Math.max(0, Math.min(maxCrop, orig.right - dxn));
      const newTop = Math.max(0, Math.min(maxCrop, orig.top + dyn));
      const newBottom = Math.max(0, Math.min(maxCrop, orig.bottom - dyn));
      cropRef.current = { left: newLeft, top: newTop, right: newRight, bottom: newBottom };
    } else if (drag.type === "resize" && drag.corner) {
      const dxn = dx / vr.w;
      const dyn = dy / vr.h;
      let newCrop = { ...orig };

      if (drag.corner === "topLeft") {
        newCrop.left = Math.max(0, Math.min(maxCrop, orig.left + dxn));
        newCrop.top = Math.max(0, Math.min(maxCrop, orig.top + dyn));
      } else if (drag.corner === "topRight") {
        newCrop.right = Math.max(0, Math.min(maxCrop, orig.right - dxn));
        newCrop.top = Math.max(0, Math.min(maxCrop, orig.top + dyn));
      } else if (drag.corner === "bottomLeft") {
        newCrop.left = Math.max(0, Math.min(maxCrop, orig.left + dxn));
        newCrop.bottom = Math.max(0, Math.min(maxCrop, orig.bottom - dyn));
      } else if (drag.corner === "bottomRight") {
        newCrop.right = Math.max(0, Math.min(maxCrop, orig.right - dxn));
        newCrop.bottom = Math.max(0, Math.min(maxCrop, orig.bottom - dyn));
      }

      cropRef.current = newCrop;
    }
    forceRender((n) => n + 1);
  }, [vr.w, vr.h]);

  const handlePointerUp = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (cropRef.current) {
      commitCrop(cropRef.current);
    }
  }, []);

  const corners: { key: Corner; x: number; y: number }[] = [
    { key: "topLeft", x: cropLeft, y: cropTop },
    { key: "topRight", x: cropRight, y: cropTop },
    { key: "bottomLeft", x: cropLeft, y: cropBottom },
    { key: "bottomRight", x: cropRight, y: cropBottom },
  ];

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-20"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Dimmed regions — top */}
      <div
        className="absolute bg-black/60 pointer-events-none"
        style={{ left: 0, top: 0, width: "100%", height: cropTop }}
      />
      {/* Bottom */}
      <div
        className="absolute bg-black/60 pointer-events-none"
        style={{ left: 0, top: cropBottom, width: "100%", height: containerRect.height - cropBottom }}
      />
      {/* Left */}
      <div
        className="absolute bg-black/60 pointer-events-none"
        style={{ left: 0, top: cropTop, width: cropLeft, height: cropH }}
      />
      {/* Right */}
      <div
        className="absolute bg-black/60 pointer-events-none"
        style={{ left: cropRight, top: cropTop, width: containerRect.width - cropRight, height: cropH }}
      />

      {/* Rule of thirds */}
      {[1 / 3, 2 / 3].map((frac) => (
        <div
          key={`h${frac}`}
          className="absolute bg-white/20 pointer-events-none"
          style={{ left: cropLeft, top: cropTop + frac * cropH, width: cropW, height: 1 }}
        />
      ))}
      {[1 / 3, 2 / 3].map((frac) => (
        <div
          key={`v${frac}`}
          className="absolute bg-white/20 pointer-events-none"
          style={{ left: cropLeft + frac * cropW, top: cropTop, width: 1, height: cropH }}
        />
      ))}

      {/* Crop border */}
      <div
        className="absolute border border-white/40 pointer-events-auto cursor-grab active:cursor-grabbing"
        style={{ left: cropLeft, top: cropTop, width: cropW, height: cropH }}
        onPointerDown={(e) => handlePointerDown(e, "pan")}
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
          }}
          onPointerDown={(e) => handlePointerDown(e, "resize", key)}
        />
      ))}
    </div>
  );
}
