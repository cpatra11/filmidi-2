import { useState } from "react";
import { Sparkles } from "lucide-react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const captionStyles = [
  { id: "default", label: "Default", desc: "Standard subtitles" },
  { id: "karaoke", label: "Karaoke", desc: "Word-by-word highlight" },
  { id: "typewriter", label: "Typewriter", desc: "Letters appear sequentially" },
  { id: "bounce", label: "Bounce", desc: "Words bounce in" },
  { id: "fade", label: "Fade", desc: "Fade in/out per word" },
];

const languages = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "ja", label: "Japanese" },
  { code: "zh", label: "Chinese" },
  { code: "ko", label: "Korean" },
  { code: "pt", label: "Portuguese" },
];

const placements = ["Top", "Center", "Bottom"];

export function CaptionTab() {
  const [language, setLanguage] = useState("en");
  const [maxWords, setMaxWords] = useState("3");
  const [profanityCensor, setProfanityCensor] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState("default");
  const [fontSize, setFontSize] = useState("24");
  const [fontColor, setFontColor] = useState("#ffffff");
  const [placement, setPlacement] = useState("Bottom");
  const [isGenerating, setIsGenerating] = useState(false);

  return (
    <div className="h-full flex flex-col bg-[#0A0A0A]">
      <div className="px-3 py-2 border-b border-[#1C1C1C]">
        <h3 className="text-xs font-semibold text-gray-300">Caption Generation</h3>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          {/* Source */}
          <div className="space-y-2">
            <Label className="text-[11px] text-gray-400">Source</Label>
            <Select defaultValue="timeline">
              <SelectTrigger className="h-8 text-xs bg-[#141414] border-[#1C1C1C]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="timeline">Entire Timeline</SelectItem>
                <SelectItem value="selection">Selection</SelectItem>
                <SelectItem value="clip">Current Clip</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Language */}
          <div className="space-y-2">
            <Label className="text-[11px] text-gray-400">Language</Label>
            <Select value={language} onValueChange={(v) => v && setLanguage(v)}>
              <SelectTrigger className="h-8 text-xs bg-[#141414] border-[#1C1C1C]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {languages.map((lang) => (
                  <SelectItem key={lang.code} value={lang.code}>
                    {lang.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Max words */}
          <div className="space-y-2">
            <Label className="text-[11px] text-gray-400">Max Words Per Line</Label>
            <Input
              type="number"
              value={maxWords}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaxWords(e.target.value)}
              min="1"
              max="10"
              className="h-8 text-xs bg-[#141414] border-[#1C1C1C]"
            />
          </div>

          {/* Style presets */}
          <div className="space-y-2">
            <Label className="text-[11px] text-gray-400">Animation Style</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {captionStyles.map((style) => (
                <button
                  key={style.id}
                  onClick={() => setSelectedStyle(style.id)}
                  className={cn(
                    "p-2 rounded-lg text-left transition-all border",
                    selectedStyle === style.id
                      ? "bg-white/10 border-white/30 text-white"
                      : "bg-[#141414] border-[#1C1C1C] text-gray-400 hover:border-gray-600"
                  )}
                >
                  <p className="text-[11px] font-medium">{style.label}</p>
                  <p className="text-[9px] text-gray-500 mt-0.5">{style.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Font settings */}
          <div className="space-y-2">
            <Label className="text-[11px] text-gray-400">Text Style</Label>
            <div className="grid grid-cols-3 gap-1.5">
              <div className="space-y-1">
                <Label className="text-[9px] text-gray-500">Size</Label>
                <Input
                  type="number"
                  value={fontSize}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFontSize(e.target.value)}
                  className="h-7 text-xs bg-[#141414] border-[#1C1C1C]"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[9px] text-gray-500">Color</Label>
                <input
                  type="color"
                  value={fontColor}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFontColor(e.target.value)}
                  className="w-7 h-7 rounded border border-[#1C1C1C] cursor-pointer"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[9px] text-gray-500">BG</Label>
                <div className="w-7 h-7 rounded border border-[#1C1C1C] bg-transparent" />
              </div>
            </div>
          </div>

          {/* Placement */}
          <div className="space-y-2">
            <Label className="text-[11px] text-gray-400">Placement</Label>
            <div className="flex gap-1">
              {placements.map((p) => (
                <button
                  key={p}
                  onClick={() => setPlacement(p)}
                  className={cn(
                    "flex-1 py-1.5 rounded text-[11px] transition-all border",
                    placement === p
                      ? "bg-white/10 border-white/30 text-white"
                      : "bg-[#141414] border-[#1C1C1C] text-gray-400 hover:border-gray-600"
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Censor */}
          <div className="flex items-center justify-between">
            <Label className="text-[11px] text-gray-400">Profanity Censor</Label>
            <button
              onClick={() => setProfanityCensor(!profanityCensor)}
              className={cn(
                "w-8 h-4 rounded-full transition-colors relative",
                profanityCensor ? "bg-white" : "bg-[#333]"
              )}
            >
              <div
                className={cn(
                  "w-3 h-3 rounded-full bg-white absolute top-0.5 transition-transform",
                  profanityCensor ? "left-[18px]" : "left-[2px]"
                )}
              />
            </button>
          </div>
        </div>
      </ScrollArea>

      {/* Generate bar */}
      <div className="p-3 border-t border-[#1C1C1C]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-gray-500">Estimated cost</span>
          <span className="text-[10px] text-white/60 font-medium">~5 credits</span>
        </div>
        <Button className="w-full h-8 text-xs gap-1.5" onClick={() => { if (!isGenerating) { setIsGenerating(true); setTimeout(() => setIsGenerating(false), 3000); } }}>
          {isGenerating ? (
            <>
              <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles size={14} />
              Generate Captions
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
