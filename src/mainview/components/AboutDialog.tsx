import { ExternalLink, Film, X } from "lucide-react";
import { useAboutStore } from "@/store/useAboutStore";

const repositoryUrl = "https://github.com/cpatra11/filmidi-q";

export function AboutDialog() {
  const { isOpen, close } = useAboutStore();
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <button aria-label="Close About" className="absolute inset-0 bg-black/70" onClick={close} />
      <section className="relative w-[460px] max-w-[calc(100vw-32px)] rounded-xl border border-[#292929] bg-[#0d0d0d] p-6 text-white shadow-2xl">
        <button aria-label="Close" title="Close" onClick={close} className="absolute right-3 top-3 rounded p-1 text-white/50 hover:bg-white/10 hover:text-white">
          <X size={16} />
        </button>
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-white text-black"><Film size={22} /></div>
          <div>
            <h2 className="text-lg font-semibold">Filmidi Editor</h2>
            <p className="text-xs text-white/50">AI-native, timeline-first video editing</p>
          </div>
        </div>
        <p className="mt-5 text-sm leading-6 text-white/75">
          Filmidi combines a precise multi-track timeline with an agent that can inspect media, edit clips, generate captions, place assets, and execute repeatable editing workflows.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2 text-xs">
          {[
            ["Version", "0.0.1"],
            ["Runtime", "Electrobun + Bun"],
            ["Editor engine", "VideoFlow"],
            ["License", "GPL-3.0-or-later"],
          ].map(([label, value]) => <div key={label} className="border-t border-white/10 pt-2"><div className="text-white/40">{label}</div><div className="mt-1 text-white/80">{value}</div></div>)}
        </div>
        <p className="mt-5 text-xs leading-5 text-white/50">
          Projects are saved as self-contained <code className="text-white/75">.filmidi</code> packages, including timeline data, media metadata, generated assets, captions, and agent history. macOS can use the optional native sidecar; other platforms use the Bun/VideoFlow backend.
        </p>
        <a href={repositoryUrl} target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-1.5 text-xs text-white/70 hover:text-white">
          Project repository <ExternalLink size={13} />
        </a>
      </section>
    </div>
  );
}
