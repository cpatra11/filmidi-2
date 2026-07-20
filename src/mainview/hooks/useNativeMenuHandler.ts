import { useEffect } from "react";
import { useAppStore } from "@/store/useAppStore";
import { useExportStore } from "@/store/useExportStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useHelpStore } from "@/store/useHelpStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useAboutStore } from "@/store/useAboutStore";
import { useEditorStore } from "@videoflow/react-video-editor";
import {
  importMediaFromPicker,
  openHelp,
  openProjectHome,
  saveCurrentProject,
  saveProjectAsCopy,
  sendFeedback,
  showMcpInstructions,
} from "@/lib/menuActions";
import {
  copySelectedLayers,
  cutSelectedLayers,
  deleteSelectedLayers,
  fitPreview,
  pasteLayers,
  selectAllLayers,
  splitAtPlayhead,
  trimSelectedToPlayhead,
} from "@/hooks/useKeyboardShortcuts";

function handleMenuAction(action: string) {
  switch (action) {
    case "about":
      useAboutStore.getState().open();
      break;
    // File
    case "new-project":
      useProjectStore.getState().addProject("Untitled Project");
      break;
    case "open-project":
      openProjectHome();
      break;
    case "save-project":
      void saveCurrentProject();
      break;
    case "save-as":
      void saveProjectAsCopy();
      break;
    case "import-media":
      void importMediaFromPicker();
      break;
    case "export":
      useExportStore.getState().open();
      break;
    case "undo":
      useEditorStore.getState().undo();
      break;
    case "redo":
      useEditorStore.getState().redo();
      break;
    case "cut":
      cutSelectedLayers();
      break;
    case "copy":
      copySelectedLayers();
      break;
    case "paste":
      void pasteLayers();
      break;
    case "delete":
      deleteSelectedLayers();
      break;
    case "select-all":
      selectAllLayers();
      break;

    // Edit
    case "split-at-playhead": {
      splitAtPlayhead();
      break;
    }
    case "trim-start": {
      trimSelectedToPlayhead("right");
      break;
    }
    case "trim-end": {
      trimSelectedToPlayhead("left");
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
      fitPreview();
      break;
    case "zoom-100":
      useEditorStore.getState().setViewport({ previewZoom: 1 });
      break;

    // Settings & Help
    case "open-settings":
      useSettingsStore.getState().open();
      break;
    case "open-help":
      openHelp();
      break;
    case "open-mcp": {
      showMcpInstructions();
      break;
    }
    case "send-feedback": {
      sendFeedback();
      break;
    }
    default:
      break;
  }
}

export function useNativeMenuHandler() {
  useEffect(() => {
    let cleanupHandler: (() => void) | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    const attach = () => {
      const eb = (window as any).__electrobun;
      if (!eb || cleanupHandler) return;

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

      cleanupHandler = () => {
        eb.receiveMessageFromBun = prev;
      };
    };

    attach();
    if (!cleanupHandler) {
      interval = setInterval(attach, 50);
    }

    return () => {
      if (interval) clearInterval(interval);
      if (cleanupHandler) cleanupHandler();
    };
  }, []);
}
