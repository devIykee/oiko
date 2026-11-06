// Agent gateway: NEP-413 auth (docs/interfaces/http.md), read tools, prepare/submit for agent_execute/agent_propose.
import {
  AjoClient, b64decode, b64encode, billStatus, buildUnsignedTx, act, computeInsights, decodeSignedTx, formatAmount, friendlyError,
  GATEWAY_RECIPIENT, GATEWAY_WINDOW_MS, goalEta, isVaultId, monthOfMs, normalizePublicKey, parseGatewayAuthHeader, parseGatewayMessage,
  parseOutcome, prevMonth, sha256Hex, splitPreview, TGAS, verifyNep413, verifySignedTx, b58encode,
  type AgentAction, type AgentView, type Balances, type NearRpc, type Overview, type Pot, type Scope, type Token,
} from "@oiko/sdk";
import { sha256 } from "@noble/hashes/sha2.js";
import { encodeTransaction } from "near-api-js";
import { factsOfSignedTx, outcomeOf, type ActionFacts } from "./accessLog";
import { howToFix } from "./howToFix";
import { serverConfig } from "./config";
import { agentDecision, checkCounterparty, type CheckInput, type CounterpartyResult } from "./counterparty";
import { ApiError } from "./errors";
import { rpc } from "./near";
import { topup } from "./relayer";
import { earnRates } from "./rates";
import { store, type Store } from "./store";

export interface AuthedAgent { kind: "agent"; vaultId: string; publicKey: string; policy: AgentView }
export interface AuthedOwner { kind: "owner"; accountId: string; publicKey: string }

export interface GatewayDeps {
  now: () => number;
  store: Store;
  viewAccessKey: (accountId: string, publicKey: string) => Promise<{ nonce: number; permission: unknown } | null>;
  getAgent: (vaultId: string, publicKey: string) => Promise<AgentView | null>;
  isVaultId: (id: string) => boolean;
}

export function defaultDeps(): GatewayDeps {
  const r = rpc();
  const cfg = serverConfig();
  return {
    now: () => Date.now(),
    store: store(),
    viewAccessKey: (a, pk) => r.viewAccessKey(a, pk),
    getAgent: (v, pk) => r.view<AgentView | null>(v, "get_agent", { public_key: pk }),
    isVaultId: (id) => isVaultId(id, cfg.oiko),
  };
}

export interface GatewayRequest { method: string; path: string; body: string; authorization: string | null }

/** Shared signature/time/nonce checks. Returns the parsed header. */
async function verifyRequest(req: GatewayRequest, deps: GatewayDeps) {
  const auth = parseGatewayAuthHeader(req.authorization);
  if (!auth) throw new ApiError("E_AUTH", 401, "Missing or malformed Authorization: NEP413 header.");
  const m = parseGatewayMessage(auth.message);
  if (!m) throw new ApiError("E_AUTH", 401, "The signed message must be \"<METHOD> <path>\\n<sha256 hex of body>\\n<unix ms>\".");
  if (m.method !== req.method.toUpperCase() || m.path !== req.path) throw new ApiError("E_AUTH", 401, `The signed message is for "${m.method} ${m.path}", not "${req.method.toUpperCase()} ${req.path}".`);
  if (m.bodyHash !== sha256Hex(req.body)) throw new ApiError("E_AUTH", 401, "The body hash in the signed message doesn't match the body.");
  const now = deps.now();
  if (Math.abs(now - m.timestamp) > GATEWAY_WINDOW_MS) throw new ApiError("E_STALE", 401);
  let publicKey: string;
  try {
    publicKey = normalizePublicKey(auth.publicKey);
  } catch {
    throw new ApiError("E_AUTH", 401, "publicKey must be an ed25519 key.");
  }
  if (!verifyNep413({ publicKey, signature: auth.signature, message: auth.message, recipient: GATEWAY_RECIPIENT, nonce: auth.nonce })) {
    throw new ApiError("E_AUTH", 401, "The NEP-413 signature doesn't verify (recipient must be \"oiko-gateway\").");
  }
  if (!(await deps.store.useNonce(`${publicKey}:${auth.nonce}`, publicKey, m.timestamp + 2 * GATEWAY_WINDOW_MS))) throw new ApiError("E_REPLAY", 401);
  return { auth, publicKey };
}

