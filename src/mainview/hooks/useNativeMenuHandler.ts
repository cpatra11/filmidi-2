import { useEffect } from "react";
import { useAppStore } from "@/store/useAppStore";
import { useExportStore } from "@/store/useExportStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useHelpStore } from "@/store/useHelpStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useEditorStore } from "@videoflow/react-video-editor";
import { commands } from "@videoflow/react-video-editor";

const { addLayerCommand } = commands;

function handleMenuAction(action: string) {
  switch (action) {
    // File
    case "new-project":
      useProjectStore.getState().addProject("Untitled Project");
      break;
    case "open-project":
      break;
    case "save-project":
      break;
    case "save-as":
      break;
    case "import-media":
      break;
    case "export":
      useExportStore.getState().open();
      break;

    // Edit
    case "split-at-playhead": {
      const s = useEditorStore.getState();
      const frame = s.currentFrame;
      const fps = s.video.fps || 30;
      const ids = s.selection.layerIds;
      if (ids.length === 0) return;
      s.commit((v: any) => {
        const idSet = new Set(ids);
        const toAdd: any[] = [];
        const processLayers = (layers: any[]) => {
          for (const layer of layers) {
            if (idSet.has(layer.id)) {
              const startFrame = Math.round(layer.startTime * fps);
              const durFrames = Math.round((layer.duration || layer.sourceDuration || 5) * fps);
              if (frame > startFrame && frame < startFrame + durFrames) {
                const splitOffset = (frame - startFrame) / fps;
                const origDur = layer.duration || layer.sourceDuration || 5;
                toAdd.push({
                  ...layer,
                  id: `${layer.id}-r-${Date.now()}`,
                  name: `${layer.name} (R)`,
                  startTime: layer.startTime + splitOffset,
                  sourceStart: (layer.sourceStart || 0) + splitOffset,
                  sourceDuration: origDur - splitOffset,
                  duration: origDur - splitOffset,
                });
                layer.duration = splitOffset;
                layer.sourceDuration = splitOffset;
              }
            } else if (layer.type === "group" && Array.isArray(layer.children)) {
              processLayers(layer.children);
            }
          }
        };
        processLayers(v.layers);
        v.layers.push(...toAdd);
      }, { label: "Split at playhead" });
      break;
    }
    case "trim-start": {
      const s = useEditorStore.getState();
      const frame = s.currentFrame;
      const fps = s.video.fps || 30;
      const ids = s.selection.layerIds;
      if (ids.length === 0) return;
      s.commit((v: any) => {
        const idSet = new Set(ids);
        const processLayers = (layers: any[]) => {
          for (const layer of layers) {
            if (idSet.has(layer.id)) {
              const startFrame = Math.round(layer.startTime * fps);
              const trimAmount = Math.max(0, frame - startFrame) / fps;
              if (trimAmount > 0) {
                layer.startTime += trimAmount;
                layer.sourceStart = (layer.sourceStart || 0) + trimAmount;
                layer.duration = (layer.duration || layer.sourceDuration || 5) - trimAmount;
                layer.sourceDuration = (layer.sourceDuration || layer.duration || 5) - trimAmount;
              }
            } else if (layer.type === "group" && Array.isArray(layer.children)) {
              processLayers(layer.children);
            }
          }
        };
        processLayers(v.layers);
      }, { label: "Trim start" });
      break;
    }
    case "trim-end": {
      const s = useEditorStore.getState();
      const frame = s.currentFrame;
      const fps = s.video.fps || 30;
      const ids = s.selection.layerIds;
      if (ids.length === 0) return;
      s.commit((v: any) => {
        const idSet = new Set(ids);
        const processLayers = (layers: any[]) => {
          for (const layer of layers) {
            if (idSet.has(layer.id)) {
              const startFrame = Math.round(layer.startTime * fps);
              const durFrames = Math.round((layer.duration || layer.sourceDuration || 5) * fps);
              const endFrame = startFrame + durFrames;
              const trimAmount = Math.max(0, endFrame - frame) / fps;
              if (trimAmount > 0) {
                layer.duration = (layer.duration || layer.sourceDuration || 5) - trimAmount;
                layer.sourceDuration = (layer.sourceDuration || layer.duration || 5) - trimAmount;
              }
            } else if (layer.type === "group" && Array.isArray(layer.children)) {
              processLayers(layer.children);
            }
          }
        };
        processLayers(v.layers);
      }, { label: "Trim end" });
      break;
    }

    // View
    case "toggle-media-panel":
      useAppStore.getState().toggleMediaPanel();
      break;
    case "toggle-inspector":
      useAppStore.getState().toggleInspector();
      break;
    case "toggle-agent-panel":
      useAppStore.getState().toggleAgentPanel();
      break;
    case "zoom-in": {
      const s = useEditorStore.getState();
      s.setViewport({ timelineScale: Math.min(5, s.viewport.timelineScale * 1.2) });
      break;
    }
    case "zoom-out": {
      const s = useEditorStore.getState();
      s.setViewport({ timelineScale: Math.max(0.1, s.viewport.timelineScale / 1.2) });
      break;
    }
    case "zoom-fit":
      useEditorStore.getState().setViewport({ timelineScale: 1, previewZoom: 1, previewPanX: 0, previewPanY: 0 });
      break;
    case "zoom-100":
      useEditorStore.getState().setViewport({ previewZoom: 1 });
      break;

    // Settings & Help
    case "open-settings":
      useSettingsStore.getState().open();
      break;
    case "open-help":
      useHelpStore.getState().open();
      break;
    case "open-mcp": {
      const msg = [
        "Filmidi Editor — MCP Server",
        "",
        "The MCP server is running on port 19790.",
        "Endpoint: http://127.0.0.1:19790/mcp",
        "",
        "To connect from Claude Desktop:",
        "1. Open Claude Desktop Settings",
        "2. Add an MCP server with URL:",
        "   http://127.0.0.1:19790/mcp",
        "3. Start the Filmidi Editor app first",
        "",
        "To test: curl http://127.0.0.1:19790/health",
      ].join("\n");
      alert(msg);
      break;
    }
    default:
      break;
  }
}

export function useNativeMenuHandler() {
  useEffect(() => {
    const eb = (window as any).__electrobun;
    if (!eb) return;

    const prev = eb.receiveMessageFromBun;
    eb.receiveMessageFromBun = (msg: unknown) => {
      try {
        const data = typeof msg === "string" ? JSON.parse(msg) : msg;
        if (data?.type === "menu-action" && data.action) {
          handleMenuAction(data.action);
          return;
        }
      } catch {
        // Non-JSON message, ignore
      }

      if (prev) {
        prev(msg);
      }
    };

    return () => {
      eb.receiveMessageFromBun = prev;
    };
  }, []);
}
