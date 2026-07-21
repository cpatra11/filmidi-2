import { createGateway } from "@ai-sdk/gateway";
import { generateImage, experimental_generateVideo, experimental_generateSpeech } from "ai";

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
  segments?: string;
}

export interface GenerationResult {
  taskId?: string;
  status: "succeeded" | "failed" | "running" | "queued" | "unknown";
  resultUrls?: string[];
  errorMessage?: string;
}

function dataUrl(bytes: Uint8Array, mediaType: string): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return `data:${mediaType};base64,${btoa(binary)}`;
}

function modelFor(gateway: ReturnType<typeof createGateway>, model: string) {
  return gateway(model);
}

export async function submitGeneration(
  apiKey: string,
  type: GenerationType,
  params: GenerationParams,
): Promise<{ taskId?: string; resultUrl?: string }> {
  if (!apiKey.trim()) throw new Error("vercel_api_key_required");
  const gateway = createGateway({ apiKey: apiKey.trim(), baseURL: "https://ai-gateway.vercel.sh/v1" });

  if (type === "image") {
    const result = await generateImage({
      model: modelFor(gateway, params.model) as any,
      prompt: params.prompt,
      aspectRatio: params.aspectRatio as any,
      n: params.numImages ?? 1,
    });
    const image = result.images[0] as any;
    return { resultUrl: image.uint8Array ? dataUrl(image.uint8Array, image.mediaType ?? "image/png") : `data:image/png;base64,${image.base64}` };
  }

  if (type === "video") {
    const result = await experimental_generateVideo({
      model: modelFor(gateway, params.model) as any,
      prompt: params.prompt,
      duration: params.duration as any,
      aspectRatio: params.aspectRatio as any,
      resolution: params.resolution as any,
    } as any);
    const video = result.videos[0] as any;
    return { resultUrl: dataUrl(video.uint8Array, video.mediaType ?? "video/mp4") };
  }

  const result = await experimental_generateSpeech({
    model: modelFor(gateway, params.model) as any,
    text: params.lyrics?.trim() || params.prompt,
    voice: params.voice as any,
  } as any);
  const audio = result.audio as any;
  return { resultUrl: dataUrl(audio.uint8Array, audio.mediaType ?? "audio/mpeg") };
}

export async function pollTask(_apiKey: string, _taskId: string): Promise<GenerationResult> {
  return { status: "failed", errorMessage: "Direct Vercel generation does not use polling." };
}

export async function waitForTask(
  _apiKey: string,
  _taskId: string,
  _onProgress?: (status: string) => void,
  _signal?: AbortSignal,
): Promise<GenerationResult> {
  return { status: "failed", errorMessage: "Direct Vercel generation does not use polling." };
}
