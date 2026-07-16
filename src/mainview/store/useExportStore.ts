import { create } from "zustand";

export type ExportDestination = "video" | "timeline" | "filmidiProject";
export type VideoCodec = "h264" | "h265" | "prores";
export type ExportResolution = "720p" | "1080p" | "2k" | "4k" | "matchTimeline";
export type TimelineExportFormat = "xmeml" | "fcpxml";
export type FCPXMLVersion = "v1.10" | "v1.11" | "v1.12" | "v1.13" | "v1.14";
export type FCPXMLTarget = "resolve" | "fcp";

export type ExportStatus = "idle" | "exporting" | "complete" | "error";

interface ExportState {
  isOpen: boolean;
  destination: ExportDestination;
  codec: VideoCodec;
  resolution: ExportResolution;
  timelineFormat: TimelineExportFormat;
  fcpxmlVersion: FCPXMLVersion;
  fcpxmlTarget: FCPXMLTarget;
  exportStatus: ExportStatus;
  progress: number;
  error: string | null;
  fileName: string;
  savedFileSize: number | null;
  savedFileHandle: FileSystemFileHandle | null;

  open: () => void;
  close: () => void;
  setDestination: (d: ExportDestination) => void;
  setCodec: (c: VideoCodec) => void;
  setResolution: (r: ExportResolution) => void;
  setTimelineFormat: (f: TimelineExportFormat) => void;
  setFCPXMLVersion: (v: FCPXMLVersion) => void;
  setFCPXMLTarget: (t: FCPXMLTarget) => void;
  setFileName: (n: string) => void;
  setProgress: (p: number) => void;
  setError: (e: string | null) => void;
  startExport: () => void;
  setExportComplete: (sizeBytes: number) => void;
  reset: () => void;
}

const DEFAULT_FILE_NAME = "Untitled";

const INITIAL_STATE = {
  isOpen: false,
  destination: "video" as ExportDestination,
  codec: "h264" as VideoCodec,
  resolution: "1080p" as ExportResolution,
  timelineFormat: "fcpxml" as TimelineExportFormat,
  fcpxmlVersion: "v1.13" as FCPXMLVersion,
  fcpxmlTarget: "resolve" as FCPXMLTarget,
  exportStatus: "idle" as ExportStatus,
  progress: 0,
  error: null as string | null,
  fileName: DEFAULT_FILE_NAME,
  savedFileSize: null as number | null,
  savedFileHandle: null as FileSystemFileHandle | null,
};

export function getFileExtension(state: { destination: ExportDestination; codec: VideoCodec; timelineFormat: TimelineExportFormat }): string {
  if (state.destination === "filmidiProject") return "filmidi";
  if (state.destination === "timeline") {
    return state.timelineFormat === "fcpxml" ? "fcpxml" : "xml";
  }
  if (state.codec === "prores") return "mov";
  return "mp4";
}

export function getContainerLabel(codec: VideoCodec): string {
  switch (codec) {
    case "h264": return "MP4 (MPEG-4)";
    case "h265": return "MP4 (HEVC)";
    case "prores": return "MOV (QuickTime)";
  }
}

export function getResolutionPixels(resolution: ExportResolution, timelineWidth: number, timelineHeight: number): { width: number; height: number } {
  switch (resolution) {
    case "720p": return { width: 1280, height: 720 };
    case "1080p": return { width: 1920, height: 1080 };
    case "2k": return { width: 2048, height: 1080 };
    case "4k": return { width: 3840, height: 2160 };
    case "matchTimeline": return { width: timelineWidth, height: timelineHeight };
  }
}

export function estimateFileSize(
  codec: VideoCodec,
  resolution: ExportResolution,
  durationSeconds: number,
): string {
  const bitratesMbps: Record<VideoCodec, Record<string, number>> = {
    h264: { "720p": 5, "1080p": 10, "2k": 15, "4k": 40, matchTimeline: 10 },
    h265: { "720p": 3, "1080p": 6, "2k": 10, "4k": 25, matchTimeline: 6 },
    prores: { "720p": 20, "1080p": 45, "2k": 60, "4k": 150, matchTimeline: 45 },
  };
  const rate = bitratesMbps[codec][resolution] ?? 10;
  const sizeMB = (rate * durationSeconds) / 8;
  if (sizeMB < 1) return `~${Math.round(sizeMB * 1024)} KB`;
  if (sizeMB < 1000) return `~${Math.round(sizeMB)} MB`;
  return `~${(sizeMB / 1000).toFixed(1)} GB`;
}

export const useExportStore = create<ExportState>((set, get) => ({
  ...INITIAL_STATE,

  open: () => set({ isOpen: true, error: null, exportStatus: "idle", progress: 0, savedFileSize: null, savedFileHandle: null }),
  close: () => {
    const { exportStatus } = get();
    if (exportStatus === "exporting") return;
    set({ isOpen: false });
  },
  setDestination: (d) => set({ destination: d }),
  setCodec: (c) => set({ codec: c }),
  setResolution: (r) => set({ resolution: r }),
  setTimelineFormat: (f) => set({ timelineFormat: f }),
  setFCPXMLVersion: (v) => set({ fcpxmlVersion: v }),
  setFCPXMLTarget: (t) => set({ fcpxmlTarget: t }),
  setFileName: (n) => set({ fileName: n }),
  setProgress: (p) => set({ progress: p }),
  setError: (e) => set({ error: e, exportStatus: e ? "error" : get().exportStatus }),
  startExport: () => set({ exportStatus: "exporting", progress: 0, error: null, savedFileSize: null }),
  setExportComplete: (sizeBytes) => set({ exportStatus: "complete", progress: 1, savedFileSize: sizeBytes }),
  reset: () => set({ ...INITIAL_STATE, savedFileHandle: null }),
}));
