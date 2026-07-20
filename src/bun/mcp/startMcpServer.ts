import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";

const MCP_PORT = 19790;
const MCP_ENDPOINT = "/mcp";

// ─── Tool Definitions ───────────────────────────────────────────

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOLS: ToolDef[] = [
  // ─── Timeline Inspection (5) ───
  {
    name: "get_timeline",
    description: "Read the full project state: settings (fps, resolution, duration, totalFrames, canGenerate), track list, all layers/clips with timing, properties, keyframes, effects, transitions. Call this first to understand the current edit before making changes.",
    inputSchema: {
      type: "object",
      properties: {
        startFrame: { type: "integer", description: "Optional — start of window (frames)." },
        endFrame: { type: "integer", description: "Optional — end of window (frames)." },
      },
    },
  },
  {
    name: "get_media",
    description: "List every media asset in the project library: id, name, type (video/audio/image), url, duration, thumbnail, folderId. Use before add_clips to know what's available.",
    inputSchema: {
      type: "object",
      properties: {
        filterTypes: {
          type: "array",
          items: { type: "string", enum: ["video", "audio", "image"] },
          description: "Optional — filter by media type(s). Omit to list all.",
        },
      },
    },
  },
  {
    name: "inspect_timeline",
    description: "Render composited preview frames as data URLs for agent vision. Returns canvas-rendered frame images the agent can visually inspect.",
    inputSchema: {
      type: "object",
      properties: {
        startFrame: { type: "integer", description: "Optional — first frame to render." },
        endFrame: { type: "integer", description: "Optional — last frame to render." },
        maxFrames: { type: "integer", description: "Optional — max frames to return (default 4)." },
      },
    },
  },
  {
    name: "inspect_media",
    description: "View media metadata: storyboard frames, duration, resolution, codec, file size, audio channels. Optionally return word-level transcript.",
    inputSchema: {
      type: "object",
      properties: {
        mediaRef: { type: "string", description: "Asset id from get_media." },
        clipId: { type: "string", description: "Optional — scope to specific clip's portion." },
        maxFrames: { type: "integer", description: "Optional — max storyboard frames (default 8)." },
        startSeconds: { type: "number", description: "Optional — start of inspection window." },
        endSeconds: { type: "number", description: "Optional — end of inspection window." },
        wordTimestamps: { type: "boolean", description: "Optional — include word-level transcript." },
        overview: { type: "boolean", description: "Optional — compact storyboard overview." },
      },
      required: ["mediaRef"],
    },
  },
  {
    name: "inspect_color",
    description: "Inspect color information at a specific point in the preview: dominant colors, color temperature, histogram data.",
    inputSchema: {
      type: "object",
      properties: {
        frame: { type: "integer", description: "Optional — frame to inspect (default: current)." },
        region: {
          type: "object",
          properties: {
            x: { type: "number" }, y: { type: "number" },
            width: { type: "number" }, height: { type: "number" },
          },
          description: "Optional — rectangular region to analyze.",
        },
      },
    },
  },

  // ─── Clip Operations (8) ───
  {
    name: "add_clips",
    description: "Place one or more media assets onto the timeline at specific tracks and times. Creates linked audio for video clips. Batch undoable. Omit trackIndex to auto-assign lowest available track.",
    inputSchema: {
      type: "object", properties: {
        entries: {
          type: "array", items: {
            type: "object", properties: {
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
      }, required: ["entries"],
    },
  },
  {
    name: "insert_clips",
    description: "Insert clips at a frame, pushing subsequent clips to the right (ripple insert). Like add_clips but shifts everything after the insertion point.",
    inputSchema: {
      type: "object", properties: {
        entries: {
          type: "array", items: {
            type: "object", properties: {
              mediaRef: { type: "string" },
              startFrame: { type: "integer" },
              trackIndex: { type: "integer" },
              durationFrames: { type: "integer" },
            },
            required: ["mediaRef", "startFrame"],
          },
        },
      }, required: ["entries"],
    },
  },
  {
    name: "remove_clips",
    description: "Remove one or more layers/clips from the timeline by their id. Handles linked groups. Prunes empty tracks.",
    inputSchema: {
      type: "object", properties: {
        layerIds: {
          type: "array", items: { type: "string" },
          description: "Array of layer ids to remove (from get_timeline).",
        },
      }, required: ["layerIds"],
    },
  },
  {
    name: "remove_tracks",
    description: "Remove entire tracks by index. All clips on the track are removed. Track indices shift after removal.",
    inputSchema: {
      type: "object", properties: {
        trackIndices: {
          type: "array", items: { type: "integer" },
          description: "Track indices to remove (from get_timeline).",
        },
      }, required: ["trackIndices"],
    },
  },
  {
    name: "move_clips",
    description: "Reposition clips on the timeline — change their startFrame and/or track. Can move multiple clips at once.",
    inputSchema: {
      type: "object", properties: {
        clips: {
          type: "array", items: {
            type: "object", properties: {
              layerId: { type: "string" },
              startTime: { type: "number", description: "New timeline time in seconds." },
              track: { type: "integer", description: "Optional — new track index." },
            },
            required: ["layerId", "startTime"],
          },
        },
      }, required: ["clips"],
    },
  },
  {
    name: "split_clips",
    description: "Split one or more layers at specific cut points. Each cut point must be strictly inside its clip. Multiple cuts on the same clip are fine. Use ripple_delete_ranges when you need to remove a span.",
    inputSchema: {
      type: "object", properties: {
        cuts: {
          type: "array", items: {
            type: "object", properties: {
              layerId: { type: "string", description: "Layer id to split." },
              atFrame: { type: "integer", description: "Frame to cut at (must be inside the clip)." },
            },
            required: ["layerId", "atFrame"],
          },
        },
      },
    },
  },
  {
    name: "set_clip_properties",
    description: "Modify properties of one or more clips: durationFrames, trim, speed, volume, opacity, blendMode, transform. NOT for preview layout — use apply_layout for multi-clip compositions.",
    inputSchema: {
      type: "object", properties: {
        clips: {
          type: "array", items: {
            type: "object", properties: {
              layerId: { type: "string" },
              sourceDuration: { type: "number", description: "Optional — new duration in seconds." },
              settings: {
                type: "object",
                properties: {
                  startTime: { type: "number" }, sourceStart: { type: "number" },
                  volume: { type: "number" }, speed: { type: "number" },
                },
              },
              properties: { type: "object", description: "Optional visual properties: { opacity?, scale?, rotation?, position?, blendMode? }." },
            },
            required: ["layerId"],
          },
        },
      }, required: ["clips"],
    },
  },
  {
    name: "ripple_delete_ranges",
    description: "Delete time ranges from the timeline, rippling everything after to the left. Use for removing spans that aren't word-aligned.",
    inputSchema: {
      type: "object", properties: {
        ranges: {
          type: "array", items: {
            type: "object", properties: {
              startFrame: { type: "integer", description: "Start of range to delete." },
              endFrame: { type: "integer", description: "End of range to delete." },
              trackIndex: { type: "integer", description: "Optional — specific track. Omit for all." },
            },
            required: ["startFrame", "endFrame"],
          },
        },
      }, required: ["ranges"],
    },
  },
  {
    name: "remove_silence",
    description: "Remove dead air from speech clips using their existing transcript. Deletes only pauses longer than the threshold and ripples linked timeline media together.",
    inputSchema: {
      type: "object", properties: {
        clipIds: { type: "array", items: { type: "string" }, description: "Optional audio/video clip ids." },
        minPauseSeconds: { type: "number", description: "Optional minimum pause length. Defaults to 0.5 seconds." },
        language: { type: "string", description: "Optional transcript language hint." },
      }, required: [],
    },
  },

  // ─── Keyframes (1) ───
  {
    name: "set_keyframes",
    description: "Replace the keyframe track for one (clipId, property) pair. Empty array clears keyframes. Frames are clip-relative.",
    inputSchema: {
      type: "object", properties: {
        clipId: { type: "string" },
        property: { type: "string", description: "Property name to animate (e.g. 'opacity', 'position')." },
        keyframes: {
          type: "array", items: {
            type: "object", properties: {
              time: { type: "number", description: "Source time in seconds." },
              value: { description: "Value at this keyframe." },
              easing: { type: "string", enum: ["step", "linear", "easeIn", "easeOut", "easeInOut"] },
            },
            required: ["time", "value"],
          },
        },
      }, required: ["clipId", "property", "keyframes"],
    },
  },

  // ─── Text & Captions (4) ───
  {
    name: "add_texts",
    description: "Add one or more text overlays to the timeline. Each entry creates a text layer at the given frame.",
    inputSchema: {
      type: "object", properties: {
        texts: {
          type: "array", items: {
            type: "object", properties: {
              text: { type: "string" },
              startFrame: { type: "integer" },
              durationFrames: { type: "integer" },
              trackIndex: { type: "integer", description: "Optional." },
              fontSize: { type: "integer", description: "Optional." },
              color: { type: "string", description: "Optional — hex color." },
              fontFamily: { type: "string", description: "Optional." },
              alignment: { type: "string", enum: ["left", "center", "right"] },
              position: {
                type: "object", properties: {
                  x: { type: "number" }, y: { type: "number" },
                },
              },
            },
            required: ["text", "startFrame", "durationFrames"],
          },
        },
      }, required: ["texts"],
    },
  },
  {
    name: "update_text",
    description: "Update an existing text layer's content or style (font, size, color, alignment, position).",
    inputSchema: {
      type: "object", properties: {
        layerId: { type: "string" },
        text: { type: "string" },
        fontSize: { type: "integer" },
        color: { type: "string" },
        fontFamily: { type: "string" },
        alignment: { type: "string", enum: ["left", "center", "right"] },
        position: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } } },
      }, required: ["layerId"],
    },
  },
  {
    name: "add_captions",
    description: "Transcribe audio on the timeline and add caption layers for detected speech.",
    inputSchema: {
      type: "object", properties: {
        clipIds: { type: "array", items: { type: "string" }, description: "Audio/video layer ids to transcribe." },
        language: { type: "string", description: "Optional — BCP-47 language tag." },
      }, required: ["clipIds"],
    },
  },
  {
    name: "remove_words",
    description: "Remove specific word ranges from text-based clips, rippling timeline. For word-aligned cuts, prefer this over ripple_delete_ranges.",
    inputSchema: {
      type: "object", properties: {
        clipId: { type: "string" },
        wordRanges: {
          type: "array", items: {
            type: "object", properties: {
              startIndex: { type: "integer" },
              endIndex: { type: "integer" },
            },
          },
        },
      }, required: ["clipId", "wordRanges"],
    },
  },

  // ─── Layout (2) ───
  {
    name: "apply_layout",
    description: "Arrange multiple clips into a multi-clip composition by setting each clip's normalized position and size.",
    inputSchema: {
      type: "object", properties: {
        clips: {
          type: "array", items: {
            type: "object", properties: {
              layerId: { type: "string" },
              x: { type: "number", description: "Normalized 0-1." },
              y: { type: "number", description: "Normalized 0-1." },
              width: { type: "number", description: "Normalized 0-1." },
              height: { type: "number", description: "Normalized 0-1." },
              rotation: { type: "number", description: "Optional — degrees." },
            },
          },
        },
      }, required: ["clips"],
    },
  },
  {
    name: "create_matte",
    description: "Create a shape layer (rectangle, ellipse, polygon, star) on the timeline. Useful for borders, backgrounds, or masking areas.",
    inputSchema: {
      type: "object", properties: {
        shapeType: { type: "string", enum: ["rectangle", "ellipse", "polygon", "star"] },
        startFrame: { type: "integer" },
        durationFrames: { type: "integer" },
        trackIndex: { type: "integer" },
        color: { type: "string", description: "Optional — hex fill color." },
        width: { type: "number", description: "Optional — normalized 0-1." },
        height: { type: "number", description: "Optional — normalized 0-1." },
        cornerRadius: { type: "number" },
        opacity: { type: "number" },
      }, required: ["shapeType", "startFrame", "durationFrames"],
    },
  },

  // ─── Color & Effects (2) ───
  {
    name: "apply_color",
    description: "Apply color grade to one or more clips using built-in color filters.",
    inputSchema: {
      type: "object", properties: {
        clipIds: { type: "array", items: { type: "string" } },
        colorFilter: {
          type: "object", properties: {
            brightness: { type: "number" }, contrast: { type: "number" },
            saturation: { type: "number" }, temperature: { type: "number" },
            hue: { type: "number" }, tint: { type: "number" },
          },
        },
        preset: { type: "string", description: "Optional — named preset." },
      }, required: ["clipIds"],
    },
  },
  {
    name: "apply_effect",
    description: "Add, update, remove, reorder, or enable/disable effects on one or more clips.",
    inputSchema: {
      type: "object", properties: {
        clipIds: { type: "array", items: { type: "string" } },
        clipId: { type: "string", description: "Legacy single-clip form." },
        effect: { type: "string" },
        operation: { type: "string", enum: ["add", "update", "remove", "reorder", "enable", "disable", "clear"] },
        effectIndex: { type: "integer" },
        toIndex: { type: "integer" },
        params: { type: "object" },
        add: { type: "array", items: { type: "object", properties: { effectType: { type: "string" }, params: { type: "object" } } } },
        remove: { type: "array", items: { type: "string" } },
        reorder: { type: "array", items: { type: "string" } },
      }, required: [],
    },
  },
  {
    name: "set_transition",
    description: "Set, update, or clear a transition at the in or out edge of clips.",
    inputSchema: {
      type: "object", properties: {
        clipIds: { type: "array", items: { type: "string" } },
        clipId: { type: "string", description: "Legacy single-clip form." },
        edge: { type: "string", enum: ["in", "out"] },
        transition: { type: "string" },
        duration: { type: "number" },
        easing: { type: "string" },
        params: { type: "object" },
        clear: { type: "boolean" },
      }, required: ["edge"],
    },
  },
  {
    name: "list_transitions",
    description: "List registered VideoFlow transition presets.",
    inputSchema: { type: "object", properties: {} },
  },

  // ─── Audio Analysis (3) ───
  {
    name: "detect_beats",
    description: "Analyze audio of a clip and detect beat timestamps for syncing edits to the rhythm.",
    inputSchema: {
      type: "object", properties: {
        clipId: { type: "string" },
        sensitivity: { type: "number", description: "Optional — 0-1." },
      }, required: ["clipId"],
    },
  },
  {
    name: "sync_audio",
    description: "Snap a clip's audio transients to a beat grid for music-synced editing.",
    inputSchema: {
      type: "object", properties: {
        clipId: { type: "string" },
        bpm: { type: "number", description: "Optional — beats per minute." },
        offsetFrames: { type: "integer", description: "Optional — frame offset from the beat." },
      }, required: ["clipId"],
    },
  },
  {
    name: "denoise_audio",
    description: "Apply noise reduction to an audio clip to clean up background hiss, hum, or buzz.",
    inputSchema: {
      type: "object", properties: {
        clipId: { type: "string" },
        strength: { type: "number", description: "Optional — 0-1 (default 0.5)." },
      }, required: ["clipId"],
    },
  },

  // ─── Media Intelligence (2) ───
  {
    name: "get_transcript",
    description: "Get or generate a word-level transcript for a media asset. Returns phrases with timing.",
    inputSchema: {
      type: "object", properties: {
        mediaRef: { type: "string", description: "Asset id from get_media." },
        language: { type: "string", description: "Optional — BCP-47 language tag." },
      }, required: ["mediaRef"],
    },
  },
  {
    name: "search_media",
    description: "Search media library by name, type, or folder. Supports sorting.",
    inputSchema: {
      type: "object", properties: {
        query: { type: "string", description: "Search query." },
        filterTypes: { type: "array", items: { type: "string", enum: ["video", "audio", "image"] } },
        folderId: { type: "string" },
        sortBy: { type: "string", enum: ["name", "date", "type"] },
        sortOrder: { type: "string", enum: ["asc", "desc"] },
      },
    },
  },

  // ─── Media Organization (7) ───
  {
    name: "list_folders", description: "List all folders in the media library.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_folder", description: "Create a new folder in the media library.",
    inputSchema: { type: "object", properties: { name: { type: "string" }, parentFolderId: { type: "string" } }, required: ["name"] },
  },
  {
    name: "move_to_folder", description: "Move media assets to a folder.",
    inputSchema: { type: "object", properties: { mediaIds: { type: "array", items: { type: "string" } }, folderId: { type: "string" } }, required: ["mediaIds", "folderId"] },
  },
  {
    name: "rename_media", description: "Rename a media asset.",
    inputSchema: { type: "object", properties: { mediaId: { type: "string" }, name: { type: "string" } }, required: ["mediaId", "name"] },
  },
  {
    name: "rename_folder", description: "Rename a folder.",
    inputSchema: { type: "object", properties: { folderId: { type: "string" }, name: { type: "string" } }, required: ["folderId", "name"] },
  },
  {
    name: "delete_media", description: "Delete media assets from the library (does not affect timeline).",
    inputSchema: { type: "object", properties: { mediaIds: { type: "array", items: { type: "string" } } }, required: ["mediaIds"] },
  },
  {
    name: "delete_folder", description: "Delete a folder and optionally its contents.",
    inputSchema: { type: "object", properties: { folderId: { type: "string" }, deleteContents: { type: "boolean" } }, required: ["folderId"] },
  },

  // ─── Media Import (1) ───
  {
    name: "import_media",
    description: "Import media files from the file system given their absolute file paths.",
    inputSchema: {
      type: "object", properties: {
        filePaths: { type: "array", items: { type: "string" }, description: "Absolute file paths on the local machine." },
        folderId: { type: "string", description: "Optional — target folder." },
      }, required: ["filePaths"],
    },
  },

  // ─── AI Generation (5) ───
  {
    name: "generate_video",
    description: "Generate a video clip using AI (text-to-video). Returns the URL of the generated video for use in add_clips.",
    inputSchema: {
      type: "object", properties: {
        prompt: { type: "string" },
        model: { type: "string", description: "Optional — model id." },
        imageRef: { type: "string", description: "Optional — reference image id." },
        duration: { type: "number", description: "Optional — desired duration in seconds." },
        resolution: { type: "string", description: "Optional — e.g. '1080p'." },
      }, required: ["prompt"],
    },
  },
  {
    name: "generate_image",
    description: "Generate an image using AI (text-to-image). Returns the URL of the generated image.",
    inputSchema: {
      type: "object", properties: {
        prompt: { type: "string" },
        model: { type: "string" },
        imageRef: { type: "string" },
        aspectRatio: { type: "string" },
        resolution: { type: "string" },
      }, required: ["prompt"],
    },
  },
  {
    name: "generate_audio",
    description: "Generate audio using AI (text-to-music, text-to-speech, or describe video).",
    inputSchema: {
      type: "object", properties: {
        prompt: { type: "string" },
        type: { type: "string", enum: ["music", "speech", "sfx"] },
        duration: { type: "number" },
        videoRef: { type: "string" },
      }, required: ["prompt"],
    },
  },
  {
    name: "upscale_media",
    description: "Upscale/resize a media asset to a higher resolution.",
    inputSchema: {
      type: "object", properties: {
        mediaRef: { type: "string" },
        resolution: { type: "string", description: "e.g. '4k', '1080p'." },
      }, required: ["mediaRef"],
    },
  },
  {
    name: "list_models",
    description: "List available AI generation models with their capabilities and pricing.",
    inputSchema: { type: "object", properties: {} },
  },

  // ─── Project Settings (1) ───
  {
    name: "set_project_settings",
    description: "Update project settings (name, fps, resolution, background color).",
    inputSchema: {
      type: "object", properties: {
        name: { type: "string" }, fps: { type: "integer" },
        width: { type: "integer" }, height: { type: "integer" },
        backgroundColor: { type: "string" },
      },
    },
  },

  // ─── Export (1) ───
  {
    name: "export_project",
    description: "Export the project to a media or project file.",
    inputSchema: {
      type: "object", properties: {
        format: { type: "string", enum: ["mp4", "mov", "gif", "image-sequence", "audio", "project"] },
        resolution: { type: "string" }, quality: { type: "string", enum: ["draft", "good", "best"] },
        includeAudio: { type: "boolean" },
        rangeStart: { type: "integer" }, rangeEnd: { type: "integer" },
        outputPath: { type: "string" },
      },
    },
  },

  // ─── Undo (1) ───
  {
    name: "undo",
    description: "Undo the last edit operation. Call get_timeline afterwards to see the state.",
    inputSchema: { type: "object", properties: {} },
  },

  // ─── Skills (1) ───
  {
    name: "read_skill",
    description: "Read a skill/tutorial from the library to learn how to perform a specific editing task.",
    inputSchema: {
      type: "object", properties: {
        skillId: { type: "string", description: "Skill identifier." },
      }, required: ["skillId"],
    },
  },
];

