import { useRef, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Select from "@radix-ui/react-select";
import * as RadioGroup from "@radix-ui/react-radio-group";
import { X, Download, Film, FileText, Package, ChevronDown, Check, AlertCircle, Square } from "lucide-react";
import {
  useExportStore,
  getFileExtension,
  getContainerLabel,
  getResolutionPixels,
  estimateFileSize,
  type VideoCodec,
  type ExportResolution,
  type ExportDestination,
  type TimelineExportFormat,
  type FCPXMLVersion,
  type FCPXMLTarget,
} from "@/store/useExportStore";
import { useEditorStore } from "@videoflow/react-video-editor";
import BrowserRenderer from "@videoflow/renderer-browser";

/* ------------------------------------------------------------------ */
/*  Select helpers                                                     */
/* ------------------------------------------------------------------ */

function SelectItem({
  value,
  children,
}: {
  value: string;
  children: React.ReactNode;
}) {
  return (
    <Select.Item
      value={value}
      className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-[#aaaacc] rounded cursor-pointer outline-none select-none data-[highlighted]:bg-white/10 data-[state=checked]:text-[#e0e0ee]"
    >
      <Select.ItemIndicator>
        <Check className="w-3 h-3 text-white/70" />
      </Select.ItemIndicator>
      <Select.ItemText>{children}</Select.ItemText>
    </Select.Item>
  );
}

function SettingSelect({
  label,
  value,
  onValueChange,
  children,
}: {
  label: string;
  value: string;
  onValueChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium text-[#8888aa]">{label}</span>
      <Select.Root value={value} onValueChange={onValueChange}>
        <Select.Trigger className="flex items-center justify-between gap-2 px-2 py-1.5 bg-white/5 border border-white/10 rounded-lg text-[11px] text-[#ccccee] outline-none hover:bg-white/8 transition-colors">
          <Select.Value />
          <Select.Icon>
            <ChevronDown className="w-3 h-3 text-[#666688]" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            position="popper"
            sideOffset={4}
            className="bg-[#0A0A0A] border border-[#1C1C1C] rounded-lg shadow-xl z-[100] max-h-[200px] overflow-y-auto min-w-[160px]"
          >
            <Select.Viewport className="p-1">
              {children}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Destination tabs                                                   */
/* ------------------------------------------------------------------ */

const DESTINATIONS: { value: ExportDestination; icon: React.ElementType; label: string }[] = [
  { value: "video", icon: Film, label: "Video" },
  { value: "timeline", icon: FileText, label: "Timeline" },
  { value: "filmidiProject", icon: Package, label: "Filmidi Project" },
];

/* ------------------------------------------------------------------ */
/*  Video settings                                                     */
/* ------------------------------------------------------------------ */

function VideoSettings() {
  const { codec, setCodec, resolution, setResolution } = useExportStore();

  return (
    <div className="flex flex-col gap-3">
      <SettingSelect label="Codec" value={codec} onValueChange={(v) => setCodec(v as VideoCodec)}>
        <SelectItem value="h264">H.264</SelectItem>
        <SelectItem value="h265">H.265 (HEVC)</SelectItem>
        <SelectItem value="prores">Apple ProRes</SelectItem>
      </SettingSelect>

      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-medium text-[#8888aa]">File Type</span>
        <div className="px-2 py-1.5 bg-white/5 border border-white/5 rounded-lg text-[11px] text-[#666688]">
          {getContainerLabel(codec)}
        </div>
      </div>

      <SettingSelect label="Resolution" value={resolution} onValueChange={(v) => setResolution(v as ExportResolution)}>
        <SelectItem value="matchTimeline">Match Timeline</SelectItem>
        <SelectItem value="4k">4K (3840×2160)</SelectItem>
        <SelectItem value="2k">2K (2048×1080)</SelectItem>
        <SelectItem value="1080p">1080p (1920×1080)</SelectItem>
        <SelectItem value="720p">720p (1280×720)</SelectItem>
      </SettingSelect>

      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-medium text-[#8888aa]">Frame Rate</span>
        <div className="px-2 py-1.5 bg-white/5 border border-white/5 rounded-lg text-[11px] text-[#666688]">
          Match Timeline
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Timeline settings                                                  */
/* ------------------------------------------------------------------ */

function TimelineSettings() {
  const {
    timelineFormat, setTimelineFormat,
    fcpxmlVersion, setFCPXMLVersion,
    fcpxmlTarget, setFCPXMLTarget,
  } = useExportStore();

  return (
    <div className="flex flex-col gap-3">
      <span className="text-[10px] font-medium text-[#8888aa]">Format</span>
      <RadioGroup.Root
        value={timelineFormat}
        onValueChange={(v) => setTimelineFormat(v as TimelineExportFormat)}
        className="flex gap-2"
      >
        <RadioGroup.Item
          value="xmeml"
          className={`flex-1 flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-colors cursor-pointer ${
            timelineFormat === "xmeml"
              ? "border-white/20 bg-white/5"
              : "border-white/10 bg-white/5 hover:bg-white/8"
          }`}
        >
          <FileText className={`w-5 h-5 ${timelineFormat === "xmeml" ? "text-white/70" : "text-[#666688]"}`} />
          <span className="text-[11px] text-[#ccccee]">XMEML</span>
          <span className="text-[9px] text-[#666688] text-center">Premiere Pro</span>
        </RadioGroup.Item>

        <RadioGroup.Item
          value="fcpxml"
          className={`flex-1 flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-colors cursor-pointer ${
            timelineFormat === "fcpxml"
              ? "border-white/20 bg-white/5"
              : "border-white/10 bg-white/5 hover:bg-white/8"
          }`}
        >
          <FileText className={`w-5 h-5 ${timelineFormat === "fcpxml" ? "text-white/70" : "text-[#666688]"}`} />
          <span className="text-[11px] text-[#ccccee]">FCPXML</span>
          <span className="text-[9px] text-[#666688] text-center">DaVinci / Final Cut</span>
        </RadioGroup.Item>
      </RadioGroup.Root>

      {timelineFormat === "fcpxml" && (
        <>
          <SettingSelect label="FCPXML Version" value={fcpxmlVersion} onValueChange={(v) => setFCPXMLVersion(v as FCPXMLVersion)}>
            <SelectItem value="v1.14">v1.14 (FCP 12+)</SelectItem>
            <SelectItem value="v1.13">v1.13 (FCP 10.6+)</SelectItem>
            <SelectItem value="v1.12">v1.12</SelectItem>
            <SelectItem value="v1.11">v1.11</SelectItem>
            <SelectItem value="v1.10">v1.10 (Resolve 18+)</SelectItem>
          </SettingSelect>

          <SettingSelect label="Target Application" value={fcpxmlTarget} onValueChange={(v) => setFCPXMLTarget(v as FCPXMLTarget)}>
            <SelectItem value="resolve">DaVinci Resolve</SelectItem>
            <SelectItem value="fcp">Final Cut Pro</SelectItem>
          </SettingSelect>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Filmidi project settings                                           */
/* ------------------------------------------------------------------ */

function FilmidiProjectSettings() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2 p-3 bg-white/5 border border-white/10 rounded-lg">
        <Package className="w-4 h-4 text-white/70 mt-0.5 shrink-0" />
        <div>
          <div className="text-[11px] text-[#ccccee]">Self-contained project bundle</div>
          <div className="text-[10px] text-[#666688] mt-1">
            All referenced media files will be copied into the bundle.
            The timeline, metadata, and generation history are included.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Save location picker                                               */
/* ------------------------------------------------------------------ */

type PickerResult =
  | { kind: "file"; handle: FileSystemFileHandle; path: string }
  | { kind: "fallback"; handle: null }
  | null; // user cancelled

async function pickSaveFile(
  fileName: string,
  ext: string,
  description: string,
): Promise<PickerResult> {
  const wsp = (window as unknown as { showSaveFilePicker?: (opts: Record<string, unknown>) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
  if (!wsp) return { kind: "fallback", handle: null };

  try {
    const handle = await wsp({
      suggestedName: `${fileName}.${ext}`,
      types: [{
        description,
        accept: { "application/octet-stream": [`.${ext}`] },
      }],
    });
    return { kind: "file", handle, path: handle.name };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return null; // user cancelled
    }
    return { kind: "fallback", handle: null }; // unexpected error, fall back to download
  }
}

/* ------------------------------------------------------------------ */
/*  Main ExportDialog                                                  */
/* ------------------------------------------------------------------ */

export function ExportDialog() {
  const {
    isOpen, close, destination, setDestination,
    codec, resolution,
    exportStatus, progress, error, fileName, setFileName, savedFileSize,
    startExport, setProgress, setError, setExportComplete,
  } = useExportStore();

  const abortRef = useRef<AbortController | null>(null);

  const storeVideo = useEditorStore((s) => s.video);
  const duration = storeVideo.duration || 0;
  const fps = storeVideo.fps || 30;
  const timelineW = storeVideo.width || 1920;
  const timelineH = storeVideo.height || 1080;

  const { width: outW, height: outH } = getResolutionPixels(resolution, timelineW, timelineH);
  const durationStr = formatDuration(duration);
  const sizeEstimate = destination === "video"
    ? estimateFileSize(codec, resolution, duration)
    : null;
  const ext = getFileExtension({ destination, codec, timelineFormat: useExportStore.getState().timelineFormat });
  const container = destination === "video" ? getContainerLabel(codec) : ext.toUpperCase();

  const handleCancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const handleExport = async () => {
    const ext = getFileExtension({ destination, codec, timelineFormat: useExportStore.getState().timelineFormat });

    // Pick save location
    const picked = await pickSaveFile(fileName, ext, destination === "video" ? "Video" : destination === "timeline" ? "Timeline" : "Filmidi Project");
    if (picked === null) return; // user cancelled the save dialog

    startExport();

    if (destination === "timeline" || destination === "filmidiProject") {
      setError("Timeline and project export are not yet available. Use Video export instead.");
      return;
    }

    if (destination === "video") {
      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const editorState = useEditorStore.getState();
        const video = {
          ...editorState.video,
          width: outW,
          height: outH,
          fps,
        };

        const raw = await BrowserRenderer.render(video, {
          signal: ac.signal,
          onProgress: (p) => setProgress(p),
          worker: true,
        });
        const blob = raw instanceof Blob ? raw : new Blob([raw], { type: "video/mp4" });

        abortRef.current = null;

        if (picked.kind === "file") {
          const writable = await picked.handle.createWritable();
          await writable.write(blob);
          await writable.close();
        } else {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${fileName}.${ext}`;
          a.style.display = "none";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }

        setExportComplete(blob.size);
      } catch (err: unknown) {
        abortRef.current = null;
        if (err instanceof DOMException && err.name === "AbortError") {
          setError("Export cancelled.");
        } else {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }
  };

  const isIdle = exportStatus === "idle";
  const isExporting = exportStatus === "exporting";
  const isComplete = exportStatus === "complete";
  const isError = exportStatus === "error";

  return (
    <Dialog.Root open={isOpen} onOpenChange={(v) => !v && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[90]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] max-h-[85vh] bg-[#0A0A0A] border border-[#1C1C1C] rounded-2xl shadow-2xl z-[91] flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 px-5 pt-4 pb-2 shrink-0">
            <Download className="w-4 h-4 text-white/70" />
            <Dialog.Title className="text-[14px] font-semibold text-[#e0e0ee]">
              Export
            </Dialog.Title>
            <div className="flex-1" />
            <Dialog.Close asChild>
              <button
                className="w-6 h-6 flex items-center justify-center text-[#666688] hover:text-[#aaaacc] cursor-pointer"
                disabled={isExporting}
              >
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Destination tabs */}
          <div className="px-5 pb-3 shrink-0">
            <div className="flex gap-1 p-0.5 rounded-lg bg-white/5 border border-white/5">
              {DESTINATIONS.map(({ value, icon: Icon, label }) => (
                <button
                  key={value}
                  onClick={() => setDestination(value)}
                  disabled={isExporting}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium cursor-pointer transition-colors ${
                    destination === value
                      ? "bg-white/10 text-[#e0e0ee]"
                      : "text-[#8888aa] hover:bg-white/5"
                  } disabled:opacity-50 disabled:cursor-default`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Settings body */}
          <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-3">
            {/* File name */}
            <div className="flex flex-col gap-1 mb-3">
              <span className="text-[10px] font-medium text-[#8888aa]">File Name</span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  disabled={isExporting || isComplete}
                  placeholder="Untitled"
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-[12px] text-[#e0e0ee] placeholder:text-[#555577] outline-none focus:border-white/20 disabled:opacity-50"
                />
                <span className="text-[11px] text-[#666688] font-mono">.{ext}</span>
              </div>
            </div>

            {destination === "video" && <VideoSettings />}
            {destination === "timeline" && <TimelineSettings />}
            {destination === "filmidiProject" && <FilmidiProjectSettings />}
          </div>

          {/* Error */}
          {isError && error && (
            <div className="mx-5 mb-2 flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg">
              <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
              <span className="text-[11px] text-red-400">{error}</span>
            </div>
          )}

          {/* Export Complete */}
          {isComplete && (
            <div className="mx-5 mb-2">
              <div className="flex items-center gap-2 px-3 py-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-emerald-300 font-medium">Export Complete</p>
                  <p className="text-[10px] text-emerald-400/60 truncate">
                    {fileName}.{ext}
                    {savedFileSize != null && ` · ${formatFileSize(savedFileSize)}`}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Progress */}
          {isExporting && (
            <div className="mx-5 mb-2">
              <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-white rounded-full transition-all duration-200"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
              <div className="text-[10px] text-[#666688] text-center mt-1">
                {Math.round(progress * 100)}%
              </div>
            </div>
          )}

          {/* Bottom bar */}
          <div className="flex items-center gap-3 px-5 py-3 border-t border-[#1C1C1C] shrink-0">
            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
              <div className="flex items-center gap-2 text-[10px] text-[#8888aa]">
                <span>{durationStr}</span>
                <span className="text-[#333355]">·</span>
                <span>{outW}×{outH}</span>
                <span className="text-[#333355]">·</span>
                <span>{container}</span>
              </div>
              {sizeEstimate && isIdle && (
                <div className="text-[10px] text-[#666688] font-mono">
                  {sizeEstimate}
                </div>
              )}
            </div>

            {isExporting ? (
              <button
                onClick={handleCancel}
                className="px-4 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-[11px] font-medium rounded-lg cursor-pointer transition-colors flex items-center gap-1.5"
              >
                <Square className="w-3 h-3" />
                Cancel
              </button>
            ) : isComplete ? (
              <Dialog.Close asChild>
                <button className="px-4 py-1.5 bg-white hover:bg-white/90 text-black text-[11px] font-medium rounded-lg cursor-pointer transition-colors">
                  Done
                </button>
              </Dialog.Close>
            ) : (
              <>
                <Dialog.Close asChild>
                  <button className="px-3 py-1.5 text-[11px] text-[#8888aa] hover:text-[#ccccee] cursor-pointer">
                    Cancel
                  </button>
                </Dialog.Close>
                <button
                  onClick={handleExport}
                  disabled={!fileName.trim() || isExporting}
                  className="px-4 py-1.5 bg-white hover:bg-white/90 text-black text-[11px] font-medium rounded-lg cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-default flex items-center gap-1.5"
                >
                  <Download className="w-3 h-3" />
                  Export
                </button>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
