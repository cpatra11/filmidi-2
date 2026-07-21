import { AI_GATEWAY_OPENAI_BASE_URL } from "./aiGateway";

const STORAGE_KEY = "filmidi_vercel_api_key";

let cachedKey: string | null = null;
let fetchPromise: Promise<string | null> | null = null;

function getBridge(): { postMessage: (msg: unknown) => void } | null {
  return (window as any).__electrobunBunBridge ?? null;
}

/**
 * Get the Vercel AI Gateway key from Bun's secure native store (Keychain on
 * macOS). Browser fallback is session-only and never persists across restarts.
 * Caches the result in a module variable so subsequent calls are instant.
 */
export function getSecureApiKey(): Promise<string | null> {
  if (cachedKey !== null) return Promise.resolve(cachedKey);
  if (fetchPromise) return fetchPromise;

  const bridge = getBridge();
  if (!bridge) {
    cachedKey = sessionStorage.getItem(STORAGE_KEY);
    return Promise.resolve(cachedKey);
  }

  fetchPromise = new Promise<string | null>((resolve) => {
    const prevHandler = (window as any).__electrobun?.receiveMessageFromBun;
    if ((window as any).__electrobun) {
      (window as any).__electrobun.receiveMessageFromBun = (msg: unknown) => {
        try {
          const data = typeof msg === "string" ? JSON.parse(msg) : msg;
          if (data?.type === "api-key-value") {
            (window as any).__electrobun.receiveMessageFromBun = prevHandler;
            cachedKey = data.key ?? null;
            fetchPromise = null;
            resolve(cachedKey);
            return;
          }
        } catch {}
        if (prevHandler) prevHandler(msg);
      };
    }
    bridge.postMessage(JSON.stringify({ type: "get-api-key" }));

    // Timeout fallback — if Bun doesn't respond, try localStorage
    setTimeout(() => {
      if (fetchPromise) {
        (window as any).__electrobun.receiveMessageFromBun = prevHandler;
        cachedKey = sessionStorage.getItem(STORAGE_KEY);
        fetchPromise = null;
        resolve(cachedKey);
      }
    }, 2000);
  });

  return fetchPromise;
}

/**
 * Save the Vercel AI Gateway key. Native Electrobun stores it in macOS
 * Keychain; browser fallback lasts only for the current session.
 */
export function setSecureApiKey(key: string): void {
  cachedKey = key || null;
  fetchPromise = null; // cancel any in-flight fetch so the new value wins
  const bridge = getBridge();
  if (bridge) {
    bridge.postMessage(JSON.stringify({ type: "set-api-key", key }));
  } else {
    if (key) {
      sessionStorage.setItem(STORAGE_KEY, key);
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }
}

/**
 * Clear the API key from native secure storage and the browser session.
 */
export function clearSecureApiKey(): void {
  cachedKey = null;
  const bridge = getBridge();
  if (bridge) {
    bridge.postMessage(JSON.stringify({ type: "set-api-key", key: "" }));
  }
  sessionStorage.removeItem(STORAGE_KEY);
}

/**
 * Synchronous check if API key is available (from cache).
 */
export function hasCachedApiKey(): boolean {
  return cachedKey !== null;
}

/**
 * Validate a Vercel AI Gateway key with a small authenticated model request.
 */
export async function validateApiKey(key: string): Promise<string | null> {
  if (!key.trim()) return "Vercel API key is empty";
  try {
    const response = await fetch(`${AI_GATEWAY_OPENAI_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${key.trim()}` },
    });
    if (!response.ok) return `Vercel API key rejected (${response.status})`;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Could not reach Vercel AI Gateway";
  }
}