function fcReceiver(permission: unknown): string | null {
  const p = permission as { FunctionCall?: { receiver_id?: string } } | string;
  return typeof p === "object" && p?.FunctionCall?.receiver_id ? p.FunctionCall.receiver_id : null;
}

export function requiredScope(path: string, kind?: "propose" | "act"): Scope {
  if (path.startsWith("/api/agent/prepare") || path.startsWith("/api/agent/submit")) return kind ?? "propose";
  return "read";
}

/** Agent auth: the key must still be on the vault (view_access_key) and the vault's policy must allow the scope. */
export async function authenticateAgent(req: GatewayRequest, scope: Scope | null, deps: GatewayDeps = defaultDeps()): Promise<AuthedAgent> {
  const { auth, publicKey } = await verifyRequest(req, deps);
  return authorizeAgentKey(auth.accountId, publicKey, scope, deps);
}

/** The on-chain half of agent auth, run on EVERY request (NEP-413 or bearer session): the key must still exist on the
 *  vault (so Disconnect, which deletes it, ends access at once), and the agent policy must be live and in scope. */
export async function authorizeAgentKey(vaultId: string, publicKey: string, scope: Scope | null, deps: GatewayDeps = defaultDeps()): Promise<AuthedAgent> {
  if (!deps.isVaultId(vaultId)) throw new ApiError("E_AUTH", 401, "accountId must be the Oiko account (vault.<name>.<root>) the agent is connected to.");
  const key = await deps.viewAccessKey(vaultId, publicKey);
  if (!key) throw new ApiError("E_KEY_GONE", 401);
  const recv = fcReceiver(key.permission);
  if (recv !== null && recv !== vaultId) throw new ApiError("E_KEY_GONE", 401);
  const policy = await deps.getAgent(vaultId, publicKey);
  if (!policy) throw new ApiError("E_AGENT_UNKNOWN", 403);
  if (policy.revoked) throw new ApiError("E_AGENT_REVOKED", 403);
  if (BigInt(policy.expires_at) <= BigInt(deps.now()) * 1_000_000n) throw new ApiError("E_AGENT_EXPIRED", 403);
  if (scope && !policy.scopes.includes(scope)) throw new ApiError("E_SCOPE", 403, `This agent doesn't have the "${scope}" permission. The owner can change it in Agents.`);
  return { kind: "agent", vaultId, publicKey, policy };
}

/** Owner auth (access log, push): NEP-413 by a key on the owner's name account (the app key or the sign-in key). */
export async function authenticateOwner(req: GatewayRequest, deps: GatewayDeps = defaultDeps()): Promise<AuthedOwner> {
  const { auth, publicKey } = await verifyRequest(req, deps);
  if (deps.isVaultId(auth.accountId)) throw new ApiError("E_AUTH", 401, "Sign with the owner's account, not the vault.");
  const key = await deps.viewAccessKey(auth.accountId, publicKey);
  if (!key) throw new ApiError("E_KEY_GONE", 401);
  return { kind: "owner", accountId: auth.accountId, publicKey };
}

// ---------- read tools ----------

const DAY_NS = 86_400_000_000_000n;
const WEEK_NS = 7n * DAY_NS;
const money = (units: string, token: Token | "usdc+usdt") => ({
  units, token: token === "usdc+usdt" ? "USDC+USDT" : token.toUpperCase(), display: `${formatAmount(units)} ${token === "usdc+usdt" ? "USDC + USDT" : token.toUpperCase()}`,
});
const bal = (b: Balances) => ({ usdc: money(b.usdc, "usdc"), usdt: money(b.usdt, "usdt"), total: money((BigInt(b.usdc) + BigInt(b.usdt)).toString(), "usdc+usdt") });
const KIND_LABEL: Record<string, string> = { flex: "Spend", autosave: "Savings", locked: "Locked", goal: "Goal", bills: "Bills" };

