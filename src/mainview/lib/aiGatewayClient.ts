import { AI_GATEWAY_OPENAI_BASE_URL } from "./aiGateway";

export interface ToolUseEvent {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface TextDeltaEvent { type: "text_delta"; text: string }
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
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

function toOpenAIMessages(messages: Message[], system?: string): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];
  if (system) result.push({ role: "system", content: system });

  for (const message of messages) {
    if (typeof message.content === "string") {
      result.push({ role: message.role, content: message.content });
      continue;
    }
    const text = message.content.filter((block) => block.type === "text") as Array<{ type: "text"; text: string }>;
    const images = message.content.filter((block) => block.type === "image") as Array<{ type: "image"; source: { media_type: string; data: string } }>;
    const toolUses = message.content.filter((block) => block.type === "tool_use") as Array<{ type: "tool_use"; id: string; name: string; input: Record<string, unknown> }>;
    const results = message.content.filter((block) => block.type === "tool_result") as Array<{ type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }>;

    if (message.role === "assistant") {
      result.push({
        role: "assistant",
        content: text.map((block) => block.text).join("\n") || null,
        ...(toolUses.length > 0 ? {
          tool_calls: toolUses.map((tool) => ({
            id: tool.id,
            type: "function",
            function: { name: tool.name, arguments: JSON.stringify(tool.input) },
          })),
        } : {}),
      });
    } else if (results.length > 0) {
      for (const item of results) {
        result.push({ role: "tool", tool_call_id: item.tool_use_id, content: item.content });
      }
    } else {
      const content: Array<Record<string, unknown>> = text.map((block) => ({ type: "text", text: block.text }));
      for (const image of images) {
        content.push({ type: "image_url", image_url: { url: `data:${image.source.media_type};base64,${image.source.data}` } });
      }
      result.push({ role: "user", content: content.length === 1 && content[0].type === "text" ? (content[0].text as string) : content });
    }
  }
  return result;
}

function toOpenAITools(tools: ToolDefinition[] | undefined) {
  return tools?.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
  }));
}

/** Stream directly from Vercel AI Gateway using the user's BYOK credential. */
export async function* streamChatVercel(
  apiKey: string,
  { messages, tools, model, system, maxTokens = 8192, signal }: {
    messages: Message[];
    tools?: ToolDefinition[];
    model: string;
    system?: string;
    maxTokens?: number;
    signal?: AbortSignal;
  },
): AsyncGenerator<StreamEvent> {
  const response = await fetch(`${AI_GATEWAY_OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey.trim()}` },
    body: JSON.stringify({
      model,
      messages: toOpenAIMessages(messages, system),
      tools: toOpenAITools(tools),
      max_tokens: maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    }),
    signal,
  });
  if (!response.ok) throw new Error(`Vercel AI Gateway error ${response.status}: ${await response.text().catch(() => "unknown error")}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Vercel returned no stream body");

  const decoder = new TextDecoder();
  let buffer = "";
  const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        const parsed = JSON.parse(data) as Record<string, any>;
        const choice = parsed.choices?.[0];
        const delta = choice?.delta;
        if (delta?.content) yield { type: "text_delta", text: delta.content };
        for (const call of delta?.tool_calls ?? []) {
          const index = Number(call.index ?? 0);
          const current = toolCalls.get(index) ?? { id: "", name: "", arguments: "" };
          current.id ||= call.id ?? "";
          current.name ||= call.function?.name ?? "";
          current.arguments += call.function?.arguments ?? "";
          toolCalls.set(index, current);
        }
        if (choice?.finish_reason) {
          for (const call of toolCalls.values()) {
            let input: Record<string, unknown> = {};
            try { input = JSON.parse(call.arguments || "{}"); } catch {}
            yield { type: "tool_use", id: call.id, name: call.name, input };
          }
          yield {
            type: "stop",
            stopReason: choice.finish_reason === "tool_calls" ? "tool_use" : choice.finish_reason,
            usage: { input_tokens: parsed.usage?.prompt_tokens ?? 0, output_tokens: parsed.usage?.completion_tokens ?? 0 },
          };
          toolCalls.clear();
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export { streamChatVercel as streamChatBackend };
