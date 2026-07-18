import { createAnthropic } from "@ai-sdk/anthropic";
import { streamText, isStepCount } from "ai";

// ─── Tool Definition (matches frontend format) ─────────────────
interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

// ─── Frontend AgentMessage (matches frontend format) ────────────
interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolUse?: Array<{
    id: string;
    name: string;
    inputJSON: string;
    result?: { content: string; isError: boolean };
  }>;
  mentions?: Array<{
    type: string;
    id: string;
    name: string;
    imageDataUrl?: string;
  }>;
  timestamp: number;
}

// ─── Tool execution relay ──────────────────────────────────────
interface PendingTool {
  resolve: (result: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pendingToolResults = new Map<string, PendingTool>();

export function resolveToolResult(
  toolResultId: string,
  result: string,
  isError?: boolean,
) {
  const pending = pendingToolResults.get(toolResultId);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingToolResults.delete(toolResultId);
  if (isError) pending.reject(new Error(result));
  else pending.resolve(result);
}

function relayToTool(
  toolName: string,
  input: unknown,
  send: (msg: any) => void,
  requestId: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const toolResultId = crypto.randomUUID();
    const timer = setTimeout(() => {
      pendingToolResults.delete(toolResultId);
      reject(new Error(`Tool "${toolName}" timed out after 120s`));
    }, 120_000);

    pendingToolResults.set(toolResultId, { resolve, reject, timer });

    send({
      type: "exec-tool",
      requestId,
      toolResultId,
      toolName,
      input,
    });
  });
}

// ─── Build relay tools (each tool → relays to frontend) ───────
function buildRelayTools(
  toolDefs: ToolDef[],
  send: (msg: any) => void,
  requestId: string,
): Record<string, any> {
  const tools: Record<string, any> = {};

  for (const def of toolDefs) {
    tools[def.name] = {
      description: def.description,
      parameters: def.input_schema,
      execute: async (args: unknown) => {
        const result = await relayToTool(def.name, args, send, requestId);
        return result;
      },
    };
  }

  return tools;
}

// ─── Message conversion: frontend → AI SDK ─────────────────────
function toSDKMessages(
  sessionMessages: AgentMessage[],
  userMessage: AgentMessage,
  context: { timeline: string; media: string },
): Array<{ role: "user" | "assistant" | "tool"; content: any }> {
  const result: Array<{ role: "user" | "assistant" | "tool"; content: any }> = [];

  // Inject context as first user message (like current buildQwenMessages)
  result.push({
    role: "user",
    content: [
      {
        type: "text",
        text: `[Timeline context]\n${context.timeline}\n\n[Media library]\n${context.media}`,
      },
    ],
  });

  for (const msg of sessionMessages) {
    if (msg.role === "system") continue;

    if (msg.role === "user") {
      const blocks: any[] = [];

      // Image mentions
      if (msg.mentions && msg.mentions.length > 0) {
        for (const m of msg.mentions) {
          if (m.imageDataUrl && m.type === "mediaAsset") {
            blocks.push({
              type: "image",
              image: m.imageDataUrl,
            });
          }
        }
        blocks.push({
          type: "text",
          text: `[The user referenced the following media inline — do not call inspect_media for them: ${msg.mentions.filter((m) => m.imageDataUrl).map((m) => m.name).join(", ")}]`,
        });
      }

      blocks.push({ type: "text", text: msg.content });
      result.push({ role: "user", content: blocks });
      continue;
    }

    // Assistant messages: separate tool-call and tool-result parts
    const assistantBlocks: any[] = [];
    const toolResultParts: any[] = [];

    if (msg.content) {
      assistantBlocks.push({ type: "text", text: msg.content });
    }
    if (msg.toolUse) {
      for (const tool of msg.toolUse) {
        if (tool.result) {
          // Tool results go in separate "tool" role messages
          let output: any;
          try {
            output = JSON.parse(tool.result.content);
            output = { type: "json", value: output };
          } catch {
            output = { type: "text", text: tool.result.content };
          }
          toolResultParts.push({
            type: "tool-result",
            toolCallId: tool.id,
            toolName: tool.name,
            output,
          });
        } else {
          // Tool calls go in the assistant message (use "input" not "args")
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(tool.inputJSON);
          } catch {}
          assistantBlocks.push({
            type: "tool-call",
            toolCallId: tool.id,
            toolName: tool.name,
            input,
          });
        }
      }
    }

    // Emit assistant message with text + tool-call parts only
    if (assistantBlocks.length > 0) {
      result.push({ role: "assistant", content: assistantBlocks });
    }

    // Emit tool results as a separate "tool" role message
    if (toolResultParts.length > 0) {
      result.push({ role: "tool", content: toolResultParts });
    }
  }

  // Add the new user message
  result.push({
    role: "user",
    content: [{ type: "text", text: userMessage.content }],
  });

  return result;
}

