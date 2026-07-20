import { useRef, useState, useEffect } from "react";
import { useAppStore } from "@/store/useAppStore";
import { useEditorStore } from "@videoflow/react-video-editor";
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

  // Keep the preview surface unobstructed during normal editing. The native
  // VideoFlow preview owns selection and transform gestures; only crop mode
  // needs an explicit set of handles above it.
  if (!rect || !hasSingleClip || !cropActive) return null;

  return <CropOverlay containerRect={rect} videoWidth={videoW} videoHeight={videoH} />;
}