// ─── JSON Schema → Zod converter ──────────────────────────────

function jsonPropToZod(prop: Record<string, unknown>): z.ZodType {
  const type = prop.type as string;
  let result: z.ZodType;

  switch (type) {
    case "string": {
      result = prop.enum ? z.enum(prop.enum as [string, ...string[]]) : z.string();
      break;
    }
    case "integer":
      result = z.number().int();
      break;
    case "number":
      result = z.number();
      break;
    case "boolean":
      result = z.boolean();
      break;
    case "array": {
      const items = prop.items as Record<string, unknown> | undefined;
      result = items ? z.array(jsonPropToZod(items)) : z.array(z.any());
      break;
    }
    case "object": {
      const props = prop.properties as Record<string, Record<string, unknown>> | undefined;
      if (props) {
        const shape: Record<string, z.ZodType> = {};
        const req = Array.isArray(prop.required) ? new Set(prop.required) : new Set();
        for (const [k, v] of Object.entries(props)) {
          let t = jsonPropToZod(v);
          if (!req.has(k)) t = t.optional();
          shape[k] = t;
        }
        result = z.object(shape);
      } else {
        result = z.object({});
      }
      break;
    }
    default:
      result = z.any();
  }

  if (prop.description && typeof prop.description === "string") {
    result = result.describe(prop.description);
  }

  return result;
}

