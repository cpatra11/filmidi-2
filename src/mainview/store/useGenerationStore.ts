import { create } from "zustand";
import { submitGeneration, waitForTask, type GenerationType, type GenerationParams } from "@/lib/generationApi";
import { getSecureApiKey } from "@/lib/secureApiKey";

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
  { id: "google/veo-3.1-generate-001", name: "Veo 3.1", type: "video" as const },
  { id: "klingai/kling-v2.6-i2v", name: "Kling v2.6 I2V", type: "video" as const },
];

const IMAGE_MODELS = [
  { id: "google/imagen-4.0-generate-001", name: "Imagen 4", type: "image" as const },
  { id: "google/imagen-4.0-fast-generate", name: "Imagen 4 Fast", type: "image" as const },
  { id: "bfl/flux-2-pro", name: "Flux 2 Pro", type: "image" as const },
  { id: "bfl/flux-2-flex", name: "Flux 2 Flex", type: "image" as const },
];

const AUDIO_MODELS = [
  { id: "xai/grok-tts", name: "Grok TTS", type: "audio" as const },
];

const TRANSCRIPTION_MODELS = [
  { id: "xai/grok-stt", name: "Grok STT", type: "transcription" as const },
];

const UPSCALE_MODELS = [
  { id: "hitpaw-upscaler-v2", name: "HitPaw Upscaler v2", type: "upscale" as const },
];

const THIRD_PARTY_MODELS = new Set<string>();

export { VIDEO_MODELS, IMAGE_MODELS, AUDIO_MODELS, THIRD_PARTY_MODELS };

export function getModelsForType(type: GenerationType) {
  return getTypeModels(type);
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
    "google/veo-3.1-generate-001": { "720p": 5, "1080p": 12 },
    "klingai/kling-v2.6-i2v": { "720p": 5, "1080p": 12 },
  };
  const imageCredits: Record<string, number> = {
    "google/imagen-4.0-generate-001": 8,
    "google/imagen-4.0-fast-generate": 3,
    "bfl/flux-2-pro": 10,
    "bfl/flux-2-flex": 5,
  };
  const audioRates: Record<string, number> = {
    "xai/grok-tts": 5,
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

    const vercelKey = await getSecureApiKey();
    if (!vercelKey) {
      set({ generationError: "Add a Vercel AI Gateway API key in Settings > Agent." });
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
      const submitResult = await submitGeneration(vercelKey, state.selectedType, params);

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
          vercelKey,
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