export function remainingCaps(p: AgentView, nowMs: number) {
  const ns = BigInt(nowMs) * 1_000_000n;
  const day = Number(ns / DAY_NS), week = Number(ns / WEEK_NS);
  const usedDay = p.spent_day[0] === day ? BigInt(p.spent_day[1]) : 0n;
  const usedWeek = p.spent_week[0] === week ? BigInt(p.spent_week[1]) : 0n;
  const left = (cap: string, used: bigint) => (BigInt(cap) > used ? BigInt(cap) - used : 0n).toString();
  return {
    per_tx: money(p.per_tx, "usdc+usdt"),
    day: { cap: money(p.daily, "usdc+usdt"), used: money(usedDay.toString(), "usdc+usdt"), remaining: money(left(p.daily, usedDay), "usdc+usdt") },
    week: { cap: money(p.weekly, "usdc+usdt"), used: money(usedWeek.toString(), "usdc+usdt"), remaining: money(left(p.weekly, usedWeek), "usdc+usdt") },
  };
}

function potView(p: Pot, nowMs: number) {
  return {
    id: p.id, name: p.name, kind: p.kind, kind_label: KIND_LABEL[p.kind] ?? p.kind, balances: bal(p.balances), earning: bal(p.earn_supplied),
    locked_until: p.unlock_at && BigInt(p.unlock_at) > BigInt(nowMs) * 1_000_000n ? new Date(Number(BigInt(p.unlock_at) / 1_000_000n)).toISOString() : null,
    target: p.target ? money(p.target, "usdc+usdt") : null, target_date: p.target_date ? new Date(Number(BigInt(p.target_date) / 1_000_000n)).toISOString() : null,
    earn: p.earn,
  };
}

export const HELP = {
  money: "Every amount is { units: integer string in base units (6 decimals), token, display }. 1 USDC = 1000000 units. USDC and USDT are stablecoins, not dollars.",
  pots: "Pots split the owner's money. Spend (kind flex, id 0) is spendable now; Locked pots cannot send money out before locked_until; Goals have targets.",
  splits: "Your plan: rules applied to every incoming payment, in order. percent value is basis points (2500 = 25%); fixed value is units. Spend gets the rest.",
  caps: "Caps are enforced by the account's contract, per payment, per UTC day and per week, with USDC and USDT summed.",
  act: "To move money: POST /api/agent/prepare {kind:'act'|'propose', action, reason}, sign the returned unsignedTx bytes' sha256 with your key, POST /api/agent/submit {signedTx}.",
};

