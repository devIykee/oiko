// Polls get_events and forwards new events as MCP notifications/message. The first poll only sets the cursor
// (no backlog flood); after that each new event is one notification with its title and suggested actions.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OikoBackend } from "./tools";

interface EventsResp { events: Array<{ id: string; type: string; at: string; title: string; suggested_actions: unknown[] }>; cursor: string }

export async function pollOnce(server: McpServer, backend: Pick<OikoBackend, "read">, cursor: string | null): Promise<string | null> {
  const r = (await backend.read("events", cursor ? { since: cursor } : {})) as EventsResp;
  if (cursor !== null && server.isConnected()) {
    for (const e of r.events) {
      await server.sendLoggingMessage({ level: "notice", logger: "oiko-events", data: { id: e.id, type: e.type, at: e.at, title: e.title, suggested_actions: e.suggested_actions } });
    }
  }
  return r.cursor ?? cursor;
}

export function startEventPoller(server: McpServer, backend: Pick<OikoBackend, "read">, everyMs: number): () => void {
  let cursor: string | null = null;
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      cursor = await pollOnce(server, backend, cursor);
    } catch (e) {
      console.error(`oiko-mcp: events poll failed: ${(e as Error).message}`);
    }
    if (!stopped) setTimeout(tick, everyMs).unref?.();
  };
  void tick();
  return () => { stopped = true; };
}
