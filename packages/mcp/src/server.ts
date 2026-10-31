import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerOikoTools, type OikoBackend } from "./tools";

export const MCP_INSTRUCTIONS = `Oiko is a personal finance app. You are connected to one person's Oiko account as their agent, with limits they set.
- Read first (get_overview). Amounts are base units with 6 decimals plus a ticker; say "120.50 USDT", never use "$" or "dollars".
- You can only do what your permissions allow. The account's contract enforces caps, allowlist and expiry; a refusal is final — explain it and offer to propose instead.
- Use propose for anything the owner should decide. Give a short, honest reason.
- Never move money out of a locked pot; it is impossible before its date.`;

export function createOikoMcpServer(backend: OikoBackend, version = "0.1.0"): McpServer {
  const server = new McpServer({ name: "oiko", version }, { instructions: MCP_INSTRUCTIONS });
  registerOikoTools(server, backend);
  return server;
}
