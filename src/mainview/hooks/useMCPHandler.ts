import { useEffect } from "react";
import { executeTool } from "@/lib/toolExecutor";

interface MCPToolCallMessage {
  type: "mcp-tool-call";
  requestId: string;
  toolName: string;
  args: Record<string, unknown>;
}

interface MCPToolResultMessage {
  type: "mcp-tool-result";
  requestId: string;
  result: string;
  isError: boolean;
}

/**
 * Listens for MCP tool call messages from the Bun process,
 * executes them via toolExecutor, and sends results back.
 */
export function useMCPHandler() {
  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    const attach = () => {
      const eb = (window as any).__electrobun;
      const bridge = (window as any).__electrobunBunBridge;
      if (!eb || !bridge || cleanup) return;

      const prev = eb.receiveMessageFromBun;
      eb.receiveMessageFromBun = (msg: unknown) => {
      try {
        const data = typeof msg === "string" ? JSON.parse(msg) : msg;

        if (data?.type === "mcp-tool-call") {
          const { requestId, toolName, args } = data as MCPToolCallMessage;

          // Execute async — don't block the message handler
          executeTool(toolName, args ?? {})
            .then((result) => {
              let isError = false;
              try {
                const parsed = JSON.parse(result);
                isError = !!parsed?.error;
              } catch {
                // Non-JSON tool responses are successful text responses.
              }
              const response: MCPToolResultMessage = {
                type: "mcp-tool-result",
                requestId,
                result,
                isError,
              };
              bridge.postMessage(JSON.stringify(response));
            })
            .catch((error) => {
              const response: MCPToolResultMessage = {
                type: "mcp-tool-result",
                requestId,
                result: error instanceof Error ? error.message : String(error),
                isError: true,
              };
              bridge.postMessage(JSON.stringify(response));
            });

          return; // handled
        }
      } catch {
        // Non-JSON or unrecognized message — pass through
      }

      // Forward to the previous handler (if any)
      if (prev) {
        prev(msg);
      }
      };

      cleanup = () => {
        eb.receiveMessageFromBun = prev;
      };
    };

    attach();
    if (!cleanup) interval = setInterval(attach, 50);

    return () => {
      if (interval) clearInterval(interval);
      cleanup?.();
    };
  }, []);
}
