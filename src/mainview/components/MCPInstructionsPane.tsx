import { useEffect, useState } from "react";
import { Copy, Check, ChevronDown, ChevronRight } from "lucide-react";

const MCP_PORT = 19790;
const MCP_URL = `http://127.0.0.1:${MCP_PORT}/mcp`;

function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="relative group">
      {label && (
        <div className="text-xs text-white/40 mb-1">{label}</div>
      )}
      <div className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-lg font-mono text-sm text-white/80">
        <code className="flex-1 break-all">{code}</code>
        <button
          onClick={handleCopy}
          className="flex-shrink-0 p-1 rounded hover:bg-white/10 transition-colors"
        >
          {copied ? (
            <Check size={14} className="text-green-400" />
          ) : (
            <Copy size={14} className="text-white/40" />
          )}
        </button>
      </div>
    </div>
  );
}

function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border border-white/10 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 transition-colors text-left"
      >
        {isOpen ? (
          <ChevronDown size={14} className="text-white/40" />
        ) : (
          <ChevronRight size={14} className="text-white/40" />
        )}
        <span className="text-sm font-medium text-white/80">{title}</span>
      </button>
      {isOpen && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

export function MCPInstructionsPane() {
  const [status, setStatus] = useState<"checking" | "online" | "offline">("checking");

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${MCP_PORT}/health`, { cache: "no-store" });
        if (!cancelled) setStatus(response.ok ? "online" : "offline");
      } catch {
        if (!cancelled) setStatus("offline");
      }
    };
    void check();
    const timer = setInterval(check, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-2">MCP Server</h2>
        <p className="text-sm text-white/60">
          Filmidi Pro exposes your open project as an MCP server, allowing AI
          assistants to inspect and edit your timeline.
        </p>
      </div>

      {/* Server URL */}
      <div>
        <h3 className="text-sm font-medium text-white/80 mb-2">Server URL</h3>
        <CodeBlock code={MCP_URL} />
        <div className="mt-2 flex items-center gap-2 text-xs text-white/50">
          <span className={`h-2 w-2 rounded-full ${status === "online" ? "bg-emerald-400" : status === "offline" ? "bg-red-400" : "bg-yellow-400"}`} />
          {status === "online" ? "MCP server is running" : status === "offline" ? "MCP server is not reachable" : "Checking MCP server..."}
        </div>
      </div>

      {/* Cursor */}
      <div>
        <h3 className="text-sm font-medium text-white/80 mb-2">Cursor</h3>
        <a
          href={`cursor://install-mcp?name=filmidi-pro&url=${encodeURIComponent(MCP_URL)}`}
          className="inline-flex items-center gap-2 px-3 py-1.5 bg-white/10 hover:bg-white/15 rounded-lg text-sm text-white/80 transition-colors mb-2"
        >
          Install in Cursor
        </a>
        <CollapsibleSection title="Manual configuration">
          <div className="mt-2 space-y-2">
            <p className="text-xs text-white/50">
              Add to your Cursor MCP settings:
            </p>
            <CodeBlock
              code={JSON.stringify(
                {
                  mcpServers: {
                    "filmidi-pro": {
                      url: MCP_URL,
                    },
                  },
                },
                null,
                2
              )}
            />
          </div>
        </CollapsibleSection>
      </div>

      {/* Claude Desktop */}
      <div>
        <h3 className="text-sm font-medium text-white/80 mb-2">
          Claude Desktop
        </h3>
        <CollapsibleSection title="Manual configuration">
          <div className="mt-2 space-y-2">
            <p className="text-xs text-white/50">
              Add to your Claude Desktop MCP config:
            </p>
            <CodeBlock
              code={JSON.stringify(
                {
                  mcpServers: {
                    "filmidi-pro": {
                      command: "npx",
                      args: [
                        "mcp-remote",
                        MCP_URL,
                      ],
                    },
                  },
                },
                null,
                2
              )}
            />
          </div>
        </CollapsibleSection>
      </div>

      {/* Claude Code */}
      <div>
        <h3 className="text-sm font-medium text-white/80 mb-2">
          Claude Code
        </h3>
        <CodeBlock
          code={`claude mcp add --transport http filmidi-pro ${MCP_URL}`}
        />
      </div>

      {/* Codex */}
      <div>
        <h3 className="text-sm font-medium text-white/80 mb-2">Codex</h3>
        <CodeBlock
          code={`codex mcp add filmidi-pro --url ${MCP_URL}`}
        />
      </div>
    </div>
  );
}
