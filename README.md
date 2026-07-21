# Filmidi Editor

Filmidi is an AI-native desktop video editor built around a precise, multi-track timeline. It combines direct editing controls with an agent that can inspect the current project and use editing tools to carry out requests such as importing media, arranging clips, trimming, ripple editing, transcription, captions, asset placement, and export.

<p>
  <a href="https://github.com/cpatra11/filmidi-2/releases/latest/download/Filmidi-v0.0.1-macos-arm64.dmg"><strong>Download for Mac (Apple Silicon)</strong></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/cpatra11/filmidi-2/releases/latest">View all releases</a>
</p>

The downloadable build is a macOS Apple Silicon DMG. Add your Qwen Cloud API key from the welcome screen or Settings after installation.

## What It Includes

- Multi-track video, audio, image, and text layers with linked audio/video clips.
- Timeline editing with move, trim, split, ripple delete, undo/redo, snapping, and zoom controls.
- Media panel with local imports, generated assets, folders, and project-scoped media metadata.
- Transcript-aware caption generation with phrase timing based on word boundaries.
- Agent tools for inspecting the timeline and media before making edits.
- VideoFlow rendering and editing primitives, including properties, keyframes, effects, and transitions where exposed by the editor UI.
- Native macOS menu actions, optional Swift media sidecar support, and a Bun/VideoFlow fallback for other platforms.
- Project saving as a self-contained `.filmidi` package.

## Architecture

The application is an Electrobun desktop app with three cooperating parts:

- `src/mainview`: React interface, timeline, media panel, dialogs, agent UI, and editor state.
- `src/bun`: Bun host process, native menus, IPC, project files, export coordination, and tool routing.
- `native/sidecar`: optional Swift implementation for macOS-specific media operations. It is not required on non-macOS systems.

VideoFlow remains the editor and rendering layer. The native sidecar is an optional acceleration and integration layer, not a migration away from VideoFlow.

## Development

Requirements: [Bun](https://bun.sh/) and Node-compatible build tools. macOS users may also build the Swift sidecar with Xcode command-line tools.

```sh
bun install
bun run dev
```

For the Vite hot-reload workflow:

```sh
bun run dev:hmr
```

Useful checks:

```sh
bunx vite build
bun run typecheck
```

## Projects And Storage

Use **Save As** to choose a destination folder. Filmidi writes a `.filmidi` project package there and stores the project path, timeline, media manifest, folders, generated assets, captions, generation history, and agent chat history. **Save Project** updates the current package after that. Exported media is written to the location selected in the export dialog and is independent of the project package.

## Agent Workflow

The agent should inspect the timeline, transcript, and media library before editing. Tools are intended to operate on the project model rather than only the preview, so edits remain visible in the timeline and are included in export. For external media, search results must be imported into the media panel first, then placed on an appropriate track and verified in the timeline. Users are responsible for checking licenses before publishing downloaded media.

## Native Media Support

On macOS, the optional Swift sidecar can provide Apple-specific media and hardware capabilities when its binary is packaged with the app. When it is unavailable, Filmidi logs the fallback and continues through Bun and VideoFlow. Production packaging includes the sidecar only when it has been built for the target architecture; non-macOS builds do not require it.

## How Codex & GPT-5.6 Accelerated Filmidi

AI-assisted development was central to bringing Filmidi from concept to a working desktop app in record time.

### Codex: Our Engineering Partner

Codex handled the heavy lifting that would have taken weeks of manual coding. It generated all 50+ MCP tools from scratch, writing clean TypeScript schemas and execution logic for everything from clip cutting to color grading and beat detection. When we needed real-time sync between the backend and UI, Codex architected the IPC handlers and Zustand stores that made it work smoothly. It even implemented the complex math behind waveform correlation and noise suppression, saving us from diving deep into audio processing research.

But perhaps most valuable was how Codex accelerated our debugging. Instead of spending hours tracing issues manually, we could ask Codex to inspect the codebase, identify problems in the timeline or MCP layers, and suggest focused fixes. This turned what could have been days of frustration into quick, iterative improvements.

### GPT-5.6: The Brain Behind the Co-Pilot

While Codex handled the engineering, GPT-5.6 became the intelligence powering Filmidi's conversational co-pilot. It helped us make critical early decisions, like choosing FableCut as our timeline engine and designing the agent architecture. More importantly, it understands what users actually want when they say "trim the silence" or "add cinematic color"—breaking down natural language into precise, sequential tool calls that the system can execute.

### Built for Trust and Transparency

Every action the AI takes is logged and auditable. Tool calls, transcripts, and project revisions are all tracked, so you can see exactly what changed and why. Critical operations run in sequence, meaning a failed transcription won't silently break caption generation or ripple edits.

### The Bottom Line

Filmidi exists because AI helped us move fast. Instead of getting bogged down rebuilding basic video editor behavior, we focused on what matters: building an editor that truly understands natural language and makes video creation feel intuitive, not mechanical.

## License

Filmidi Editor is released under the GNU General Public License v3.0 or later. See [LICENSE](LICENSE).

## Repository

This project is maintained in the `build-week-challenge` branch at
[github.com/cpatra11/filmidi-2](https://github.com/cpatra11/filmidi-2/tree/build-week-challenge).
