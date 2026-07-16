import { create } from "zustand";
import { submitGeneration, waitForTask, type GenerationType, type GenerationParams } from "@/lib/generationApi";
import { useAccountStore } from "./useAccountStore";
import { getSecureApiKey, hasCachedApiKey } from "@/lib/secureApiKey";

export type { GenerationType };

export interface GenerationReference {
  id: string;
  name: string;
  type: "image" | "video" | "audio";
  thumbnailUrl?: string;
  url?: string;
}

export interface GenerationHistoryEntry {
  id: string;
  type: GenerationType;
  model: string;
  prompt: string;
  params: GenerationParams;
  resultUrls: string[];
  createdAt: number;
}

interface GenerationState {
  selectedType: GenerationType;
  prompt: string;
  selectedModelIndex: number;
  isGenerating: boolean;
  generationProgress: string | null;
  generationError: string | null;
  generationSuccess: boolean;
  abortController: AbortController | null;

  duration: number;
  aspectRatio: string;
  resolution: string;
  quality: string;
  numImages: number;
  voice: string;
  lyrics: string;
  styleInstructions: string;
  instrumental: boolean;
  generateAudio: boolean;

  firstFrame: GenerationReference | null;
  lastFrame: GenerationReference | null;
  imageReferences: GenerationReference[];
  refImages: GenerationReference[];
  refVideos: GenerationReference[];
  refAudios: GenerationReference[];
  sourceVideo: GenerationReference | null;
  audioVideoSource: GenerationReference | null;

  showSettings: boolean;
  showHistory: boolean;
  history: GenerationHistoryEntry[];

  setSelectedType: (type: GenerationType) => void;
  setPrompt: (prompt: string) => void;
  setSelectedModelIndex: (index: number) => void;
  setDuration: (d: number) => void;
  setAspectRatio: (ar: string) => void;
  setResolution: (r: string) => void;
  setQuality: (q: string) => void;
  setNumImages: (n: number) => void;
  setVoice: (v: string) => void;
  setLyrics: (l: string) => void;
  setStyleInstructions: (s: string) => void;
  setInstrumental: (i: boolean) => void;
  setGenerateAudio: (g: boolean) => void;
  setFirstFrame: (ref: GenerationReference | null) => void;
  setLastFrame: (ref: GenerationReference | null) => void;
  setSourceVideo: (ref: GenerationReference | null) => void;
  setAudioVideoSource: (ref: GenerationReference | null) => void;
  addImageReference: (ref: GenerationReference) => void;
  removeImageReference: (id: string) => void;
  addRefImage: (ref: GenerationReference) => void;
  removeRefImage: (id: string) => void;
  addRefVideo: (ref: GenerationReference) => void;
  removeRefVideo: (id: string) => void;
  addRefAudio: (ref: GenerationReference) => void;
  removeRefAudio: (id: string) => void;
  toggleSettings: () => void;
  toggleHistory: () => void;
  submit: () => Promise<void>;
  cancelGeneration: () => void;
  reset: () => void;
  clearReferences: () => void;
}

const VIDEO_MODELS = [
  { id: "wan2.7-t2v", name: "Wan 2.7 T2V", type: "video" as const },
  { id: "wan2.7-i2v", name: "Wan 2.7 I2V", type: "video" as const },
  { id: "wan2.7-r2v", name: "Wan 2.7 R2V", type: "video" as const },
  { id: "wan2.7-videoedit", name: "Wan 2.7 Video Edit", type: "video" as const },
  { id: "happyhorse-1.1-t2v", name: "HappyHorse 1.1 T2V", type: "video" as const },
  { id: "happyhorse-1.1-i2v", name: "HappyHorse 1.1 I2V", type: "video" as const },
  { id: "happyhorse-1.1-r2v", name: "HappyHorse 1.1 R2V", type: "video" as const },
];

const IMAGE_MODELS = [
  { id: "qwen-image-2.0-pro", name: "Qwen-Image 2.0 Pro", type: "image" as const },
  { id: "qwen-image-2.0-turbo", name: "Qwen-Image 2.0 Turbo", type: "image" as const },
  { id: "wan2.7-image-pro", name: "Wan 2.7 Image Pro", type: "image" as const },
  { id: "wan2.6-t2i", name: "Wan 2.6 T2I", type: "image" as const },
];

