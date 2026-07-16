interface ShortcutGroup {
  name: string;
  shortcuts: { key: string; description: string }[];
}

const shortcutGroups: ShortcutGroup[] = [
  {
    name: "Playback",
    shortcuts: [
      { key: "Space", description: "Play / Pause" },
      { key: "←", description: "Step back 1 frame" },
      { key: "→", description: "Step forward 1 frame" },
      { key: "Shift + ←", description: "Step back 1 second" },
      { key: "Shift + →", description: "Step forward 1 second" },
    ],
  },
  {
    name: "Tools",
    shortcuts: [
      { key: "V", description: "Selection tool" },
      { key: "B", description: "Razor tool" },
      { key: "S", description: "Split clip at playhead" },
      { key: "X", description: "Ripple delete" },
      { key: "C", description: "Toggle crop mode" },
    ],
  },
  {
    name: "Editing",
    shortcuts: [
      { key: "A", description: "Select all layers" },
      { key: "Delete", description: "Delete selected" },
      { key: "Cmd + Z", description: "Undo" },
      { key: "Cmd + Shift + Z", description: "Redo" },
      { key: "Cmd + X", description: "Cut" },
      { key: "Cmd + C", description: "Copy" },
      { key: "Cmd + V", description: "Paste" },
      { key: "Cmd + A", description: "Select all" },
    ],
  },
  {
    name: "Timeline",
    shortcuts: [
      { key: "Cmd + +", description: "Zoom in" },
      { key: "Cmd + -", description: "Zoom out" },
      { key: "Cmd + 0", description: "Zoom to fit" },
      { key: "Escape", description: "Exit crop/transform mode" },
    ],
  },
  {
    name: "File",
    shortcuts: [
      { key: "Cmd + N", description: "New project" },
      { key: "Cmd + O", description: "Open project" },
      { key: "Cmd + S", description: "Save project" },
      { key: "Cmd + E", description: "Export" },
    ],
  },
  {
    name: "View",
    shortcuts: [
      { key: "Cmd + Shift + I", description: "Toggle inspector" },
      { key: "Cmd + Shift + M", description: "Toggle media panel" },
      { key: "Cmd + Ctrl + F", description: "Toggle fullscreen" },
      { key: "Cmd + ,", description: "Open settings" },
      { key: "Cmd + ?", description: "Open help" },
    ],
  },
];

export function ShortcutsPane() {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h2 className="text-lg font-semibold mb-4">Keyboard Shortcuts</h2>
      <div className="space-y-6">
        {shortcutGroups.map((group) => (
          <div key={group.name}>
            <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
              {group.name}
            </h3>
            <div className="space-y-1">
              {group.shortcuts.map((shortcut) => (
                <div
                  key={shortcut.key}
                  className="flex items-center justify-between py-1.5"
                >
                  <span className="text-sm text-white/70">
                    {shortcut.description}
                  </span>
                  <div className="flex items-center gap-1">
                    {shortcut.key.split(" + ").map((key, i) => (
                      <span key={i} className="flex items-center gap-1">
                        {i > 0 && (
                          <span className="text-white/30 text-xs">+</span>
                        )}
                        <kbd className="px-2 py-0.5 text-xs font-mono bg-white/10 border border-white/10 rounded text-white/80 min-w-[24px] text-center">
                          {key}
                        </kbd>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