// ─── Message conversion: AI SDK steps → frontend AgentMessage ──
function stepsToAgentMessages(steps: any[]): AgentMessage[] {
  const messages: AgentMessage[] = [];

  for (const step of steps) {
    const content: string = step.text || "";
    const stepContent: any[] = step.content || [];

    const toolCalls = stepContent.filter((p: any) => p.type === "tool-call");
    const toolResults = stepContent.filter((p: any) => p.type === "tool-result");

    const toolUse = toolCalls.map((tc: any) => {
      const matchingResult = toolResults.find(
        (tr: any) => tr.toolCallId === tc.toolCallId,
      );
      return {
        id: tc.toolCallId,
        name: tc.toolName,
        inputJSON: JSON.stringify(tc.input),
        result: matchingResult
          ? {
              content:
                typeof matchingResult.output === "string"
                  ? matchingResult.output
                  : JSON.stringify(matchingResult.output),
              isError: false,
            }
          : undefined,
      };
    });

    if (content || toolUse.length > 0) {
      messages.push({
        id:
          Math.random().toString(36).slice(2, 10) +
          Date.now().toString(36),
        role: "assistant",
        content,
        toolUse: toolUse.length > 0 ? toolUse : undefined,
        timestamp: Date.now(),
      });
    }
  }

  return messages;
}

// ─── Main agent loop entry point ───────────────────────────────
export interface AgentLoopParams {
  requestId: string;
  sessionMessages: AgentMessage[];
  userMessage: AgentMessage;
  context: { timeline: string; media: string };
  toolDefs: ToolDef[];
  system: string;
  modelId: string;
  apiKey: string;
  send: (msg: any) => void;
}

export async function runAgentLoop(params: AgentLoopParams) {
  const {
    requestId,
    sessionMessages,
    userMessage,
    context,
    toolDefs,
    system,
    modelId,
    apiKey,
    send,
  } = params;

  try {
    const anthropic = createAnthropic({
      baseURL: "https://dashscope-intl.aliyuncs.com/apps/anthropic/v1",
      apiKey,
      headers: { "anthropic-version": "2023-06-01" },
    });

    const model = anthropic(modelId);
    const tools = buildRelayTools(toolDefs, send, requestId);
    const messages = toSDKMessages(sessionMessages, userMessage, context);

    const result = streamText({
      model,
      messages,
      system,
      tools,
      stopWhen: isStepCount(10),
      maxOutputTokens: 8192,
    });

    let finalText = "";

    for await (const part of result.stream) {
      // Forward event to frontend for real-time UI
      if (part.type === "text-delta") {
        finalText += part.text;
        send({
          type: "agent-event",
          requestId,
          event: {
            type: "text-delta",
            text: part.text,
          },
        });
      } else if (part.type === "tool-call") {
        send({
          type: "agent-event",
          requestId,
          event: {
            type: "tool-call",
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: part.input,
          },
        });
      } else if (part.type === "tool-result") {
        send({
          type: "agent-event",
          requestId,
          event: {
            type: "tool-result",
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            output:
              typeof part.output === "string"
                ? part.output
                : JSON.stringify(part.output),
          },
        });
      }
    }

    // Extract steps → convert to frontend AgentMessage[]
    const steps = await result.steps;
    const newMessages = stepsToAgentMessages(steps);

    send({
      type: "agent-done",
      requestId,
      newMessages,
      text: finalText,
    });
  } catch (err: any) {
    console.error("[aiAgent] Error:", err?.message ?? err);
    send({
      type: "agent-error",
      requestId,
      error: err?.message ?? String(err),
    });
  }
}
