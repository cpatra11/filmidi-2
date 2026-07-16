import { useAccountStore } from "@/store/useAccountStore";

const BASE_URL = "https://dashscope-intl.aliyuncs.com";
const BACKEND_URL = "http://localhost:3000";

export type GenerationType = "image" | "video" | "audio";

export interface GenerationParams {
  prompt: string;
  model: string;
  duration?: number;
  aspectRatio?: string;
  resolution?: string;
  quality?: string;
  numImages?: number;
  voice?: string;
  lyrics?: string;
  styleInstructions?: string;
  instrumental?: boolean;
  generateAudio?: boolean;
  startFrameUrl?: string;
  endFrameUrl?: string;
  sourceVideoUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  videoUrl?: string;
}

export interface GenerationResult {
  taskId?: string;
  status: "succeeded" | "failed" | "running" | "queued" | "unknown";
  resultUrls?: string[];
  errorMessage?: string;
}

function qwenEndpoint(model: string, type: GenerationType): string {
  if (model === "wan2.7-image-pro") {
    return `${BASE_URL}/api/v1/services/aigc/wanx-image-generation/generation`;
  }
  if (model.startsWith("happyhorse-")) {
    let suffix: string;
    if (model === "happyhorse-1.1-i2v") {
      suffix = "happyhorse-image-to-video";
    } else if (model === "happyhorse-1.1-r2v") {
      suffix = "happyhorse-reference-to-video";
    } else {
      suffix = "happyhorse-text-to-video";
    }
    return `${BASE_URL}/api/v1/services/aigc/video-generation/${suffix}`;
  }
  switch (type) {
    case "image":
    case "audio":
      return `${BASE_URL}/api/v1/services/aigc/multimodal-generation/generation`;
    case "video":
      return `${BASE_URL}/api/v1/services/aigc/video-generation/video-synthesis`;
  }
}

function isAsync(model: string, type: GenerationType): boolean {
  if (model.startsWith("happyhorse-")) return true;
  return type === "video";
}

function buildBody(model: string, type: GenerationType, params: GenerationParams): Record<string, unknown> {
  switch (type) {
    case "image": {
      const input: Record<string, unknown> = { prompt: params.prompt };
      if (params.referenceImageUrls?.length) {
        input["image_url"] = params.referenceImageUrls[0];
      }
      const size = resolutionToSize(params.resolution, params.aspectRatio);
      return {
        model,
        input,
        parameters: {
          size: size ?? "1024x1024",
          n: params.numImages ?? 1,
        },
      };
    }
    case "video": {
      const input: Record<string, unknown> = { prompt: params.prompt };
      if (params.sourceVideoUrl) input["video_url"] = params.sourceVideoUrl;
      if (params.startFrameUrl) input["start_frame_url"] = params.startFrameUrl;
      if (params.endFrameUrl) input["end_frame_url"] = params.endFrameUrl;
      if (params.referenceImageUrls?.length) input["image_url"] = params.referenceImageUrls[0];
      const size = resolutionToSize(params.resolution, params.aspectRatio);
      return {
        model,
        input,
        parameters: {
          duration: params.duration ?? 5,
          size: size ?? "1280x720",
        },
      };
    }
    case "audio": {
      const input: Record<string, unknown> = { text: params.prompt };
      if (params.videoUrl) input["video_url"] = params.videoUrl;
      const parameters: Record<string, unknown> = {};
      if (params.voice) parameters["voice"] = params.voice;
      if (params.lyrics) parameters["lyrics"] = params.lyrics;
      if (params.styleInstructions) parameters["style_instructions"] = params.styleInstructions;
      if (params.instrumental) parameters["instrumental"] = true;
      if (params.duration) parameters["duration"] = params.duration;
      return { model, input, parameters };
    }
  }
}

function resolutionToSize(resolution?: string, aspectRatio?: string): string | null {
  const ar = aspectRatio ?? "16:9";
  if (resolution === "4K") {
    if (ar === "9:16") return "2160x3840";
    if (ar === "1:1") return "3840x3840";
    if (ar === "4:3") return "2880x2160";
    if (ar === "3:4") return "2160x2880";
    return "3840x2160";
  }
  if (resolution === "1080p") {
    if (ar === "9:16") return "1080x1920";
    if (ar === "1:1") return "1920x1920";
    if (ar === "4:3") return "1440x1080";
    if (ar === "3:4") return "1080x1440";
    return "1920x1080";
  }
  // 720p or default
  if (ar === "9:16") return "720x1280";
  if (ar === "1:1") return "1280x1280";
  if (ar === "4:3") return "960x720";
  if (ar === "3:4") return "720x960";
  return "1280x720";
}