function jsonSchemaToZodRawShape(schema: Record<string, unknown>): Record<string, z.ZodType> {
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (!properties) return {};

  const required = Array.isArray(schema.required) ? new Set(schema.required) : new Set();
  const shape: Record<string, z.ZodType> = {};

  for (const [key, prop] of Object.entries(properties)) {
    let type = jsonPropToZod(prop);
    if (!required.has(key)) {
      type = type.optional();
    }
    shape[key] = type;
  }

  return shape;
}

// ─── Start MCP Server ───────────────────────────────────────────

export async function startMcpServer(
  callToolOnRenderer: (name: string, args: Record<string, unknown>) => Promise<string>,
): Promise<void> {
  type Session = {
    server: McpServer;
    transport: WebStandardStreamableHTTPServerTransport;
  };
  const sessions = new Map<string, Session>();

  const createSession = async (): Promise<Session> => {
    const server = new McpServer({ name: "Filmidi Editor", version: "1.0.0" });
    for (const tool of TOOLS) {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: jsonSchemaToZodRawShape(tool.inputSchema),
        },
        async (args: Record<string, unknown>) => {
          try {
            const resultStr = await callToolOnRenderer(tool.name, args);
            return { content: [{ type: "text" as const, text: resultStr }] };
          } catch (err) {
            return {
              content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
              isError: true,
            };
          }
        },
      );
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return { server, transport };
  };

  // Start HTTP server (using node:http to avoid Bun.serve C++ crash)
  const server = createServer(async (nodeReq: IncomingMessage, nodeRes: ServerResponse) => {
    if (!nodeReq.url) {
      nodeRes.writeHead(400);
      nodeRes.end("Bad request");
      return;
    }

    const url = new URL(nodeReq.url, `http://${nodeReq.headers.host ?? "127.0.0.1"}`);

    // Health check
    if (url.pathname === "/health") {
      nodeRes.writeHead(200, { "Content-Type": "application/json" });
      nodeRes.end(JSON.stringify({ status: "ok", service: "filmidi-mcp" }));
      return;
    }

    if (url.pathname !== MCP_ENDPOINT) {
      nodeRes.writeHead(404);
      nodeRes.end("Not found");
      return;
    }

    const corsHeaders: Record<string, string> = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Session-ID, Last-Event-ID",
      "Access-Control-Expose-Headers": "MCP-Session-ID",
    };

    if (nodeReq.method === "OPTIONS") {
      nodeRes.writeHead(204, corsHeaders);
      nodeRes.end();
      return;
    }

    // A normal browser visit sends Accept: text/html and is not an MCP
    // session. Return useful diagnostics instead of the SDK's SSE error.
    const accept = nodeReq.headers.accept ?? "";
    if (nodeReq.method === "GET" && !accept.includes("text/event-stream")) {
      nodeRes.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
      nodeRes.end(JSON.stringify({
        service: "filmidi-mcp",
        status: "ready",
        endpoint: `http://127.0.0.1:${MCP_PORT}${MCP_ENDPOINT}`,
        note: "Use an MCP client or JSON-RPC POST request; this endpoint is not a web page.",
      }));
      return;
    }

    try {
      const rawSessionId = nodeReq.headers["mcp-session-id"];
      const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
      let session = sessionId ? sessions.get(sessionId) : undefined;

      if (sessionId && !session) {
        nodeRes.writeHead(404, corsHeaders);
        nodeRes.end("Unknown MCP session");
        return;
      }
      if (!session) session = await createSession();

      // Each MCP initialize request gets its own transport. Reusing one
      // transport across Codex reconnects causes "Server already initialized".
      const webReq = await incomingToWebRequest(nodeReq, url);
      const webRes = await session.transport.handleRequest(webReq);
      const responseSessionId = webRes.headers.get("mcp-session-id") ?? sessionId;
      if (responseSessionId) sessions.set(responseSessionId, session);
      if (nodeReq.method === "DELETE" && sessionId) sessions.delete(sessionId);

      await webResponseToNode(webRes, nodeRes, corsHeaders);
    } catch (error) {
      console.error("[MCP] Request failed:", error);
      if (!nodeRes.headersSent) nodeRes.writeHead(500, corsHeaders);
      nodeRes.end("MCP request failed");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(MCP_PORT, "127.0.0.1", () => {
      console.log(`[MCP] Server running on http://127.0.0.1:${MCP_PORT}${MCP_ENDPOINT}`);
      resolve();
    });
  });
}

// ─── HTTP conversion helpers ───────────────────────────────────

function incomingToWebRequest(nodeReq: IncomingMessage, url: URL): Promise<Request> {
  const method = nodeReq.method ?? "GET";
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeReq.headers)) {
    if (value) {
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
  }

  return new Promise((resolve) => {
    const chunks: Uint8Array[] = [];
    nodeReq.on("data", (chunk: Buffer) => chunks.push(new Uint8Array(chunk)));
    nodeReq.on("end", () => {
      const body = chunks.length > 0 ? Buffer.concat(chunks.map((c) => Buffer.from(c))) : undefined;
      resolve(new Request(url, { method, headers, body }));
    });
  });
}

async function webResponseToNode(
  webRes: Response,
  nodeRes: ServerResponse,
  extraHeaders: Record<string, string>,
): Promise<void> {
  const headers: Record<string, string> = { ...extraHeaders };
  webRes.headers.forEach((value, key) => {
    headers[key] = value;
  });

  nodeRes.writeHead(webRes.status, headers);

  if (webRes.body) {
    const reader = webRes.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        nodeRes.write(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
  }

  nodeRes.end();
}
