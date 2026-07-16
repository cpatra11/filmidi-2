import { useEffect } from "react";
import { useEditorStore } from "@videoflow/react-video-editor";
import type { VideoJSON } from "@videoflow/react-video-editor";

/**
 * Initializes the VideoFlow editor store with the given video data.
 * Must be mounted once before any VideoFlow panel components.
 */
export function VideoFlowInit({ video }: { video: VideoJSON }) {
  useEffect(() => {
    const store = useEditorStore.getState();
    store.loadVideo(video);
    // Sync the bridge if it's already set up by Preview
    const bridge = useEditorStore.getState().bridge;
    if (bridge) {
      bridge.setVideo(useEditorStore.getState().video);
    }
  }, [video]);
  return null;
}
