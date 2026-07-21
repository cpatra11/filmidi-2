import { FILMIDI_BACKEND_URL } from "./backendConfig";

const BACKEND_URL = FILMIDI_BACKEND_URL;

/**
 * Production Google Client ID.
 * Replace this with your actual client ID before building for production,
 * or users can set it in Settings > Account at runtime.
 */
const BUILTIN_GOOGLE_CLIENT_ID = "305739693579-1mj45fpvlg7bq09unb1kds7e5k4o7f6j.apps.googleusercontent.com";

interface GoogleSignInResult {
  token: string;
  email: string;
  name: string;
}

export interface EmailAuthResult {
  token: string;
  email: string;
  name: string;
}

export async function signInWithEmail(email: string, password: string): Promise<EmailAuthResult> {
  return emailAuth('/login', { email, password });
}

export async function registerWithEmail(email: string, password: string, name: string): Promise<EmailAuthResult> {
  return emailAuth('/register', { email, password, name });
}

async function emailAuth(path: string, body: Record<string, string>): Promise<EmailAuthResult> {
  const response = await fetch(`${BACKEND_URL}/api/v1/auth${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Authentication failed (${response.status})`);
  return data as EmailAuthResult;
}

function getGoogleClientId(): string {
  return localStorage.getItem("filmidi_google_client_id") || BUILTIN_GOOGLE_CLIENT_ID;
}

export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  const clientId = getGoogleClientId();
  if (!clientId) {
    throw new Error("Google Client ID not configured. Go to Settings > Account and paste your Google Client ID.");
  }

  const state = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  const redirectUri = `${BACKEND_URL}/api/v1/auth/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "consent",
    state,
  });
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  // Ask the bun process to open the URL in the system browser via IPC.
  // We MUST NOT use window.open() or form.submit(target="_blank") inside the
  // Electrobun WebView — both trigger a native new-window handler that causes a
  // C++ exception / Bun crash.  Instead we send an IPC message to the bun side
  // which calls Electrobun.Utils.openExternal(url).
  const bridge = (window as any).__electrobunBunBridge;
  const electrobun = (window as any).__electrobun;

  if (bridge?.postMessage && electrobun) {
    return new Promise<GoogleSignInResult>((resolve, reject) => {
      const origHandler = electrobun.receiveMessageFromBun;

      electrobun.receiveMessageFromBun = (msg: any) => {
        try {
          const data = typeof msg === "string" ? JSON.parse(msg) : msg;

          if (data?.type === "sign-in-browser-opened") {
            electrobun.receiveMessageFromBun = origHandler;
            startPolling(state).then(resolve, reject);
            return;
          }

          if (data?.type === "sign-in-result") {
            electrobun.receiveMessageFromBun = origHandler;
            if (data.isError) {
              reject(new Error(data.error));
            } else {
              resolve({ token: data.token, email: data.email, name: data.name });
            }
            return;
          }
        } catch { /* ignore parse errors */ }

        // Forward unrecognized messages to the original handler
        if (origHandler) origHandler(msg);
      };

      bridge.postMessage(JSON.stringify({ type: "sign-in", authUrl, state }));
    });
  }

  // Fallback for the Vite HMR dev-server context where the bridge is absent.
  window.open(authUrl, "_blank", "noopener,noreferrer");
  return startPolling(state);
}

async function startPolling(state: string): Promise<GoogleSignInResult> {
  const timeout = 300_000;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch(`${BACKEND_URL}/api/v1/auth/status?state=${state}`);
      if (!res.ok) continue;
      const data = await res.json();
      if (data.status === "success") {
        return { token: data.token, email: data.email, name: data.name };
      }
    } catch {}
  }

  throw new Error("Sign in timed out");
}

export async function fetchSubscription(authToken: string): Promise<{
  plan: string;
  status: string;
  creditsRemaining: number;
  budgetCredits: number;
  expiresAt: string | null;
}> {
  const res = await fetch(`${BACKEND_URL}/api/v1/billing/subscription`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!res.ok) {
    if (res.status === 404) {
      return { plan: "free", status: "none", creditsRemaining: 0, budgetCredits: 0, expiresAt: null };
    }
    throw new Error(`Failed to fetch subscription (${res.status})`);
  }
  return res.json();
}

export async function createCheckoutSession(authToken: string, priceId: string): Promise<string> {
  const res = await fetch(`${BACKEND_URL}/api/v1/billing/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ priceId }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Checkout failed (${res.status}): ${err}`);
  }
  const data = await res.json() as { url: string };
  return data.url;
}

export async function createPortalUrl(authToken: string): Promise<string> {
  const res = await fetch(`${BACKEND_URL}/api/v1/billing/portal`, {
    method: "POST",
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Portal failed (${res.status}): ${err}`);
  }
  const data = await res.json() as { url: string };
  return data.url;
}
