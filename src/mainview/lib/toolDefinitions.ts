import type { ToolDefinition } from "./qwenClient";

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  // ─── TIMELINE INSPECTION (5) ─────────────────────────────────────
  {
    name: "get_timeline",
    description:
      "Read the full project state: settings (fps, resolution, duration, totalFrames, canGenerate), track list, all layers/clips with timing, properties, keyframes, effects, transitions. Call this first to understand the current edit before making changes. Page with startFrame/endFrame for long timelines.",
    input_schema: {
      type: "object",
      properties: {
        startFrame: { type: "integer", description: "Optional — start of window (frames)." },
        endFrame: { type: "integer", description: "Optional — end of window (frames)." },
      },
      required: [],
    },
  },
  {
    name: "get_media",
    description:
      "List every media asset in the project library: id, name, type (video/audio/image), url, duration, thumbnail, folderId. Use before add_clips to know what's available. Filter by type if needed.",
    input_schema: {
      type: "object",
      properties: {
        filterTypes: {
          type: "array",
          items: { type: "string", enum: ["video", "audio", "image"] },
          description: "Optional — filter by media type(s). Omit to list all.",
        },
      },
      required: [],
    },
  },
  {
    name: "inspect_timeline",
    description:
      "Render composited preview frames as data URLs for agent vision. Returns canvas-rendered frame images the agent can visually inspect. Use to verify layout, crop, text placement, or color.",
    input_schema: {
      type: "object",
      properties: {
        startFrame: { type: "integer", description: "Optional — first frame to render." },
        endFrame: { type: "integer", description: "Optional — last frame to render." },
        maxFrames: { type: "integer", description: "Optional — max frames to return (default 4)." },
      },
      required: [],
    },
  },
  {
    name: "inspect_media",
    description:
      "Inspect a SINGLE media asset by its id (from get_media). Returns storyboard frames, duration, resolution, codec, audio channels, and optionally word-level transcript. You MUST provide mediaRef — call get_media first to get asset ids.",
    input_schema: {
      type: "object",
      properties: {
        mediaRef: { type: "string", description: "REQUIRED. The asset id string — must be copied exactly from get_media output. Do not call inspect_media without this parameter." },
        clipId: { type: "string", description: "Optional — scope to specific clip's portion." },
        maxFrames: { type: "integer", description: "Optional — max storyboard frames (default 8)." },
        startSeconds: { type: "number", description: "Optional — start of inspection window." },
        endSeconds: { type: "number", description: "Optional — end of inspection window." },
        wordTimestamps: { type: "boolean", description: "Optional — include word-level transcript." },
        overview: { type: "boolean", description: "Optional — compact storyboard overview." },
        language: { type: "string", description: "Optional — BCP-47 language tag for transcription." },
      },
      required: ["mediaRef"],
    },
  },
  {
    name: "inspect_color",
    description:
      "Inspect color information at a specific point in the preview: dominant colors, color temperature, histogram data. Use to guide color grading decisions.",
    input_schema: {
      type: "object",
      properties: {
        frame: { type: "integer", description: "Optional — frame to inspect (default: current)." },
        region: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            width: { type: "number" },
            height: { type: "number" },
          },
          description: "Optional — rectangular region to analyze.",
        },
      },
      required: [],
    },
  },

  // ─── CLIP OPERATIONS (8) ─────────────────────────────────────────
  {
    name: "add_clips",
    description:
      "Place one or more media assets onto the timeline at specific tracks and times. Creates linked audio for video clips. Overwrites any clips in the landing region. Batch undoable. Omit trackIndex to auto-assign lowest available track.",
    input_schema: {
      type: "object",
      properties: {
        entries: {
          type: "array",
          items: {
            type: "object",
            properties: {
              mediaRef: { type: "string", description: "Asset id from get_media." },
              startFrame: { type: "integer", description: "Timeline frame to place the clip." },
              trackIndex: { type: "integer", description: "Optional — track index. Omit to auto-assign." },
              durationFrames: { type: "integer", description: "Optional — duration in frames. Defaults to source." },
              trimStartFrame: { type: "integer", description: "Optional — source trim start (frames)." },
              trimEndFrame: { type: "integer", description: "Optional — source trim end (frames)." },
            },
            required: ["mediaRef", "startFrame"],
          },
        },
      },
      required: ["entries"],
    },
  },
  {
    name: "insert_clips",
    description:
      "Insert clips at a frame, pushing subsequent clips to the right (ripple insert). Like add_clips but shifts everything after the insertion point.",
    input_schema: {
      type: "object",
      properties: {
        entries: {
          type: "array",
          items: {
            type: "object",
            properties: {
              mediaRef: { type: "string", description: "Asset id from get_media." },
              startFrame: { type: "integer", description: "Timeline frame to insert at." },
              trackIndex: { type: "integer", description: "Optional — track index." },
              durationFrames: { type: "integer", description: "Optional — duration in frames." },
            },
            required: ["mediaRef", "startFrame"],
          },
        },
      },
      required: ["entries"],
    },
  },
  {
    name: "remove_clips",
    description:
      "Remove one or more layers/clips from the timeline by their id. Handles linked groups. Prunes empty tracks.",
    input_schema: {
      type: "object",
      properties: {
        layerIds: {
          type: "array",
          items: { type: "string" },
          description: "Array of layer ids to remove (from get_timeline).",
        },
      },
      required: ["layerIds"],
    },
  },
  {
    name: "remove_tracks",
    description:
      "Remove entire tracks by index. All clips on the track are removed. Track indices shift after removal.",
    input_schema: {
      type: "object",
      properties: {
        trackIndices: {
          type: "array",
          items: { type: "integer" },
          description: "Track indices to remove (from get_timeline).",
        },
      },
      required: ["trackIndices"],
    },
  },
  {
    name: "move_clips",
    description:
      "Reposition clips on the timeline — change their startFrame and/or track. Can move multiple clips at once. Linked partners follow the frame delta.",
    input_schema: {
      type: "object",
      properties: {
        clips: {
          type: "array",
          items: {
            type: "object",
            properties: {
              layerId: { type: "string" },
              startTime: { type: "number", description: "New timeline time in seconds." },
              track: { type: "integer", description: "Optional — new track index." },
            },
            required: ["layerId", "startTime"],
          },
        },
      },
      required: ["clips"],
    },
  },
  {
    name: "split_clips",
    description:
      "Split one or more layers at specific cut points. Each cut point must be strictly inside its clip. Multiple cuts on the same clip are fine. Linked partners (video+audio pairs) are split at the same frame. Splits only insert boundaries; nothing shifts. Use ripple_delete_ranges when you need to remove a span.",
    input_schema: {
      type: "object",
      properties: {
        cuts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              layerId: { type: "string", description: "Layer id to split." },
              atFrame: { type: "integer", description: "Frame to cut at (must be inside the clip)." },
            },
            required: ["layerId", "atFrame"],
          },
          description: "Array of cut points. Omit to split all selected at playhead.",
        },
      },
      required: [],
    },
  },
  {
    name: "set_clip_properties",
    description:
      "Modify properties of one or more clips: durationFrames, trim, speed, volume, opacity, blendMode, transform. NOT for preview layout — use apply_layout for multi-clip compositions. Transform only for rare single-clip tweaks.",
    input_schema: {
      type: "object",
      properties: {
        clips: {
          type: "array",
          items: {
            type: "object",
            properties: {
              layerId: { type: "string" },
              sourceDuration: { type: "number", description: "Optional — new duration in seconds." },
              settings: {
                type: "object",
                properties: {
                  startTime: { type: "number" },
                  sourceStart: { type: "number" },
                  volume: { type: "number" },
                  speed: { type: "number" },
                },
                description: "Optional timing/settings patch.",
              },
              properties: {
                type: "object",
                description: "Optional — visual properties: { opacity?, scale?, rotation?, position?, blendMode? }.",
                properties: {
                  opacity: { type: "number" },
                  scale: { type: "number" },
                  rotation: { type: "number" },
                  position: { type: "array", items: { type: "number" } },
                  blendMode: { type: "string" },
                },
              },
            },
          },
        },
      },
      required: ["clips"],
    },
  },
  {
    name: "tag_media",
    description:
      "Add or remove tags on media library assets. Tags are searchable labels for organizing assets.",
    input_schema: {
      type: "object",
      properties: {
        mediaRef: { type: "string", description: "Asset ID from get_media." },
        tags: { type: "array", items: { type: "string" }, description: "Tags to add or remove." },
        action: { type: "string", enum: ["add", "remove", "set"], description: "add=append, remove=delete, set=replace all." },
      },
      required: ["mediaRef", "tags", "action"],
    },
  },
  {
    name: "tag_clip",
    description:
      "Add or remove tags on timeline clips (layers). Tags are stored in layer settings and searchable.",
    input_schema: {
      type: "object",
      properties: {
        clipId: { type: "string", description: "Clip/layer ID from get_timeline." },
        tags: { type: "array", items: { type: "string" }, description: "Tags to add or remove." },
        action: { type: "string", enum: ["add", "remove", "set"], description: "add=append, remove=delete, set=replace all." },
      },
      required: ["clipId", "tags", "action"],
    },
  },
  {
    name: "search_by_tag",
    description:
      "Find media assets and timeline clips that have specific tags. Returns matching asset IDs and clip IDs.",
    input_schema: {
      type: "object",
      properties: {
        tags: { type: "array", items: { type: "string" }, description: "Tags to search for." },
        match: { type: "string", enum: ["any", "all"], description: "any=at least one tag matches, all=every tag matches. Default: any." },
        scope: { type: "string", enum: ["media", "timeline", "both"], description: "Where to search. Default: both." },
      },
      required: ["tags"],
    },
  },
  {
    name: "ripple_delete_ranges",
    description:
      "Delete time ranges from the timeline, rippling everything after to the left. Use for removing spans that aren't word-aligned. For word-aligned cuts, prefer remove_words.",
    input_schema: {
      type: "object",
      properties: {
        ranges: {
          type: "array",
          items: {
            type: "object",
            properties: {
              startFrame: { type: "integer", description: "Start of range to delete." },
              endFrame: { type: "integer", description: "End of range to delete." },
              trackIndex: { type: "integer", description: "Optional — specific track. Omit for all." },
            },
            required: ["startFrame", "endFrame"],
          },
        },
      },
      required: ["ranges"],
    },
  },

  // ─── KEYFRAMES (1) ───────────────────────────────────────────────
  {
    name: "set_keyframes",
    description:
      "Replace the keyframe track for one (clipId, property) pair. Empty array clears keyframes. Frames are clip-relative. Not for static layout — use apply_layout.",
    input_schema: {
      type: "object",
      properties: {
        clipId: { type: "string", description: "Layer id to keyframe." },
        property: { type: "string", description: "Property name to animate (e.g. 'opacity', 'position')." },
        keyframes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              time: { type: "number", description: "Source time in seconds." },
              value: { description: "Value at this keyframe." },
              easing: { type: "string", enum: ["step", "linear", "easeIn", "easeOut", "easeInOut"], description: "Optional easing." },
            },
            required: ["time", "value"],
          },
        },
      },
      required: ["clipId", "property", "keyframes"],
    },
  },

  // ─── TEXT / CAPTIONS (3) ─────────────────────────────────────────
  {
    name: "add_texts",
    description:
      "Add one or more text layers to the timeline. Each creates a text clip with content, styling, and timing. Use for titles, subtitles, lower thirds, watermarks.",
    input_schema: {
      type: "object",
      properties: {
        texts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              content: { type: "string", description: "Text content (supports \\n for multiline)." },
              startFrame: { type: "integer", description: "Timeline frame to place text." },
              durationFrames: { type: "integer", description: "Duration in frames." },
              trackIndex: { type: "integer", description: "Optional — track index." },
              fontName: { type: "string", description: "Optional — font family." },
              fontSize: { type: "number", description: "Optional — font size in em." },
              color: { type: "string", description: "Optional — text color (CSS)." },
              isBold: { type: "boolean", description: "Optional — bold weight." },
              isItalic: { type: "boolean", description: "Optional — italic style." },
              alignment: { type: "string", enum: ["left", "center", "right"], description: "Optional — text alignment." },
              centerX: { type: "number", description: "Optional — horizontal position 0-1." },
              centerY: { type: "number", description: "Optional — vertical position 0-1." },
            },
            required: ["content", "startFrame", "durationFrames"],
          },
        },
      },
      required: ["texts"],
    },
  },
  {
    name: "update_text",
    description:
      "Modify text content or styling of an existing text/caption layer. Pass captionGroupId to restyle an entire caption track at once.",
    input_schema: {
      type: "object",
      properties: {
        clipId: { type: "string", description: "Layer id to update (or use captionGroupId)." },
        captionGroupId: { type: "string", description: "Optional — update entire caption group." },
        content: { type: "string", description: "Optional — new text content." },
        fontName: { type: "string", description: "Optional — font family." },
        fontSize: { type: "number", description: "Optional — font size in em." },
        color: { type: "string", description: "Optional — text color (CSS)." },
        isBold: { type: "boolean", description: "Optional — bold weight." },
        isItalic: { type: "boolean", description: "Optional — italic style." },
        alignment: { type: "string", enum: ["left", "center", "right"], description: "Optional — text alignment." },
        borderColor: { type: "string", description: "Optional — outline color." },
        backgroundColor: { type: "string", description: "Optional — background color." },
      },
      required: [],
    },
  },
  {
    name: "add_captions",
    description:
      "Transcribe spoken audio (on-device or cloud) and create styled caption clips on a text track. Supports per-word animations, censor profanity, max words, text case. If adding for entire timeline, omit clipIds.",
    input_schema: {
      type: "object",
      properties: {
        clipIds: {
          type: "array",
          items: { type: "string" },
          description: "Optional — clip ids to transcribe. Omit for entire timeline.",
        },
        mode: { type: "string", enum: ["local", "cloud"], description: "Optional — processing mode: 'local' (free, energy-based VAD) or 'cloud' (requires API key, fun-asr with diarization). Defaults to user settings." },
        language: { type: "string", description: "Optional — BCP-47 language tag." },
        centerX: { type: "number", description: "Optional — horizontal position 0-1." },
        centerY: { type: "number", description: "Optional — vertical position 0-1." },
        textCase: { type: "string", enum: ["auto", "upper", "lower"], description: "Optional — text case transform." },
        censorProfanity: { type: "boolean", description: "Optional — censor profanity." },
        maxWords: { type: "integer", description: "Optional — max words per caption line." },
        animation: { type: "string", description: "Optional — animation preset name." },
        highlightColor: { type: "string", description: "Optional — word highlight color (hex)." },
        fontName: { type: "string", description: "Optional — font family." },
        fontSize: { type: "number", description: "Optional — font size." },
        isBold: { type: "boolean", description: "Optional — bold." },
        isItalic: { type: "boolean", description: "Optional — italic." },
        color: { type: "string", description: "Optional — text color." },
      },
      required: [],
    },
  },

  // ─── TEXT-BASED AUDIO (1) ────────────────────────────────────────
  {
    name: "remove_words",
    description:
      "Descript-style text-based editing. Given word indices from get_transcript or exact tokens like 'um', split clips at boundaries and remove ranges. Handles pause gap, linked A/V partners. Cut aggressiveness: tight/balanced/loose. After a cut, indices shift — re-read get_transcript before the next call.",
    input_schema: {
      type: "object",
      properties: {
        words: {
          type: "array",
          description: "Word indices to remove (single ints or [start,end] spans).",
        },
        matches: {
          type: "array",
          items: { type: "string" },
          description: "Exact tokens to find and remove (e.g. ['um', 'uh']).",
        },
        cutAggressiveness: {
          type: "string",
          enum: ["tight", "balanced", "loose"],
          description: "Optional — how much surrounding pause to eat (default: balanced).",
        },
        language: { type: "string", description: "Optional — BCP-47 tag for local transcription." },
      },
      required: [],
    },
  },

  // ─── LAYOUT (1) ──────────────────────────────────────────────────
  {
    name: "extract_audio",
    description:
      "Extract audio track from video clip(s) on the timeline. Creates a WAV audio layer linked to the video. Use this when the audio layer is missing or when you need to re-extract audio for transcription.",
    input_schema: {
      type: "object",
      properties: {
        clipIds: {
          type: "array",
          items: { type: "string" },
          description: "Video clip IDs to extract audio from. Omit for all video clips.",
        },
      },
      required: [],
    },
  },

  // ─── LAYOUT (1) ──────────────────────────────────────────────────
  {
    name: "apply_layout",
    description:
      "Compose multiple clips in the preview (split screen, PIP, grid, sidebar, three-up). Pick a layout, fill every slot with mediaRef (place new) or clipIds (re-layout existing). Fills each region edge-to-edge without stretching. Re-call with anchorX/anchorY to nudge crop framing. Never hand-position with set_clip_properties for multi-clip layouts.",
    input_schema: {
      type: "object",
      properties: {
        layout: { type: "string", description: "Layout preset name (e.g. 'sideBySide', 'pip', 'grid2x2')." },
        slots: {
          type: "array",
          items: {
            type: "object",
            properties: {
              mediaRef: { type: "string", description: "Asset id to place in this slot." },
              clipIds: { type: "array", items: { type: "string" }, description: "Existing clip ids to re-layout." },
              anchor: { type: "string", enum: ["top", "bottom", "left", "right", "center"], description: "Optional — crop anchor." },
              anchorX: { type: "number", description: "Optional — horizontal crop bias 0-1." },
              anchorY: { type: "number", description: "Optional — vertical crop bias 0-1." },
            },
          },
        },
        trackIndex: { type: "integer", description: "Optional — track for new clips." },
      },
      required: ["layout", "slots"],
    },
  },

  // ─── COLOR / EFFECTS (2) ─────────────────────────────────────────
  {
    name: "apply_color",
    description:
      "Apply color grading to clips: brightness, contrast, saturation, temperature, tint, highlights, shadows, shadows. Uses VideoFlow's color properties.",
    input_schema: {
      type: "object",
      properties: {
        clipIds: {
          type: "array",
          items: { type: "string" },
          description: "Clip ids to color grade.",
        },
        brightness: { type: "number", description: "Optional — brightness -1 to 1." },
        contrast: { type: "number", description: "Optional — contrast 0 to 2." },
        saturation: { type: "number", description: "Optional — saturation 0 to 2." },
        temperature: { type: "number", description: "Optional — color temperature -1 to 1." },
        tint: { type: "number", description: "Optional — tint -1 to 1." },
        highlights: { type: "number", description: "Optional — highlights adjustment." },
        shadows: { type: "number", description: "Optional — shadows adjustment." },
      },
      required: ["clipIds"],
    },
  },
  {
    name: "apply_effect",
    description:
      "Add a visual effect to one or more clips. Effects include: gaussianBlur, motionBlur, glow, bloom, vignette, duotone, chromaticAberration, rgbSplit, pixelate, filmGrain, and many more. See VideoFlow effect catalog.",
    input_schema: {
      type: "object",
      properties: {
        clipIds: {
          type: "array",
          items: { type: "string" },
          description: "Clip ids to apply effect to.",
        },
        effect: { type: "string", description: "Effect name (e.g. 'gaussianBlur', 'vignette')." },
        params: {
          type: "object",
          description: "Optional — effect-specific parameters.",
        },
      },
      required: ["clipIds", "effect"],
    },
  },

  // ─── AUDIO ANALYSIS (3) ──────────────────────────────────────────
  {
    name: "detect_beats",
    description:
      "Find rhythmic beats in any audio or video asset with audio. Returns timestamps in source seconds and estimated BPM. Call inspect_media first to hear the audio, then detect_beats to find cut points aligned with rhythm. Window with startSeconds/endSeconds for a section.",
    input_schema: {
      type: "object",
      properties: {
        mediaRef: { type: "string", description: "Asset id with audio (video or audio)." },
        startSeconds: { type: "number", description: "Optional — start of analysis window." },
        endSeconds: { type: "number", description: "Optional — end of analysis window." },
      },
      required: ["mediaRef"],
    },
  },
  {
    name: "sync_audio",
    description:
      "Align one or more clips to a reference clip by waveform cross-correlation. ReferenceClipId stays, targets move. Use for dual-system sound or multicam. Returns per-clip confidence; refuses weak matches. mode='timecode' matches embedded timecode metadata.",
    input_schema: {
      type: "object",
      properties: {
        referenceClipId: { type: "string", description: "Clip to sync to (usually camera audio)." },
        targetClipId: { type: "string", description: "Single target clip to sync." },
        targetClipIds: { type: "array", items: { type: "string" }, description: "Multiple target clips." },
        mode: { type: "string", enum: ["auto", "audio", "timecode"], description: "Optional — sync method." },
        searchWindowSeconds: { type: "number", description: "Optional — max offset to search." },
        minConfidence: { type: "number", description: "Optional — minimum match confidence 0-1." },
      },
      required: ["referenceClipId"],
    },
  },
  {
    name: "denoise_audio",
    description:
      "Apply ML audio denoising to clean up background noise on audio clips. Pass enabled:false to restore original. Strength 0-1 controls aggressiveness (1 = maximum).",
    input_schema: {
      type: "object",
      properties: {
        clipIds: {
          type: "array",
          items: { type: "string" },
          description: "Audio clip ids to denoise.",
        },
        enabled: { type: "boolean", description: "Optional — enable/disable denoising (default true)." },
        strength: { type: "number", description: "Optional — denoise strength 0-1 (default 0.5)." },
        mode: { type: "string", enum: ["local", "cloud"], description: "Optional — processing mode. 'local' uses RNNoise WASM (low-latency, offline). 'cloud' same (no cloud alternative yet). Defaults to user settings." },
      },
      required: ["clipIds"],
    },
  },

  // ─── MEDIA INTELLIGENCE (2) ──────────────────────────────────────
  {
    name: "get_transcript",
    description:
      "Get word-level transcript with frame indices for video/audio clips. Supports window paging (10K word limit). Map word timestamps to project frames accounting for trim/speed/position. Call before remove_words for text-based editing.",
    input_schema: {
      type: "object",
      properties: {
        startFrame: { type: "integer", description: "Optional — start of transcript window." },
        endFrame: { type: "integer", description: "Optional — end of transcript window." },
        clipId: { type: "string", description: "Optional — scope to specific clip." },
        language: { type: "string", description: "Optional — BCP-47 tag for local transcription." },
        mode: { type: "string", enum: ["local", "cloud"], description: "Optional — processing mode. 'local' uses Web Speech API (free, no key needed). 'cloud' uses Qwen ASR (higher quality, requires API key). Defaults to user settings." },
      },
      required: [],
    },
  },
  {
    name: "search_media",
    description:
      "Search across the media library by visual content or spoken words. Describe what's on screen or quote words said. Returns ranked asset IDs with source-second time ranges. Hits are ready to convert into add_clips trims.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query — visual description or spoken text." },
        scope: { type: "string", enum: ["visual", "spoken", "both"], description: "Optional — search scope." },
        mediaRef: { type: "string", description: "Optional — search within a specific asset." },
        limit: { type: "integer", description: "Optional — max results (default 10)." },
      },
      required: ["query"],
    },
  },

  // ─── MEDIA ORGANIZATION (7) ──────────────────────────────────────
  {
    name: "list_folders",
    description: "List all folders in the media library. Returns folder id, name, parent, and asset count.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "create_folder",
    description: "Create a new folder in the media library.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Folder name." },
        parentFolderId: { type: "string", description: "Optional — parent folder id." },
      },
      required: ["name"],
    },
  },
  {
    name: "move_to_folder",
    description: "Move media assets to a folder.",
    input_schema: {
      type: "object",
      properties: {
        assetIds: { type: "array", items: { type: "string" }, description: "Asset ids to move." },
        folderId: { type: "string", description: "Target folder id (omit for root)." },
      },
      required: ["assetIds"],
    },
  },
  {
    name: "rename_media",
    description: "Rename a media asset.",
    input_schema: {
      type: "object",
      properties: {
        mediaRef: { type: "string", description: "Asset id to rename." },
        name: { type: "string", description: "New name." },
      },
      required: ["mediaRef", "name"],
    },
  },
  {
    name: "rename_folder",
    description: "Rename a folder.",
    input_schema: {
      type: "object",
      properties: {
        folderId: { type: "string", description: "Folder id to rename." },
        name: { type: "string", description: "New name." },
      },
      required: ["folderId", "name"],
    },
  },
  {
    name: "delete_media",
    description: "Delete media assets from the library. Removes from timeline as well.",
    input_schema: {
      type: "object",
      properties: {
        assetIds: { type: "array", items: { type: "string" }, description: "Asset ids to delete." },
      },
      required: ["assetIds"],
    },
  },
  {
    name: "delete_folder",
    description: "Delete a folder and its contents from the media library.",
    input_schema: {
      type: "object",
      properties: {
        folderId: { type: "string", description: "Folder id to delete." },
      },
      required: ["folderId"],
    },
  },
  {
    name: "organize_media",
    description:
      "Automatically organize media assets into structured folders by type (Video, Audio, Images) and optionally by AI-generated status. Call this when the user asks to organize their media library.",
    input_schema: {
      type: "object",
      properties: {
        byType: { type: "boolean", description: "Group by media type (Video/Audio/Image). Default: true." },
        byGenerated: { type: "boolean", description: "Separate AI-generated assets into 'AI Generated' folder. Default: false." },
      },
      required: [],
    },
  },

  // ─── MEDIA IMPORT (1) ────────────────────────────────────────────
  {
    name: "import_media",
    description:
      "Import media from a URL, local file path, or bytes. Bridge for assets from stock services, web search, or local files. Returns a placeholder asset id that resolves in the background.",
    input_schema: {
      type: "object",
      properties: {
        source: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL to download from." },
            path: { type: "string", description: "Local file path." },
            bytes: { type: "string", description: "Base64-encoded bytes." },
          },
          description: "Import source (one of url, path, or bytes).",
        },
        name: { type: "string", description: "Optional — display name for the asset." },
        folderId: { type: "string", description: "Optional — folder to place in." },
      },
      required: ["source"],
    },
  },

  // ─── SHAPE (1) ───────────────────────────────────────────────────
  {
    name: "create_matte",
    description:
      "Add a solid-color PNG to the library. Use for backgrounds, mattes, color bars. Pass hex color and optional aspect ratio (defaults to project dimensions).",
    input_schema: {
      type: "object",
      properties: {
        hex: { type: "string", description: "Color in hex format (e.g. '#000000')." },
        aspectRatio: { type: "string", description: "Optional — aspect ratio (e.g. '16:9'). Defaults to project." },
        folderId: { type: "string", description: "Optional — folder to place in." },
      },
      required: ["hex"],
    },
  },

      // ─── AI GENERATION (6) ───────────────────────────────────────────
  {
    name: "generate_video",
    description:
      "Generate a video clip via AI. Costs real money and is not undoable. Propose prompt, model, duration, aspect ratio, then wait for confirmation. All generation tools return a placeholder asset id and run in background. Check get_media for status.",
    input_schema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Video prompt (8-20 words). Camera movement + subject action." },
        duration: { type: "number", description: "Duration in seconds." },
        aspectRatio: { type: "string", enum: ["16:9", "9:16", "1:1", "4:3"], description: "Aspect ratio." },
        model: { type: "string", description: "Model id from list_models." },
        resolution: { type: "string", enum: ["480p", "720p", "1080p"], description: "Optional — resolution." },
        startFrameMediaRef: { type: "string", description: "Optional — reference image for first frame." },
        endFrameMediaRef: { type: "string", description: "Optional — reference image for last frame." },
        referenceMediaRefs: { type: "array", items: { type: "string" }, description: "Optional — style/content references." },
        negativePrompt: { type: "string", description: "Optional — what to avoid." },
        seed: { type: "integer", description: "Optional — reproducibility seed." },
        folderId: { type: "string", description: "Optional — folder for output." },
      },
      required: ["prompt", "duration"],
    },
  },
  {
    name: "generate_image",
    description:
      "Generate an image via AI. Costs real money. Formula: subject + setting + shot type + lighting/mood. 15-30 words. Never generate UI screenshots, app interfaces, or title cards.",
    input_schema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Image prompt (15-30 words)." },
        aspectRatio: { type: "string", enum: ["16:9", "9:16", "1:1", "4:3"], description: "Aspect ratio." },
        model: { type: "string", description: "Model id from list_models." },
        resolution: { type: "string", enum: ["512", "768", "1024"], description: "Optional — resolution." },
        referenceMediaRefs: { type: "array", items: { type: "string" }, description: "Optional — style references." },
        negativePrompt: { type: "string", description: "Optional — what to avoid." },
        seed: { type: "integer", description: "Optional — reproducibility seed." },
        folderId: { type: "string", description: "Optional — folder for output." },
      },
      required: ["prompt"],
    },
  },
  {
    name: "generate_audio",
    description:
      "Generate audio via AI. Three categories by model: TTS (prompt is exact text, needs voice), Music (prompt describes style/mood), SFX (sound effects). Check list_models type='audio' for available models and capabilities.",
    input_schema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Text for TTS, style description for music, or effect description for SFX." },
        duration: { type: "number", description: "Duration in seconds." },
        model: { type: "string", description: "Model id from list_models." },
        voice: { type: "string", description: "Optional — voice name for TTS." },
        styleInstructions: { type: "string", description: "Optional — delivery instructions for TTS." },
        videoSourceMediaRef: { type: "string", description: "Optional — video for video-to-audio models." },
        videoSourceStartFrame: { type: "integer", description: "Optional — start frame for video source." },
        videoSourceEndFrame: { type: "integer", description: "Optional — end frame for video source." },
        segments: { type: "string", description: "Optional — timed style changes JSON for music models." },
        folderId: { type: "string", description: "Optional — folder for output." },
      },
      required: ["prompt", "duration"],
    },
  },
  {
    name: "upscale_media",
    description:
      "Upscale an image or video asset to higher resolution via AI. Check list_models for supported input/output resolutions.",
    input_schema: {
      type: "object",
      properties: {
        mediaRef: { type: "string", description: "Asset id to upscale." },
        targetResolution: { type: "string", enum: ["2x", "4x"], description: "Upscale factor." },
        model: { type: "string", description: "Optional — model id from list_models." },
      },
      required: ["mediaRef"],
    },
  },
  {
    name: "list_models",
    description:
      "List available AI models for generation. Filter by type (video, image, audio). Shows capabilities: supported durations, aspect ratios, references, voices, asset types. Call before any generation tool.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["video", "image", "audio"], description: "Optional — filter by model type." },
      },
      required: [],
    },
  },
  {
    name: "cancel_generation",
    description: "Attempt to cancel a running generation task. May not work for all model types.",
    input_schema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task ID from generation response." },
      },
      required: ["taskId"],
    },
  },

  // ─── PROJECT SETTINGS (1) ────────────────────────────────────────
  {
    name: "set_project_settings",
    description:
      "Change project-level settings: name, resolution (width/height), fps. Auto-fits existing clips to new resolution.",
    input_schema: {
      type: "object",
      properties: {
        width: { type: "number", description: "Optional — new project width in px." },
        height: { type: "number", description: "Optional — new project height in px." },
        fps: { type: "number", description: "Optional — new frames per second." },
        name: { type: "string", description: "Optional — new project name." },
      },
      required: [],
    },
  },

  // ─── EXPORT (1) ──────────────────────────────────────────────────
  {
    name: "export_project",
    description:
      "Export the current project. Modes: video (H.264/H.265/ProRes, resolution options), xml (FCPXML for DaVinci/Premiere), filmidi (self-contained .filmidi package). Video renders in background; xml/filmidi finish inline.",
    input_schema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["video", "xml", "filmidi"], description: "Export mode (default: video)." },
        format: { type: "string", enum: ["mp4", "webm", "mov"], description: "Video format." },
        resolution: { type: "string", enum: ["original", "4K", "2K", "1080p", "720p", "480p"], description: "Target resolution." },
        codec: { type: "string", enum: ["h264", "h265", "prores"], description: "Video codec." },
        outputPath: { type: "string", description: "Optional — file save location. Omit for ~/Downloads." },
      },
      required: [],
    },
  },

  // ─── MULTICAM (5) ────────────────────────────────────────────────
  {
    name: "list_multicam_sources",
    description: "List all multicam sources in the project.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "add_multicam_source",
    description: "Add a new multicam source (e.g. a camera angle).",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Source name (e.g. 'Camera A')." },
      },
      required: ["name"],
    },
  },
  {
    name: "remove_multicam_source",
    description: "Remove a multicam source.",
    input_schema: {
      type: "object",
      properties: {
        sourceId: { type: "string", description: "Source id to remove." },
      },
      required: ["sourceId"],
    },
  },
  {
    name: "rename_multicam_source",
    description: "Rename a multicam source.",
    input_schema: {
      type: "object",
      properties: {
        sourceId: { type: "string", description: "Source id to rename." },
        name: { type: "string", description: "New name." },
      },
      required: ["sourceId", "name"],
    },
  },
  {
    name: "assign_clip_to_source",
    description: "Assign a clip to a multicam source for angle switching.",
    input_schema: {
      type: "object",
      properties: {
        clipId: { type: "string", description: "Clip id to assign." },
        sourceId: { type: "string", description: "Multicam source id." },
      },
      required: ["clipId", "sourceId"],
    },
  },

  // ─── UNDO (1) ────────────────────────────────────────────────────
  {
    name: "undo",
    description:
      "Undo the most recent agent edit. Only reverts tool-made changes, not the user's manual edits.",
    input_schema: { type: "object", properties: {}, required: [] },
  },

  // ─── SKILLS (1) ──────────────────────────────────────────────────
  {
    name: "read_skill",
    description:
      "Load a skill playbook by id. Skills are task-specific procedures (e.g. 'color-grade-interview', 'beat-sync-edit'). Read before executing a matched task.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Skill id." },
      },
      required: ["id"],
    },
  },

  // ─── FEEDBACK (1) ────────────────────────────────────────────────
  {
    name: "send_feedback",
    description:
      "Flag a bug, limitation, or improvement suggestion to the Filmidi team. Use when a tool is missing, broken, or returns wrong results. Never send verbatim user content.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["bug", "suggestion"], description: "Feedback type." },
        summary: { type: "string", description: "Paraphrased summary of the issue or suggestion." },
        toolName: { type: "string", description: "Optional — which tool the feedback is about." },
      },
      required: ["type", "summary"],
    },
  },

  // ─── PROJECT NAVIGATION (3) ──────────────────────────────────────
  {
    name: "get_projects",
    description:
      "List known projects (id, name, path, whether open, which is active). Call this first when unsure what's available.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "open_project",
    description: "Make an existing project active by id or path.",
    input_schema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project id from get_projects." },
        path: { type: "string", description: "Or project file path." },
      },
      required: [],
    },
  },
  {
    name: "new_project",
    description: "Create and open a fresh project with the given name.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Project name." },
      },
      required: ["name"],
    },
  },
];