export async function readTool(ctx: AuthedAgent, tool: string, params: Record<string, string | undefined>, r: NearRpc = rpc(), nowMs = Date.now(), check: CounterpartyChecker = defaultChecker): Promise<unknown> {
  const v = ctx.vaultId;
  const ov = () => r.view<Overview>(v, "get_overview");
  switch (tool) {
    case "me": {
      const p = ctx.policy;
      return {
        _help: "Your own permissions and how much of your limits is left. " + HELP.caps,
        vault: v, public_key: ctx.publicKey, label: p.label, agent_name: p.agent_name, scopes: p.scopes, allowed_actions: p.allowed_actions,
        allowlist: p.allowlist, expires_at: new Date(Number(BigInt(p.expires_at) / 1_000_000n)).toISOString(), caps: remainingCaps(p, nowMs),
      };
    }
    case "overview": {
      const o = await ov();
      return {
        _help: { money: HELP.money, pots: HELP.pots, splits: HELP.splits, act: HELP.act },
        owner: o.owner, totals: bal(o.totals), spend_available: bal(o.flex), locked: bal(o.locked), earning: bal(o.earning),
        pots: o.pots.map((p) => potView(p, nowMs)),
        goals: o.pots.filter((p) => p.kind === "goal").map((p) => potView(p, nowMs)),
        splits: o.splits.map((s) => ({ ...s, pot_name: o.pots.find((p) => p.id === s.pot_id)?.name ?? null })),
        bills: o.bills.map((b) => ({ id: b.id, name: b.name, amount: money(b.amount, b.token), due_day: b.due_day, payee: b.payee, pot_id: b.pot_id, ...statusOf(b, nowMs) })),
        my_pending_proposals: o.proposals.filter((p) => p.public_key === ctx.publicKey),
        my_caps: remainingCaps(ctx.policy, nowMs),
      };
    }
    case "pots": {
      const o = await ov();
      return { _help: HELP.pots + " " + HELP.money, pots: o.pots.map((p) => potView(p, nowMs)) };
    }
    case "activity": {
      const limit = Math.max(1, Math.min(100, Number(params.limit ?? 20) || 20));
      const rows = await r.view<Array<Record<string, unknown>>>(v, "get_activity", { from_seq: null, limit });
      return {
        _help: "Newest first. kind is the event name; by says who did it (owner, agent:<key>, schedule, proposal:<id>). amount is in units (6 decimals).",
        activity: rows.map((a) => ({ ...a, at_iso: typeof a.at === "string" ? new Date(Number(BigInt(a.at) / 1_000_000n)).toISOString() : null, display: a.amount && a.token ? money(a.amount as string, a.token as Token).display : null })),
      };
    }
    case "goals": {
      const [o, acts] = await Promise.all([ov(), r.view<import("@oiko/sdk").Activity[]>(v, "get_activity", { from_seq: null, limit: 200 })]);
      return {
        _help: "Goals with targets and an estimated finish date from the last 30 days of money coming in (the assumption is stated).",
        goals: o.pots.filter((p) => p.kind === "goal" || p.target).map((p) => {
          const eta = goalEta(p, acts, nowMs);
          return { ...potView(p, nowMs), eta: eta.etaMs === null ? null : new Date(eta.etaMs).toISOString(), assumption: eta.assumption };
        }),
      };
    }
    case "splits": {
      const o = await ov();
      return {
        _help: HELP.splits,
        rules: o.splits.map((s) => ({ ...s, pot_name: o.pots.find((p) => p.id === s.pot_id)?.name ?? null })),
        preview_for_100: splitPreview(o.splits, "100000000", o.pots).map((x) => ({ ...x, display: `${formatAmount(x.amount)}` })),
      };
    }
    case "bills": {
      const bills = await r.view<import("@oiko/sdk").Bill[]>(v, "get_bills");
      return {
        _help: "Recurring bills. status: upcoming, due (within 3 days or today), paid (this month), missed. Pay with action {type:'pay_bill', bill_id}.",
        bills: bills.map((b) => ({ id: b.id, name: b.name, amount: money(b.amount, b.token), due_day: b.due_day, payee: b.payee, pot_id: b.pot_id, last_paid_month: b.last_paid_month, ...statusOf(b, nowMs) })),
      };
    }
    case "insights": {
      const month = params.month && /^\d{6}$/.test(params.month) ? Number(params.month) : monthOfMs(nowMs);
      let from = month;
      for (let i = 0; i < 5; i++) from = prevMonth(from);
      const [stats, acts] = await Promise.all([
        r.view<import("@oiko/sdk").MonthStats[]>(v, "get_month_stats", { from_month: from, to_month: month }),
        r.view<import("@oiko/sdk").Activity[]>(v, "get_activity", { from_seq: null, limit: 200 }),
      ]);
      const ins = computeInsights(stats, acts, month);
      return {
        _help: `Insights for ${month} (yyyymm, UTC). savings_rate_bps = saved / money in × 10000. top_payees is from the last 200 activity rows.`,
        month, money_in: bal(ins.moneyIn), money_out: bal(ins.moneyOut), saved: bal(ins.saved), savings_rate_bps: ins.savingsRateBps,
        top_payees: ins.topPayees.map((p) => ({ to: p.to, amount: money(p.amount, "usdc+usdt") })), trend: ins.trend,
      };
    }
    case "counterparty": {
      let action: AgentAction;
      if (params.bill_id !== undefined && /^\d+$/.test(params.bill_id)) action = { type: "pay_bill", bill_id: Number(params.bill_id) };
      else if (params.to) action = { type: "pay", to: params.to.trim().toLowerCase(), token: params.token === "usdc" ? "usdc" : "usdt", amount: params.amount && /^\d{1,39}$/.test(params.amount) ? params.amount : "0", memo: null };
      else throw new ApiError("E_BAD_REQUEST", 400, "Give ?to=<account>&amount=<units>&token=usdc|usdt, or ?bill_id=<id>.");
      const pay = await resolvePayment(ctx, action, r);
      const result = await check({ agentVault: ctx.vaultId, agentPublicKey: ctx.publicKey, receiver: pay!.receiver, amount: pay!.amount === "0" ? null : pay!.amount, token: pay!.token });
      const onList = onAllowlist(ctx, pay!.receiver);
      const a = agentDecision(result, "act", onList), p = agentDecision(result, "propose", onList);
      return {
        _help: "Counterparty check. verdict allow: fine to act. warn: don't act, use propose so the owner approves. block: don't pay at all and tell the owner. The account's contract still enforces your allowlist and caps.",
        ...result, on_allowlist: onList,
        decision: { act: a.ok ? "allowed" : "refused", propose: p.ok ? "allowed" : "refused", message: a.ok ? a.note ?? "OK to act." : a.message },
      };
    }
    case "invoices": {
      const { agentInvoices, invoiceDeps } = await import("./invoicesHttp");
      return agentInvoices(v, invoiceDeps());
    }
    case "events": {
      const { loadEvents } = await import("./agentEvents");
      const { eventsSince } = await import("./events");
      const r2 = eventsSince(await loadEvents(v, ctx.policy, r, store(), nowMs), params.since);
      return {
        _help: "Things that happened or became true, oldest first. Pass cursor back as ?since= next time. Each event has deterministic suggested_actions computed by Oiko from the account right now: act (do it within your caps), propose (money, owner approves), propose_change (non-money, owner approves), tell_owner. autopilot marks a rule the owner turned on in advance. You decide what to do.",
        ...r2,
      };
    }
    case "brief": {
      const { monthBrief } = await import("./brief");
      const month = params.month && /^\d{6}$/.test(params.month) ? Number(params.month) : monthOfMs(nowMs);
      let from = month;
      for (let i = 0; i < 2; i++) from = prevMonth(from);
      const [stats, acts, o] = await Promise.all([
        r.view<import("@oiko/sdk").MonthStats[]>(v, "get_month_stats", { from_month: from, to_month: month }),
        r.view<import("@oiko/sdk").Activity[]>(v, "get_activity", { from_seq: null, limit: 200 }),
        ov(),
      ]);
      return monthBrief(month, stats, acts, o, nowMs, ctx.policy);
    }
    case "changes": {
      const { listChanges } = await import("./changes");
      const rows = await listChanges(v, { store: store(), now: () => nowMs, overview: () => ov() }, { publicKey: ctx.publicKey });
      return { _help: "Your non-money proposals (plan, pots, locks, Earn, bills, schedules, draft invoices) and whether the owner approved them. Propose new ones with propose_change.", changes: rows };
    }
    case "autopilot": {
      const { getAutopilot } = await import("./agentEvents");
      const { webhookStatus } = await import("./webhooks");
      return {
        _help: "Autopilot rules the owner turned on. When one is due, get_events returns an autopilot_due (or bill_due_today) event whose suggested_actions carry autopilot: <rule>; run them with act inside your caps. If you can't act, propose instead.",
        autopilot: await getAutopilot(store(), v), webhook: await webhookStatus(store(), v, ctx.publicKey),
      };
    }
    case "earn-rates":
      return { _help: "Variable lending rates today (supplyApr is a percent). Rates change and can go to zero.", ...(await earnRates()) };
    case "rosca":
    case "ajo": {
      const ajo = serverConfig().oiko.contracts.ajo;
      const help = "ROSCA savings groups this account is in: rotating savings where members contribute each round and one member receives the pot. Amounts in units (6 decimals).";
      if (!ajo || !serverConfig().features.ajo) return { _help: "ROSCA savings are not enabled here.", groups: [], circles: [] };
      const groups = await new AjoClient(r, ajo).circlesFor(v).catch(() => []);
      return { _help: help, groups, circles: groups };
    }
    default:
      throw new ApiError("E_NOT_FOUND", 404);
  }
}
function statusOf(b: import("@oiko/sdk").Bill, nowMs: number) {
  const s = billStatus(b, nowMs);
  return { status: s.status, next_due: s.nextDue.toISOString() };
}

