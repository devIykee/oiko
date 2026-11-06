// MCP over streamable HTTP (stateless) at POST /api/mcp. Each request carries the agent's NEP-413 Authorization header.
import { createOikoMcpServer, type AgentActionInput, type ConfigChangeInput, type OikoBackend, type ReadTool } from "oiko-mcp/internal";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { normalizePublicKey, parseGatewayAuthHeader } from "@oiko/sdk";
import { serverConfig } from "./config";
import { ApiError } from "./errors";
import { fileReport } from "./counterpartyHttp";
import { factsOfAction, factsOfSignedTx } from "./accessLog";
import { authenticateToken } from "./agentSession";
import { authenticateAgent, logAccess, payReceiverOfSignedTx, prepare, readTool, submit, type AuthedAgent } from "./gateway";
import { clientIp, errorResponse, json, readText } from "./http";
import { withHowToFix } from "./howToFix";
import { store } from "./store";
import { checkLimits } from "./ratelimit";

class InProcessBackend implements OikoBackend {
  readonly canSign = false;
  constructor(private readonly ctx: AuthedAgent) {}
  async read(tool: ReadTool, params: Record<string, string> = {}) {
    if (!this.ctx.policy.scopes.includes("read")) throw withHowToFix(new ApiError("E_SCOPE", 403, "This agent doesn't have the \"read\" permission."), this.ctx.policy);
    const r = await readTool(this.ctx, tool, params).catch((e) => { throw withHowToFix(e, this.ctx.policy); });
    await logAccess({ vaultId: this.ctx.vaultId, publicKey: this.ctx.publicKey, method: "MCP", path: `/api/mcp#${tool}`, status: 200, tool });
    return r;
  }
  async report(receiver: string, reason: string, evidence: string) {
    const r = await fileReport(this.ctx, { receiver, reason, evidence });
    await logAccess({ vaultId: this.ctx.vaultId, publicKey: this.ctx.publicKey, method: "MCP", path: "/api/mcp#report_counterparty", status: 200, tool: "report" });
    return r;
  }
  async proposeChange(change: ConfigChangeInput, reason: string) {
    const { proposeChange } = await import("./changes");
    const { rpc } = await import("./near");
    let status = 200, code: string | null = null;
    try {
      return await proposeChange(this.ctx, change, reason, { store: store(), now: () => Date.now(), overview: (v) => rpc().view(v, "get_overview") });
    } catch (e) {
      status = e instanceof ApiError ? e.status : 500;
      code = e instanceof ApiError ? e.code : "E_INTERNAL";
      throw withHowToFix(e, this.ctx.policy);
    } finally {
      await logAccess({ vaultId: this.ctx.vaultId, publicKey: this.ctx.publicKey, method: "MCP", path: "/api/mcp#propose_change", status, code, tool: "propose_change" });
    }
  }
  async setWebhook(url: string | null) {
    const { checkWebhookUrl, registerWebhook, webhookKey } = await import("./webhooks");
    await logAccess({ vaultId: this.ctx.vaultId, publicKey: this.ctx.publicKey, method: "MCP", path: "/api/mcp#set_webhook", status: 200, tool: "webhook" });
    if (url === null) {
      await store().deleteSetting(webhookKey(this.ctx.vaultId, this.ctx.publicKey));
      return { ok: true, removed: true };
    }
    return registerWebhook(store(), this.ctx.vaultId, this.ctx.publicKey, checkWebhookUrl(url, serverConfig().network === "local"), Date.now());
  }
  async run(kind: "propose" | "act", action: AgentActionInput, reason?: string, signedTx?: string) {
    if (!signedTx) {
      // prepare runs the counterparty check (block / warn refusals carry the reasons).
      const facts = factsOfAction(action, kind === "act" ? "agent_execute" : "agent_propose");
      let p: Awaited<ReturnType<typeof prepare>>;
      try {
        p = await prepare(this.ctx, kind, action, reason);
      } catch (e) {
        await logAccess({ vaultId: this.ctx.vaultId, publicKey: this.ctx.publicKey, method: "MCP", path: `/api/mcp#${kind}`, status: e instanceof ApiError ? e.status : 500, code: e instanceof ApiError ? e.code : "E_INTERNAL", tool: "prepare", facts });
        throw withHowToFix(e, this.ctx.policy, facts);
      }
      await logAccess({ vaultId: this.ctx.vaultId, publicKey: this.ctx.publicKey, method: "MCP", path: `/api/mcp#${kind}`, status: 200, tool: "prepare", facts });
      return {
        needs_signature: true, unsigned_tx: p.unsignedTx, hash: p.hash, ...(p.counterparty ? { counterparty: p.counterparty } : {}),
        how: "Sign the 32-byte hash (sha256 of unsigned_tx bytes) with your ed25519 agent key, build a borsh SignedTransaction, base64 it and call this tool again with signed_tx. @oiko/sdk signTransactionBytes() does this.",
      };
    }
    const r = await submit(this.ctx, signedTx);
    await logAccess({ vaultId: this.ctx.vaultId, publicKey: this.ctx.publicKey, method: "MCP", path: `/api/mcp#${kind}`, status: r.ok ? 200 : 422, code: r.ok ? null : r.error?.code, tool: kind, txHash: r.txHash, receiver: r.ok ? payReceiverOfSignedTx(signedTx) : null, facts: factsOfSignedTx(signedTx) });
    if (!r.ok) throw Object.assign(new Error(r.error?.message ?? "That didn't go through."), { code: r.error?.code, how_to_fix: r.error?.how_to_fix });
    return { ok: true, txHash: r.txHash, value: r.value };
  }
}

/** POST /api/mcp. Auth: NEP-413 per request (stdio/SDK agents), or a hosted session token from POST /api/agent/session
 *  as `Authorization: Bearer <token>` or in the URL (/api/mcp/t/<token>) for remote MCP clients that only take a URL.
 *  Either way the key + policy are re-checked on chain on every request, and propose/act still need the agent's own
 *  signature: without signed_tx the tools return the unsigned transaction and how to sign it. */
export async function handleMcp(req: Request, urlToken?: string): Promise<Response> {
  if (!serverConfig().features.mcp) return errorResponse(new ApiError("E_DISABLED", 404));
  if (req.method !== "POST") {
    return json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed: this MCP endpoint is stateless; use POST." }, id: null }, 405, { allow: "POST" });
  }
  const url = new URL(req.url);
  const authz = req.headers.get("authorization");
  const bearer = urlToken ?? (/^Bearer\s+(\S+)$/i.exec(authz?.trim() ?? "")?.[1] ?? null);
  const a = bearer ? null : parseGatewayAuthHeader(authz);
  try {
    if (!checkLimits("gateway", clientIp(req), a?.publicKey ?? (bearer ? `session:${bearer.slice(-16)}` : null))) throw new ApiError("E_RATE_LIMIT", 429);
    const text = await readText(req, 256 * 1024);
    const ctx = bearer
      ? await authenticateToken(bearer, null)
      : await authenticateAgent({ method: "POST", path: url.pathname + url.search, body: text, authorization: authz }, null);
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
