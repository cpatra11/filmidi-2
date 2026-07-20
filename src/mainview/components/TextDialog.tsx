import { useEffect, useState } from "react";
import { Check, Type, X } from "lucide-react";
import { useTextDialogStore } from "@/store/useTextDialogStore";

export function TextDialog() {
  const { isOpen, close, submit } = useTextDialogStore();
  const [value, setValue] = useState("Text");

  useEffect(() => {
    if (isOpen) setValue("Text");
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <button aria-label="Close text dialog" className="absolute inset-0 bg-black/60" onClick={close} />
      <form
        className="relative w-[360px] max-w-[calc(100vw-32px)] rounded-xl border border-[#292929] bg-[#101010] p-4 text-white shadow-2xl"
        onSubmit={(event) => { event.preventDefault(); submit(value); }}
      >
        <button type="button" aria-label="Close" title="Close" onClick={close} className="absolute right-3 top-3 rounded p-1 text-white/50 hover:bg-white/10 hover:text-white"><X size={16} /></button>
        <div className="flex items-center gap-2"><Type size={16} /><h2 className="text-sm font-semibold">Add Text</h2></div>
        <label className="mt-4 block text-xs text-white/50" htmlFor="timeline-text">Text content</label>
        <textarea
          id="timeline-text"
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="mt-1 min-h-20 w-full resize-y rounded-md border border-white/15 bg-black/30 px-2.5 py-2 text-sm outline-none focus:border-white/40"
          placeholder="Type text for the timeline"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={close} className="rounded-md px-3 py-1.5 text-xs text-white/60 hover:bg-white/10 hover:text-white">Cancel</button>
          <button type="submit" className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-black hover:bg-white/85"><Check size={13} /> Add to timeline</button>
        </div>
      </form>
    </div>
  );
}