// ---------- prepare / submit ----------

// 100 Tgas covers a transfer plus its callback. NEAR reserves prepaid gas at a pessimistic price,
// so keeping this low keeps the NEAR an account must hold low too.
export const AGENT_GAS = (100n * TGAS).toString();

// ---------- counterparty pre-flight ----------

export type CounterpartyChecker = (input: CheckInput) => Promise<CounterpartyResult>;
const defaultChecker: CounterpartyChecker = (i) => checkCounterparty(i);

/** Who an action pays and how much (pay, pay_bill); null for moves between the owner's own pots. */
export async function resolvePayment(ctx: AuthedAgent, action: AgentAction, r: NearRpc): Promise<{ receiver: string; amount: string; token: Token } | null> {
  if (action.type === "pay") return { receiver: action.to, amount: action.amount, token: action.token };
  if (action.type === "pay_bill") {
    const bills = await r.view<import("@oiko/sdk").Bill[]>(ctx.vaultId, "get_bills");
    const b = bills.find((x) => x.id === action.bill_id);
    if (!b) throw new ApiError("E_BAD_REQUEST", 400, `There is no bill with id ${action.bill_id}. Read get_bills first.`);
    return { receiver: b.payee, amount: b.amount, token: b.token };
  }
  return null;
}
export function onAllowlist(ctx: AuthedAgent, receiver: string): boolean {
  return ctx.policy.allowlist.some((x) => x.type === "near" && x.account_id === receiver);
}

