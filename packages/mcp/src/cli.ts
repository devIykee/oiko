#!/usr/bin/env node
// oiko-mcp: stdio MCP server. Env: OIKO_CONNECTION=oiko1:… or OIKO_AGENT_KEY + OIKO_VAULT_ID + OIKO_API_URL.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { publicKeyFromSecretKey } from "@oiko/sdk";
import { connectionFromEnv } from "./env";
import { GatewayBackend } from "./gatewayBackend";
import { createOikoMcpServer } from "./server";

async function main() {
  const conn = connectionFromEnv();
  const server = createOikoMcpServer(new GatewayBackend(conn));
  await server.connect(new StdioServerTransport());
  // stdout is the MCP channel; log to stderr only.
  console.error(`oiko-mcp: connected to ${conn.vault} via ${conn.api} as ${publicKeyFromSecretKey(conn.sk)}`);
}

main().catch((e) => {
  console.error(`oiko-mcp: ${(e as Error).message}`);
  process.exit(1);
});