const AUDIO_MODELS = [
  { id: "qwen3-tts-flash", name: "Qwen3 TTS Flash", type: "audio" as const },
  { id: "qwen3-tts-instruct-flash", name: "Qwen3 TTS Instruct", type: "audio" as const },
  { id: "cosyvoice-v3-plus", name: "CosyVoice v3 Plus", type: "audio" as const },
  { id: "cosyvoice-v3-flash", name: "CosyVoice v3 Flash", type: "audio" as const },
  { id: "fun-music-v1", name: "FunMusic v1", type: "audio" as const },
  { id: "fun-music-preview", name: "FunMusic Preview", type: "audio" as const },
  { id: "sonilo-v1.1-text-to-music", name: "Sonilo Text→Music", type: "audio" as const },
  { id: "sonilo-v1.1-video-to-music", name: "Sonilo Video→Music", type: "audio" as const },
  { id: "mirelo-sfx-v1.5-text-to-sfx", name: "Mirelo Text→SFX", type: "audio" as const },
  { id: "mirelo-sfx-v1.5-video-to-audio", name: "Mirelo Video→SFX", type: "audio" as const },
];

const THIRD_PARTY_MODELS = new Set([
  "sonilo-v1.1-text-to-music",
  "sonilo-v1.1-video-to-music",
  "mirelo-sfx-v1.5-text-to-sfx",
  "mirelo-sfx-v1.5-video-to-audio",
]);

export { VIDEO_MODELS, IMAGE_MODELS, AUDIO_MODELS, THIRD_PARTY_MODELS };

export function getModelsForType(type: GenerationType) {
  const isDirect = !useAccountStore.getState().isSignedIn();
  const all = getTypeModels(type);
  if (isDirect) {
    // Direct mode (own API key) — hide third-party models that need the backend proxy
    return all.filter((m) => !THIRD_PARTY_MODELS.has(m.id));
  }
  return all;
}

function getTypeModels(type: GenerationType) {
  switch (type) {
    case "video": return VIDEO_MODELS;
    case "image": return IMAGE_MODELS;
    case "audio": return AUDIO_MODELS;
  }
}

export function getCostForConfig(
  type: GenerationType,
  modelId: string,
  duration: number,
  resolution: string,
): number | null {
  const videoRates: Record<string, Record<string, number>> = {
    "wan2.7-t2v": { "720p": 5, "1080p": 12 },
    "wan2.7-i2v": { "720p": 5, "1080p": 12 },
    "wan2.7-r2v": { "720p": 5, "1080p": 12 },
    "wan2.7-videoedit": { "720p": 5, "1080p": 12 },
    "happyhorse-1.1-t2v": { "720p": 4, "1080p": 10 },
    "happyhorse-1.1-i2v": { "720p": 4, "1080p": 10 },
    "happyhorse-1.1-r2v": { "720p": 4, "1080p": 10 },
  };
  const imageCredits: Record<string, number> = {
    "qwen-image-2.0-pro": 8,
    "qwen-image-2.0-turbo": 3,
    "wan2.7-image-pro": 10,
    "wan2.6-t2i": 2,
  };
  const audioRates: Record<string, number> = {
    "qwen3-tts-flash": 5,
    "qwen3-tts-instruct-flash": 5,
    "cosyvoice-v3-plus": 8,
    "cosyvoice-v3-flash": 3,
    "fun-music-v1": 25,
    "fun-music-preview": 10,
    "sonilo-v1.1-text-to-music": 30,
    "sonilo-v1.1-video-to-music": 30,
    "mirelo-sfx-v1.5-text-to-sfx": 20,
    "mirelo-sfx-v1.5-video-to-audio": 20,
  };

  if (type === "video") {
    const rates = videoRates[modelId];
    if (!rates) return null;
    const rate = rates[resolution] ?? rates["720p"] ?? 5;
    return Math.ceil(rate * duration);
  }
  if (type === "image") {
    const rate = imageCredits[modelId];
    return rate != null ? rate * (1) : null;
  }
  if (type === "audio") {
    const rate = audioRates[modelId];
    if (!rate) return null;
    return Math.ceil(rate * duration);
  }
  return null;
}