/**
 * Runs the counterparty check for pay / pay_bill. block refuses act and propose (E_COUNTERPARTY_BLOCKED);
 * warn refuses act (E_COUNTERPARTY_WARN, use propose) unless agentDecision's narrow allowlist exception applies.
 */
export async function enforceCounterparty(ctx: AuthedAgent, kind: "propose" | "act", action: AgentAction, r: NearRpc, check: CounterpartyChecker = defaultChecker) {
  const pay = await resolvePayment(ctx, action, r);
  if (!pay) return null;
  const result = await check({ agentVault: ctx.vaultId, agentPublicKey: ctx.publicKey, receiver: pay.receiver, amount: pay.amount, token: pay.token });
  const d = agentDecision(result, kind, onAllowlist(ctx, pay.receiver));
  if (!d.ok) throw new ApiError(d.code, d.code === "E_COUNTERPARTY_BLOCKED" ? 403 : 409, d.message, { counterparty: result, ...(d.code === "E_COUNTERPARTY_WARN" ? { next: "propose" } : {}) });
  return { result, note: d.note };
}

export async function prepare(ctx: AuthedAgent, kind: "propose" | "act", action: AgentAction, reason: string | undefined, r: NearRpc = rpc(), check: CounterpartyChecker = defaultChecker) {
  if (!ctx.policy.scopes.includes(kind)) throw new ApiError("E_SCOPE", 403, `This agent doesn't have the "${kind}" permission.`);
  if (kind === "propose" && !reason?.trim()) throw new ApiError("E_BAD_REQUEST", 400, "A proposal needs a short reason (up to 280 characters) the owner will read.");
  const cp = await enforceCounterparty(ctx, kind, action, r, check);
  const method = kind === "act" ? "agent_execute" : "agent_propose";
  const args = kind === "act" ? { action } : { action, reason: reason!.trim() };
  // Make sure the account can pay for the agent's transaction (relayer top-up, rate limited, best effort).
  await topup(ctx.vaultId, "gateway").catch((e) => console.warn("[oiko] agent top-up skipped", (e as Error).message));
  const u = await buildUnsignedTx(r, ctx.vaultId, ctx.publicKey, ctx.vaultId, [act.functionCall(method, args, AGENT_GAS, 0n)]);
  return { unsignedTx: b64encode(u.bytes), hash: b64encode(u.hash), ...(cp ? { counterparty: cp.result, ...(cp.note ? { counterparty_note: cp.note } : {}) } : {}) };
}

