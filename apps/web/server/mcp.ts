// MCP over streamable HTTP (stateless) at POST /api/mcp. Each request carries the agent's NEP-413 Authorization header.
import { createOikoMcpServer, type AgentActionInput, type OikoBackend, type ReadTool } from "@oiko/mcp";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { normalizePublicKey, parseGatewayAuthHeader } from "@oiko/sdk";
import { serverConfig } from "./config";
import { ApiError } from "./errors";
import { authenticateAgent, logAccess, prepare, readTool, submit, type AuthedAgent } from "./gateway";
import { clientIp, errorResponse, json, readText } from "./http";
import { checkLimits } from "./ratelimit";

class InProcessBackend implements OikoBackend {
  readonly canSign = false;
  constructor(private readonly ctx: AuthedAgent) {}
  async read(tool: ReadTool, params: Record<string, string> = {}) {
    if (!this.ctx.policy.scopes.includes("read")) throw new ApiError("E_SCOPE", 403, "This agent doesn't have the \"read\" permission.");
    const r = await readTool(this.ctx, tool, params);
    await logAccess({ vaultId: this.ctx.vaultId, publicKey: this.ctx.publicKey, method: "MCP", path: `/api/mcp#${tool}`, status: 200, tool });
    return r;
  }
  async run(kind: "propose" | "act", action: AgentActionInput, reason?: string, signedTx?: string) {
    if (!signedTx) {
      const p = await prepare(this.ctx, kind, action, reason);
      return {
        needs_signature: true, unsigned_tx: p.unsignedTx, hash: p.hash,
        how: "Sign the 32-byte hash (sha256 of unsigned_tx bytes) with your ed25519 agent key, build a borsh SignedTransaction, base64 it and call this tool again with signed_tx. @oiko/sdk signTransactionBytes() does this.",
      };
    }
    const r = await submit(this.ctx, signedTx);
    await logAccess({ vaultId: this.ctx.vaultId, publicKey: this.ctx.publicKey, method: "MCP", path: `/api/mcp#${kind}`, status: r.ok ? 200 : 422, code: r.ok ? null : r.error?.code, tool: kind, txHash: r.txHash });
    if (!r.ok) throw Object.assign(new Error(r.error?.message ?? "That didn't go through."), { code: r.error?.code });
    return { ok: true, txHash: r.txHash, value: r.value };
  }
}

export async function handleMcp(req: Request): Promise<Response> {
  if (!serverConfig().features.mcp) return errorResponse(new ApiError("E_DISABLED", 404));
  if (req.method !== "POST") {
    return json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed: this MCP endpoint is stateless; use POST." }, id: null }, 405, { allow: "POST" });
  }
  const url = new URL(req.url);
  const a = parseGatewayAuthHeader(req.headers.get("authorization"));
  try {
    if (!checkLimits("gateway", clientIp(req), a?.publicKey ?? null)) throw new ApiError("E_RATE_LIMIT", 429);
    const text = await readText(req, 256 * 1024);
    const ctx = await authenticateAgent({ method: "POST", path: url.pathname + url.search, body: text, authorization: req.headers.get("authorization") }, null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }, 400);
    }
    const server = createOikoMcpServer(new InProcessBackend(ctx));
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    // Rebuild the request (body already consumed) for the transport.
    const fwd = new Request(req.url, { method: "POST", headers: req.headers, body: text });
    const res = await transport.handleRequest(fwd, { parsedBody: parsed });
    return res;
  } catch (e) {
    if (a) {
      let pk = a.publicKey;
      try { pk = normalizePublicKey(a.publicKey); } catch { /* keep raw */ }
      await logAccess({ vaultId: a.accountId, publicKey: pk, method: "POST", path: "/api/mcp", status: e instanceof ApiError ? e.status : 500, code: e instanceof ApiError ? e.code : "E_INTERNAL", tool: "mcp" });
    }
    return errorResponse(e);
  }
}
