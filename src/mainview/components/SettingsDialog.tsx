import * as Dialog from "@radix-ui/react-dialog";
import * as Switch from "@radix-ui/react-switch";
import * as Select from "@radix-ui/react-select";
import { useState, useEffect } from "react";
import { X, Settings, Monitor, Cpu, Bot, HardDrive, Bell, ChevronDown, Check, User } from "lucide-react";
import { useSettingsStore, type SettingsTab } from "@/store/useSettingsStore";
import { useAccountStore } from "@/store/useAccountStore";
import { THIRD_PARTY_MODELS } from "@/store/useGenerationStore";
import { getSecureApiKey, setSecureApiKey } from "@/lib/secureApiKey";

/* ------------------------------------------------------------------ */
/*  Model catalog (matches useGenerationStore)                         */
/* ------------------------------------------------------------------ */

interface ModelEntry {
  id: string;
  name: string;
  category: "chat" | "image" | "video" | "audio";
}

const ALL_MODELS: ModelEntry[] = [
  { id: "qwen3.7-max", name: "Qwen 3.7 Max", category: "chat" },
  { id: "qwen3.7-plus", name: "Qwen 3.7 Plus", category: "chat" },
  { id: "qwen3.6-plus", name: "Qwen 3.6 Plus", category: "chat" },
  { id: "qwen3.6-flash", name: "Qwen 3.6 Flash", category: "chat" },
  { id: "qwen-turbo", name: "Qwen Turbo", category: "chat" },
  { id: "qwen-image-2.0-pro", name: "Qwen-Image 2.0 Pro", category: "image" },
  { id: "qwen-image-2.0-turbo", name: "Qwen-Image 2.0 Turbo", category: "image" },
  { id: "wan2.7-image-pro", name: "Wan 2.7 Image Pro", category: "image" },
  { id: "wan2.6-t2i", name: "Wan 2.6 T2I", category: "image" },
  { id: "wan2.7-t2v", name: "Wan 2.7 T2V", category: "video" },
  { id: "wan2.7-i2v", name: "Wan 2.7 I2V", category: "video" },
  { id: "wan2.7-r2v", name: "Wan 2.7 R2V", category: "video" },
  { id: "wan2.7-videoedit", name: "Wan 2.7 Video Edit", category: "video" },
  { id: "happyhorse-1.1-t2v", name: "HappyHorse 1.1 T2V", category: "video" },
  { id: "happyhorse-1.1-i2v", name: "HappyHorse 1.1 I2V", category: "video" },
  { id: "happyhorse-1.1-r2v", name: "HappyHorse 1.1 R2V", category: "video" },
  { id: "qwen3-tts-flash", name: "Qwen3 TTS Flash", category: "audio" },
  { id: "qwen3-tts-instruct-flash", name: "Qwen3 TTS Instruct", category: "audio" },
  { id: "cosyvoice-v3-plus", name: "CosyVoice v3 Plus", category: "audio" },
  { id: "cosyvoice-v3-flash", name: "CosyVoice v3 Flash", category: "audio" },
  { id: "fun-music-v1", name: "FunMusic v1", category: "audio" },
  { id: "fun-music-preview", name: "FunMusic Preview", category: "audio" },
  { id: "sonilo-v1.1-text-to-music", name: "Sonilo Text→Music", category: "audio" },
  { id: "mirelo-sfx-v1.5-text-to-sfx", name: "Mirelo Text→SFX", category: "audio" },
];

const CATEGORY_LABELS: Record<string, string> = {
  chat: "Chat (Agent)",
  image: "Image Generation",
  video: "Video Generation",
  audio: "Audio / Music / SFX",
};

/* ------------------------------------------------------------------ */
/*  Sidebar                                                            */
/* ------------------------------------------------------------------ */

const TABS: { id: SettingsTab; label: string; icon: React.ElementType }[] = [
  { id: "general", label: "General", icon: Monitor },
  { id: "account", label: "Account", icon: User },
  { id: "models", label: "Models", icon: Cpu },
  { id: "agent", label: "Agent", icon: Bot },
  { id: "storage", label: "Storage", icon: HardDrive },
];

