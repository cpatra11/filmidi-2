import { useState } from "react";
import { Music, Sparkles, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useGenerationStore, getModelsForType } from "@/store/useGenerationStore";

const musicModels = [
  { id: "fun-music-v1", label: "Fun Music v1", desc: "High quality music generation" },
  { id: "fun-music-preview", label: "Fun Music Preview", desc: "Faster, lower quality" },
];

export function MusicTab() {
  const [tab, setTab] = useState<"text" | "video">("text");
  const [model, setModel] = useState("fun-music-v1");
  const [prompt, setPrompt] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [instrumental, setInstrumental] = useState(false);
  const [duration, setDuration] = useState("30");
  const generationStore = useGenerationStore();

  const handleGenerate = () => {
    if (generationStore.isGenerating) return;
    const models = getModelsForType("audio");
    const modelIndex = models.findIndex((m) => m.id === model);
    generationStore.setSelectedType("audio");
    generationStore.setPrompt(prompt);
    generationStore.setSelectedModelIndex(modelIndex >= 0 ? modelIndex : 0);
    generationStore.setDuration(parseInt(duration, 10) || 30);
    generationStore.setLyrics(lyrics);
    generationStore.setInstrumental(instrumental);
    generationStore.submit();
  };

  const isGenerating = generationStore.isGenerating;

  return (
    <div className="h-full flex flex-col bg-[#0A0A0A]">
      <div className="px-3 py-2 border-b border-[#1C1C1C]">
        <h3 className="text-xs font-semibold text-gray-300">Music Generation</h3>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          <Tabs value={tab} onValueChange={(v) => setTab(v as "text" | "video")}>
            <TabsList className="w-full h-8 bg-[#141414]">
              <TabsTrigger value="text" className="flex-1 text-[11px] gap-1">
                <Music size={12} />
                Text to Music
              </TabsTrigger>
              <TabsTrigger value="video" className="flex-1 text-[11px] gap-1">
                <Mic size={12} />
                Video to Music
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="space-y-2">
            <Label className="text-[11px] text-gray-400">Model</Label>
            <Select value={model} onValueChange={(v) => v && setModel(v)}>
              <SelectTrigger className="h-8 text-xs bg-[#141414] border-[#1C1C1C]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {musicModels.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    <div>
                      <p className="text-xs">{m.label}</p>
                      <p className="text-[9px] text-gray-500">{m.desc}</p>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-[11px] text-gray-400">Description</Label>
            <Textarea
              placeholder="Describe the music you want... e.g., 'Upbeat electronic dance track with synths'"
              value={prompt}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPrompt(e.target.value)}
              className="min-h-[80px] text-xs bg-[#141414] border-[#1C1C1C] resize-none"
            />
          </div>

          {tab === "text" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] text-gray-400">Lyrics (optional)</Label>
                <button
                  onClick={() => setInstrumental(!instrumental)}
                  className={cn(
                    "px-2 py-0.5 rounded text-[10px] transition-all border",
                    instrumental
                      ? "bg-white/10 border-white/30 text-white/60"
                      : "bg-[#141414] border-[#1C1C1C] text-gray-500 hover:border-gray-600"
                  )}
                >
                  Instrumental
                </button>
              </div>
              {!instrumental && (
                <Textarea
                  placeholder="Enter lyrics here..."
                  value={lyrics}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setLyrics(e.target.value)}
                  className="min-h-[60px] text-xs bg-[#141414] border-[#1C1C1C] resize-none"
                />
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-[11px] text-gray-400">Duration (seconds)</Label>
            <Input
              type="number"
              value={duration}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDuration(e.target.value)}
              min="5"
              max="300"
              className="h-8 text-xs bg-[#141414] border-[#1C1C1C]"
            />
          </div>
        </div>
      </ScrollArea>

      <div className="p-3 border-t border-[#1C1C1C]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-gray-500">Estimated cost</span>
          <span className="text-[10px] text-white/60 font-medium">~10 credits</span>
        </div>
        <Button className="w-full h-8 text-xs gap-1.5" onClick={handleGenerate}>
          {isGenerating ? (
            <>
              <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles size={14} />
              Generate Music
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
