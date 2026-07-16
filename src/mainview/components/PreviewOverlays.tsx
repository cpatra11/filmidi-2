import { useRef, useState, useEffect } from "react";
import { useAppStore } from "@/store/useAppStore";
import { useEditorStore } from "@videoflow/react-video-editor";
import { TransformOverlay } from "./TransformOverlay";
import { CropOverlay } from "./CropOverlay";

interface Props {
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export function PreviewOverlays({ containerRef }: Props) {
  const cropActive = useAppStore((s) => s.cropEditingActive);
  const selection = useEditorStore((s) => s.selection);
  const video = useEditorStore((s) => s.video);

  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setRect(el.getBoundingClientRect());
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  const hasSingleClip = selection.layerIds.length === 1;
  const videoW = video.width || 1920;
  const videoH = video.height || 1080;

  if (!rect || !hasSingleClip) return null;

  return cropActive ? (
    <CropOverlay containerRect={rect} videoWidth={videoW} videoHeight={videoH} />
  ) : (
    <TransformOverlay containerRect={rect} videoWidth={videoW} videoHeight={videoH} />
  );
}
