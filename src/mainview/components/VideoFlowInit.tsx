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

    // Project loading and Preview mount are asynchronous. If the project is
    // opened while Preview is still mounting, the first setVideo call is lost
    // and the old audio graph can remain attached to the bridge.
    let synced = false;
    const syncBridge = () => {
      const current = useEditorStore.getState();
      const bridge = current.bridge;
      if (!bridge) return false;

      try {
        bridge.stop();
        bridge.setVideo(current.video);
        bridge.seek(0);
        current.setCurrentFrame(0);
        synced = true;
        console.info("[VideoFlowInit] Preview video and audio graph synced", {
          layers: current.video.layers?.length ?? 0,
        });
      } catch (error) {
        console.warn("[VideoFlowInit] Preview sync failed; retrying", error);
      }
      return true;
    };

    syncBridge();
    const unsubscribe = useEditorStore.subscribe((state) => {
      if (!synced && state.bridge) syncBridge();
    });
    const retryTimer = window.setInterval(() => {
      if (synced || syncBridge()) window.clearInterval(retryTimer);
    }, 100);

    return () => {
      window.clearInterval(retryTimer);
      unsubscribe();
    };
  }, [video]);
  return null;
}
