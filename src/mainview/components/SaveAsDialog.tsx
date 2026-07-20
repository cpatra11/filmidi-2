import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, FileText, Database, Check, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSaveAsStore } from "@/store/useSaveAsStore";
import { saveProjectAsCopyWithName } from "@/lib/menuActions";
import { dbChooseProjectLocation, dbGetProjectStorageInfo } from "@/lib/dbIPC";

export function SaveAsDialog() {
  const { isOpen, close, defaultName } = useSaveAsStore();
  const [name, setName] = useState(defaultName);
  const [storagePath, setStoragePath] = useState("Loading local project storage...");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [location, setLocation] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName(defaultName);
      setSavedId(null);
      setLocation(null);
      setSavedPath(null);
      dbGetProjectStorageInfo()
        .then((info) => setStoragePath(info.path))
        .catch(() => setStoragePath("Local Filmidi project storage"));
    }
  }, [defaultName, isOpen]);

  const handleSave = async () => {
    const nextName = name.trim();
    if (!nextName) return;
    const selectedLocation = location || await dbChooseProjectLocation();
    if (!selectedLocation) return;
    setLocation(selectedLocation);
    const result = await saveProjectAsCopyWithName(nextName, selectedLocation);
    if (result?.id) {
      setSavedId(result.id);
      setSavedPath(result.filePath);
      return;
    }
    close();
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[420px] rounded-xl bg-[#0A0A0A] border border-white/10 shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-md bg-white/10 flex items-center justify-center">
                <FileText className="w-4 h-4 text-white/70" />
              </div>
              <Dialog.Title className="text-sm font-medium text-white">
                Save As
              </Dialog.Title>
            </div>
            <Dialog.Close className="w-6 h-6 flex items-center justify-center rounded-md text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors">
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          <div className="p-5">
            <label className="block text-xs font-medium text-white/60 mb-1.5">
              Project Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={cn(
                "w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white",
                "placeholder:text-white/30 outline-none focus:border-white/30 transition-colors"
              )}
              autoFocus
            />
            <p className="mt-3 text-[11px] text-white/40">
              Creates a complete copy including timeline clips, audio, video, text, captions, effects, generated media, folders, and chat history.
            </p>
            <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-white/40">
                <Database className="w-3.5 h-3.5" />
                Project storage location
              </div>
              <div className="mt-1 text-[11px] text-white/70 break-all">{location ?? "No project folder selected"}</div>
              <div className="mt-1 text-[10px] text-white/35">The complete project file will be written here. Internal index: {storagePath}</div>
              <Button type="button" variant="ghost" onClick={async () => setLocation(await dbChooseProjectLocation(location ?? undefined))} className="mt-2 h-7 px-2 text-[10px] text-white/65">
                <FolderOpen className="w-3.5 h-3.5 mr-1.5" /> Choose folder
              </Button>
            </div>
            {savedId && (
              <div className="mt-3 flex items-center gap-2 text-[11px] text-emerald-300">
                <Check className="w-3.5 h-3.5" />
                Saved as a complete project copy. Project ID: {savedId}
                {savedPath && <span className="block break-all text-white/50">{savedPath}</span>}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/10">
            <Button variant="ghost" onClick={close} className="text-white/60 hover:text-white/80">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!!savedId} className="bg-white text-black hover:bg-white/90">
              Save As
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