/** The receiver of a signed agent_execute {type:"pay"} (for the access log's prior-interaction signal); null otherwise. */
export function payReceiverOfSignedTx(signedTx: string): string | null {
  try {
    const t = decodeSignedTx(b64decode(signedTx)).transaction;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fc = (t.actions[0] as any)?.functionCall as { methodName: string; args: Uint8Array | number[] } | undefined;
    if (!fc || fc.methodName !== "agent_execute") return null;
    // borsh decodes Vec<u8> as a plain number[]
    const a = JSON.parse(new TextDecoder().decode(Uint8Array.from(fc.args))) as { action?: { type?: string; to?: string } };
    return a.action?.type === "pay" && typeof a.action.to === "string" ? a.action.to : null;
  } catch {
    return null;
  }
}

/** Validates that a signed tx is exactly one agent_execute/agent_propose call by this agent on its vault. */
export function checkAgentTx(ctx: AuthedAgent, signedTx: string) {
  let stx;
  try {
    stx = decodeSignedTx(b64decode(signedTx));
  } catch {
    throw new ApiError("E_BAD_REQUEST", 400, "signedTx must be a base64 borsh SignedTransaction.");
  }
  const t = stx.transaction;
  if (t.signerId !== ctx.vaultId || t.receiverId !== ctx.vaultId) throw new ApiError("E_AUTH", 403, "The transaction must be signed by and sent to your connected account.");
  if (t.publicKey.toString() !== ctx.publicKey) throw new ApiError("E_AUTH", 403, "The transaction must be signed with the same agent key.");
  if (t.actions.length !== 1) throw new ApiError("E_BAD_REQUEST", 400, "Exactly one action is allowed.");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fc = (t.actions[0] as any).functionCall as { methodName: string; deposit: bigint | string } | undefined;
  if (!fc || !["agent_execute", "agent_propose"].includes(fc.methodName)) throw new ApiError("E_BAD_REQUEST", 400, "Only agent_execute or agent_propose calls are allowed.");
  if (BigInt(fc.deposit) !== 0n) throw new ApiError("E_BAD_REQUEST", 400, "No deposit is allowed.");
  const need: Scope = fc.methodName === "agent_execute" ? "act" : "propose";
  if (!ctx.policy.scopes.includes(need)) throw new ApiError("E_SCOPE", 403, `This agent doesn't have the "${need}" permission.`);
  if (!verifySignedTx(stx)) throw new ApiError("E_AUTH", 401, "The transaction signature doesn't verify.");
  return { stx, method: fc.methodName, txHash: b58encode(sha256(encodeTransaction(t))) };
}

export async function submit(ctx: AuthedAgent, signedTx: string, r: NearRpc = rpc()) {
  const { txHash } = checkAgentTx(ctx, signedTx);
  try {
    const out = parseOutcome(await r.sendTx(b64encode(b64decode(signedTx))), txHash);
    if (out.ok) return { txHash: out.txHash, ok: true, value: out.value };
    const f = friendlyError(out.errorMessage ?? out.errorCode ?? "");
    return { txHash: out.txHash, ok: false, error: { code: f.code, message: `${f.title} ${f.next}`, detail: out.errorMessage, how_to_fix: howToFix(f.code, ctx.policy, factsOfSignedTx(signedTx)) } };
  } catch (e) {
    const f = friendlyError((e as Error).message);
    return { txHash, ok: false, error: { code: f.code, message: `${f.title} ${f.next}`, detail: (e as Error).message.slice(0, 300), how_to_fix: howToFix(f.code, ctx.policy, factsOfSignedTx(signedTx)) } };
  }
}

export interface LogRow { vaultId: string; publicKey: string; method: string; path: string; status: number; code?: string | null; tool?: string | null; txHash?: string | null; receiver?: string | null; facts?: ActionFacts }
/** Writes one access-log row with what was tried (action, amount, payee) and the outcome. Never throws. */
export async function logAccess(row: LogRow, s: Store = store()) {
  const f = row.facts;
  const outcome = outcomeOf({ tool: row.tool, status: row.status, code: row.code, method: f?.method ?? row.method, path: row.path });
  await s.logAccess({
    vaultId: row.vaultId, publicKey: row.publicKey, method: row.method, path: row.path, status: row.status, code: row.code ?? null, tool: row.tool ?? null,
    txHash: row.txHash ?? null, receiver: row.receiver ?? null, amount: f?.amount ?? null, token: f?.token ?? null, actionType: f?.type ?? null, outcome,
  }).catch((e) => console.warn("[oiko] access log write failed", e));
}
