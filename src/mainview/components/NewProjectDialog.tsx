import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Film } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ASPECT_RATIOS = [
  { label: "16:9", w: 1920, h: 1080, desc: "Widescreen" },
  { label: "9:16", w: 1080, h: 1920, desc: "Vertical / Stories" },
  { label: "1:1", w: 1080, h: 1080, desc: "Square" },
  { label: "4:3", w: 1440, h: 1080, desc: "Classic" },
  { label: "3:4", w: 1080, h: 1440, desc: "Portrait" },
  { label: "21:9", w: 2560, h: 1080, desc: "Ultrawide" },
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
  const [selectedRatio, setSelectedRatio] = useState(0);
  const [fps, setFps] = useState(30);

  const ratio = ASPECT_RATIOS[selectedRatio];

  const handleCreate = () => {
    onCreate({ name: name.trim() || "Untitled Project", width: ratio.w, height: ratio.h, fps });
    onOpenChange(false);
  };

  const handleReset = () => {
    setName("Untitled Project");
    setSelectedRatio(0);
    setFps(30);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) handleReset(); onOpenChange(o); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[400px] rounded-xl bg-[#0A0A0A] border border-white/10 shadow-2xl overflow-hidden">
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

            {/* Aspect ratio */}
            <div>
              <label className="block text-xs font-medium text-white/60 mb-2">Aspect Ratio</label>
              <div className="grid grid-cols-3 gap-2">
                {ASPECT_RATIOS.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedRatio(i)}
                    className={cn(
                      "px-3 py-2.5 rounded-lg border text-center transition-all",
                      selectedRatio === i
                        ? "border-white/40 bg-white/10 text-white"
                        : "border-white/10 text-white/50 hover:border-white/20 hover:text-white/70"
                    )}
                  >
                    <div className="text-sm font-medium">{r.label}</div>
                    <div className="text-[10px] text-white/40 mt-0.5">{r.desc}</div>
                  </button>
                ))}
              </div>
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
