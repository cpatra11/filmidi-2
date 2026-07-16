import { useAccountStore } from "@/store/useAccountStore";
import { getSecureApiKey } from "@/lib/secureApiKey";

const BACKEND_URL = "http://localhost:3000";
const DASHSCOPE_BASE = "https://dashscope-intl.aliyuncs.com";

async function getApiKey(): Promise<string | null> {
  return getSecureApiKey();
}

interface AuthHeaders {
  Authorization?: string;
  "x-api-key"?: string;
}

async function getAuthHeaders(): Promise<AuthHeaders> {
  const account = useAccountStore.getState();
  if (account.isSignedIn() && account.sessionToken) {
    return { Authorization: `Bearer ${account.sessionToken}` };
  }
  const key = await getApiKey();
  if (key) {
    return { "x-api-key": key };
  }
  return {};
}

type RouteType = "generation" | "transcription" | "agent" | "direct";

function getRouteConfig(type: RouteType): { baseUrl: string; pathPrefix: string } {
  const account = useAccountStore.getState();
  if (account.isSignedIn() && account.sessionToken) {
    return { baseUrl: BACKEND_URL, pathPrefix: `/api/v1/${type === "direct" ? "" : type}` };
  }
  return { baseUrl: DASHSCOPE_BASE, pathPrefix: "" };
}

export async function apiPost<T = unknown>(
  type: RouteType,
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const { baseUrl, pathPrefix } = getRouteConfig(type);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(await getAuthHeaders()) as Record<string, string>,
  };

  // DashScope uses different auth header and API structure
  if (baseUrl === DASHSCOPE_BASE && type === "generation") {
    const key = await getApiKey();
    if (!key) throw new Error("No API key configured");
    headers["Authorization"] = `Bearer ${key}`;
    delete headers["x-api-key"];
  }

  const url = `${baseUrl}${pathPrefix}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`API error (${res.status}): ${text}`);
  }

  return res.json() as Promise<T>;
}

export async function apiGet<T = unknown>(
  type: RouteType,
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  const { baseUrl, pathPrefix } = getRouteConfig(type);
  const headers: Record<string, string> = {
    ...(await getAuthHeaders()) as Record<string, string>,
  };

  if (baseUrl === DASHSCOPE_BASE) {
    const key = await getApiKey();
    if (!key) throw new Error("No API key configured");
    headers["Authorization"] = `Bearer ${key}`;
    delete headers["x-api-key"];
  }

  const url = `${baseUrl}${pathPrefix}${path}`;
  const res = await fetch(url, { headers, signal });

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`API error (${res.status}): ${text}`);
  }

  return res.json() as Promise<T>;
}
