export interface ToolUseEvent {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface TextDeltaEvent {
  type: "text_delta";
  text: string;
}

export interface ToolResultEvent {
  type: "tool_result";
  id: string;
  content: string;
  isError: boolean;
}

export interface StopEvent {
  type: "stop";
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | null;
  usage: { input_tokens: number; output_tokens: number };
}

export type StreamEvent = TextDeltaEvent | ToolUseEvent | StopEvent;

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Stream a chat completion from Qwen's Anthropic-compatible API.
 * Returns an async generator of StreamEvents.
 */
export async function* streamChat(
  apiKey: string,
  {
    messages,
    tools,
    model,
    system,
    maxTokens = 8192,
    signal,
  }: {
    messages: Message[];
    tools?: ToolDefinition[];
    model: string;
    system?: string;
    maxTokens?: number;
    signal?: AbortSignal;
  },
): AsyncGenerator<StreamEvent> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    stream: true,
    messages: messages.map((m) => {
      if (typeof m.content === "string") {
        return { role: m.role, content: m.content };
      }
      return { role: m.role, content: m.content };
    }),
  };
  if (system) body.system = system;
  if (tools && tools.length > 0) {
    body.tools = tools;
    // Mark last tool for prompt caching
    const last = (body.tools as Record<string, unknown>[]).at(-1);
    if (last) last.cache_control = { type: "ephemeral" };
  }

  const response = await fetch(
    "https://dashscope-intl.aliyuncs.com/apps/anthropic/v1/messages",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      signal,
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "unknown error");
    throw new Error(`Qwen API error ${response.status}: ${text}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let currentBlock: { type: "text" | "tool_use"; index: number; id?: string; name?: string; input?: string } | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data) continue;

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }

        const eventType = parsed.type as string;

        if (eventType === "message_start") {
          // Initial message — nothing to yield yet
          continue;
        }

        if (eventType === "content_block_start") {
          const index = parsed.index as number;
          const block = parsed.content_block as Record<string, unknown>;
          if (block.type === "text") {
            currentBlock = { type: "text", index };
          } else if (block.type === "tool_use") {
            currentBlock = {
              type: "tool_use",
              index,
              id: block.id as string,
              name: block.name as string,
              input: "",
            };
          }
          continue;
        }

        if (eventType === "content_block_delta") {
          const index = parsed.index as number;
          const delta = parsed.delta as Record<string, unknown>;
          if (delta.type === "text_delta" && currentBlock?.type === "text") {
            const text = delta.text as string;
            if (text) yield { type: "text_delta", text };
          } else if (delta.type === "input_json_delta" && currentBlock?.type === "tool_use") {
            currentBlock.input = (currentBlock.input ?? "") + (delta.partial_json as string);
          }
          continue;
        }

        if (eventType === "content_block_stop") {
          if (currentBlock?.type === "tool_use" && currentBlock.id && currentBlock.name) {
            let input: Record<string, unknown> = {};
            try {
              input = currentBlock.input ? JSON.parse(currentBlock.input) : {};
            } catch {}
            yield {
              type: "tool_use",
              id: currentBlock.id,
              name: currentBlock.name,
              input,
            };
          }
          currentBlock = null;
          continue;
        }

        if (eventType === "message_delta") {
          const delta = parsed.delta as Record<string, unknown> | undefined;
          const usage = parsed.usage as Record<string, unknown> | undefined;
          const stopReason = (delta?.stop_reason as string | undefined) ?? null;
          yield {
            type: "stop",
            stopReason: stopReason as StopEvent["stopReason"],
            usage: {
              input_tokens: (usage?.input_tokens as number) ?? 0,
              output_tokens: (usage?.output_tokens as number) ?? 0,
            },
          };
          continue;
        }

        if (eventType === "error") {
          const error = parsed.error as Record<string, unknown> | undefined;
          throw new Error(
            `Qwen API stream error: ${error?.type ?? "unknown"}: ${error?.message ?? JSON.stringify(parsed)}`,
          );
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Stream a chat completion through the Filmidi backend proxy.
 * Uses JWT auth instead of API key. The SSE response format is identical to DashScope.
 */
export async function* streamChatBackend(
  sessionToken: string,
  {
    messages,
    tools,
    model,
    system,
    maxTokens = 8192,
    signal,
  }: {
    messages: Message[];
    tools?: ToolDefinition[];
    model: string;
    system?: string;
    maxTokens?: number;
    signal?: AbortSignal;
  },
): AsyncGenerator<StreamEvent> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    stream: true,
    messages,
  };
  if (system) body.system = system;
  if (tools && tools.length > 0) {
    body.tools = tools;
    const last = (body.tools as Record<string, unknown>[]).at(-1);
    if (last) last.cache_control = { type: "ephemeral" };
  }

  const response = await fetch("http://localhost:3000/api/v1/agent/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "unknown error");
    throw new Error(`Backend proxy error ${response.status}: ${text}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let currentBlock: { type: "text" | "tool_use"; index: number; id?: string; name?: string; input?: string } | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data) continue;

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }

        const eventType = parsed.type as string;

        if (eventType === "message_start") continue;

        if (eventType === "content_block_start") {
          const index = parsed.index as number;
          const block = parsed.content_block as Record<string, unknown>;
          if (block.type === "text") {
            currentBlock = { type: "text", index };
          } else if (block.type === "tool_use") {
            currentBlock = {
              type: "tool_use",
              index,
              id: block.id as string,
              name: block.name as string,
              input: "",
            };
          }
          continue;
        }

        if (eventType === "content_block_delta") {
          const index = parsed.index as number;
          const delta = parsed.delta as Record<string, unknown>;
          if (delta.type === "text_delta" && currentBlock?.type === "text") {
            const text = delta.text as string;
            if (text) yield { type: "text_delta", text };
          } else if (delta.type === "input_json_delta" && currentBlock?.type === "tool_use") {
            currentBlock.input = (currentBlock.input ?? "") + (delta.partial_json as string);
          }
          continue;
        }

        if (eventType === "content_block_stop") {
          if (currentBlock?.type === "tool_use" && currentBlock.id && currentBlock.name) {
            let input: Record<string, unknown> = {};
            try {
              input = currentBlock.input ? JSON.parse(currentBlock.input) : {};
            } catch {}
            yield {
              type: "tool_use",
              id: currentBlock.id,
              name: currentBlock.name,
              input,
            };
          }
          currentBlock = null;
          continue;
        }

        if (eventType === "message_delta") {
          const delta = parsed.delta as Record<string, unknown> | undefined;
          const usage = parsed.usage as Record<string, unknown> | undefined;
          const stopReason = (delta?.stop_reason as string | undefined) ?? null;
          yield {
            type: "stop",
            stopReason: stopReason as StopEvent["stopReason"],
            usage: {
              input_tokens: (usage?.input_tokens as number) ?? 0,
              output_tokens: (usage?.output_tokens as number) ?? 0,
            },
          };
          continue;
        }

        if (eventType === "error") {
          const error = parsed.error as Record<string, unknown> | undefined;
          throw new Error(
            `Backend proxy stream error: ${error?.type ?? "unknown"}: ${error?.message ?? JSON.stringify(parsed)}`,
          );
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
