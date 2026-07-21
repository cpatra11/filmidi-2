import { useAccountStore } from "@/store/useAccountStore";
import { FILMIDI_BACKEND_URL } from "@/lib/backendConfig";

const BACKEND_URL = FILMIDI_BACKEND_URL;

interface AuthHeaders {
  Authorization?: string;
}

function getAuthHeaders(): AuthHeaders {
  const account = useAccountStore.getState();
  if (account.isSignedIn() && account.sessionToken) {
    return { Authorization: `Bearer ${account.sessionToken}` };
  }
  throw new Error("Sign in to use Filmidi cloud features.");
}

type RouteType = "generation" | "transcription" | "agent" | "direct";

function getRouteConfig(type: RouteType): { baseUrl: string; pathPrefix: string } {
  return { baseUrl: BACKEND_URL, pathPrefix: `/api/v1/${type === "direct" ? "" : type}` };
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
    ...(getAuthHeaders() as Record<string, string>),
  };

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
    ...(getAuthHeaders() as Record<string, string>),
  };

  const url = `${baseUrl}${pathPrefix}${path}`;
  const res = await fetch(url, { headers, signal });

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`API error (${res.status}): ${text}`);
  }

  return res.json() as Promise<T>;
}
