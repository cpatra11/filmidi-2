# Filmidi Swift → Electrobun/VideoFlow Migration Plan

## Current State
- **eb/** has 1 React component (`App.tsx`) wrapping `<VideoEditor>` from VideoFlow
- VideoFlow already provides: timeline, preview, inspector, media panel, toolbar, playback, text, effects, transitions, keyframes, undo/redo, export
- 3 patch scripts fix WKWebView compatibility (audio, video seeking, font loading)

## What VideoFlow ALREADY Provides (no work needed)
Timeline tracks/clips/playhead, preview canvas, inspector properties, media browser, toolbar, play/pause, undo/redo, text layers, video effects, transitions, keyframe animation, basic export, layer management.

## What Needs to Be Built (from Swift app)

---

## Phase 1: App Shell & Window Management
**Files:** `eb/src/mainview/App.tsx`, `eb/src/bun/index.ts`

| Feature | Swift Source | Electrobun Equivalent |
|---------|-------------|----------------------|
| Custom title bar | `TitleBarView.swift` | CSS `title-bar-area` + Electrobun `setTitleBarStyle('hidden')` |
| Project name (editable) | Title bar leading | ContentEditable span + IPC save |
| Back button to home | Title bar leading | React Router or state-based view switch |
| Account avatar | Title bar trailing | `<img>` from OAuth token |
| Credit summary badge | `CreditSummaryView` | Small pill component |
| Settings gear button | Title bar trailing | Opens settings modal |
| Window state persistence | `EditorWindowController` | Electrobun `BrowserWindow` position/size save to disk |
| Window close handling | `AppDelegate` | Electrobun `onClose` → save project |

**New deps:** None — pure React + Tailwind.

---

## Phase 2: Layout System
**Files:** `eb/src/mainview/components/Layout.tsx`

| Feature | Swift Source | Implementation |
|---------|-------------|----------------|
| 5-zone split layout | `EditorSplitViewController` | CSS Grid or `react-resizable-panels` |
| Agent panel (280pt) | Left column | Collapsible panel |
| Media panel (280pt) | Left column (tabbed with agent) | Collapsible panel |
| Preview (flex) | Center | VideoFlow `<vf-preview>` |
| Inspector (260pt) | Right column | VideoFlow `<vf-inspector>` |
| Timeline (300pt) | Bottom | VideoFlow `<vf-timeline>` |
| Layout presets | `LayoutPreset` enum | CSS class toggles |
| Panel toggle buttons | Toolbar right side | State-driven show/hide |

**New deps:** `react-resizable-panels`

---

## Phase 3: Toolbar
**Files:** `eb/src/mainview/components/Toolbar.tsx`

| Feature | Swift Source | Implementation |
|---------|-------------|----------------|
| Undo button | `ToolbarView` | `editor.undo()` |
| Redo button | `ToolbarView` | `editor.redo()` |
| Pointer tool (V) | `ToolMode.pointer` | State toggle |
| Razor tool (B) | `ToolMode.razor` | State toggle |
| Split clip (S) | `ToolbarView` | `editor.splitClip()` |
| Ripple delete (X) | `ToolbarView` | `editor.deleteClip()` |
| Zoom fit/in/out | `ToolbarView` | `editor.zoomFit/In/Out()` |
| Zoom percentage | `ToolbarView` | State display |
| Play/Pause | `ToolbarView` | `editor.play()/stop()` |
| Step forward/back | `ToolbarView` | `editor.stepForward/Back()` |
| Agent toggle | `ToolbarView` | State toggle |
| Inspector toggle | `ToolbarView` | State toggle |
| Media toggle | `ToolbarView` | State toggle |

---

## Phase 4: Keyboard Shortcuts
**Files:** `eb/src/mainview/hooks/useKeyboardShortcuts.ts`

All 27+ shortcuts from `EditorWindowController.swift`:

| Shortcut | Action | Implementation |
|----------|--------|----------------|
| Space | Play/Pause | `editor.play()/stop()` |
| Left/Right Arrow | Step 1 frame | `editor.step()` |
| Shift+Arrow | Step 1 second | `editor.step(30)` |
| Cmd+Z | Undo | `editor.undo()` |
| Cmd+Shift+Z | Redo | `editor.redo()` |
| Cmd+X/C/V | Cut/Copy/Paste | Clipboard API + editor commands |
| Cmd+Shift+V | Paste and match style | Custom paste handler |
| Delete/Backspace | Delete selected | `editor.deleteSelected()` |
| Cmd+A | Select all | `editor.selectAll()` |
| S | Split clip at playhead | `editor.splitClip()` |
| X | Ripple delete | `editor.deleteClip()` |
| B | Razor tool | Set tool mode |
| V | Pointer tool | Set tool mode |
| Cmd+Shift+I | Toggle inspector | State toggle |
| Cmd+Shift+M | Toggle media | State toggle |
| Cmd+Ctrl+F | Toggle fullscreen | Electrobun fullscreen API |
| Cmd+=/- | Zoom in/out | `editor.zoomIn/Out()` |
| Cmd+0 | Zoom to fit | `editor.zoomFit()` |

---

## Phase 5: Context Menus
**Files:** `eb/src/mainview/components/ContextMenu.tsx`

| Menu | Items | Source |
|------|-------|--------|
| **Clip context** | AI Edit, AI Crop, AI Resize, AI Background Remove, AI Enhance | `TimelineView+AIEditMenu.swift` |
| **Clip context** | Detect Beats, Show Beat Markers, Snap to Beats | `TimelineView+BeatsMenu.swift` |
| **Clip context** | Sync Audio, Sync Lock, Sync Unlock | `TimelineView+SyncMenu.swift` |
| **Clip context** | Cut, Copy, Paste, Delete, Split | Standard editing |
| **Media context** | Add to timeline, Show in Finder, Delete, Rename | `MediaPanelView` |
| **Timeline context** | Add track, Paste, Select all | Timeline operations |
| **Tab context** | Rename, Duplicate, Delete | `TimelineTabBar` |

Implementation: Custom React context menu component triggered on `onContextMenu`.

---

## Phase 6: Media Panel (Enhanced)
**Files:** `eb/src/mainview/components/MediaPanel.tsx`

| Feature | Swift Source | Implementation |
|---------|-------------|----------------|
| Vertical icon tab rail | `MediaPanelView` layout | Flex row: icon rail + content area |
| Media tab | Grid/list of imported files | Zustand store + thumbnails |
| Captions tab | Text overlay list | Custom component |
| Music tab | Audio library browser | Custom component |
| Search bar | Media search | Filtered list |
| Grid/List toggle | View mode switch | State toggle |
| Import drop zone | Drag files to import | HTML5 drag-and-drop + upload API |
| Drag to timeline | Drag media to timeline | VideoFlow drag API |
| Thumbnail cards | Media previews | Canvas-generated thumbnails |
| File type badges | Video/Audio/Image icons | Lucide React icons |

---

## Phase 7: Agent Panel (AI Chat)
**Files:** `eb/src/mainview/components/AgentPanel.tsx`, `eb/src/mainview/hooks/useAgent.ts`
**Libraries:** `ai` (Vercel AI SDK), `@assistant-ui/react`, `@assistant-ui/react-ai-sdk`

| Feature | Swift Source | Implementation |
|---------|-------------|----------------|
| Chat message list | `AgentPanelView` | `@assistant-ui/react` `<Thread>` component |
| User message bubbles | Right-aligned, blue | assistant-ui built-in styling |
| Agent message bubbles | Left-aligned, gray + avatar | assistant-ui built-in styling |
| Tool invocation cards | Expandable cards with status | assistant-ui generative UI (tool call rendering) |
| Typing indicator | 3 bouncing dots | assistant-ui built-in |
| Starter prompts grid | Quick action buttons | Custom component with `useChat` |
| Text input field | Multi-line textarea | assistant-ui `<Composer>` |
| Attachment button | File/image upload | assistant-ui attachments support |
| Voice input button | Microphone recording | Web Audio API `MediaRecorder` |
| Send button | Submit message | assistant-ui built-in |
| SSE streaming | Anthropic-compatible streaming via Qwen | **Vercel AI SDK `useChat` hook with custom `fetch`**. Rewrites request to `https://dashscope-intl.aliyuncs.com/apps/anthropic/v1/messages` with `x-api-key` header. Override model in fetch wrapper to one of: `qwen3.7-max`, `qwen3.7-plus`, `qwen3.6-plus`, `qwen3.6-flash`, `qwen-turbo`. Backend proxy fallback: Hono server at `/api/v1/agent/stream` with `Bearer <sessionToken>`. Two client modes: direct (x-api-key) or backend proxy (session token). Max tokens: 8192. Stream timeout: 300s. Max retries: 5 (direct) / 3 (proxy), exponential backoff with jitter, HTTP 429 only. |
| 59 MCP tools | Tool schemas | Full schema definitions for all 59 tools (see "Tool Catalog" in Swift sources). See `ToolDefinitions.swift` for JSON schemas. 59 tools total: 5 timeline inspection, 1 search, 8 clip operations, 3 clip properties, 3 text/captions, 2 text-based audio, 6 AI generation, 8 media organization, 3 color grading, 1 export, 1 project settings, 6 multicam, 2 audio analysis, 1 skills, 1 model discovery, 1 feedback, 3 project navigation (MCP-only). |
| Tool executor | `ToolExecutor.swift` | Dispatch layer that receives tool calls from agent loop and executes against the Zustand store. Split across 18+ extension files: clips, timeline, text, generation, color, audio, multicam, search, export, import, folders, projects, media inspection, transcription, words, beats, denoise, feedback. |
| Tool schemas | `ToolDefinitions.swift` | All 59 tool schemas with JSON input schemas (Anthropic tool format). Types: timeline inspection, timeline manipulation, text/captions, audio analysis, AI generation, color/effects, media management, multicam, projects, media inspection. |
| Context injection | Timeline context before each turn | Before each assistant turn, inject: `totalFrames`, `trackCount`, `fps`, `currentFrame`, layers summary, media list, active generation status. |
| Edit history injection | Edit history log | Last N agent edits as a text log injected into the assistant message. Deduplicate old timeline/transcript results. |
| Agent undo isolation | `agentUndoStack` | Separate undo stack for agent-made edits. `undo` reverts only the assistant's changes, not the user's manual edits. |
| Frame capture (inspect_timeline) | `inspectTimeline` | Render composited frames as data URLs for agent vision. Two options: (a) `DomRenderer.renderFrame()` → `canvas.toDataURL()` for current frame, (b) `BrowserRenderer.render()` → MP4 blob for timeline preview. |
| Tool result formatting | Structured JSON results | Each tool returns structured JSON the LLM can reason about: success status, affected layer ids, before/after diff summary, frame URLs for visual tools. |
| Mutation delta responses | `MutationDelta` | After every mutation tool, return delta describing what changed: new/changed clips, uniform shifts, removed IDs, created tracks, caption group summaries. |
| Starter prompts grid | `AgentPanelView` starter prompts | 8 quick-action buttons: Generate AI video, Generate B-roll, Create letterbox opening, Add captions, Create voiceover, Generate music, Organize media. |
| @-mention autocomplete | `AgentMentionContext` | In-agent input: `@` triggers autocomplete for media assets, timeline clips, timeline ranges. 3 types: `mediaAsset`, `timelineClip`, `timelineRange`. |
| Image attachment via @-mention | Image inlining | Mentioned image assets are base64-encoded and attached as image blocks in the API call. Agent instructed not to call `inspect_media` for inlined images. |
| Multi-tab chat sessions | `ChatSessionStore` | Persisted chat sessions as JSON in project directory. Full CRUD: new, select, close, delete. Auto-named from first user message. |
| Chat auto-save | `syncMessagesIntoCurrentSession` | Save chat after every streaming turn and on session switch/close. |
| Prompt caching | `cache_control: { type: "ephemeral" }` | 3-level caching: system prompt, tool definitions (last tool), conversation prefix (last message block). Minimises token usage across turns. |
| Context deduplication | `AgentService.apiMessages` | Old timeline/transcript results replaced with compact markers: `[Timeline: Xf · Y tracks · Z clips — read earlier.]`. Prevents context blow-up. |
| Edit history logging | `editorLog: [EditLogEntry]` | Track every mutation tool call with turn number, tool name, and mutation summary. Injected into last API message before each turn (last 12 edits). |
| ID shortening | `ToolExecutor+ShortId.swift` | All entity IDs shortened to shortest unique prefix (min 8 chars) in API responses. Expanded back to full UUIDs on tool input. Ambiguous prefixes throw clear error. |
| Agent instructions (system prompt) | `AgentInstructions.swift` | Comprehensive system prompt covering: timeline model (frames-based), always-do rules (call get_media first, check canGenerate before generation), editing rules (use apply_layout, not hand-position), generation cost warnings, prompt craft formulas, communication style. |
| Skills system | `Skill.swift` + `SkillCatalog.swift` + `SkillStore.swift` | SKILL.md files in `~/.palmier/skills/<id>/` with YAML frontmatter. Community catalog from GitHub. Install/update with SHA256 content hashing. Surfaced in system prompt; agent calls `read_skill(id)` before matching tasks. |
| Skill enable/disable | Settings-driven | Zustand store |

---

## Phase 8: Agent Media Intelligence Tools
**Files:** `eb/src/mainview/hooks/useTranscription.ts`, `eb/src/mainview/hooks/useMediaInspection.ts`, `eb/src/mainview/hooks/useVisualSearch.ts`
**Libraries:** Transformers.js (for SigLIP vision/text embeddings), WhisperKit WASM (on-device transcription), Web Speech API

### Local ML Models

| Model | Source | Purpose |
|-------|--------|---------|
| **SigLIP 2** (`google/siglip2-base-patch16-256`) | Core ML (downloaded from HuggingFace), 256×256 input, 768-dim embeddings, 8-bit palettized | On-device visual semantic search: encode images + text queries, cosine similarity via Accelerate (vDSP). Image/text encoders, Gemma SentencePiece tokenizer. |
| **WhisperKit** (`argmaxinc/WhisperKit`) | Core ML (downloaded at runtime) | On-device speech-to-text transcription for captions, agent tools, speaker identification. |

### Features

| Feature | Swift Source | Implementation |
|---------|-------------|----------------|
| **`get_transcript`** | `getTranscript` tool + `Transcription.swift` | Word-level transcript with frame indices. Dispatch to on-device (WhisperKit) or cloud (Qwen Cloud ASR). Map word timestamps to project frames accounting for trim/speed/position. Return structured JSON: `{ words: [{text, startFrame, endFrame}], language, confidence }`. Supports window paging (10K word limit), clipId scoping. |
| **`remove_words`** | `removeWords` tool | Descript-style text-based editing. Given word indices (from `get_transcript`) or exact tokens like "um", split clips at boundaries and remove ranges. Handles pause gap, A/V linked partners, single-track enforcement. Cut aggressiveness: tight/balanced/loose. |
| **`add_captions`** | `addCaptions` tool | Transcribe spoken audio (cloud or local WhisperKit) → create styled caption clips on a text track. Supports per-word animations, censor profanity, max words, text case. Style from template (font, size, position, color). |
| **`inspect_media`** | `inspectMedia` tool | View media metadata: storyboard frames (sample at N intervals, deduplicate visually similar via luma grid comparison), duration, resolution, codec, EXIF. Render storyboard grid via `DomRenderer.renderFrame()` at sample points → canvas composite → JPEG data URL. |
| **`search_media`** | `searchMedia` tool | **SigLIP 2 visual search**: on-device image/text encoder via Transformers.js (or Core ML if available). Cosine similarity via `vDSP_mmul`. Best-frame-per-shot deduplication. **Spoken word search**: match transcript text via keyword + semantic. Return ranked asset IDs with source-second time ranges. |
| **Transcript caching** | `TranscriptCache` | Cache transcription results keyed by file URL. Per-asset word-level transcripts, pending jobs. |
| **SigLIP model lifecycle** | `VisualModelLoader` | Download ImageEncoder/TextEncoder ML packages from HuggingFace, verify SHA256, compile via `MLModel.compileModel()`, manage state machine (unknown → notInstalled → downloading → preparing → ready → failed). |
| **SigLIP visual indexer** | `VisualIndexer` + `EmbeddingStore` | Sample video frames via luma-based shot detection (min 8s coverage), encode each frame through SigLIP, save to binary embedding store (magic header + JSON header + Float64 times + Float16 vectors). Stills get single embedding. |
| **SigLIP embedding store** | `EmbeddingStore` | Binary disk format: magic `PALMEMB1`, JSON header, rows (time/shotStart/shotEnd) + Float16 vectors. Keyed by file identity (path + mtime + size, SHA256-hashed). |

---

## Phase 9: Agent Audio Analysis Tools
**Files:** `eb/src/mainview/hooks/useAudioAnalysis.ts`, `eb/src/mainview/hooks/useAudioEnhancement.ts`
**Libraries:** Web Audio API (AudioContext, AnalyserNode, OfflineAudioContext), ONNX Runtime Web or RNNoise WASM

### Local ML Models

| Model | Source | Purpose |
|-------|--------|---------|
| **Beat This** (beat detector) | Core ML (bundled in app, `Resources/Models/BeatThis.mlmodelc/`) | On-device beat/downbeat detection. Input: 22,050 Hz mono audio, 1500-sample chunks. Outputs: beat + downbeat logit arrays. BPM estimated from median inter-beat interval. |
| **Silero VAD** | MLX (downloaded via `speech-swift` at runtime) | Voice activity detection: finds speech segments per 32ms cell. Results cached as JSON sidecars. Used by transcription pipelines and speaker ID. |
| **WeSpeaker** | MLX (downloaded via `speech-swift` at runtime) | Speaker identification: extracts speaker embeddings, matches across files via cosine similarity (threshold 0.45), assigns global speaker IDs. Caches fingerprints as JSON. |
| **SpeechEnhancer** | Core ML / MLX (downloaded via `speech-swift` at runtime) | Audio denoising: multi-channel speech enhancement. Caches output as `.caf` files. |

### Features

| Feature | Swift Source | Implementation |
|---------|-------------|----------------|
| **`sync_audio`** | `syncAudio` tool | Align clips via waveform cross-correlation. Extract PCM data from both clips via `OfflineAudioContext` + `AudioBuffer`, compute normalized cross-correlation, find max-correlation offset. Return offset in frames + confidence. Also supports timecode matching. |
| **`detect_beats`** | `detectBeats` tool | BPM + beat/downbeat positions from audio track. Uses **Beat This** Core ML model for inference. Peak picking after model output, median IBI for BPM. Return BPM + array of beat frame positions + downbeat markers. Supports windowing. |
| **`denoise_audio`** | `denoiseAudio` tool | ML audio denoising via **SpeechEnhancer**. Configurable strength 0–1. `enabled:false` restores original. Background-processing with caching. |
| **Voice activity** | `VoiceActivity.swift` | **Silero VAD** for speech segment detection. Run on import or on-demand for transcription/speaker ID. |
| **Speaker identification** | `SpeakerIdentity.swift` | **WeSpeaker** embeddings for speaker diarization. Match across files, assign speaker IDs. |

---

## Phase 10: AI Generation Panel (AI Content)
**Files:** `eb/src/mainview/components/GenerationPanel.tsx`, `eb/src/mainview/hooks/useGeneration.ts`
**Libraries:** `@tanstack/react-query` (polling status), `ai` (streaming)

| Feature | Swift Source | Implementation |
|---------|-------------|----------------|
| Mode segmented control | Video/Image/Audio/Music | Tab buttons |
| Video generation | Prompt + duration + resolution + model | Form with sliders/dropdowns |
| Image generation | Prompt + resolution + model | Form |
| Audio generation | Prompt + duration + model | Form |
| Music generation | Prompt + duration + style tags | Form with tag selector |
| Reference image upload | Style/content guidance | File upload + thumbnails |
| Advanced options | Negative prompt, CFG, seed | Collapsible section |
| Generate button | Start generation | API call + loading state |
| Generation history | Recent generations list | Scrollable list with thumbnails |
| Drag to timeline | Add generated content | Drag-and-drop |

---

## Phase 11: Inspector Tabs (Enhanced)
**Files:** Modify VideoFlow inspector or overlay custom panels

| Tab | Controls | Source |
|-----|----------|--------|
| **Content** | Clip name, source info, duration, position | `InspectorView` Content tab |
| **Animate** | Position X/Y, Scale, Rotation, Opacity, Anchor, Keyframes | `InspectorView` Animate tab |
| **Video** | Brightness, Contrast, Saturation, Temperature, Tint, Highlights, Shadows, Blur, Sharpen | `InspectorView` Video tab |
| **Adjust** | Speed/duration, Reverse toggle, Frame interpolation | `InspectorView` Adjust tab |
| **Audio** | Volume, Pan, Fade in/out, EQ, Audio effects | `InspectorView` Audio tab |
| **AI Edit** | Text prompt, preset actions | `InspectorView` AI Edit tab |

VideoFlow already provides most of these. The AI Edit tab needs custom implementation.

---

## Phase 12: Preview Overlays
**Files:** `eb/src/mainview/components/CropOverlay.tsx`, `eb/src/mainview/components/TransformOverlay.tsx`

| Feature | Swift Source | Implementation |
|---------|-------------|----------------|
| Crop overlay | 4 corners + 4 edges + center drag | SVG/div handles with pointer events |
| Aspect ratio lock | Toggle + presets (Free, 16:9, 9:16, 4:3, 1:1) | State + constrained resize math |
| Crop apply/cancel | Confirm/discard buttons | Button bar |
| Transform overlay | Position + rotation + 8 resize handles | SVG/div handles |
| Rotation handle | Circular handle above top-center | Absolute positioned circle |
| Bounding box | Dashed rectangle | CSS border dashed |
| Snap guides | Alignment to center/edges | Conditional lines |
| Mode toggles | Transform/Crop mode switch | State toggle in toolbar |

---

## Phase 13: Export Dialog
**Files:** `eb/src/mainview/components/ExportDialog.tsx`

| Feature | Swift Source | Implementation |
|---------|-------------|----------------|
| Sheet presentation | Modal over editor | `@radix-ui/react-dialog` |
| 3 export modes | Video / Timeline / Filmidi Project | Tab buttons |
| Format dropdown | MP4, MOV, WebM | `@radix-ui/react-select` |
| Resolution | Original, 4K, 1080p, 720p, 480p, Custom | `@radix-ui/react-select` + custom input |
| Frame rate | Original, 24, 25, 30, 60 fps | `@radix-ui/react-select` |
| Codec | H.264, H.265, ProRes | `@radix-ui/react-select` |
| Quality | Low, Medium, High, Maximum + estimated size | Radio group + size estimate |
| Audio include | Toggle + codec (AAC, PCM) | `@radix-ui/react-switch` + select |
| Range | Entire / Selection / Custom | Radio group + range inputs |
| Output path | File save location | Electrobun file save dialog |
| Progress indicator | Export progress bar | Animated progress bar |
| Project export | Bundle all assets + .filmidi | ZIP archive via `fflate` |

**New deps:** `fflate` (for project ZIP export), `ffmpeg.wasm` (for client-side video encoding)

---

## Phase 14: Settings Window
**Files:** `eb/src/mainview/components/SettingsDialog.tsx`

| Pane | Controls | Source |
|------|----------|--------|
| **Account** | Avatar, name, email, sign out, subscription | `IdentityViews`, `AccountPopoverCard` |
| **General** | Launch behavior, default export format, theme (Light/Dark/System), language, show tour | `SettingsView` General |
| **Models** | AI model config, API keys, proxy | `SettingsView` Models |
| **Agent** | Default persona, tool permissions, auto-execute, context size | `SettingsView` Agent |
| **Skills** | Enable/disable AI skills | `SettingsView` Skills |
| **Storage** | Cache size, clear cache, download location, auto-cleanup | `SettingsView` Storage |

Implementation: Sidebar + detail pane layout. Store settings in localStorage or Electrobun IPC to disk.

---

## Phase 15: Home / Project Browser
**Files:** `eb/src/mainview/components/HomeView.tsx`

| Feature | Swift Source | Implementation |
|---------|-------------|----------------|
| Sidebar nav | Projects, Recents, Templates | Nav list |
| Project grid | Card layout with thumbnails | CSS Grid of cards |
| New project card | "+" button | Card with plus icon |
| Right-click menu | Open, Rename, Duplicate, Delete, Show in Finder | Context menu |
| Double-click open | Open project | Event handler |
| Sort options | By name, date, size | Dropdown |
| Template system | Pre-built project templates | Template cards |

---

## Phase 16: Help Window
**Files:** `eb/src/mainview/components/HelpDialog.tsx`

| Feature | Swift Source | Implementation |
|---------|-------------|----------------|
| Shortcuts reference | Full keyboard shortcuts table | HTML table |
| MCP status | MCP server configuration | Status display |
| Feedback form | Screenshot + text + submit | Form + `getDisplayMedia()` for screenshot |

---

## Phase 17: Tour Overlay
**Files:** `eb/src/mainview/components/TourOverlay.tsx`

| Feature | Swift Source | Implementation |
|---------|-------------|----------------|
| Dark backdrop | Semi-transparent overlay | Fixed div with backdrop |
| Spotlight cutout | Transparent hole in overlay | CSS `clip-path` or SVG mask |
| Step cards | Title + description + illustration | Card component |
| Navigation | Next / Skip / Back buttons | Button row |
| Progress dots | Step indicator | Dot indicators |
| Persistence | "Don't show again" | localStorage flag |

---

## Phase 18: Account & Auth
**Files:** `eb/src/mainview/hooks/useAuth.ts`, `eb/src/mainview/components/AccountPopover.tsx`

| Feature | Swift Source | Implementation |
|---------|-------------|----------------|
| Google Sign-In | OAuth2 flow | Redirect-based OAuth in WKWebView |
| Account popover | Avatar, name, email, credits, manage, sign out | Popover component |
| Credit summary | Full + compact display | Badge component |
| Token storage | Keychain | Electrobun IPC → Bun file storage |
| Subscription management | DodoPayments | Redirect to payment page |

---

## Phase 19: Project Save/Load
**Files:** `eb/src/bun/ipc-handlers.ts`, `eb/src/mainview/hooks/useProject.ts`

| Feature | Swift Source | Implementation |
|---------|-------------|----------------|
| Project file format | `.filmidi` JSON | JSON serialization via Zustand |
| Save to disk | `NSDocument` save | Electrobun IPC → `Bun.write()` |
| Open from disk | `NSDocument` open | Electrobun IPC → `Bun.file()` |
| Auto-save | Periodic save | `setInterval` + dirty flag |
| Media manifest | Track imported files | JSON manifest with relative paths |
| Media resolver | Find media files | Bun file system operations |
| Recent projects | MRU list | JSON file in app data dir |
| Export project | ZIP bundle | `fflate` for ZIP creation |

---

## Phase 20: Additional Features

| Feature | Swift Source | Implementation |
|---------|-------------|----------------|
| Multi-timeline tabs | `TimelineTabBar` | VideoFlow tab support or custom |
| Timeline ruler | `TimelineRuler` | VideoFlow provides this |
| Track headers (mute/hide/sync) | `TimelineHeaderView` | VideoFlow provides this |
| Layout presets | `LayoutPreset` enum | CSS class toggles |
| Project activity log | `ProjectActivityView` | Scrollable log component |
| Onboarding tour | `TourOverlay` | Phase 17 |
| Feedback with screenshot | `FeedbackView` | `getDisplayMedia()` API |
| **MCP HTTP server** | `MCPHTTPServer` + `MCPService` | Bun HTTP server (port 19789, IPv4 loopback) exposing all 59 tools via SSE. Share `ToolExecutor` (from Phase 7) between in-app agent and MCP server. Stateless fallback for sessionless clients. Advertises `filmidi://` resource URIs for model listings. Supports 32 concurrent sessions with 3600s idle timeout. |
| **Export XML/FCPXML** | `ProjectExporter` | Project → XML for Final Cut Pro / DaVinci Resolve. Build from VideoJSON layer data. |
| **Multicam** | `MulticamManager` | Track sources in timeline model, switch active source per clip, assign/reassign clips. |
| Window state persistence | `EditorWindowController` | Electrobun window APIs |

---

## Phase 21: Menu Bar
**Files:** `eb/src/bun/menu.ts` (if Electrobun supports native menus)

| Menu | Items | Shortcuts |
|------|-------|-----------|
| File | New, Open, Open Recent, Close, Save, Save As, Export | Cmd+N/O/Shift+O/W/S/Shift+S/Shift+E |
| Edit | Undo, Redo, Cut, Copy, Paste, Paste and Match, Delete, Select All | Cmd+Z/Shift+Z/X/C/V/Shift+V/Del/A |
| View | Toggle Inspector, Toggle Media, Fullscreen | Cmd+Shift+I/M/Ctrl+F |
| Window | Minimize, Zoom, Bring All to Front | Cmd+M/^ |
| Help | Filmidi Help | Cmd+? |

Implementation: Electrobun may not support native menus — implement as custom React menu bar if needed.

---

## Phase 22: Styling & Theming
**Files:** `eb/tailwind.config.js`, `eb/src/mainview/index.css`

| Feature | Swift Source | Implementation |
|---------|-------------|----------------|
| Dark theme (default) | App appearance | Tailwind dark classes + CSS vars |
| Light theme | Settings toggle | Tailwind `dark:` prefix |
| System theme | OS preference | `prefers-color-scheme` media query |
| Brand colors | Violet primary, Pink accent | CSS custom properties |
| Font system | Bundled fonts | `@fontsource` packages or Google Fonts |
| Icon system | SF Symbols | Lucide React |

---

## Library Stack

### UI Primitives (Radix UI)
| Package | Purpose |
|---------|---------|
| `@radix-ui/react-dialog` | Modal dialogs (Export, Settings, Help) |
| `@radix-ui/react-select` | Dropdowns (format, resolution, codec) |
| `@radix-ui/react-slider` | Sliders (volume, brightness, etc.) |
| `@radix-ui/react-switch` | Toggle switches (include audio, etc.) |
| `@radix-ui/react-tabs` | Tab panels (inspector tabs, settings panes) |
| `@radix-ui/react-popover` | Popovers (account card, tooltips) |
| `@radix-ui/react-context-menu` | Right-click context menus |
| `@radix-ui/react-dropdown-menu` | Dropdown menus (toolbar menus) |
| `@radix-ui/react-radio-group` | Radio button groups (quality, export range) |
| `@radix-ui/react-collapsible` | Collapsible sections (inspector groups) |
| `@radix-ui/react-tooltip` | Tooltips (toolbar buttons) |

### Layout & Panels
| Package | Purpose |
|---------|---------|
| `react-resizable-panels` | Splittable panel layout (editor zones) |

### Icons
| Package | Purpose |
|---------|---------|
| `lucide-react` | All icons (toolbar, media panel, tabs, menus) |

### State Management
| Package | Purpose |
|---------|---------|
| `zustand` | Global state (selection, tool mode, panels, settings) |

### Animations
| Package | Purpose |
|---------|---------|
| `framer-motion` | Panel transitions, modals, tooltips, typing indicator |

### Export & Encoding
| Package | Purpose |
|---------|---------|
| `fflate` | ZIP creation for .filmidi project export |
| `@ffmpeg/ffmpeg` | Client-side video encoding (WASM) |

### AI / Agent / LLM
| Package | Purpose |
|---------|---------|
| `ai` | Vercel AI SDK — React hooks for streaming, tool calls, multi-step agent loops |
| `@assistant-ui/react` | Production chat UI primitives (Thread, Message, Composer, ActionBar) |
| `@assistant-ui/react-ai-sdk` | Bridge between assistant-ui and Vercel AI SDK |
| `@tanstack/react-query` | Async state — polling generation status, caching API responses |

**LLM provider**: Qwen models via Anthropic-compatible Messages API. **No `@ai-sdk/anthropic`** — we do NOT call Anthropic. Instead, `useChat` uses a **custom `fetch` wrapper** that rewrites the request to `https://dashscope-intl.aliyuncs.com/apps/anthropic/v1/messages` with:
- Header: `x-api-key: <qwen-api-key>` (or backend proxy with `Authorization: Bearer <sessionToken>`)
- Header: `anthropic-version: 2023-06-01`
- Model override: `qwen3.7-max`, `qwen3.7-plus`, `qwen3.6-plus`, `qwen3.6-flash`, or `qwen-turbo`

The AI SDK's standard Anthropic provider (`@ai-sdk/anthropic`) would hardcode the Anthropic base URL and model names — we use a custom fetch to bypass that.

### Utilities
| Package | Purpose |
|---------|---------|
| `date-fns` | Date formatting (project timestamps, generation history) |
| `clsx` | Conditional className joining |
| `tailwind-merge` | Tailwind class deduplication |

### Already in project (keep)
| Package | Purpose |
|---------|---------|
| `react` / `react-dom` | UI framework |
| `tailwindcss` | Utility-first CSS |
| `@videoflow/*` | Video editing core |
| `electrobun` | Desktop framework |
| `vite` | Build tool |
| `typescript` | Type safety |
| `zustand` | State management |

---

## Execution Order

1. **Phase 1-2** (Foundation): App shell, layout, title bar ✅
2. **Phase 3-4** (Core interaction): Toolbar + keyboard shortcuts ✅
3. **Phase 5** (Context menus): Right-click menus ✅
4. **Phase 6** (Media panel): Enhanced media browser ✅
5. **Phase 11** (Inspector): Enhanced inspector with AI Edit tab ✅
6. **Phase 8-9** (Agent Tools): Media intelligence + audio analysis tools ✅
7. **Phase 13** (Export): Export dialog
7. **Phase 14** (Settings): Preferences window
8. **Phase 15** (Home): Project browser
9. **Phase 7** (Agent Panel): Chat UI, tool schemas, tool executor, agent infrastructure
10. **Phase 8-9** (Agent Tools): Media intelligence + audio analysis tools
11. **Phase 10** (Generation Panel): AI generation UI
12. **Phase 16-20** (Polish): Help, Tour, Account, Save/Load, Additional
13. **Phase 21-22** (Theming): Menu bar + theming
