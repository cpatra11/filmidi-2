import { useMemo, useState } from "react";
import { commands, useEditorStore, useSelection } from "@videoflow/react-video-editor";
import { listEffects, listTransitions } from "@videoflow/renderer-browser";
import { ChevronDown, Plus, Trash2 } from "lucide-react";

const {
  setPropertyCommand,
  setSettingCommand,
  setKeyframeCommand,
  removeKeyframeCommand,
  addEffectCommand,
  removeEffectCommand,
  setEffectEnabledCommand,
  setTransitionCommand,
} = commands as any;

function NumberField({ label, value, step = 0.01, onChange }: { label: string; value: number; step?: number; onChange: (value: number) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 text-[10px] text-white/55">
      <span>{label}</span>
      <input
        className="w-[86px] rounded border border-white/10 bg-white/5 px-1.5 py-1 text-right text-[11px] text-white outline-none focus:border-white/35"
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details open className="border-b border-white/10 px-3 py-2">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white/55">
        <ChevronDown size={12} /> {title}
      </summary>
      <div className="mt-2 flex flex-col gap-2">{children}</div>
    </details>
  );
}

export function VideoFlowInspector() {
  const { layers } = useSelection();
  const layer = (layers.length === 1 ? layers[0] : null) as any;
  const commit = useEditorStore((state) => state.commit);
  const currentFrame = useEditorStore((state) => state.currentFrame);
  const fps = useEditorStore((state) => state.video.fps || 30);
  const [effectName, setEffectName] = useState(listEffects()[0] ?? "");
  const [transitionName, setTransitionName] = useState(listTransitions()[0] ?? "");

  const position = Array.isArray(layer?.properties?.position) ? layer.properties.position : [0.5, 0.5];
  const effects = Array.isArray(layer?.effects) ? layer.effects : [];
  const keyframeTime = Math.max(0, currentFrame / fps - Number(layer?.settings?.startTime ?? 0));
  const keyframeProperties = useMemo(() => ["position", "scale", "rotation", "opacity"], []);

  if (!layer) {
    return <div className="border-b border-white/10 px-3 py-3 text-[10px] text-white/35">Select one clip for VideoFlow controls.</div>;
  }

  const updateProperty = (name: string, value: unknown) => void setPropertyCommand(commit, layer.id, name, value);
  const updateSetting = (name: string, value: unknown) => void setSettingCommand(commit, layer.id, name, value);

  return (
    <div className="border-t border-white/10 bg-[#0d0d0d] text-white">
      <div className="px-3 pt-3 text-[11px] font-semibold text-white/80">VideoFlow Controls</div>
      <Section title="Transform">
        <NumberField label="Position X" value={Number(position[0])} onChange={(value) => updateProperty("position", [value, Number(position[1])])} />
        <NumberField label="Position Y" value={Number(position[1])} onChange={(value) => updateProperty("position", [Number(position[0]), value])} />
        <NumberField label="Scale" value={Number(layer.properties?.scale ?? 1)} onChange={(value) => updateProperty("scale", value)} />
        <NumberField label="Rotation" value={Number(layer.properties?.rotation ?? 0)} step={1} onChange={(value) => updateProperty("rotation", value)} />
        <NumberField label="Opacity" value={Number(layer.properties?.opacity ?? 1)} step={0.01} onChange={(value) => updateProperty("opacity", Math.max(0, Math.min(1, value)))} />
      </Section>

      <Section title="Timing">
        <NumberField label="Start (s)" value={Number(layer.settings?.startTime ?? 0)} onChange={(value) => updateSetting("startTime", Math.max(0, value))} />
        <NumberField label="Duration (s)" value={Number(layer.settings?.sourceDuration ?? 0)} onChange={(value) => updateSetting("sourceDuration", Math.max(0, value))} />
        <NumberField label="Speed" value={Number(layer.settings?.speed ?? 1)} step={0.05} onChange={(value) => updateSetting("speed", Math.max(0.05, value))} />
      </Section>

      {(layer.type === "audio" || layer.type === "video") && (
        <Section title="Audio">
          <NumberField label="Volume" value={Number(layer.properties?.volume ?? layer.settings?.volume ?? 1)} onChange={(value) => updateProperty("volume", Math.max(0, value))} />
          <label className="flex items-center justify-between text-[10px] text-white/55">
            Mute
            <input type="checkbox" checked={layer.properties?.mute === true || layer.settings?.mute === true} onChange={(event) => updateProperty("mute", event.target.checked)} />
          </label>
        </Section>
      )}

      <Section title="Effects">
        <div className="flex gap-1">
          <select className="min-w-0 flex-1 rounded border border-white/10 bg-white/5 px-1.5 py-1 text-[10px] text-white" value={effectName} onChange={(event) => setEffectName(event.target.value)}>
            {listEffects().map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <button className="rounded border border-white/10 px-2 text-white/70 hover:bg-white/10" title="Add effect" onClick={() => effectName && void addEffectCommand(commit, layer.id, effectName)}><Plus size={13} /></button>
        </div>
        {effects.map((effect: any, index: number) => (
          <div key={`${effect.effect ?? effect.name}-${index}`} className="flex items-center gap-2 rounded border border-white/10 px-2 py-1">
            <input type="checkbox" checked={effect.enabled !== false} onChange={(event) => void setEffectEnabledCommand(commit, layer.id, index, event.target.checked)} />
            <span className="min-w-0 flex-1 truncate text-[10px] text-white/70">{effect.effect ?? effect.name ?? "Effect"}</span>
            <button className="text-white/40 hover:text-red-300" title="Remove effect" onClick={() => void removeEffectCommand(commit, layer.id, index, String(effect.effect ?? effect.name ?? "effect"))}><Trash2 size={12} /></button>
          </div>
        ))}
      </Section>

      <Section title="Transitions">
        {(["in", "out"] as const).map((edge) => (
          <div key={edge} className="flex items-center gap-1">
            <span className="w-7 text-[10px] uppercase text-white/45">{edge}</span>
            <select className="min-w-0 flex-1 rounded border border-white/10 bg-white/5 px-1.5 py-1 text-[10px] text-white" value={layer[`transition${edge === "in" ? "In" : "Out"}`]?.transition ?? ""} onChange={(event) => void setTransitionCommand(commit, layer.id, edge, event.target.value ? { transition: event.target.value, duration: 0.5 } : null)}>
              <option value="">None</option>
              {listTransitions().map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <NumberField label="" value={Number(layer[`transition${edge === "in" ? "In" : "Out"}`]?.duration ?? 0.5)} step={0.05} onChange={(value) => { const current = layer[`transition${edge === "in" ? "In" : "Out"}`]; if (current) void setTransitionCommand(commit, layer.id, edge, { ...current, duration: Math.max(0.01, value) }); }} />
          </div>
        ))}
      </Section>

      <Section title="Keyframes">
        <div className="text-[10px] text-white/40">Current source time: {keyframeTime.toFixed(2)}s</div>
        {keyframeProperties.map((property) => (
          <div key={property} className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-white/65">{property}</span>
            <div className="flex gap-1">
              <button className="rounded border border-white/10 px-1.5 py-1 text-[10px] text-white/65 hover:bg-white/10" title={`Add ${property} keyframe`} onClick={() => void setKeyframeCommand(commit, layer.id, property, keyframeTime, layer.properties?.[property])}>◆</button>
              <button className="rounded border border-white/10 px-1.5 py-1 text-[10px] text-white/65 hover:bg-white/10" title={`Remove ${property} keyframe`} onClick={() => void removeKeyframeCommand(commit, layer.id, property, keyframeTime)}>×</button>
            </div>
          </div>
        ))}
      </Section>
    </div>
  );
}