function SettingsSidebar() {
  const { activeTab, setActiveTab } = useSettingsStore();

  return (
    <div className="w-[180px] shrink-0 border-r border-[#1C1C1C] p-2 flex flex-col gap-0.5">
      {TABS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => setActiveTab(id)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] cursor-pointer transition-colors ${
            activeTab === id
              ? "bg-white/10 text-[#e0e0ee]"
              : "text-[#8888aa] hover:bg-white/5 hover:text-[#aaaacc]"
          }`}
        >
          <Icon className="w-3.5 h-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Toggle row                                                         */
/* ------------------------------------------------------------------ */

function ToggleRow({
  title,
  subtitle,
  checked,
  onCheckedChange,
}: {
  title: string;
  subtitle?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="flex flex-col gap-0.5">
        <span className="text-[12px] text-[#ccccee]">{title}</span>
        {subtitle && <span className="text-[10px] text-[#666688]">{subtitle}</span>}
      </div>
      <Switch.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="w-8 h-[18px] bg-white/10 rounded-full relative data-[state=checked]:bg-white transition-colors cursor-pointer shrink-0"
      >
        <Switch.Thumb className="block w-3.5 h-3.5 bg-white rounded-full transition-transform translate-x-0.5 data-[state=checked]:translate-x-[17px]" />
      </Switch.Root>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  General pane                                                       */
/* ------------------------------------------------------------------ */

function GeneralPane() {
  const {
    theme, setTheme,
    defaultExportFormat, setDefaultExportFormat,
    notificationsEnabled, setNotificationsEnabled,
    showTourOnLaunch, setShowTourOnLaunch,
    audioProcessingMode, setAudioProcessingMode,
  } = useSettingsStore();

  return (
    <div className="flex flex-col gap-1">
      <SectionHeader title="Appearance" />
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-medium text-[#8888aa]">Theme</span>
        <Select.Root value={theme} onValueChange={(v) => setTheme(v as any)}>
          <Select.Trigger className="flex items-center justify-between gap-2 px-2 py-1.5 bg-white/5 border border-white/10 rounded-lg text-[11px] text-[#ccccee] outline-none hover:bg-white/8 transition-colors w-[200px]">
            <Select.Value />
            <Select.Icon><ChevronDown className="w-3 h-3 text-[#666688]" /></Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Content position="popper" sideOffset={4} className="bg-[#0A0A0A] border border-[#1C1C1C] rounded-lg shadow-xl z-[100] min-w-[160px]">
              <Select.Viewport className="p-1">
                <Select.Item value="dark" className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-[#aaaacc] rounded cursor-pointer outline-none data-[highlighted]:bg-white/10 data-[state=checked]:text-[#e0e0ee]">
                  <Select.ItemIndicator><Check className="w-3 h-3 text-white/70" /></Select.ItemIndicator>
                  <Select.ItemText>Dark</Select.ItemText>
                </Select.Item>
                <Select.Item value="light" className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-[#aaaacc] rounded cursor-pointer outline-none data-[highlighted]:bg-white/10 data-[state=checked]:text-[#e0e0ee]">
                  <Select.ItemIndicator><Check className="w-3 h-3 text-white/70" /></Select.ItemIndicator>
                  <Select.ItemText>Light</Select.ItemText>
                </Select.Item>
                <Select.Item value="system" className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-[#aaaacc] rounded cursor-pointer outline-none data-[highlighted]:bg-white/10 data-[state=checked]:text-[#e0e0ee]">
                  <Select.ItemIndicator><Check className="w-3 h-3 text-white/70" /></Select.ItemIndicator>
                  <Select.ItemText>System</Select.ItemText>
                </Select.Item>
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      </div>

      <SectionHeader title="Export" />
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-medium text-[#8888aa]">Default Format</span>
        <Select.Root value={defaultExportFormat} onValueChange={setDefaultExportFormat}>
          <Select.Trigger className="flex items-center justify-between gap-2 px-2 py-1.5 bg-white/5 border border-white/10 rounded-lg text-[11px] text-[#ccccee] outline-none hover:bg-white/8 transition-colors w-[200px]">
            <Select.Value />
            <Select.Icon><ChevronDown className="w-3 h-3 text-[#666688]" /></Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Content position="popper" sideOffset={4} className="bg-[#0A0A0A] border border-[#1C1C1C] rounded-lg shadow-xl z-[100] min-w-[160px]">
              <Select.Viewport className="p-1">
                <Select.Item value="mp4" className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-[#aaaacc] rounded cursor-pointer outline-none data-[highlighted]:bg-white/10 data-[state=checked]:text-[#e0e0ee]">
                  <Select.ItemIndicator><Check className="w-3 h-3 text-white/70" /></Select.ItemIndicator>
                  <Select.ItemText>MP4 (H.264)</Select.ItemText>
                </Select.Item>
                <Select.Item value="mov" className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-[#aaaacc] rounded cursor-pointer outline-none data-[highlighted]:bg-white/10 data-[state=checked]:text-[#e0e0ee]">
                  <Select.ItemIndicator><Check className="w-3 h-3 text-white/70" /></Select.ItemIndicator>
                  <Select.ItemText>MOV (ProRes)</Select.ItemText>
                </Select.Item>
                <Select.Item value="webm" className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-[#aaaacc] rounded cursor-pointer outline-none data-[highlighted]:bg-white/10 data-[state=checked]:text-[#e0e0ee]">
                  <Select.ItemIndicator><Check className="w-3 h-3 text-white/70" /></Select.ItemIndicator>
                  <Select.ItemText>WebM (VP9)</Select.ItemText>
                </Select.Item>
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      </div>

      <SectionHeader title="Audio Processing" />
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-medium text-[#8888aa]">Mode</span>
        <Select.Root value={audioProcessingMode} onValueChange={(v) => setAudioProcessingMode(v as any)}>
          <Select.Trigger className="flex items-center justify-between gap-2 px-2 py-1.5 bg-white/5 border border-white/10 rounded-lg text-[11px] text-[#ccccee] outline-none hover:bg-white/8 transition-colors w-[200px]">
            <Select.Value />
            <Select.Icon><ChevronDown className="w-3 h-3 text-[#666688]" /></Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Content position="popper" sideOffset={4} className="bg-[#0A0A0A] border border-[#1C1C1C] rounded-lg shadow-xl z-[100] min-w-[160px]">
              <Select.Viewport className="p-1">
                <Select.Item value="local" className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-[#aaaacc] rounded cursor-pointer outline-none data-[highlighted]:bg-white/10 data-[state=checked]:text-[#e0e0ee]">
                  <Select.ItemIndicator><Check className="w-3 h-3 text-white/70" /></Select.ItemIndicator>
                  <Select.ItemText>Local (free, offline)</Select.ItemText>
                </Select.Item>
                <Select.Item value="cloud" className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-[#aaaacc] rounded cursor-pointer outline-none data-[highlighted]:bg-white/10 data-[state=checked]:text-[#e0e0ee]">
                  <Select.ItemIndicator><Check className="w-3 h-3 text-white/70" /></Select.ItemIndicator>
                  <Select.ItemText>Qwen Cloud (requires key)</Select.ItemText>
                </Select.Item>
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
        <span className="text-[9px] text-[#555577]">
          Local: offline denoising + energy-based VAD. Cloud: fun-asr transcription + speaker diarization.
        </span>
      </div>

      <SectionHeader title="Notifications" />
      <ToggleRow
        title="System notifications"
        subtitle="Show notifications on export complete, generation done, etc."
        checked={notificationsEnabled}
        onCheckedChange={setNotificationsEnabled}
      />

      <SectionHeader title="On Launch" />
      <ToggleRow
        title="Show tour"
        subtitle="Show the feature tour when opening a project for the first time"
        checked={showTourOnLaunch}
        onCheckedChange={setShowTourOnLaunch}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Models pane                                                        */
/* ------------------------------------------------------------------ */

function ModelsPane() {
  const { disabledModelIds, toggleModelDisabled } = useSettingsStore();
  const isDirect = !useAccountStore.getState().isSignedIn();

  const categories = ["chat", "image", "video", "audio"] as const;

  return (
    <div className="flex flex-col gap-4">
      {categories.map((cat) => {
        const models = ALL_MODELS.filter((m) =>
          m.category === cat && (!isDirect || !THIRD_PARTY_MODELS.has(m.id))
        );
        return (
          <div key={cat}>
            <SectionHeader title={CATEGORY_LABELS[cat]} />
            <div className="flex flex-col">
              {models.map((model) => {
                const enabled = !disabledModelIds.includes(model.id);
                return (
                  <div
                    key={model.id}
                    className="flex items-center justify-between gap-3 py-2 border-b border-white/5 last:border-0"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[11px] text-[#ccccee]">{model.name}</span>
                      <span className="text-[9px] text-[#555577] font-mono">{model.id}</span>
                    </div>
                    <Switch.Root
                      checked={enabled}
                      onCheckedChange={() => toggleModelDisabled(model.id)}
                      className="w-8 h-[18px] bg-white/10 rounded-full relative data-[state=checked]:bg-white transition-colors cursor-pointer shrink-0"
                    >
                      <Switch.Thumb className="block w-3.5 h-3.5 bg-white rounded-full transition-transform translate-x-0.5 data-[state=checked]:translate-x-[17px]" />
                    </Switch.Root>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Account pane                                                       */
/* ------------------------------------------------------------------ */

const GOOGLE_CLIENT_ID_KEY = "filmidi_google_client_id";

function GoogleClientIdInput() {
  const [value, setValue] = useState(() => localStorage.getItem(GOOGLE_CLIENT_ID_KEY) ?? "");
  const [saved, setSaved] = useState(() => !!localStorage.getItem(GOOGLE_CLIENT_ID_KEY));

  const handleSave = () => {
    if (value.trim()) {
      localStorage.setItem(GOOGLE_CLIENT_ID_KEY, value.trim());
      setSaved(true);
    }
  };

  return (
    <div className="flex items-center gap-2 mb-2">
      <input
        type="text"
        value={value}
        onChange={(e) => { setValue(e.target.value); setSaved(false); }}
        onKeyDown={(e) => { if (e.key === "Enter" && value.trim()) handleSave(); }}
        placeholder="Paste your Google Client ID..."
        className="flex-1 bg-[#141414] border border-[#1C1C1C] rounded-lg px-2.5 py-1.5 text-[12px] text-[#e0e0ee] placeholder:text-[#555577] outline-none focus:border-white/20"
      />
      <button
        onClick={handleSave}
        disabled={saved || !value.trim()}
        className="px-3 py-1.5 rounded-lg bg-white hover:bg-white/90 text-[11px] text-black font-medium cursor-pointer disabled:opacity-30 disabled:cursor-default transition-colors"
      >
        {saved ? "Saved" : "Save"}
      </button>
    </div>
  );
}

function AccountPane() {
  const account = useAccountStore();
  const [signingIn, setSigningIn] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const signedIn = account.isSignedIn();

  const handleSignIn = async () => {
    setSigningIn(true);
    setCheckoutError(null);
    try {
      await account.signInWithGoogle();
    } catch (err: unknown) {
      setCheckoutError(err instanceof Error ? err.message : String(err));
    } finally {
      setSigningIn(false);
    }
  };

  const handleSubscribe = async (priceId: string) => {
    try {
      await account.checkout(priceId);
    } catch (err: unknown) {
      setCheckoutError(err instanceof Error ? err.message : String(err));
    }
  };

  if (signedIn) {
    return (
      <div className="flex flex-col gap-1">
        <SectionHeader title="Account" />
        <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
          <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
            <User className="w-5 h-5 text-white/50" />
          </div>
          <div>
            <p className="text-xs font-medium text-[#e0e0ee]">{account.name || "User"}</p>
            <p className="text-[10px] text-[#8888aa]">{account.email}</p>
          </div>
        </div>

        <SectionHeader title="Subscription" />
        <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
          <div>
            <p className="text-xs font-medium text-[#e0e0ee] capitalize">{account.plan || "Free"} Plan</p>
            <p className="text-[10px] text-[#8888aa]">
              {account.creditsRemaining != null ? `${account.creditsRemaining.toLocaleString()} credits remaining` : "No subscription"}
            </p>
          </div>
          <button
            onClick={account.manageSubscription}
            className="px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 text-[11px] text-[#e0e0ee] hover:bg-white/15 cursor-pointer transition-colors"
          >
            Manage
          </button>
        </div>

        <SectionHeader title="Danger Zone" />
        <button
          onClick={account.signOut}
          className="self-start px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-[11px] text-red-400 hover:bg-red-500/20 cursor-pointer transition-colors"
        >
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <SectionHeader title="Google Client ID" />
      <p className="text-[11px] text-[#8888aa] mb-1">
        Required for Sign in with Google. Get it from the <a className="text-white/60 underline" href="https://console.cloud.google.com/apis/credentials" target="_blank">Google Cloud Console</a>.
      </p>
      <GoogleClientIdInput />

      <SectionHeader title="Sign In" />
      <p className="text-[11px] text-[#8888aa] mb-1">
        Sign in with Google to buy a subscription and use cloud features without your own API key.
      </p>
      <button
        onClick={handleSignIn}
        disabled={signingIn}
        className="self-start flex items-center gap-2 px-4 py-2 rounded-lg bg-white hover:bg-white/90 text-[12px] text-black font-medium cursor-pointer disabled:opacity-50 transition-colors"
      >
        {signingIn ? (
          <>
            <div className="w-3.5 h-3.5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
            Signing in...
          </>
        ) : (
          "Sign in with Google"
        )}
      </button>
      {checkoutError && <p className="text-[11px] text-red-400">{checkoutError}</p>}

      <SectionHeader title="Plans" />
      <div className="grid grid-cols-3 gap-2">
        <div className="flex flex-col gap-2 p-3 rounded-lg bg-white/5 border border-white/10">
          <span className="text-xs font-semibold text-[#e0e0ee]">Free</span>
          <span className="text-[18px] font-bold text-[#e0e0ee]">$0</span>
          <ul className="text-[10px] text-[#8888aa] space-y-1 list-disc list-inside">
            <li>Own API key required</li>
            <li>All core features</li>
            <li>Community support</li>
          </ul>
        </div>

        <div className="flex flex-col gap-2 p-3 rounded-lg bg-white/10 border border-white/20">
          <span className="text-xs font-semibold text-[#e0e0ee]">Pro</span>
          <span className="text-[18px] font-bold text-[#e0e0ee]">$19/mo</span>
          <ul className="text-[10px] text-[#8888aa] space-y-1 list-disc list-inside">
            <li>5,000 credits/mo</li>
            <li>No API key needed</li>
            <li>Priority support</li>
          </ul>
          <button
            onClick={() => handleSubscribe("price_pro_monthly")}
            disabled={signingIn}
            className="mt-1 w-full px-2 py-1.5 rounded-lg bg-white hover:bg-white/90 text-[11px] text-black font-medium cursor-pointer disabled:opacity-50 transition-colors"
          >
            Subscribe
          </button>
        </div>

        <div className="flex flex-col gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
          <span className="text-xs font-semibold text-amber-300">Max</span>
          <span className="text-[18px] font-bold text-amber-300">$99/mo</span>
          <ul className="text-[10px] text-[#8888aa] space-y-1 list-disc list-inside">
            <li>20,000 credits/mo</li>
            <li>No API key needed</li>
            <li>Highest priority</li>
          </ul>
          <button
            onClick={() => handleSubscribe("price_max_monthly")}
            disabled={signingIn}
            className="mt-1 w-full px-2 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-[11px] text-black font-medium cursor-pointer disabled:opacity-50 transition-colors"
          >
            Subscribe
          </button>
        </div>
      </div>
    </div>
  );
}

function AgentPane() {
  const {
    agentAutoExecute, setAgentAutoExecute,
    agentContextSize, setAgentContextSize,
  } = useSettingsStore();

  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [saved, setSaved] = useState(true);

  // Load the API key from secure storage on mount
  useEffect(() => {
    getSecureApiKey().then((key) => {
      if (key) {
        setApiKeyDraft(key);
        setSaved(true);
      }
    });
  }, []);

  const handleSaveKey = () => {
    setSecureApiKey(apiKeyDraft.trim());
    setSaved(true);
  };

  return (
    <div className="flex flex-col gap-1">
      <SectionHeader title="API Connection" />
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-medium text-[#8888aa]">Qwen API Key</span>
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={apiKeyDraft}
            onChange={(e) => { setApiKeyDraft(e.target.value); setSaved(false); }}
            onKeyDown={(e) => { if (e.key === "Enter" && apiKeyDraft.trim()) handleSaveKey(); }}
            placeholder="Enter your Qwen API key..."
            className="flex-1 bg-[#141414] border border-[#1C1C1C] rounded-lg px-2.5 py-1.5 text-[12px] text-[#e0e0ee] placeholder:text-[#555577] outline-none focus:border-white/20"
          />
          <button
            onClick={handleSaveKey}
            disabled={saved || !apiKeyDraft.trim()}
            className="px-3 py-1.5 rounded-lg bg-white hover:bg-white/90 text-[11px] text-black font-medium cursor-pointer disabled:opacity-30 disabled:cursor-default transition-colors"
          >
            Save
          </button>
        </div>
        <span className="text-[9px] text-[#555577]">
          Your own Qwen API key from dashscope.aliyuncs.com. Required for the AI agent and cloud features.
        </span>
      </div>

      <SectionHeader title="Behavior" />
      <ToggleRow
        title="Auto-execute tool calls"
        subtitle="Automatically run agent tool calls without confirmation"
        checked={agentAutoExecute}
        onCheckedChange={setAgentAutoExecute}
      />

      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-medium text-[#8888aa]">Context size (turns)</span>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={10}
            max={500}
            step={10}
            value={agentContextSize}
            onChange={(e) => setAgentContextSize(Number(e.target.value))}
            className="flex-1 accent-white h-1"
          />
          <span className="text-[11px] text-[#aaaacc] font-mono w-[40px] text-right">
            {agentContextSize}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Storage pane                                                       */
/* ------------------------------------------------------------------ */

function StoragePane() {
  const { searchIndexEnabled, setSearchIndexEnabled } = useSettingsStore();

  const clearCache = () => {
    try {
      localStorage.removeItem("filmidi_agent_sessions");
      localStorage.removeItem("filmidi_generation_history");
      localStorage.removeItem("filmidi_media_panel");
    } catch {}
  };

  return (
    <div className="flex flex-col gap-1">
      <SectionHeader title="Media Search Index" />
      <ToggleRow
        title="Enable search index"
        subtitle="Index media names and transcripts for faster search"
        checked={searchIndexEnabled}
        onCheckedChange={setSearchIndexEnabled}
      />

      <SectionHeader title="Cache" />
      <div className="flex flex-col gap-2">
        <div className="text-[11px] text-[#8888aa]">
          Agent sessions, generation history, and media panel state are stored in browser localStorage.
        </div>
        <button
          onClick={clearCache}
          className="self-start px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-[11px] text-[#aaaacc] hover:bg-white/8 hover:text-[#ccccee] cursor-pointer transition-colors"
        >
          Clear Cache
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared                                                             */
/* ------------------------------------------------------------------ */

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="text-[10px] font-semibold text-[#666688] uppercase tracking-wider mt-4 mb-1 first:mt-0">
      {title}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main SettingsDialog                                                */
/* ------------------------------------------------------------------ */

export function SettingsDialog() {
  const { isOpen, close, activeTab } = useSettingsStore();

  return (
    <Dialog.Root open={isOpen} onOpenChange={(v) => !v && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[90]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[560px] h-[480px] bg-[#0A0A0A] border border-[#1C1C1C] rounded-2xl shadow-2xl z-[91] flex overflow-hidden">
          <SettingsSidebar />

          <div className="flex-1 flex flex-col min-w-0">
            {/* Header */}
            <div className="flex items-center gap-2 px-4 pt-3 pb-2 shrink-0">
              <Settings className="w-4 h-4 text-[#8888aa]" />
              <Dialog.Title className="text-[13px] font-semibold text-[#e0e0ee]">
                Settings
              </Dialog.Title>
              <div className="flex-1" />
              <Dialog.Close asChild>
                <button className="w-6 h-6 flex items-center justify-center text-[#666688] hover:text-[#aaaacc] cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </Dialog.Close>
            </div>

            {/* Content */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
              {activeTab === "general" && <GeneralPane />}
              {activeTab === "account" && <AccountPane />}
              {activeTab === "models" && <ModelsPane />}
              {activeTab === "agent" && <AgentPane />}
              {activeTab === "storage" && <StoragePane />}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
