import { create } from "zustand";

export interface TourStep {
  id: string;
  title: string;
  instruction: string;
  targetSelector?: string;
  position?: "right" | "left" | "top" | "bottom";
}

const STORAGE_KEY = "filmidi_has_seen_tour";

function hasSeenTour(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function markTourSeen() {
  localStorage.setItem(STORAGE_KEY, "true");
}

const tourSteps: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to Filmidi",
    instruction:
      "Let's take a quick tour of the editor. You can re-open this tour anytime from the Help menu.",
  },
  {
    id: "media",
    title: "Media Panel",
    instruction:
      "Import your video, audio, and image files here. Drag them to the timeline to start editing.",
    targetSelector: "[data-tour='media-panel']",
    position: "right",
  },
  {
    id: "preview",
    title: "Preview",
    instruction:
      "See your video in real-time. Use the transform and crop overlays to adjust clips.",
    targetSelector: "[data-tour='preview']",
    position: "left",
  },
  {
    id: "timeline",
    title: "Timeline",
    instruction:
      "Arrange your clips, add transitions, and fine-tune timing. Use keyboard shortcuts for fast editing.",
    targetSelector: "[data-tour='timeline']",
    position: "top",
  },
  {
    id: "inspector",
    title: "Inspector",
    instruction:
      "Adjust clip properties, apply effects, and use AI-powered editing tools.",
    targetSelector: "[data-tour='inspector']",
    position: "left",
  },
  {
    id: "agent",
    title: "AI Agent",
    instruction:
      "Ask the AI to edit your video, add captions, generate content, and more.",
    targetSelector: "[data-tour='agent']",
    position: "right",
  },
  {
    id: "done",
    title: "You're all set!",
    instruction:
      "Start creating! You can access keyboard shortcuts with ⌘? and settings with ⌘,.",
  },
];

interface TourState {
  isActive: boolean;
  currentStep: number;
  hasSeen: boolean;
  start: () => void;
  advance: () => void;
  back: () => void;
  end: () => void;
}

export const useTourStore = create<TourState>((set, get) => ({
  isActive: false,
  currentStep: 0,
  hasSeen: hasSeenTour(),

  start: () => set({ isActive: true, currentStep: 0 }),

  advance: () => {
    const { currentStep } = get();
    if (currentStep >= tourSteps.length - 1) {
      markTourSeen();
      set({ isActive: false, hasSeen: true });
    } else {
      set({ currentStep: currentStep + 1 });
    }
  },

  back: () => {
    const { currentStep } = get();
    if (currentStep > 0) {
      set({ currentStep: currentStep - 1 });
    }
  },

  end: () => {
    markTourSeen();
    set({ isActive: false, hasSeen: true });
  },
}));

export { tourSteps };
