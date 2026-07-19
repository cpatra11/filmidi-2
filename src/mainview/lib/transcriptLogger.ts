export type TranscriptLogLevel = "debug" | "info" | "warn" | "error";

function stringifyDetail(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function logTranscript(
  level: TranscriptLogLevel,
  scope: string,
  message: string,
  details?: unknown,
) {
  const bridge = (window as any).__electrobunBunBridge;
  const payload = {
    level,
    scope,
    message,
    details,
    timestamp: new Date().toISOString(),
  };

  if (bridge) {
    bridge.postMessage(JSON.stringify({ type: "transcript-log", payload }));
    return;
  }

  const line = `[${payload.timestamp}] [${level}] [${scope}] ${message}${details === undefined ? "" : ` ${stringifyDetail(details)}`}`;
  const logger = console[level] ?? console.log;
  logger.call(console, line);
}
