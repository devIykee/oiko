// HTTP glue for /api/agent/* (framework-free: takes a web Request, returns a Response).
import { describeRow, factsOfAction, factsOfSignedTx, outcomeOf, reasonOf, type ActionFacts, type Outcome } from "./accessLog";
import { parseGatewayAuthHeader, normalizePublicKey } from "@oiko/sdk";
import { ApiError } from "./errors";
import { authenticateAgent, authenticateOwner, logAccess, payReceiverOfSignedTx, prepare, readTool, submit, type GatewayRequest } from "./gateway";
import { clientIp, errorResponse, json, parseBody, readText } from "./http";
import { checkLimits } from "./ratelimit";
import { PrepareBody, SubmitBody } from "./schemas";
import { store } from "./store";

export function gatewayRequest(req: Request, body: string): GatewayRequest {
  const url = new URL(req.url);
  return { method: req.method, path: url.pathname + url.search, body, authorization: req.headers.get("authorization") };
}
export function who(req: Request): { vaultId: string; publicKey: string } | null {
  const a = parseGatewayAuthHeader(req.headers.get("authorization"));
  if (!a) return null;
  try {
    return { vaultId: a.accountId, publicKey: normalizePublicKey(a.publicKey) };
  } catch {
    return null;
  }
}

/** GET /api/agent/<tool> */
export async function agentRead(req: Request, tool: string): Promise<Response> {
  const url = new URL(req.url);
  const id = who(req);
  let status = 200, code: string | null = null;
  try {
    if (!checkLimits("gateway", clientIp(req), id?.publicKey ?? null)) throw new ApiError("E_RATE_LIMIT", 429);
    const ctx = await authenticateAgent(gatewayRequest(req, ""), "read");
    const params = Object.fromEntries(url.searchParams.entries());
    return json(await readTool(ctx, tool, params));
  } catch (e) {
    status = e instanceof ApiError ? e.status : 500;
    code = e instanceof ApiError ? e.code : "E_INTERNAL";
    return errorResponse(e);
  } finally {
    if (id) await logAccess({ ...id, method: "GET", path: url.pathname + url.search, status, code, tool });
  }
}

/** POST /api/agent/prepare and /api/agent/submit */
export async function agentWrite(req: Request, op: "prepare" | "submit"): Promise<Response> {
  const url = new URL(req.url);
  const id = who(req);
  let status = 200, code: string | null = null, txHash: string | null = null, receiver: string | null = null;
  let facts: ActionFacts | undefined;
  try {
    if (!checkLimits("gateway", clientIp(req), id?.publicKey ?? null)) throw new ApiError("E_RATE_LIMIT", 429);
    const text = await readText(req);
    if (op === "prepare") {
      const b = parseBody(PrepareBody, text);
      facts = factsOfAction(b.action, b.kind === "act" ? "agent_execute" : "agent_propose");
      const ctx = await authenticateAgent(gatewayRequest(req, text), b.kind);
      return json(await prepare(ctx, b.kind, b.action, b.reason));
    }
    const b = parseBody(SubmitBody, text);
    facts = factsOfSignedTx(b.signedTx);
    const ctx = await authenticateAgent(gatewayRequest(req, text), null);
    const r = await submit(ctx, b.signedTx);
    txHash = r.txHash;
    if (!r.ok) code = r.error?.code ?? null;
    else receiver = payReceiverOfSignedTx(b.signedTx);
    return json(r);
  } catch (e) {
    status = e instanceof ApiError ? e.status : 500;
    code = e instanceof ApiError ? e.code : "E_INTERNAL";
    return errorResponse(e);
  } finally {
    if (id) await logAccess({ ...id, method: "POST", path: url.pathname, status, code, tool: op, txHash, receiver: receiver ?? facts?.receiver ?? null, facts });
  }
}

/** GET /api/agent/log?vaultId=&publicKey= — owner only (NEP-413 by a key on the owner's name account). */
export async function agentLog(req: Request): Promise<Response> {
  try {
    if (!checkLimits("gateway", clientIp(req), null)) throw new ApiError("E_RATE_LIMIT", 429);
    const owner = await authenticateOwner(gatewayRequest(req, ""));
    const url = new URL(req.url);
    const vaultId = url.searchParams.get("vaultId") ?? `vault.${owner.accountId}`;
    if (vaultId !== `vault.${owner.accountId}`) throw new ApiError("E_UNAUTHORIZED", 403, "You can only read your own account's access log.");
    const pk = url.searchParams.get("publicKey");
    const s = store();
    const raw = await s.listAccess(vaultId, pk ? normalizePublicKey(pk) : null, 200);
    // Owner-facing: what was tried, the outcome, and the reason in plain words.
    const rows = raw.map((r) => {
      const outcome = (r.outcome as Outcome | null) ?? outcomeOf({ tool: r.tool, status: r.status, code: r.code, path: r.path, method: r.method });
      return { ...r, outcome, summary: describeRow({ tool: r.tool, type: r.actionType, amount: r.amount, token: r.token, receiver: r.receiver }), reason: reasonOf(outcome, r.code) };
    });
    return json({ vaultId, storage: s.kind, ...(s.kind === "memory" ? { note: "In-memory log: it resets when the server restarts." } : {}), rows });
  } catch (e) {
    return errorResponse(e);
  }
}
