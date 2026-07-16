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
    const eb = (window as any).__electrobun;
    if (!eb) return;

    const bridge = (window as any).__electrobunBunBridge;
    if (!bridge) return;

    const prev = eb.receiveMessageFromBun;
    eb.receiveMessageFromBun = (msg: unknown) => {
      try {
        const data = typeof msg === "string" ? JSON.parse(msg) : msg;

        if (data?.type === "mcp-tool-call") {
          const { requestId, toolName, args } = data as MCPToolCallMessage;

          // Execute async — don't block the message handler
          executeTool(toolName, args ?? {})
            .then((result) => {
              const response: MCPToolResultMessage = {
                type: "mcp-tool-result",
                requestId,
                result,
                isError: false,
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

    return () => {
      eb.receiveMessageFromBun = prev;
    };
  }, []);
}
