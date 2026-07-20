import { useEditorStore } from "@videoflow/react-video-editor";
import { useProjectSaveStore } from "@/store/useProjectSaveStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useMediaPanelStore } from "@/store/useMediaPanelStore";
import { useGenerationStore } from "@/store/useGenerationStore";

export type SaveTarget =
  | { kind: "file"; handle: FileSystemFileHandle; path: string }
  | { kind: "fallback"; handle: null }
  | null;

export async function pickSaveFile(
  fileName: string,
  ext: string,
  description: string,
): Promise<SaveTarget> {
  const wsp = (window as unknown as {
    showSaveFilePicker?: (opts: Record<string, unknown>) => Promise<FileSystemFileHandle>;
  }).showSaveFilePicker;
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
    if (err instanceof DOMException && err.name === "AbortError") return null;
    return { kind: "fallback", handle: null };
  }
}

export async function saveBlob(
  blob: Blob,
  fileName: string,
  ext: string,
  description: string,
  preferredHandle: FileSystemFileHandle | null = null,
): Promise<boolean> {
  if (preferredHandle) {
    const writable = await preferredHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  }

  const picked = await pickSaveFile(fileName, ext, description);
  if (picked === null) return false;

  if (picked.kind === "file") {
    const writable = await picked.handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileName}.${ext}`;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}

export async function saveText(
  text: string,
  fileName: string,
  ext: string,
  description: string,
  mimeType = "application/octet-stream",
  preferredHandle: FileSystemFileHandle | null = null,
): Promise<boolean> {
  return saveBlob(new Blob([text], { type: mimeType }), fileName, ext, description, preferredHandle);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeLayerForExport(layer: any): any {
  const copy = cloneJson(layer);
  const settings = { ...(copy.settings ?? {}) };
  const startTime = Number(settings.startTime ?? copy.startTime ?? 0);
  const sourceStart = Number(settings.sourceStart ?? copy.sourceStart ?? 0);
  const sourceDuration = Number(settings.sourceDuration ?? copy.sourceDuration ?? copy.duration ?? 0);
  const speed = Math.max(Math.abs(Number(settings.speed ?? copy.speed ?? 1)), 0.0001);
  const duration = sourceDuration / speed;

  copy.startTime = startTime;
  copy.sourceStart = sourceStart;
  copy.sourceDuration = sourceDuration;
  copy.duration = duration;
  copy.settings = {
    ...settings,
    startTime,
    sourceStart,
    sourceDuration,
    speed: Number(settings.speed ?? copy.speed ?? 1),
  };

  if (Array.isArray(copy.children)) {
    copy.children = copy.children.map((child: any) => normalizeLayerForExport(child));
  }

  return copy;
}

export function normalizeVideoForExport(video: any): any {
  const copy = cloneJson(video);
  if (Array.isArray(copy.layers)) {
    copy.layers = copy.layers.map((layer: any) => normalizeLayerForExport(layer));
  }
  return copy;
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function formatSeconds(seconds: number): string {
  const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return `${value.toFixed(3).replace(/\.?0+$/, "")}s`;
}

function getVideoLayers(video: any): any[] {
  return Array.isArray(video?.layers) ? video.layers : [];
}

function getClipName(layer: any): string {
  const raw = layer?.settings?.name ?? layer?.name ?? layer?.id ?? "Clip";
  return String(raw);
}

function getSourceUrl(layer: any): string {
  return String(layer?.settings?.source ?? layer?.source ?? "");
}

function getLayerStart(layer: any): number {
  return Number(layer?.settings?.startTime ?? layer?.startTime ?? 0);
}

function getLayerSourceStart(layer: any): number {
  return Number(layer?.settings?.sourceStart ?? layer?.sourceStart ?? 0);
}

function getLayerDuration(layer: any): number {
  return Number(layer?.settings?.sourceDuration ?? layer?.sourceDuration ?? layer?.duration ?? 0);
}

export function serializeTimelineXmeml(video: any): string {
  const fps = Number(video?.fps ?? 30);
  const layers = getVideoLayers(video).slice().sort((a, b) => getLayerStart(a) - getLayerStart(b));

  const buildClip = (layer: any): string => {
    const startFrames = Math.round(getLayerStart(layer) * fps);
    const durationFrames = Math.max(1, Math.round(getLayerDuration(layer) * fps));
    const sourceStartFrames = Math.max(0, Math.round(getLayerSourceStart(layer) * fps));
    const sourceEndFrames = sourceStartFrames + durationFrames;
    const name = escapeXml(getClipName(layer));
    const src = escapeXml(getSourceUrl(layer));
    return [
      "        <clipitem id=\"clipitem-",
      escapeXml(String(layer?.id ?? name)),
      "\">",
      `<name>${name}</name>`,
      `<enabled>${layer?.settings?.enabled === false ? "FALSE" : "TRUE"}</enabled>`,
      `<start>${startFrames}</start>`,
      `<end>${startFrames + durationFrames}</end>`,
      `<in>${sourceStartFrames}</in>`,
      `<out>${sourceEndFrames}</out>`,
      `<file><name>${name}</name><pathurl>${src}</pathurl></file>`,
      `</clipitem>`,
    ].join("");
  };

  const videoTrack = layers.filter((layer) => layer?.type !== "audio");
  const audioTrack = layers.filter((layer) => layer?.type === "audio");

  return `<?xml version="1.0" encoding="UTF-8"?>
<xmeml version="5">
  <sequence>
    <name>${escapeXml(String(video?.name ?? "Untitled"))}</name>
    <duration>${Math.max(1, Math.round(Number(video?.duration ?? 0) * fps))}</duration>
    <rate>
      <timebase>${Math.round(fps)}</timebase>
      <ntsc>FALSE</ntsc>
    </rate>
    <media>
      <video>
        <track>
${videoTrack.map((layer) => buildClip(layer)).join("\n")}
        </track>
      </video>
      <audio>
        <track>
${audioTrack.map((layer) => buildClip(layer)).join("\n")}
        </track>
      </audio>
    </media>
  </sequence>
</xmeml>
`;
}

export function serializeTimelineFcpxml(video: any): string {
  const fps = Number(video?.fps ?? 30);
  const layers = getVideoLayers(video).slice().sort((a, b) => getLayerStart(a) - getLayerStart(b));
  const assetIds = new Map<string, string>();
  const assets: string[] = [];

  for (const layer of layers) {
    const src = getSourceUrl(layer);
    if (!src || assetIds.has(src)) continue;
    const assetId = `r${assetIds.size + 1}`;
    assetIds.set(src, assetId);
    const name = escapeXml(getClipName(layer));
    assets.push(
      `    <asset id="${assetId}" name="${name}" src="${escapeXml(src)}" start="0s" duration="${formatSeconds(Number(video?.duration ?? 0))}" hasVideo="${layer?.type !== "audio" ? "1" : "0"}" hasAudio="${layer?.type === "audio" ? "1" : "0"}" />`,
    );
  }

  const clipNodes = layers.map((layer) => {
    const src = getSourceUrl(layer);
    const assetId = assetIds.get(src);
    const start = formatSeconds(getLayerStart(layer));
    const sourceStart = formatSeconds(getLayerSourceStart(layer));
    const duration = formatSeconds(getLayerDuration(layer));
    const lane = String(Math.max(0, Number(layer?.track ?? 0) + 1));
    const name = escapeXml(getClipName(layer));
    return `          <asset-clip name="${name}" ref="${assetId ?? "r1"}" offset="${start}" start="${sourceStart}" duration="${duration}" lane="${lane}" />`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<fcpxml version="1.13">
  <resources>
    <format id="r-format" name="Filmidi ${Math.round(fps)}fps" frameDuration="1/${Math.round(fps)}s" width="${Number(video?.width ?? 1920)}" height="${Number(video?.height ?? 1080)}" />
${assets.join("\n")}
  </resources>
  <library>
    <event name="Filmidi">
      <project name="${escapeXml(String(video?.name ?? "Untitled"))}">
        <sequence format="r-format" duration="${formatSeconds(Number(video?.duration ?? 0))}">
          <spine>
${clipNodes.join("\n")}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}

export async function serializeFilmidiPackage(): Promise<string> {
  const editor = useEditorStore.getState();
  const projectStore = useProjectStore.getState();
  const projectId = projectStore.currentProjectId;
  const { useAgentStore } = await import("@/store/useAgentStore");

  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    project: {
      id: projectId,
      name: projectStore.projects.find((p) => p.id === projectId)?.name ?? editor.video?.name ?? "Untitled",
    },
    timeline: editor.video,
    mediaManifest: {
      assets: useMediaPanelStore.getState().assets,
      folders: useMediaPanelStore.getState().folders,
    },
    generationLog: useGenerationStore.getState().history,
    chatHistory: useAgentStore.getState().sessions,
  };

  return JSON.stringify(payload, null, 2);
}

export function getTimelineExportText(video: any, format: "xmeml" | "fcpxml"): string {
  return format === "fcpxml" ? serializeTimelineFcpxml(video) : serializeTimelineXmeml(video);
}
