import { useState } from "react";
import {
  useGenerationStore,
  getModelsForType,
  getCostForConfig,
  type GenerationType,
  type GenerationReference,
  type GenerationHistoryEntry,
} from "@/store/useGenerationStore";
import { useAppStore } from "@/store/useAppStore";
import {
  Video,
  Image as ImageIcon,
  AudioWaveform,
  ArrowUp,
  X,
  Settings,
  ChevronDown,
  Plus,
  VideoIcon,
  Music,
  Clock,
  Trash2,
  RotateCcw,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const TYPE_TABS: { type: GenerationType; icon: React.ElementType; color: string }[] = [
  { type: "image", icon: ImageIcon, color: "#FFFFFF" },
  { type: "video", icon: Video, color: "#FFFFFF" },
  { type: "audio", icon: AudioWaveform, color: "#FFFFFF" },
];

const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"];
const RESOLUTIONS = ["720p", "1080p"];
const QUALITIES = ["standard", "hd"];
const DURATIONS = [5, 10, 15, 20];
const VOICES = [
  "default-female", "default-male", "gentle-female", "deep-male",
  "narrative-female", "narrative-male", "cosy-female", "cosy-male",
  "cosy-narrative", "cosy-news",
];

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* ------------------------------------------------------------------ */
/*  Ref card                                                           */
/* ------------------------------------------------------------------ */

function RefCard({
  ref: refObj,
  onRemove,
}: {
  ref: GenerationReference;
  onRemove: () => void;
}) {
  return (
    <div className="relative group">
      <div className="w-[80px] h-[56px] rounded-md overflow-hidden bg-[#141414] border border-[#1C1C1C]">
        {refObj.thumbnailUrl ? (
          <img src={refObj.thumbnailUrl} alt={refObj.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {refObj.type === "image" && <ImageIcon className="w-4 h-4 text-[#8888aa]" />}
            {refObj.type === "video" && <VideoIcon className="w-4 h-4 text-[#8888aa]" />}
            {refObj.type === "audio" && <Music className="w-4 h-4 text-[#8888aa]" />}
          </div>
        )}
      </div>
      <button
        onClick={onRemove}
        className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#333355] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
      >
        <X className="w-2.5 h-2.5" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Drop zone                                                          */
/* ------------------------------------------------------------------ */

function RefDropZone({ onDrop }: { onDrop: () => void }) {
  const [targeted, setTargeted] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setTargeted(true); }}
      onDragLeave={() => setTargeted(false)}
      onDrop={(e) => { e.preventDefault(); setTargeted(false); onDrop(); }}
      className={`w-[80px] h-[56px] rounded-md flex flex-col items-center justify-center cursor-pointer transition-colors border-2 border-dashed ${
        targeted
          ? "border-white/20 bg-white/5"
          : "border-[#1C1C1C] bg-white/5 hover:bg-white/8"
      }`}
    >
      <Plus className={`w-4 h-4 ${targeted ? "text-white/70" : "text-[#555577]"}`} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Frame slot                                                         */
/* ------------------------------------------------------------------ */

function FrameSlot({
  label,
  asset,
  onDrop,
  onClear,
  acceptType = "image",
  icon: Icon = ImageIcon,
}: {
  label: string;
  asset: GenerationReference | null;
  onDrop: (ref: GenerationReference) => void;
  onClear: () => void;
  acceptType?: string;
  icon?: React.ElementType;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium text-[#8888aa]">{label}</span>
      {asset ? (
        <div className="relative group">
          <div className="w-[80px] h-[56px] rounded-md overflow-hidden bg-[#141414] border border-[#1C1C1C]">
            {asset.thumbnailUrl ? (
              <img src={asset.thumbnailUrl} alt={asset.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Icon className="w-4 h-4 text-[#8888aa]" />
              </div>
            )}
          </div>
          <button
            onClick={onClear}
            className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#333355] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </div>
      ) : (
        <RefDropZone onDrop={() => {
          onDrop({ id: `ref-${Date.now()}`, name: "Dropped file", type: acceptType as "image" | "video" | "audio" });
        }} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Model picker                                                       */
/* ------------------------------------------------------------------ */

function ModelPicker() {
  const { selectedType, selectedModelIndex, setSelectedModelIndex } = useGenerationStore();
  const models = getModelsForType(selectedType);
  const current = models[selectedModelIndex] || models[0];
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium text-[#aaaacc] hover:text-[#ccccee] cursor-pointer"
      >
        <span className="truncate max-w-[100px]">{current?.name}</span>
        <ChevronDown className="w-2.5 h-2.5" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 bg-[#0A0A0A] border border-[#1C1C1C] rounded-lg shadow-lg overflow-hidden z-50 max-h-[200px] overflow-y-auto min-w-[160px]">
          {models.map((m, i) => (
            <button
              key={m.id}
              onClick={() => { setSelectedModelIndex(i); setOpen(false); }}
              className={`w-full px-3 py-1.5 text-left text-[11px] cursor-pointer ${
                selectedModelIndex === i
                  ? "bg-white/10 text-[#e0e0ee]"
                  : "text-[#aaaacc] hover:bg-white/5"
              }`}
            >
              {m.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Settings popover                                                   */
/* ------------------------------------------------------------------ */

function SettingsPopover() {
  const {
    selectedType, duration, setDuration, aspectRatio, setAspectRatio,
    resolution, setResolution, quality, setQuality, numImages, setNumImages,
    voice, setVoice, instrumental, setInstrumental, generateAudio, setGenerateAudio,
    showSettings, toggleSettings,
  } = useGenerationStore();

  if (!showSettings) return null;

  return (
    <div className="absolute bottom-full right-0 mb-2 w-[280px] bg-[#0A0A0A] border border-[#1C1C1C] rounded-xl shadow-xl p-3 z-50">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[12px] font-semibold text-[#ccccee]">Settings</span>
        <button onClick={toggleSettings} className="text-[#555577] hover:text-[#8888aa] cursor-pointer">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {selectedType === "video" && (
        <>
          <SettingSection label="Duration">
            <OptionRow
              options={DURATIONS.map((d) => ({ value: String(d), label: `${d}s` }))}
              selected={String(duration)}
              onSelect={(v) => setDuration(Number(v))}
            />
          </SettingSection>
          <SettingSection label="Aspect Ratio">
            <OptionRow
              options={ASPECT_RATIOS.map((a) => ({ value: a, label: a }))}
              selected={aspectRatio}
              onSelect={setAspectRatio}
            />
          </SettingSection>
          <SettingSection label="Resolution">
            <OptionRow
              options={RESOLUTIONS.map((r) => ({ value: r, label: r }))}
              selected={resolution}
              onSelect={setResolution}
            />
          </SettingSection>
          <SettingSection label="Generate Audio">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={generateAudio}
                onChange={(e) => setGenerateAudio(e.target.checked)}
                className="accent-white"
              />
              <span className="text-[11px] text-[#aaaacc]">Include audio track</span>
            </label>
          </SettingSection>
        </>
      )}

      {selectedType === "image" && (
        <>
          <SettingSection label="Aspect Ratio">
            <OptionRow
              options={ASPECT_RATIOS.map((a) => ({ value: a, label: a }))}
              selected={aspectRatio}
              onSelect={setAspectRatio}
            />
          </SettingSection>
          <SettingSection label="Resolution">
            <OptionRow
              options={RESOLUTIONS.map((r) => ({ value: r, label: r }))}
              selected={resolution}
              onSelect={setResolution}
            />
          </SettingSection>
          <SettingSection label="Quality">
            <OptionRow
              options={QUALITIES.map((q) => ({ value: q, label: q === "standard" ? "Standard" : "HD" }))}
              selected={quality}
              onSelect={setQuality}
            />
          </SettingSection>
          <SettingSection label="Number of Images">
            <OptionRow
              options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: String(n) }))}
              selected={String(numImages)}
              onSelect={(v) => setNumImages(Number(v))}
            />
          </SettingSection>
        </>
      )}

      {selectedType === "audio" && (
        <>
          <SettingSection label="Voice">
            <div className="flex flex-wrap gap-1">
              {VOICES.map((v) => (
                <button
                  key={v}
                  onClick={() => setVoice(v)}
                  className={`px-2 py-0.5 rounded text-[10px] cursor-pointer ${
                    voice === v
                      ? "bg-white/10 text-[#e0e0ee]"
                      : "bg-white/5 text-[#8888aa] hover:bg-white/10"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </SettingSection>
          <SettingSection label="Duration">
            <OptionRow
              options={[15, 30, 60, 120].map((d) => ({ value: String(d), label: `${d}s` }))}
              selected={String(duration)}
              onSelect={(v) => setDuration(Number(v))}
            />
          </SettingSection>
          <SettingSection label="Instrumental">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={instrumental}
                onChange={(e) => setInstrumental(e.target.checked)}
                className="accent-white"
              />
              <span className="text-[11px] text-[#aaaacc]">No vocals</span>
            </label>
          </SettingSection>
        </>
      )}
    </div>
  );
}

function SettingSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2.5">
      <div className="text-[10px] font-medium text-[#8888aa] mb-1">{label}</div>
      {children}
    </div>
  );
}

function OptionRow({
  options,
  selected,
  onSelect,
}: {
  options: { value: string; label: string }[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="flex gap-1 flex-wrap">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onSelect(opt.value)}
          className={`px-2 py-0.5 rounded text-[10px] cursor-pointer ${
            selected === opt.value
              ? "bg-white/10 text-[#e0e0ee]"
              : "bg-white/5 text-[#8888aa] hover:bg-white/10"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  History panel                                                      */
/* ------------------------------------------------------------------ */

function HistoryPanel() {
  const { history, toggleHistory } = useGenerationStore();

  return (
    <div className="absolute inset-0 bg-[#0A0A0A] z-50 flex flex-col">
      <div className="flex items-center gap-2 px-3 pt-2 pb-1 shrink-0">
        <Clock className="w-3.5 h-3.5 text-[#8888aa]" />
        <span className="text-[12px] font-semibold text-[#ccccee]">Generation History</span>
        <div className="flex-1" />
        <button
          onClick={toggleHistory}
          className="w-6 h-6 flex items-center justify-center text-[#8888aa] hover:text-[#aaaacc] cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
        {history.length === 0 ? (
          <div className="text-[11px] text-[#555577] text-center py-8">
            No generations yet
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {history.map((entry) => (
              <HistoryCard key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryCard({ entry }: { entry: GenerationHistoryEntry }) {
  const { setPrompt, setSelectedType, setSelectedModelIndex, toggleHistory } = useGenerationStore();
  const models = getModelsForType(entry.type);
  const modelIndex = models.findIndex((m) => m.id === entry.model);
  const modelName = models[modelIndex]?.name ?? entry.model;

  const handleRerun = () => {
    setSelectedType(entry.type);
    if (modelIndex >= 0) setSelectedModelIndex(modelIndex);
    setPrompt(entry.prompt);
    toggleHistory();
  };

  const typeIcon = entry.type === "video" ? Video : entry.type === "image" ? ImageIcon : AudioWaveform;
  const TypeIcon = typeIcon;

  return (
    <div className="bg-white/5 rounded-lg p-2.5 border border-white/5">
      <div className="flex items-start gap-2">
        <TypeIcon className="w-3.5 h-3.5 text-[#8888aa] mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-[#ccccee] truncate">{entry.prompt}</div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[9px] text-[#666688] font-mono">{modelName}</span>
            <span className="text-[9px] text-[#555577]">{formatTime(entry.createdAt)}</span>
          </div>
        </div>
        <button
          onClick={handleRerun}
          className="w-5 h-5 flex items-center justify-center text-[#666688] hover:text-[#aaaacc] cursor-pointer shrink-0"
          title="Re-run with same settings"
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      </div>

      {entry.resultUrls.length > 0 && (
        <div className="mt-2 flex gap-1.5 overflow-x-auto">
          {entry.resultUrls.map((url, i) => (
            <a
              key={i}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 w-[60px] h-[42px] rounded bg-[#141414] border border-[#1C1C1C] flex items-center justify-center overflow-hidden hover:border-white/20 transition-colors"
            >
              {entry.type === "image" ? (
                <img src={url} alt="" className="w-full h-full object-cover" />
              ) : entry.type === "video" ? (
                <Video className="w-3 h-3 text-[#8888aa]" />
              ) : (
                <AudioWaveform className="w-3 h-3 text-[#8888aa]" />
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main GenerationPanel                                               */
/* ------------------------------------------------------------------ */

export function GenerationPanel() {
  const { toggleGenerationPanel } = useAppStore();
  const {
    selectedType, setSelectedType, prompt, setPrompt,
    firstFrame, setFirstFrame, lastFrame, setLastFrame,
    imageReferences, addImageReference, removeImageReference,
    audioVideoSource, setAudioVideoSource,
    duration, resolution,
    isGenerating, generationProgress, generationError, generationSuccess,
    submit, cancelGeneration, toggleSettings, toggleHistory, showHistory,
    clearReferences,
    lyrics, setLyrics,
  } = useGenerationStore();

  const models = getModelsForType(selectedType);
  const currentModel = models[useGenerationStore.getState().selectedModelIndex] ?? models[0];
  const estimatedCost = getCostForConfig(selectedType, currentModel?.id ?? "", duration, resolution);

  const canSubmit = prompt.trim().length > 0 && !isGenerating;

  const handleTypeChange = (type: GenerationType) => {
    setSelectedType(type);
    clearReferences();
  };

  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-[#0A0A0A] to-[#050505] rounded-xl border border-[#1C1C1C] shadow-lg overflow-hidden relative">
      {/* History overlay */}
      {showHistory && <HistoryPanel />}

      {/* Header: type tabs + history + close */}
      <div className="flex items-center gap-2 px-3 pt-2 pb-1 shrink-0">
        <div className="flex gap-0.5 p-0.5 rounded-lg bg-white/5 border border-white/5">
          {TYPE_TABS.map(({ type, icon: Icon, color }) => (
            <button
              key={type}
              onClick={() => handleTypeChange(type)}
              className={`px-2.5 py-1 rounded-md flex items-center gap-1.5 cursor-pointer transition-colors ${
                selectedType === type ? "bg-white/10" : "hover:bg-white/5"
              }`}
            >
              <Icon
                className="w-3.5 h-3.5"
                style={{ color: selectedType === type ? color : "#8888aa" }}
              />
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          onClick={toggleHistory}
          className="w-6 h-6 flex items-center justify-center text-[#8888aa] hover:text-[#aaaacc] cursor-pointer"
          title="Generation History"
        >
          <Clock className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={toggleGenerationPanel}
          className="w-6 h-6 flex items-center justify-center text-[#8888aa] hover:text-[#aaaacc] cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* References area */}
      <div className="px-3 py-1 shrink-0">
        {selectedType === "video" && (
          <div className="flex gap-2 items-start">
            <FrameSlot
              label="First Frame"
              asset={firstFrame}
              onDrop={setFirstFrame}
              onClear={() => setFirstFrame(null)}
            />
            <FrameSlot
              label="Last Frame"
              asset={lastFrame}
              onDrop={setLastFrame}
              onClear={() => setLastFrame(null)}
            />
          </div>
        )}

        {selectedType === "image" && (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-medium text-[#8888aa]">References</span>
            <div className="flex gap-1.5 flex-wrap items-start">
              {imageReferences.map((ref) => (
                <RefCard
                  key={ref.id}
                  ref={ref}
                  onRemove={() => removeImageReference(ref.id)}
                />
              ))}
              <RefDropZone
                onDrop={() => {
                  addImageReference({
                    id: `imgref-${Date.now()}`,
                    name: "Image ref",
                    type: "image",
                  });
                }}
              />
            </div>
          </div>
        )}

        {selectedType === "audio" && (
          <FrameSlot
            label="Source Video (optional)"
            asset={audioVideoSource}
            onDrop={setAudioVideoSource}
            onClear={() => setAudioVideoSource(null)}
            acceptType="video"
            icon={VideoIcon}
          />
        )}
      </div>

      {/* Prompt area + input box */}
      <div className="flex-1 min-h-0 px-3 pb-2 flex flex-col gap-1">
        <div className="flex-1 min-h-0 rounded-xl bg-black/20 border border-white/10 focus-within:border-white/20 transition-colors overflow-hidden flex flex-col relative">
          {/* Settings popover */}
          <SettingsPopover />

          {/* Prompt textarea */}
          <div className="flex-1 min-h-0 relative">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                selectedType === "audio"
                  ? "Describe the music style or mood"
                  : selectedType === "image"
                    ? "Describe the image"
                    : "Describe the video"
              }
              className="w-full h-full bg-transparent text-[12px] text-[#e0e0ee] placeholder:text-[#555577] px-3 pt-2.5 pb-1 resize-none outline-none"
            />
          </div>

          {/* Secondary fields for audio */}
          {selectedType === "audio" && (
            <div className="px-3 pb-1">
              <textarea
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
                placeholder="Lyrics (optional). [Verse] and [Chorus] tags supported."
                className="w-full bg-transparent text-[11px] text-[#aaaacc] placeholder:text-[#444466] resize-none outline-none min-h-[36px] max-h-[80px] border-t border-white/5 pt-1"
              />
            </div>
          )}

          {/* Bottom toolbar */}
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-t border-white/5 shrink-0">
            <ModelPicker />
            <button
              onClick={toggleSettings}
              className="w-5 h-5 flex items-center justify-center text-[#8888aa] hover:text-[#aaaacc] cursor-pointer"
            >
              <Settings className="w-3 h-3" />
            </button>

            <div className="flex-1" />

            {estimatedCost !== null && (
              <span className="text-[10px] text-[#8888aa] font-mono">
                {estimatedCost} credits
              </span>
            )}

            {isGenerating ? (
              <button
                onClick={cancelGeneration}
                className="w-7 h-7 flex items-center justify-center rounded-full bg-[#333] hover:bg-[#444] text-white cursor-pointer transition-colors"
                title="Cancel generation"
              >
                <X className="w-3.5 h-3.5" strokeWidth={2.5} />
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={!canSubmit}
                className="w-7 h-7 flex items-center justify-center rounded-full bg-white hover:bg-white/90 text-white cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-default"
              >
                <ArrowUp className="w-3.5 h-3.5" strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>

        {/* Error */}
        {generationError && (
          <div className="text-[10px] text-red-400 text-center py-1 px-2 bg-red-500/10 rounded-md">
            {generationError}
          </div>
        )}

        {/* Progress */}
        {isGenerating && generationProgress && (
          <div className="text-[10px] text-white/70 text-center py-1">
            {generationProgress}
          </div>
        )}

        {/* Success */}
        {generationSuccess && (
          <div className="text-[10px] text-emerald-400 text-center py-1">
            Generation complete
          </div>
        )}
      </div>
    </div>
  );
}
