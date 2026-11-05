import { handleMcp } from "@/server/mcp";

// Remote MCP clients that only accept a URL (no custom headers): the hosted session token is the last path segment.
// Short-lived (<= 24 h) and re-checked on chain on every request; treat the URL like a password.
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  return handleMcp(req, (await ctx.params).token);
}
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  return handleMcp(req, (await ctx.params).token);
}
