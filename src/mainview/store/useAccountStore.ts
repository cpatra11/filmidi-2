import { create } from "zustand";
import { signInWithGoogle, fetchSubscription, createCheckoutSession, createPortalUrl } from "@/lib/authClient";

export type AuthMode = "direct" | "backend" | "none";

interface AccountState {
  mode: AuthMode;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  sessionToken: string | null;
  creditsRemaining: number | null;
  plan: "free" | "pro" | "max" | null;
  subscriptionStatus: string | null;
  budgetCredits: number | null;

  setSession: (token: string, email: string, name: string) => void;
  setAvatar: (url: string) => void;
  setCredits: (credits: number) => void;
  setPlan: (plan: "free" | "pro" | "max") => void;
  signOut: () => void;
  isSignedIn: () => boolean;
  signInWithGoogle: () => Promise<void>;
  loadSubscription: () => Promise<void>;
  checkout: (priceId: string) => Promise<void>;
  manageSubscription: () => Promise<void>;
}

const STORAGE_KEY = "filmidi_account";

function loadAccount(): Partial<AccountState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveAccount(state: Partial<AccountState>) {
  const toSave = {
    mode: state.mode,
    email: state.email,
    name: state.name,
    avatarUrl: state.avatarUrl,
    sessionToken: state.sessionToken,
    creditsRemaining: state.creditsRemaining,
    plan: state.plan,
    subscriptionStatus: state.subscriptionStatus,
    budgetCredits: state.budgetCredits,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
}

const saved = loadAccount();

export const useAccountStore = create<AccountState>((set, get) => ({
  mode: saved.mode || "none",
  email: saved.email || null,
  name: saved.name || null,
  avatarUrl: saved.avatarUrl || null,
  sessionToken: saved.sessionToken || null,
  creditsRemaining: saved.creditsRemaining ?? null,
  plan: saved.plan || null,
  subscriptionStatus: saved.subscriptionStatus || null,
  budgetCredits: saved.budgetCredits ?? null,

  setSession: (token, email, name) => {
    set({ sessionToken: token, email, name, mode: "backend" });
    saveAccount(get());
  },

  setAvatar: (url) => {
    set({ avatarUrl: url });
    saveAccount(get());
  },

  setCredits: (credits) => {
    set({ creditsRemaining: credits });
    saveAccount(get());
  },

  setPlan: (plan) => {
    set({ plan });
    saveAccount(get());
  },

  signOut: () => {
    set({
      mode: "none",
      email: null,
      name: null,
      avatarUrl: null,
      sessionToken: null,
      creditsRemaining: null,
      plan: null,
      subscriptionStatus: null,
      budgetCredits: null,
    });
    localStorage.removeItem(STORAGE_KEY);
  },

  isSignedIn: () => {
    const s = get();
    return s.mode === "backend" && !!s.sessionToken;
  },

  signInWithGoogle: async () => {
    try {
      const result = await signInWithGoogle();
      get().setSession(result.token, result.email, result.name);
      await get().loadSubscription();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(msg);
    }
  },

  loadSubscription: async () => {
    const s = get();
    if (!s.sessionToken) return;
    try {
      const sub = await fetchSubscription(s.sessionToken);
      set({
        plan: (sub.plan === "price_max_monthly" ? "max" : "pro") as "free" | "pro" | "max",
        creditsRemaining: sub.creditsRemaining,
        budgetCredits: sub.budgetCredits,
        subscriptionStatus: sub.status,
      });
      saveAccount(get());
    } catch {
      set({ plan: "free", creditsRemaining: null, budgetCredits: null, subscriptionStatus: null });
    }
  },

  checkout: async (priceId: string) => {
    const s = get();
    if (!s.sessionToken) throw new Error("Not signed in");
    const url = await createCheckoutSession(s.sessionToken, priceId);
    window.open(url, "_blank");
  },

  manageSubscription: async () => {
    const s = get();
    if (!s.sessionToken) return;
    const url = await createPortalUrl(s.sessionToken);
    window.open(url, "_blank");
  },
}));
