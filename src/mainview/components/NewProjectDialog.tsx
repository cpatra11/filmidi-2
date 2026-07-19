import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Film } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PRESETS = [
  { label: "HD 1080p", w: 1920, h: 1080, desc: "16:9" },
  { label: "HD 720p", w: 1280, h: 720, desc: "16:9" },
  { label: "4K UHD", w: 3840, h: 2160, desc: "16:9" },
  { label: "Vertical 1080p", w: 1080, h: 1920, desc: "9:16" },
  { label: "Square 1:1", w: 1080, h: 1080, desc: "1:1" },
  { label: "Custom", w: 0, h: 0, desc: "Set manually" },
];

const FPS_OPTIONS = [23.976, 24, 25, 29.97, 30, 48, 50, 60];

interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (settings: {
    name: string;
    width: number;
    height: number;
    fps: number;
  }) => void;
}

export function NewProjectDialog({ open, onOpenChange, onCreate }: NewProjectDialogProps) {
  const [name, setName] = useState("Untitled Project");
  const [selectedPreset, setSelectedPreset] = useState(0);
  const [customW, setCustomW] = useState("1920");
  const [customH, setCustomH] = useState("1080");
  const [fps, setFps] = useState(30);

  const preset = PRESETS[selectedPreset];
  const isCustom = selectedPreset === PRESETS.length - 1;
  const width = isCustom ? parseInt(customW, 10) || 1920 : preset.w;
  const height = isCustom ? parseInt(customH, 10) || 1080 : preset.h;

  const handleCreate = () => {
    onCreate({ name: name.trim() || "Untitled Project", width, height, fps });
    onOpenChange(false);
  };

  const handleReset = () => {
    setName("Untitled Project");
    setSelectedPreset(0);
    setFps(30);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) handleReset(); onOpenChange(o); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[420px] rounded-xl bg-[#0A0A0A] border border-white/10 shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-md bg-white/10 flex items-center justify-center">
                <Film className="w-4 h-4 text-white/70" />
              </div>
              <Dialog.Title className="text-sm font-medium text-white">
                New Project
              </Dialog.Title>
            </div>
            <Dialog.Close className="w-6 h-6 flex items-center justify-center rounded-md text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors">
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="p-5 space-y-5">
            {/* Project name */}
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1.5">Project Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Awesome Video"
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/30 outline-none focus:border-white/30 transition-colors"
                autoFocus
              />
            </div>

            {/* Resolution presets */}
            <div>
              <label className="block text-xs font-medium text-white/60 mb-2">Resolution</label>
              <div className="grid grid-cols-3 gap-2">
                {PRESETS.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedPreset(i)}
                    className={cn(
                      "px-3 py-2 rounded-lg border text-left transition-all",
                      selectedPreset === i
                        ? "border-white/40 bg-white/10 text-white"
                        : "border-white/10 text-white/50 hover:border-white/20 hover:text-white/70"
                    )}
                  >
                    <div className="text-xs font-medium">{p.label}</div>
                    <div className="text-[10px] text-white/40 mt-0.5">{p.desc}</div>
                  </button>
                ))}
              </div>
              {isCustom && (
                <div className="flex gap-2 mt-2">
                  <input
                    type="number"
                    value={customW}
                    onChange={(e) => setCustomW(e.target.value)}
                    placeholder="Width"
                    className="w-full px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/30 outline-none focus:border-white/30"
                  />
                  <span className="flex items-center text-white/30 text-xs">×</span>
                  <input
                    type="number"
                    value={customH}
                    onChange={(e) => setCustomH(e.target.value)}
                    placeholder="Height"
                    className="w-full px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/30 outline-none focus:border-white/30"
                  />
                </div>
              )}
            </div>

            {/* FPS */}
            <div>
              <label className="block text-xs font-medium text-white/60 mb-2">Frame Rate</label>
              <div className="flex flex-wrap gap-1.5">
                {FPS_OPTIONS.map((f) => (
                  <button
                    key={f}
                    onClick={() => setFps(f)}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-xs font-medium border transition-all",
                      fps === f
                        ? "border-white/40 bg-white/10 text-white"
                        : "border-white/10 text-white/40 hover:border-white/20 hover:text-white/60"
                    )}
                  >
                    {f}fps
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/10">
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-white/60 hover:text-white/80">
              Cancel
            </Button>
            <Button onClick={handleCreate} className="bg-white text-black hover:bg-white/90">
              Create Project
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
