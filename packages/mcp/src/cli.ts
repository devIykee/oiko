#!/usr/bin/env node
// oiko-mcp: stdio MCP server. Env: OIKO_CONNECTION=oiko1:… or OIKO_AGENT_KEY + OIKO_VAULT_ID + OIKO_API_URL.
// OIKO_EVENTS_POLL_SECONDS (default 60, 0 = off): poll Oiko for new events and send each as an MCP
// notifications/message (logger "oiko-events"), so clients that show notifications hear about them without asking.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { publicKeyFromSecretKey } from "@oiko/sdk";
import { connectionFromEnv } from "./env";
import { GatewayBackend } from "./gatewayBackend";
import { createOikoMcpServer } from "./server";
import { startEventPoller } from "./events";

async function main() {
  const conn = connectionFromEnv();
  const backend = new GatewayBackend(conn);
  const server = createOikoMcpServer(backend);
  await server.connect(new StdioServerTransport());
  // stdout is the MCP channel; log to stderr only.
  console.error(`oiko-mcp: connected to ${conn.vault} via ${conn.api} as ${publicKeyFromSecretKey(conn.sk)}`);
  const secs = Number(process.env.OIKO_EVENTS_POLL_SECONDS ?? 60);
  if (secs > 0) startEventPoller(server, backend, Math.max(15, secs) * 1000);
}

main().catch((e) => {
  console.error(`oiko-mcp: ${(e as Error).message}`);
  process.exit(1);
});
