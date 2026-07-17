import { useState, useEffect, useCallback } from "react";
import { Users, Mic, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { transcribeAudio } from "@/lib/cloudTranscription";
import { getSecureApiKey } from "@/lib/secureApiKey";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useAccountStore } from "@/store/useAccountStore";
import { useEditorStore } from "@videoflow/react-video-editor";

interface Speaker {
  id: string;
  name: string;
  color: string;
}

const defaultColors = [
  "#FFFFFF", "#999999", "#666666", "#CCCCCC",
  "#AAAAAA", "#DDDDDD", "#777777", "#BBBBBB",
];

export function SpeechTab() {
  // Speakers state
  const [markSpeakers, setMarkSpeakers] = useState(false);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [isIdentifying, setIsIdentifying] = useState(false);
  const [identifyError, setIdentifyError] = useState<string | null>(null);

  // Silence state
  const [markSilence, setMarkSilence] = useState(false);
  const [analyzingCount, setAnalyzingCount] = useState(0);
  const [deadAirCount, setDeadAirCount] = useState(0);

  const handleIdentify = useCallback(async () => {
    setIsIdentifying(true);
    setIdentifyError(null);

    const settingsMode = useSettingsStore.getState().audioProcessingMode;
    const apiKey = await getSecureApiKey();
    const hasCloudAccess = !!apiKey || useAccountStore.getState().isSignedIn();
    const effectiveMode = hasCloudAccess ? "cloud" : settingsMode;

    if (effectiveMode !== "cloud") {
      setIdentifyError("Switch to Cloud mode in Settings > Audio Processing to identify speakers.");
      setIsIdentifying(false);
      return;
    }

    if (!hasCloudAccess) {
      setIdentifyError("No API key set and not signed in. Configure in the Agent panel first.");
      setIsIdentifying(false);
      return;
    }

    try {
      const editor = useEditorStore.getState();
      const layers = (editor.video?.layers ?? []) as Array<Record<string, unknown>>;
      const audioClips = layers.filter(
        (l: any) => l.type === "audio" || l.type === "video"
      );

      if (audioClips.length === 0) {
        setIdentifyError("No audio or video clips found in the timeline.");
        setIsIdentifying(false);
        return;
      }

      const speakerSet = new Set<string>();
      for (const clip of audioClips) {
        const mediaRef = (clip as any).mediaRef;
        if (!mediaRef?.url) continue;

        const result = await transcribeAudio(mediaRef.url, apiKey, {
          diarization: true,
        });

        for (const seg of result.segments) {
          if (seg.speaker) speakerSet.add(seg.speaker);
        }
        for (const w of result.words) {
          if (w.speaker) speakerSet.add(w.speaker);
        }
      }

      const sorted = Array.from(speakerSet).sort();
      const newSpeakers: Speaker[] = sorted.map((id, i) => ({
        id,
        name: `Speaker ${i + 1}`,
        color: defaultColors[i % defaultColors.length],
      }));

      setSpeakers(newSpeakers);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setIdentifyError(msg);
    } finally {
      setIsIdentifying(false);
    }
  }, []);

  const handleRemoveSpeaker = (id: string) => {
    setSpeakers((prev) => prev.filter((s) => s.id !== id));
  };

  const handleRenameSpeaker = (id: string, name: string) => {
    setSpeakers((prev) =>
      prev.map((s) => (s.id === id ? { ...s, name } : s))
    );
  };

  const handleColorChange = (id: string, color: string) => {
    setSpeakers((prev) =>
      prev.map((s) => (s.id === id ? { ...s, color } : s))
    );
  };

  const handleRemoveSilence = useCallback(async () => {
    const editor = useEditorStore.getState();
    const layers = (editor.video?.layers ?? []) as Array<Record<string, unknown>>;
    const audioClips = layers.filter(
      (l: any) => l.type === "audio" || l.type === "video"
    );

    if (audioClips.length === 0) return;

    setAnalyzingCount(audioClips.length);

    try {
      let totalSilentSections = 0;
      for (const clip of audioClips) {
        const mediaRef = (clip as any).mediaRef;
        if (!mediaRef?.url) continue;

        const resp = await fetch(mediaRef.url);
        const blob = await resp.blob();
        const buffer = await blob.arrayBuffer();
        const audioCtx = new AudioContext();
        const audioBuffer = await audioCtx.decodeAudioData(buffer);

        const channel = audioBuffer.getChannelData(0);
        const hopMs = 50;
        const hopSamples = Math.floor(audioBuffer.sampleRate * hopMs / 1000);
        const threshold = 0.02;

        let inSilence = false;
        let sections = 0;
        for (let i = 0; i < channel.length; i += hopSamples) {
          let maxAbs = 0;
          for (let j = i; j < Math.min(i + hopSamples, channel.length); j++) {
            maxAbs = Math.max(maxAbs, Math.abs(channel[j]));
          }
          const isQuiet = maxAbs < threshold;
          if (isQuiet && !inSilence) {
            sections++;
            inSilence = true;
          } else if (!isQuiet) {
            inSilence = false;
          }
        }
        totalSilentSections += sections;
        audioCtx.close();
      }

      setDeadAirCount(totalSilentSections);
    } catch {
      // Silently fail — silence detection is non-critical
    } finally {
      setAnalyzingCount(0);
    }
  }, []);

  useEffect(() => {
    if (markSilence && deadAirCount === 0 && analyzingCount === 0) {
      handleRemoveSilence();
    }
  }, [markSilence, deadAirCount, analyzingCount, handleRemoveSilence]);

  return (
    <div className="h-full flex flex-col bg-[#0A0A0A] relative">
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-5">
          {/* Speakers Section */}
          <div className="space-y-3">
            <h4 className="text-[11px] font-semibold text-gray-300 uppercase tracking-wider">
              Speakers
            </h4>

            {/* Mark Speakers toggle */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users size={14} className="text-gray-500" />
                <div>
                  <p className="text-xs text-gray-300">Mark Speakers</p>
                  <p className="text-[10px] text-gray-600">
                    Tints waveforms by speaker. Voices are matched across clips using cloud transcripts.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setMarkSpeakers(!markSpeakers)}
                className={cn(
                  "w-8 h-4 rounded-full transition-colors relative shrink-0",
                  markSpeakers ? "bg-white" : "bg-gray-700"
                )}
              >
                <div
                  className={cn(
                    "w-3 h-3 rounded-full bg-white absolute top-0.5 transition-transform",
                    markSpeakers ? "left-[18px]" : "left-[2px]"
                  )}
                />
              </button>
            </div>

            {/* Identify / Refresh button */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[11px] gap-1"
                disabled={isIdentifying}
                onClick={handleIdentify}
              >
                {isIdentifying ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    Identifying...
                  </>
                ) : speakers.length === 0 ? (
                  "Identify Speakers"
                ) : (
                  "Refresh"
                )}
              </Button>
              <span className="text-[10px] text-gray-600">
                {isIdentifying
                  ? "Transcribing clips and matching voices..."
                  : "Matches voices across clips, transcribes untranscribed clips first (uses credits)."}
              </span>
            </div>

            {/* Error */}
            {identifyError && (
              <p className="text-[11px] text-red-400">{identifyError}</p>
            )}

            {/* Speaker labels */}
            {speakers.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-[10px] text-gray-500">Labels</Label>
                {speakers.map((speaker) => (
                  <div key={speaker.id} className="flex items-center gap-2">
                    <input
                      type="color"
                      value={speaker.color}
                      onChange={(e) => handleColorChange(speaker.id, e.target.value)}
                      className="w-6 h-6 rounded border border-[#1C1C1C] cursor-pointer shrink-0"
                    />
                    <Input
                      value={speaker.name}
                      onChange={(e) => handleRenameSpeaker(speaker.id, e.target.value)}
                      className="h-7 text-xs bg-[#141414] border-[#1C1C1C] flex-1"
                    />
                    <button
                      onClick={() => handleRemoveSpeaker(speaker.id)}
                      className="text-gray-600 hover:text-gray-400 transition-colors shrink-0"
                      title="Remove speaker"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Silence Detection Section */}
          <div className="space-y-3">
            <h4 className="text-[11px] font-semibold text-gray-300 uppercase tracking-wider">
              Silence Detection
            </h4>

            {/* Mark Silence toggle */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mic size={14} className="text-gray-500" />
                <div>
                  <p className="text-xs text-gray-300">Mark Silence</p>
                  <p className="text-[10px] text-gray-600">
                    Speech is detected on-device in the background. Dims quiet, speech-free spans on timeline waveforms.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setMarkSilence(!markSilence)}
                className={cn(
                  "w-8 h-4 rounded-full transition-colors relative shrink-0",
                  markSilence ? "bg-white" : "bg-gray-700"
                )}
              >
                <div
                  className={cn(
                    "w-3 h-3 rounded-full bg-white absolute top-0.5 transition-transform",
                    markSilence ? "left-[18px]" : "left-[2px]"
                  )}
                />
              </button>
            </div>

            {/* Analyzing progress */}
            {analyzingCount > 0 && (
              <div className="flex items-center gap-2">
                <Loader2 size={12} className="text-gray-500 animate-spin" />
                <span className="text-[11px] text-gray-500">
                  {analyzingCount === 1
                    ? "Detecting speech..."
                    : `Detecting speech in ${analyzingCount} files...`}
                </span>
              </div>
            )}

            {/* Remove Silence */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[11px]"
                disabled={deadAirCount === 0}
                onClick={handleRemoveSilence}
              >
                Remove Silence
              </Button>
              {deadAirCount > 0 && (
                <span className="text-[11px] text-gray-500">
                  {deadAirCount === 1 ? "1 section" : `${deadAirCount} sections`}
                </span>
              )}
            </div>
          </div>
        </div>
      </ScrollArea>

      {/* Identifying overlay */}
      {isIdentifying && (
        <div className="absolute inset-0 bg-[#0A0A0A]/80 backdrop-blur-sm flex items-center justify-center z-10">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-full border-2 border-white/20 border-t-white animate-spin" />
            <div className="text-center">
              <p className="text-xs text-gray-300 font-medium">Identifying Speakers</p>
              <p className="text-[10px] text-gray-500 mt-1">Transcribing and matching voices...</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