export async function submitGeneration(
  apiKey: string,
  type: GenerationType,
  params: GenerationParams,
): Promise<{ taskId?: string; resultUrl?: string }> {
  const account = useAccountStore.getState();
  const isBackendUser = account.isSignedIn();

  if (isBackendUser && account.sessionToken) {
    // Route through backend proxy
    const body: Record<string, unknown> = {
      model: params.model,
      type,
      prompt: params.prompt,
      duration: params.duration,
      aspectRatio: params.aspectRatio,
      quality: params.quality,
      voice: params.voice,
      lyrics: params.lyrics,
      instrumental: params.instrumental,
      videoUrl: params.videoUrl,
      sourceVideoUrl: params.sourceVideoUrl,
      startFrameUrl: params.startFrameUrl,
      endFrameUrl: params.endFrameUrl,
      referenceImageUrls: params.referenceImageUrls,
      referenceVideoUrls: params.referenceVideoUrls,
      referenceAudioUrls: params.referenceAudioUrls,
      size: params.resolution ? `${params.resolution}` : undefined,
    };

    const res = await fetch(`${BACKEND_URL}/api/v1/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${account.sessionToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "unknown error");
      throw new Error(`Generation API error ${res.status}: ${text}`);
    }

    const data = await res.json() as Record<string, unknown>;
    const taskId = data.taskId as string | undefined;
    if (taskId) return { taskId };

    const resultUrls = data.resultUrls as string[] | undefined;
    if (resultUrls?.length) return { resultUrl: resultUrls[0] };

    return {};
  }

  // Direct DashScope path (existing code)
  const body = buildBody(params.model, type, params);
  const url = qwenEndpoint(params.model, type);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (isAsync(params.model, type)) {
    headers["X-DashScope-Async"] = "enable";
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`Generation API error ${res.status}: ${text}`);
  }

  const data = await res.json() as Record<string, unknown>;
  const output = data.output as Record<string, unknown> | undefined;

  const taskId = output?.task_id as string | undefined;
  if (taskId) return { taskId };

  // Synchronous result (image/audio)
  const results = output?.results as Array<Record<string, unknown>> | undefined;
  if (results?.length) {
    const urls = results[0].url as string | undefined;
    if (urls) return { resultUrl: urls };
    const urlArray = results[0].urls as string[] | undefined;
    if (urlArray?.length) return { resultUrl: urlArray[0] };
  }

  return {};
}

export async function pollTask(
  apiKey: string,
  taskId: string,
): Promise<GenerationResult> {
  const account = useAccountStore.getState();
  const isBackendUser = account.isSignedIn();

  if (isBackendUser && account.sessionToken) {
    const res = await fetch(`${BACKEND_URL}/api/v1/generations/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${account.sessionToken}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "unknown error");
      throw new Error(`Poll API error ${res.status}: ${text}`);
    }
    return res.json() as Promise<GenerationResult>;
  }

  const res = await fetch(`${BASE_URL}/api/v1/tasks/${taskId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`Poll API error ${res.status}: ${text}`);
  }

  const data = await res.json() as Record<string, unknown>;
  const output = data.output as Record<string, unknown> | undefined;
  const status = output?.task_status as string | undefined;
  const results = output?.results as Array<Record<string, unknown>> | undefined;

  let mappedStatus: GenerationResult["status"];
  switch (status) {
    case "SUCCEEDED": mappedStatus = "succeeded"; break;
    case "FAILED": mappedStatus = "failed"; break;
    case "PENDING": mappedStatus = "queued"; break;
    default: mappedStatus = "running"; break;
  }

  const resultUrls = results
    ?.map((r) => (r.url as string | undefined) ?? (r.urls as string[] | undefined)?.[0])
    .filter((u): u is string => !!u);

  return {
    taskId,
    status: mappedStatus,
    resultUrls,
    errorMessage: mappedStatus === "failed" ? JSON.stringify(output) : undefined,
  };
}

export async function waitForTask(
  apiKey: string,
  taskId: string,
  onProgress?: (status: string) => void,
  signal?: AbortSignal,
): Promise<GenerationResult> {
  const account = useAccountStore.getState();
  const isBackendUser = account.isSignedIn();

  let delay = 2000;
  const maxDelay = 10000;
  while (!signal?.aborted) {
    await new Promise((r) => setTimeout(r, delay));

    if (isBackendUser && account.sessionToken) {
      const res = await fetch(
        `${BACKEND_URL}/api/v1/generations/tasks/${taskId}`,
        { headers: { Authorization: `Bearer ${account.sessionToken}` } },
      );
      if (res.ok) {
        const result = await res.json() as GenerationResult;
        onProgress?.(result.status);
        if (result.status === "succeeded" || result.status === "failed") {
          return result;
        }
      }
    } else {
      const result = await pollTask(apiKey, taskId);
      onProgress?.(result.status);
      if (result.status === "succeeded" || result.status === "failed") {
        return result;
      }
    }

    delay = Math.min(delay + 1000, maxDelay);
  }
  return { status: "failed", errorMessage: "Aborted" };
}