const HISTORY_STORAGE_KEY = "filmidi_generation_history";

async function getApiKey(): Promise<string | null> {
  return getSecureApiKey();
}

function loadHistory(): GenerationHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as GenerationHistoryEntry[];
    return parsed.slice(-50);
  } catch {
    return [];
  }
}

function persistHistory(history: GenerationHistoryEntry[]) {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(-50)));
  } catch { /* quota exceeded — silently drop oldest */ }
}

const INITIAL_STATE = {
  selectedType: "video" as GenerationType,
  prompt: "",
  selectedModelIndex: 0,
  isGenerating: false,
  generationProgress: null as string | null,
  generationError: null as string | null,
  generationSuccess: false,
  abortController: null as AbortController | null,
  duration: 5,
  aspectRatio: "16:9",
  resolution: "1080p",
  quality: "high",
  numImages: 1,
  voice: "",
  lyrics: "",
  styleInstructions: "",
  instrumental: false,
  generateAudio: true,
  firstFrame: null as GenerationReference | null,
  lastFrame: null as GenerationReference | null,
  imageReferences: [] as GenerationReference[],
  refImages: [] as GenerationReference[],
  refVideos: [] as GenerationReference[],
  refAudios: [] as GenerationReference[],
  sourceVideo: null as GenerationReference | null,
  audioVideoSource: null as GenerationReference | null,
  showSettings: false,
  showHistory: false,
  history: loadHistory(),
};

