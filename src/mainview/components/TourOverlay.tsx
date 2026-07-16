import { useEffect, useState, useCallback } from "react";
import { useTourStore, tourSteps, type TourStep } from "@/store/useTourStore";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

interface TargetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function useTargetRect(selector?: string): TargetRect | null {
  const [rect, setRect] = useState<TargetRect | null>(null);

  useEffect(() => {
    if (!selector) {
      setRect(null);
      return;
    }

    const update = () => {
      const el = document.querySelector(selector);
      if (el) {
        const r = el.getBoundingClientRect();
        setRect({ x: r.left, y: r.top, width: r.width, height: r.height });
      } else {
        setRect(null);
      }
    };

    update();
    const interval = setInterval(update, 200);
    return () => clearInterval(interval);
  }, [selector]);

  return rect;
}

function Spotlight({
  rect,
}: {
  rect: TargetRect;
}) {
  const padding = 8;
  const borderRadius = 12;

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: rect.x - padding,
        top: rect.y - padding,
        width: rect.width + padding * 2,
        height: rect.height + padding * 2,
        borderRadius,
        boxShadow: "0 0 0 9999px rgba(0,0,0,0.6), 0 0 20px rgba(255,255,255,0.15)",
        border: "2px solid rgba(255,255,255,0.3)",
      }}
    />
  );
}

function CalloutCard({
  step,
  targetRect,
  stepIndex,
  totalSteps,
  onBack,
  onNext,
  onEnd,
}: {
  step: TourStep;
  targetRect: TargetRect | null;
  stepIndex: number;
  totalSteps: number;
  onBack: () => void;
  onNext: () => void;
  onEnd: () => void;
}) {
  const isIntro = step.id === "welcome";
  const isOutro = step.id === "done";
  const isLast = stepIndex === totalSteps - 1;

  const cardStyle = isIntro || isOutro
    ? "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
    : getCalloutPosition(targetRect, step.position);

  return (
    <div
      className={`absolute z-[60] w-[320px] ${cardStyle}`}
    >
      <div className="bg-zinc-900 border border-white/10 rounded-xl shadow-2xl p-5">
        {isIntro && (
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-white to-white/70 flex items-center justify-center mb-4 mx-auto">
            <span className="text-xl">🎬</span>
          </div>
        )}

        <h3 className="text-base font-semibold mb-2">{step.title}</h3>
        <p className="text-sm text-white/60 leading-relaxed mb-4">
          {step.instruction}
        </p>

        {isOutro && (
          <div className="grid grid-cols-2 gap-2 mb-4">
            {[
              { label: "Shortcuts", desc: "⌘?" },
              { label: "Settings", desc: "⌘," },
              { label: "Export", desc: "⌘E" },
              { label: "Help", desc: "⌘?" },
            ].map((item) => (
              <div
                key={item.label}
                className="px-3 py-2 bg-white/5 rounded-lg text-center"
              >
                <div className="text-xs text-white/60">{item.label}</div>
                <div className="text-xs font-mono text-white/40 mt-0.5">
                  {item.desc}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {!isIntro && stepIndex > 0 && (
              <button
                onClick={onBack}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-white/60 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
              >
                <ChevronLeft size={14} />
                Back
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onEnd}
              className="px-3 py-1.5 text-sm text-white/50 hover:text-white/80 rounded-lg hover:bg-white/5 transition-colors"
            >
              Skip
            </button>
            {isLast ? (
              <button
                onClick={onEnd}
                className="px-4 py-1.5 text-sm font-medium bg-white text-black hover:bg-white/90 rounded-lg transition-colors"
              >
                Start creating
              </button>
            ) : (
              <button
                onClick={onNext}
                className="flex items-center gap-1 px-4 py-1.5 text-sm font-medium bg-white text-black hover:bg-white/90 rounded-lg transition-colors"
              >
                Next
                <ChevronRight size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-1.5 mt-4">
          {tourSteps.map((_, i) => (
            <div
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                i === stepIndex
                  ? "bg-white"
                  : i < stepIndex
                    ? "bg-white/50"
                    : "bg-white/20"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function getCalloutPosition(
  targetRect: TargetRect | null,
  preferred?: string
): string {
  if (!targetRect) return "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2";

  const offset = 20;
  const cardWidth = 320;
  const cardHeight = 200;

  const positions: Record<string, string> = {
    right: `absolute left-[${targetRect.x + targetRect.width + offset}px] top-[${targetRect.y}px]`,
    left: `absolute left-[${targetRect.x - cardWidth - offset}px] top-[${targetRect.y}px]`,
    top: `absolute left-[${targetRect.x}px] top-[${targetRect.y - cardHeight - offset}px]`,
    bottom: `absolute left-[${targetRect.x}px] top-[${targetRect.y + targetRect.height + offset}px]`,
  };

  return positions[preferred || "right"] || positions.right;
}

export function TourOverlay() {
  const { isActive, currentStep, advance, back, end } = useTourStore();
  const step = tourSteps[currentStep];
  const targetRect = useTargetRect(step?.targetSelector);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") end();
      if (e.key === "Enter") advance();
    },
    [advance, end]
  );

  useEffect(() => {
    if (isActive) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isActive, handleKeyDown]);

  if (!isActive || !step) return null;

  const isSpotlight = !!step.targetSelector;

  return (
    <div className="fixed inset-0 z-[55]">
      {/* Scrim */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={end}
      />

      {/* Spotlight */}
      {isSpotlight && targetRect && <Spotlight rect={targetRect} />}

      {/* Callout card */}
      <CalloutCard
        step={step}
        targetRect={isSpotlight ? targetRect : null}
        stepIndex={currentStep}
        totalSteps={tourSteps.length}
        onBack={back}
        onNext={advance}
        onEnd={end}
      />

      {/* Close button */}
      <button
        onClick={end}
        className="absolute top-4 right-4 z-[61] w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/60 hover:text-white transition-colors"
      >
        <X size={16} />
      </button>
    </div>
  );
}
