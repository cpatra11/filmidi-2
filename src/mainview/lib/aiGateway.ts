import { createGateway } from "@ai-sdk/gateway";

export const AI_GATEWAY_OPENAI_BASE_URL = "https://ai-gateway.vercel.sh/v1";
export const AI_GATEWAY_SDK_BASE_URL = "https://ai-gateway.vercel.sh/v4/ai";
export const DEFAULT_TRANSCRIPTION_MODEL = "xai/grok-stt";

/** AI SDK adds a User-Agent header that the Gateway CORS policy rejects. */
export const browserSafeGatewayFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const headers = new Headers(init?.headers);
  headers.delete("user-agent");
  return globalThis.fetch(input, { ...init, headers });
};

export type GatewayCapability = "chat" | "image" | "video" | "audio" | "transcription" | "upscale";

export function createFilmidiGateway(apiKey: string) {
  return createGateway({
    apiKey: apiKey.trim(),
    baseURL: AI_GATEWAY_SDK_BASE_URL,
    fetch: browserSafeGatewayFetch as any,
  });
}

export function gatewayModelProvider(modelId: string): string {
  return modelId.includes("/") ? modelId.slice(0, modelId.indexOf("/")) : "unknown";
}

export interface GatewayModelInfo {
  id: string;
  name: string;
  type: string;
  description: string;
  capabilities?: string[];
}

export function normalizeGatewayModel(model: Record<string, unknown>): GatewayModelInfo | null {
  const id = String(model.id ?? "").trim();
  if (!id) return null;
  const capabilities = Array.isArray(model.capabilities)
    ? model.capabilities.map(String)
    : undefined;
  return {
    id,
    name: String(model.name ?? id),
    type: String(model.type ?? model.modelType ?? "language"),
    description: String(model.description ?? "Vercel AI Gateway model"),
    ...(capabilities ? { capabilities } : {}),
  };
}
