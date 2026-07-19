/**
 * Frontend IPC bridge for SQLite database operations.
 * All data is persisted via Bun's SQLite process.
 */

function getBridge(): { postMessage: (msg: unknown) => void } | null {
  return (window as any).__electrobunBunBridge ?? null;
}

function sendAndWait(type: string, payload: Record<string, unknown>, responseType: string, timeout = 10000): Promise<any> {
  return new Promise((resolve, reject) => {
    const bridge = getBridge();
    if (!bridge) {
      reject(new Error("No Bun process available"));
      return;
    }
    const requestId = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const timer = setTimeout(() => {
      if ((window as any).__electrobun?.receiveMessageFromBun) {
        const orig = (window as any).__electrobun.receiveMessageFromBun;
        (window as any).__electrobun.receiveMessageFromBun = (msg: any) => {
          if (msg?.requestId === requestId) return; // ignore after timeout
          if (orig) orig(msg);
        };
      }
      reject(new Error("Database operation timed out"));
    }, timeout);

    const origHandler = (window as any).__electrobun?.receiveMessageFromBun;
    const handler = (msg: any) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === responseType) {
        clearTimeout(timer);
        if ((window as any).__electrobun) {
          (window as any).__electrobun.receiveMessageFromBun = origHandler;
        }
        resolve(msg);
        return;
      }
      if (origHandler) origHandler(msg);
    };
    (window as any).__electrobun.receiveMessageFromBun = handler;

    bridge.postMessage(JSON.stringify({ requestId, type, ...payload }));
  });
}

export async function dbListProjects(): Promise<any[]> {
  const res = await sendAndWait("db-list-projects", {}, "db-list-projects-result");
  return res.projects ?? [];
}

export async function dbSaveProject(project: {
  id: string; name: string; width?: number; height?: number; fps?: number;
}): Promise<void> {
  await sendAndWait("db-save-project", project as any, "db-save-project-result");
}

export async function dbDeleteProject(id: string): Promise<void> {
  await sendAndWait("db-delete-project", { id }, "db-delete-project-result");
}

export async function dbUpdateProjectName(id: string, name: string): Promise<void> {
  await sendAndWait("db-update-project-name", { id, name }, "db-update-project-name-result");
}

export async function dbSaveProjectData(projectId: string, data: {
  timeline?: unknown; mediaManifest?: unknown; generationLog?: unknown; chatHistory?: unknown; thumbnail?: string;
}): Promise<void> {
  await sendAndWait("db-save-project-data", { projectId, ...data } as any, "db-save-project-data-result");
}

export async function dbLoadProjectData(id: string): Promise<{
  timeline: unknown; mediaManifest: unknown; generationLog: unknown; chatHistory: unknown;
} | null> {
  const res = await sendAndWait("db-load-project-data", { id }, "db-load-project-data-result");
  return res.data ?? null;
}

export async function dbDeleteProjectData(id: string): Promise<void> {
  await sendAndWait("db-delete-project-data", { id }, "db-delete-project-data-result");
}