export const useGenerationStore = create<GenerationState>((set, get) => ({
  ...INITIAL_STATE,

  setSelectedType: (type) => set({ selectedType: type, selectedModelIndex: 0 }),
  setPrompt: (prompt) => set({ prompt }),
  setSelectedModelIndex: (index) => set({ selectedModelIndex: index }),
  setDuration: (d) => set({ duration: d }),
  setAspectRatio: (ar) => set({ aspectRatio: ar }),
  setResolution: (r) => set({ resolution: r }),
  setQuality: (q) => set({ quality: q }),
  setNumImages: (n) => set({ numImages: n }),
  setVoice: (v) => set({ voice: v }),
  setLyrics: (l) => set({ lyrics: l }),
  setStyleInstructions: (s) => set({ styleInstructions: s }),
  setInstrumental: (i) => set({ instrumental: i }),
  setGenerateAudio: (g) => set({ generateAudio: g }),
  setFirstFrame: (ref) => set({ firstFrame: ref }),
  setLastFrame: (ref) => set({ lastFrame: ref }),
  setSourceVideo: (ref) => set({ sourceVideo: ref }),
  setAudioVideoSource: (ref) => set({ audioVideoSource: ref }),

  addImageReference: (ref) =>
    set((s) => ({ imageReferences: [...s.imageReferences, ref] })),
  removeImageReference: (id) =>
    set((s) => ({ imageReferences: s.imageReferences.filter((r) => r.id !== id) })),

  addRefImage: (ref) =>
    set((s) => ({ refImages: [...s.refImages, ref] })),
  removeRefImage: (id) =>
    set((s) => ({ refImages: s.refImages.filter((r) => r.id !== id) })),

  addRefVideo: (ref) =>
    set((s) => ({ refVideos: [...s.refVideos, ref] })),
  removeRefVideo: (id) =>
    set((s) => ({ refVideos: s.refVideos.filter((r) => r.id !== id) })),

  addRefAudio: (ref) =>
    set((s) => ({ refAudios: [...s.refAudios, ref] })),
  removeRefAudio: (id) =>
    set((s) => ({ refAudios: s.refAudios.filter((r) => r.id !== id) })),

  toggleSettings: () => set((s) => ({ showSettings: !s.showSettings })),
  toggleHistory: () => set((s) => ({ showHistory: !s.showHistory })),

  clearReferences: () =>
    set({
      firstFrame: null,
      lastFrame: null,
      imageReferences: [],
      refImages: [],
      refVideos: [],
      refAudios: [],
      sourceVideo: null,
      audioVideoSource: null,
    }),

  reset: () => set(INITIAL_STATE),

  cancelGeneration: () => {
    const { abortController } = get();
    abortController?.abort();
    set({
      isGenerating: false,
      generationProgress: null,
      abortController: null,
    });
  },

  submit: async () => {
    const state = get();
    if (!state.prompt.trim() || state.isGenerating) return;

    const apiKey = await getApiKey();
    if (!apiKey) {
      set({ generationError: "No API key set. Open the Agent panel to set your Qwen API key." });
      return;
    }

    const models = getModelsForType(state.selectedType);
    const currentModel = models[state.selectedModelIndex] ?? models[0];
    if (!currentModel) return;

    const controller = new AbortController();
    set({
      isGenerating: true,
      generationError: null,
      generationSuccess: false,
      generationProgress: "Preparing...",
      abortController: controller,
    });

    try {
      const params: GenerationParams = {
        prompt: state.prompt,
        model: currentModel.id,
        duration: state.duration,
        aspectRatio: state.aspectRatio,
        resolution: state.resolution,
        quality: state.quality,
        numImages: state.numImages,
        voice: state.voice || undefined,
        lyrics: state.lyrics || undefined,
        styleInstructions: state.styleInstructions || undefined,
        instrumental: state.instrumental || undefined,
        generateAudio: state.generateAudio,
        startFrameUrl: state.firstFrame?.url,
        endFrameUrl: state.lastFrame?.url,
        sourceVideoUrl: state.sourceVideo?.url,
        referenceImageUrls: state.imageReferences.map((r) => r.url).filter((u): u is string => !!u),
        referenceVideoUrls: state.refVideos.map((r) => r.url).filter((u): u is string => !!u),
        referenceAudioUrls: state.refAudios.map((r) => r.url).filter((u): u is string => !!u),
        videoUrl: state.audioVideoSource?.url,
      };

      set({ generationProgress: "Submitting..." });
      const submitResult = await submitGeneration(apiKey, state.selectedType, params);

      // Synchronous result (image/audio without async)
      if (submitResult.resultUrl) {
        const entry: GenerationHistoryEntry = {
          id: `gen-${Date.now().toString(36)}`,
          type: state.selectedType,
          model: currentModel.id,
          prompt: state.prompt,
          params,
          resultUrls: [submitResult.resultUrl],
          createdAt: Date.now(),
        };
        const history = [entry, ...get().history];
        persistHistory(history);
        set({
          isGenerating: false,
          generationSuccess: true,
          generationProgress: null,
          abortController: null,
          history,
        });
        setTimeout(() => set({ generationSuccess: false }), 3000);
        return;
      }

      // Async result (video) — poll
      if (submitResult.taskId) {
        set({ generationProgress: "Generating..." });
        const result = await waitForTask(
          apiKey,
          submitResult.taskId,
          (status) => {
            const label = status === "running" ? "Generating..." :
                          status === "queued" ? "Queued..." :
                          status;
            set({ generationProgress: label });
          },
          controller.signal,
        );

        if (result.status === "succeeded" && result.resultUrls?.length) {
          const entry: GenerationHistoryEntry = {
            id: `gen-${Date.now().toString(36)}`,
            type: state.selectedType,
            model: currentModel.id,
            prompt: state.prompt,
            params,
            resultUrls: result.resultUrls,
            createdAt: Date.now(),
          };
          const history = [entry, ...get().history];
          persistHistory(history);
          set({
            isGenerating: false,
            generationSuccess: true,
            generationProgress: null,
            abortController: null,
            history,
          });
          setTimeout(() => set({ generationSuccess: false }), 3000);
          return;
        }

        set({
          isGenerating: false,
          generationError: result.errorMessage ?? "Generation failed",
          generationProgress: null,
          abortController: null,
        });
        return;
      }

      set({
        isGenerating: false,
        generationError: "No task ID or result returned from API",
        generationProgress: null,
        abortController: null,
      });
    } catch (err: unknown) {
      if (controller.signal.aborted) {
        set({ isGenerating: false, generationProgress: null, abortController: null });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      set({
        isGenerating: false,
        generationError: message,
        generationProgress: null,
        abortController: null,
      });
    }
  },
}));
