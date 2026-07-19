import { useEditorStore, commands } from "@videoflow/react-video-editor";
import { useAppStore } from "@/store/useAppStore";
import { useHelpStore } from "@/store/useHelpStore";
import { useMediaPanelStore } from "@/store/useMediaPanelStore";
import { useProjectSaveStore, type ProjectData } from "@/store/useProjectSaveStore";
import { useProjectStore } from "@/store/useProjectStore";
import { getMediaDuration } from "./mediaDuration";

const { addLayerCommand } = commands;

function getDisplayName(urlOrFile: string | File | undefined): string {
  if (!urlOrFile) return "Clip";
  if (typeof urlOrFile === "string") {
    const parts = urlOrFile.split("/");
    const last = parts[parts.length - 1];
    return decodeURIComponent(last).replace(/\.[^.]+$/, "") || "Clip";
  }
  return urlOrFile.name.replace(/\.[^.]+$/, "") || "Clip";
}

function nextTrack(type: string, offset = 0): number {
  const layers = useEditorStore.getState().video.layers ?? [];
  const sameTypeCount = layers.filter((l: any) => l.type === type).length;
  return offset + sameTypeCount;
}

function setLayerTrack(commit: any, layerId: string, track: number) {
  commit((draft: any) => {
    const layer = draft.layers?.find((x: any) => x.id === layerId);
    if (layer) layer.track = Math.max(0, Math.floor(track));
  }, { label: "Set track" });
}

async function getCurrentProjectData(projectId: string | null): Promise<ProjectData> {
  const saveStore = useProjectSaveStore.getState();
  const saved = projectId ? await saveStore.loadProject(projectId) : null;
  return {
    timeline: useEditorStore.getState().video,
    mediaManifest: saved?.mediaManifest ?? [],
    generationLog: saved?.generationLog ?? [],
    chatHistory: saved?.chatHistory ?? [],
  };
}

export async function saveCurrentProject(): Promise<void> {
  const projectStore = useProjectStore.getState();
  const saveStore = useProjectSaveStore.getState();
  const projectId = projectStore.currentProjectId;
  if (!projectId) return;
  const data = await getCurrentProjectData(projectId);
  await saveStore.saveProject(data);
}

export async function saveProjectAsCopy(): Promise<void> {
  const projectStore = useProjectStore.getState();
  const currentId = projectStore.currentProjectId;
  if (!currentId) return;

  const current = projectStore.projects.find((p) => p.id === currentId);
  const baseName = current?.name ?? "Untitled Project";
  const name = window.prompt("Save project as:", `${baseName} Copy`);
  if (!name || !name.trim()) return;

  const nextName = name.trim();
  const data = await getCurrentProjectData(currentId);
  const id = projectStore.addProject(nextName, {
    width: current?.width ?? useEditorStore.getState().video.width ?? 1920,
    height: current?.height ?? useEditorStore.getState().video.height ?? 1080,
    fps: current?.fps ?? useEditorStore.getState().video.fps ?? 30,
  }, { select: false });
  await useProjectSaveStore.getState().importProject(id, data);
  projectStore.openProject(id);
  useAppStore.getState().setProjectName(nextName);
}

export function openProjectHome(): void {
  useProjectStore.getState().openProject(null);
}

export async function importMediaFromPicker(): Promise<void> {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.accept = "video/*,audio/*,image/*";

  const files = await new Promise<File[] | null>((resolve) => {
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.oncancel = () => resolve(null);
    input.click();
  });

  if (!files || files.length === 0) return;
  await importMediaFiles(files);
}

export async function importMediaFiles(files: File[] | FileList): Promise<void> {
  const mediaStore = useMediaPanelStore.getState();
  const editor = useEditorStore.getState();
  const fileArr = Array.from(files);
  const fps = editor.video.fps || 30;
  const startTime = editor.currentFrame / fps;

  for (const file of fileArr) {
    const type = file.type.startsWith("video/") ? "video" as const : file.type.startsWith("audio/") ? "audio" as const : "image" as const;
    const duration = await getMediaDuration(file, type);
    const id = `asset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const url = URL.createObjectURL(file);
    mediaStore.addAsset({
      id,
      name: file.name,
      type,
      url,
      duration,
      isGenerated: false,
      folderId: mediaStore.currentFolderId,
      createdAt: Date.now(),
    });
    if (editor.mediaImporter) editor.mediaImporter([file], { startTime, track: 0 });

    if (type === "video") {
      const { generateLinkId, setLayerLinkId } = await import("@/lib/linkUtils");
      const { commands: cmds } = await import("@videoflow/react-video-editor");
      const setSettingCommand = cmds.setSettingCommand;
      const linkId = generateLinkId();
      const clipName = getDisplayName(file);
      const audioTrack = nextTrack("audio", 0);
      const videoTrack = nextTrack("video", 10);
      cmds.setTrackSettingsCommand(editor.commit, audioTrack, { name: `A${audioTrack + 1}` });
      cmds.setTrackSettingsCommand(editor.commit, videoTrack, { name: `V${videoTrack - 9}` });
      const audioLayerId = await addLayerCommand(editor.commit, { type: "audio", source: url, sourceDuration: duration, startTime });
      setLayerTrack(editor.commit, audioLayerId, audioTrack);
      await cmds.setSettingCommand(editor.commit, audioLayerId, "name", `${clipName} Audio`);
      await setLayerLinkId(editor.commit, audioLayerId, linkId, setSettingCommand);
      const layerId = await addLayerCommand(editor.commit, { type, source: url, sourceDuration: duration, startTime });
      setLayerTrack(editor.commit, layerId, videoTrack);
      await cmds.setSettingCommand(editor.commit, layerId, "name", clipName);
      await setLayerLinkId(editor.commit, layerId, linkId, setSettingCommand);
      await cmds.setPropertyCommand(editor.commit, layerId, "mute", true);
    } else {
      const layerId = await addLayerCommand(editor.commit, { type, source: url, sourceDuration: duration, startTime });
      if (layerId) setLayerTrack(editor.commit, layerId, nextTrack("audio", 0));
    }
  }

  mediaStore.showToast(`Imported ${fileArr.length} file${fileArr.length > 1 ? "s" : ""}`);
  const s = useEditorStore.getState();
  s.bridge?.seek(s.currentFrame);
}

export function openHelp(): void {
  useHelpStore.getState().open();
}

export function showMcpInstructions(): void {
  alert([
    "Filmidi Editor — MCP Server",
    "",
    "Endpoint: http://127.0.0.1:19790/mcp",
    "",
    "To connect from Claude Desktop:",
    "1. Open Claude Desktop Settings",
    "2. Add an MCP server with URL http://127.0.0.1:19790/mcp",
    "3. Start Filmidi Editor first",
  ].join("\n"));
}

export function sendFeedback(): void {
  const message = window.prompt("Feedback", "");
  if (!message || !message.trim()) return;
  console.log("[feedback]", message.trim());
  alert("Feedback captured locally. Share the console output with the maintainer.");
}
