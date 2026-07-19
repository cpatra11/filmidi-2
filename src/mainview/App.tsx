import { Component, useEffect, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "./components/Layout";
import { HomeView } from "./components/HomeView";
import { VideoFlowInit } from "./components/VideoFlowInit";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useNativeMenuHandler } from "./hooks/useNativeMenuHandler";
import { useMCPHandler } from "./hooks/useMCPHandler";
import { useProjectStore } from "./store/useProjectStore";
import { useProjectSaveStore } from "./store/useProjectSaveStore";
import type { VideoJSON } from "@videoflow/react-video-editor";

const queryClient = new QueryClient();

const defaultVideo: VideoJSON = {
  name: "Untitled",
  duration: 300,
  width: 1920,
  height: 1080,
  fps: 30,
  backgroundColor: "#000000",
  layers: [],
};

// ─── Top-level error boundary to prevent black screen on crash ───

interface CrashBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class CrashBoundary extends Component<{ children: ReactNode }, CrashBoundaryState> {
  state: CrashBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): CrashBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    console.error("[CrashBoundary]", error);
    if (info.componentStack) {
      console.error("[CrashBoundary] Component stack:", info.componentStack);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            background: "#050505",
            color: "#ffffff",
            fontFamily: "'Geist Variable', system-ui, -apple-system, sans-serif",
            padding: 32,
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: 14, fontWeight: 600, margin: "0 0 8px" }}>
            Something went wrong
          </p>
          <p
            style={{
              fontSize: 11,
              color: "#666666",
              margin: "0 0 16px",
              maxWidth: 420,
              lineHeight: 1.5,
              fontFamily: "'Geist Mono', monospace",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {this.state.error?.message ?? "Unknown error"}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: "7px 16px",
              fontSize: 12,
              fontWeight: 500,
              fontFamily: "inherit",
              background: "#ffffff",
              color: "#000000",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  useKeyboardShortcuts();
  useNativeMenuHandler();
  useMCPHandler();

  // Electrobun's Bun-side executes window.__electrobun.receiveMessageFromHost(msg).
  // However, the frontend overrides window.__electrobun.receiveMessageFromBun.
  // We bridge them here and flush any pending startup messages.
  useEffect(() => {
    const eb = (window as any).__electrobun;
    if (!eb) return;

    eb.receiveMessageFromHost = (msg: unknown) => {
      eb.receiveMessageFromBun?.(msg);
    };

    const pending = (window as any).__electrobunPendingHostMessages;
    if (Array.isArray(pending) && pending.length > 0) {
      (window as any).__electrobunPendingHostMessages = [];
      for (const msg of pending) {
        eb.receiveMessageFromBun?.(msg);
      }
    }
  }, []);

  const currentProjectId = useProjectStore((s) => s.currentProjectId);

  // Sync project ID to save store and initialize data for new projects
  useEffect(() => {
    if (!currentProjectId) return;
    const saveStore = useProjectSaveStore.getState();
    saveStore.setCurrentProject(currentProjectId);
    const savedData = saveStore.loadProject(currentProjectId);
    if (!savedData) {
      // Use project settings from the store
      const project = useProjectStore.getState().projects.find((p) => p.id === currentProjectId);
      saveStore.saveProject({
        timeline: {
          ...defaultVideo,
          name: project?.name ?? "Untitled",
          width: project?.width ?? 1920,
          height: project?.height ?? 1080,
          fps: project?.fps ?? 30,
        },
        mediaManifest: [],
        generationLog: [],
        chatHistory: [],
      });
    }
  }, [currentProjectId]);

  // Load saved project data or use default
  const savedData = currentProjectId ? useProjectSaveStore.getState().loadProject(currentProjectId) : null;
  const videoData = savedData?.timeline ?? defaultVideo;

  return (
    <CrashBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          {currentProjectId ? (
            <>
              <VideoFlowInit video={videoData as VideoJSON} />
              <Layout />
            </>
          ) : (
            <HomeView />
          )}
        </TooltipProvider>
      </QueryClientProvider>
    </CrashBoundary>
  );
}

export default App;
