# Filmidi Editor

Filmidi is an AI-native desktop video editor built around a precise, multi-track timeline. It combines direct editing controls with an agent that can inspect the current project and use editing tools to carry out requests such as importing media, arranging clips, trimming, ripple editing, transcription, captions, asset placement, and export.

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

## License

Filmidi Editor is released under the GNU General Public License v3.0 or later. See [LICENSE](LICENSE).

## Repository

This project is maintained in the `qchackathon` branch at [github.com/cpatra11/filmidi-q](https://github.com/cpatra11/filmidi-q).
