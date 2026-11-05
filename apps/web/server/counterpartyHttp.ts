// HTTP glue for the counterparty check: public GET /api/counterparty/:accountId and agent POST /api/agent/report.
import { isVaultId, type Token } from "@oiko/sdk";
import { gatewayRequest, who } from "./agentHttp";
import { serverConfig } from "./config";
import { checkCounterparty, isValidAccountId, oikoAccounts, type CounterpartyDeps } from "./counterparty";
import { ApiError } from "./errors";
import { authenticateAgent, defaultDeps, logAccess, type AuthedAgent, type GatewayDeps } from "./gateway";
import { clientIp, errorResponse, json, parseBody, readText } from "./http";
import { checkLimits } from "./ratelimit";
import { ReportBody } from "./schemas";
import { store, type Store } from "./store";

/** GET /api/counterparty/:accountId?vault=&amount=&token= — public, rate limited. `vault` adds the prior-payment signal. */
export async function counterpartyPublic(req: Request, rawId: string, deps?: CounterpartyDeps): Promise<Response> {
  try {
    if (!checkLimits("counterparty", clientIp(req), null)) throw new ApiError("E_RATE_LIMIT", 429);
    const receiver = decodeURIComponent(rawId).trim().toLowerCase();
    const url = new URL(req.url);
    const vault = url.searchParams.get("vault");
    const amount = url.searchParams.get("amount");
    const token = url.searchParams.get("token");
    const result = await checkCounterparty({
      receiver,
      agentVault: vault && isVaultId(vault, serverConfig().oiko) ? vault : null,
      amount: amount && /^\d{1,39}$/.test(amount) ? amount : null,
      token: token === "usdc" || token === "usdt" ? (token as Token) : null,
    }, deps);
    return json({
      ...result,
      _help: "allow: nothing worrying found. warn: look closer before paying (agents must propose instead of paying). block: don't pay. This is advice on top of the account's on-chain limits, which are the hard guarantee.",
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Stores a report from an authenticated agent (one per reporting account per receiver). */
export async function fileReport(ctx: AuthedAgent, b: { receiver: string; reason: string; evidence: string }, s: Store = store(), isOiko: (id: string) => boolean = (x) => oikoAccounts().has(x)) {
  const receiver = b.receiver.trim().toLowerCase();
  if (!isValidAccountId(receiver)) throw new ApiError("E_BAD_REQUEST", 400, "receiver must be a NEAR account id.");
  if (isOiko(receiver) || receiver === ctx.vaultId) throw new ApiError("E_BAD_REQUEST", 400, "You can't report Oiko's own contracts or your own account.");
  const reason = b.reason.trim().slice(0, 280), evidence = b.evidence.trim().slice(0, 1000);
  if (reason.length < 8 || evidence.length < 4) throw new ApiError("E_BAD_REQUEST", 400, "A report needs a one-sentence reason and some evidence (URL, transaction hash or the text you received).");
  const stored = await s.addReport({ receiver, reason, evidence, reporter: `agent:${ctx.publicKey}`, reporterVault: ctx.vaultId, verified: true });
  return {
    ok: true, receiver, stored,
    note: stored ? "Thanks. The report is shared with every Oiko account's counterparty check." : "This account already reported that receiver; the first report stands.",
  };
}

/** POST /api/agent/report {receiver, reason, evidence} — an authenticated agent (scope read) reports a bad receiver. */
export async function agentReport(req: Request, opts: { gw?: GatewayDeps; store?: Store; isOiko?: (id: string) => boolean } = {}): Promise<Response> {
  const url = new URL(req.url);
  const id = who(req);
  let status = 200, code: string | null = null;
  try {
    if (!checkLimits("report", clientIp(req), id?.publicKey ?? null)) throw new ApiError("E_RATE_LIMIT", 429);
    const text = await readText(req, 8 * 1024);
    const b = parseBody(ReportBody, text);
    const ctx = await authenticateAgent(gatewayRequest(req, text), "read", opts.gw ?? defaultDeps());
    return json(await fileReport(ctx, b, opts.store ?? store(), opts.isOiko));
  } catch (e) {
    status = e instanceof ApiError ? e.status : 500;
    code = e instanceof ApiError ? e.code : "E_INTERNAL";
    return errorResponse(e);
  } finally {
    if (id) await logAccess({ ...id, method: "POST", path: url.pathname, status, code, tool: "report" }, opts.store);
  }
}
