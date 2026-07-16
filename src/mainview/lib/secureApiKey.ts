const STORAGE_KEY = "filmidi_qwen_api_key";

let cachedKey: string | null = null;
let fetchPromise: Promise<string | null> | null = null;

function getBridge(): { postMessage: (msg: unknown) => void } | null {
  return (window as any).__electrobunBunBridge ?? null;
}

/**
 * Get the API key from Bun's secure in-memory store (Electrobun)
 * or from localStorage (browser fallback).
 * Caches the result in a module variable so subsequent calls are instant.
 */
export function getSecureApiKey(): Promise<string | null> {
  if (cachedKey !== null) return Promise.resolve(cachedKey);
  if (fetchPromise) return fetchPromise;

  const bridge = getBridge();
  if (!bridge) {
    // Browser fallback
    cachedKey = localStorage.getItem(STORAGE_KEY);
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
        cachedKey = localStorage.getItem(STORAGE_KEY);
        fetchPromise = null;
        resolve(cachedKey);
      }
    }, 2000);
  });

  return fetchPromise;
}

/**
 * Save the API key. In Electrobun, sends it to Bun's secure in-memory store.
 * Also keeps a local cache, but does NOT write to localStorage.
 */
export function setSecureApiKey(key: string): void {
  cachedKey = key;
  const bridge = getBridge();
  if (bridge) {
    bridge.postMessage(JSON.stringify({ type: "set-api-key", key }));
  } else {
    localStorage.setItem(STORAGE_KEY, key);
  }
}

/**
 * Clear the API key from both Bun's store and localStorage.
 */
export function clearSecureApiKey(): void {
  cachedKey = null;
  const bridge = getBridge();
  if (bridge) {
    bridge.postMessage(JSON.stringify({ type: "set-api-key", key: "" }));
  }
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Synchronous check if API key is available (from cache).
 */
export function hasCachedApiKey(): boolean {
  return cachedKey !== null;
}
