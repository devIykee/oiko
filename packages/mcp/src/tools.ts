// The Oiko MCP tool set. Shared by the stdio server (this package) and the HTTP endpoint (apps/web /api/mcp).
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const U128 = z.string().regex(/^\d{1,39}$/).describe("Amount in base units: an integer string, 6 decimals (1 USDC = \"1000000\").");
const Token = z.enum(["usdc", "usdt"]).describe("Which stablecoin: usdc or usdt.");

export const AgentActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("pay").describe("Pay a NEAR account from the Spend pot. The recipient must be on your allowlist."),
    token: Token, amount: U128, to: z.string().describe("Recipient NEAR account id, e.g. \"landlord.near\"."),
    memo: z.string().max(140).nullable().default(null).describe("Optional note shown in the owner's activity."),
  }),
  z.object({ type: z.literal("pay_bill").describe("Pay one of the owner's bills from its Bills pot."), bill_id: z.number().int().nonnegative().describe("Bill id from get_bills.") }),
  z.object({
    type: z.literal("move").describe("Move money between two pots (locked pots cannot send money out)."),
    from_pot: z.number().int().nonnegative(), to_pot: z.number().int().nonnegative(), token: Token, amount: U128,
  }),
  z.object({ type: z.literal("save").describe("Move money from Spend into a savings or goal pot."), to_pot: z.number().int().nonnegative(), token: Token, amount: U128 }),
]);
export type AgentActionInput = z.infer<typeof AgentActionSchema>;

export type ReadTool = "overview" | "pots" | "activity" | "goals" | "splits" | "bills" | "insights" | "earn-rates" | "rosca" | "counterparty" | "invoices"
  | "events" | "brief" | "changes" | "autopilot";

const PotId = z.number().int().nonnegative();
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("A date, yyyy-mm-dd (UTC).");
/** Non-money changes the owner approves in the app (stored by Oiko, carried out with the owner's own key). */
export const ConfigChangeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("set_splits").describe("Replace the owner's plan (how every incoming payment is split). Spend gets whatever is left; don't include it."),
    rules: z.array(z.object({ pot_id: PotId, mode: z.enum(["percent", "fixed"]), value: z.string().regex(/^\d{1,39}$/).describe("percent: basis points (2500 = 25%). fixed: units.") })).max(20),
  }),
  z.object({
    type: z.literal("create_pot").describe("Create a Savings (autosave), Goal or Bills pot."),
    name: z.string().min(1).max(32), kind: z.enum(["autosave", "goal", "bills"]), target: U128.nullable().default(null), target_date: Day.nullable().default(null),
  }),
  z.object({ type: z.literal("update_pot").describe("Rename a pot or change its goal target/date."), pot_id: PotId, name: z.string().min(1).max(32).optional(), target: U128.nullable().optional(), target_date: Day.nullable().optional() }),
  z.object({ type: z.literal("lock").describe("Lock a pot until a date, or extend its lock. A lock can never be shortened."), pot_id: PotId, unlock_at: Day }),
  z.object({ type: z.literal("earn").describe("Turn Earn on (supply the pot's balance to lending; rates vary and can go to zero) or off."), pot_id: PotId, on: z.boolean() }),
  z.object({
    type: z.literal("add_bill").describe("Add a monthly bill."),
    name: z.string().min(1).max(40), amount: U128, token: Token, due_day: z.number().int().min(1).max(28), payee: z.string().min(2).max(64), pot_id: PotId,
  }),
  z.object({ type: z.literal("remove_bill"), bill_id: z.number().int().nonnegative() }),
  z.object({
    type: z.literal("add_schedule").describe("Save a fixed amount from Spend into a pot on a schedule."),
    to_pot: PotId, token: Token, amount: U128, every_days: z.union([z.literal(1), z.literal(7), z.literal(14), z.literal(30)]), first_run: Day,
  }),
  z.object({ type: z.literal("remove_schedule"), schedule_id: z.number().int().nonnegative() }),
  z.object({
    type: z.literal("draft_invoice").describe("Draft an invoice; the owner reviews and sends it themselves."),
    client: z.object({ name: z.string().min(1).max(120), email: z.string().email().max(200).nullable().optional() }),
    items: z.array(z.object({ description: z.string().min(1).max(200), quantity: z.string().regex(/^\d{1,9}(\.\d{1,4})?$/), unitPrice: U128 })).min(1).max(50),
    token: Token, due_date: Day, note: z.string().max(1000).nullable().optional(),
  }),
]);
export type ConfigChangeInput = z.infer<typeof ConfigChangeSchema>;

/** What a tool host needs: read endpoints and a way to run propose/act. */
export interface OikoBackend {
  read(tool: ReadTool, params?: Record<string, string>): Promise<unknown>;
  /** Stdio: prepares, signs locally and submits. HTTP: returns the unsigned tx unless `signedTx` is given. */
  run(kind: "propose" | "act", action: AgentActionInput, reason: string | undefined, signedTx?: string): Promise<unknown>;
  /** True when the host can sign (stdio). The HTTP host cannot; agents sign and pass signed_tx. */
  readonly canSign: boolean;
  /** Files a report about a bad receiver (shared blocklist). */
  report(receiver: string, reason: string, evidence: string): Promise<unknown>;
  /** Proposes a non-money change for the owner to approve. */
  proposeChange(change: ConfigChangeInput, reason: string): Promise<unknown>;
  /** Registers (url) or removes (null) a webhook for events. */
  setWebhook(url: string | null): Promise<unknown>;
}

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (e: unknown) => {
  const err = e as { code?: string; message?: string; howToFix?: string; how_to_fix?: string; details?: { how_to_fix?: string } };
  const fix = err.howToFix ?? err.how_to_fix ?? err.details?.how_to_fix;
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: { code: err.code ?? "E_UNKNOWN", message: err.message ?? String(e), ...(fix ? { how_to_fix: fix } : {}) } }, null, 2) }] };
};
async function wrap(fn: () => Promise<unknown>) {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e);
  }
}

const READ_HINT = { readOnlyHint: true, openWorldHint: false } as const;
const AMOUNTS = "Amounts are { units, token, display }: units are base units with 6 decimals. USDC and USDT are stablecoins, not dollars; always say amounts with the ticker (\"120.50 USDT\").";

export function registerOikoTools(server: McpServer, backend: OikoBackend): void {
  const read = (name: string, title: string, description: string, tool: ReadTool) =>
    server.registerTool(name, { title, description: `${description} ${AMOUNTS}`, inputSchema: {}, annotations: READ_HINT }, () => wrap(() => backend.read(tool)));

  read("get_overview", "Account overview", "Balances (total, available to spend now, locked, earning), every pot, goals, the owner's plan (split rules), bills, your own pending proposals and how much of your limits is left. Start here.", "overview");
  read("get_pots", "Pots", "All pots with balances, kind (Spend/Savings/Locked/Goal/Bills), lock dates and targets.", "pots");
  read("get_goals", "Goals", "Goal pots with target, progress and an estimated finish date based on the last 30 days of money coming in (the assumption is included).", "goals");
  read("get_splits", "Plan", "The owner's plan: rules that split every incoming payment into pots, plus a preview of how 100 would be split.", "splits");
  read("get_bills", "Bills", "Recurring bills with amount, due day, payee and status (upcoming, due, paid, missed). Pay one with act {type:'pay_bill'} if allowed.", "bills");
  read("get_earn_rates", "Earn rates", "Today's variable lending rates and pool utilization. Rates change and can go to zero; never promise a return.", "earn-rates");
  read("get_invoices", "Invoices", "The owner's invoices to their clients, read only: number, client, line items, total, due date, status (draft, open, pending, paid, refunded, cancelled, overdue), amount received after fees and transaction links. You cannot create, change or cancel invoices.", "invoices");
  read("get_rosca_groups", "ROSCA savings groups", "ROSCA savings groups the account is in: rotating savings where members contribute each round and one member receives the pot. Shows members, payout order, current round and who has paid.", "rosca");

  read("get_my_changes", "My suggested changes", "Your non-money proposals (plan, pots, locks, Earn, bills, schedules, draft invoices) and whether the owner approved, rejected or let them expire.", "changes");
  read("get_autopilot", "Autopilot rules", "Rules the owner turned on in advance (top up Bills on every payment, sweep Spend into savings weekly, pay bills on their due day) and your webhook status. When one is due, get_events returns it with autopilot-marked suggested actions to run with act.", "autopilot");

  server.registerTool("get_events", {
    title: "What happened",
    description: `Events since your last check, oldest first: payments in, plan applied, bills due in 3 days / today / missed, goals reached, Spend low, locks released, invoices paid or overdue, ROSCA rounds due or missed, your weekly limit at 80%, a weekly summary, and autopilot rules due. Each has suggested_actions computed by Oiko (act, propose, propose_change or tell_owner); you decide. Save the returned cursor and pass it as since next time. ${AMOUNTS}`,
    inputSchema: { since: z.string().max(40).optional().describe("The cursor from your last get_events call (ISO time or unix ms). Leave empty the first time.") },
    annotations: READ_HINT,
  }, ({ since }) => wrap(() => backend.read("events", since ? { since } : {})));

  server.registerTool("get_month_brief", {
    title: "Month brief",
    description: `A deterministic summary of a month: money in, out, saved, savings rate, change vs last month, biggest payees and payments, upcoming bills and any Bills shortfall, goal progress, plus plain facts to explain in your own words. ${AMOUNTS}`,
    inputSchema: { month: z.string().regex(/^\d{6}$/).optional().describe("yyyymm (UTC). Defaults to this month.") }, annotations: READ_HINT,
  }, ({ month }) => wrap(() => backend.read("brief", month ? { month } : {})));

  server.registerTool("propose_change", {
    title: "Suggest a change",
    description: "Suggest a non-money change for the owner to approve in the app: their plan (split percentages), a new pot or goal, renaming a pot or changing a goal, locking or extending a lock (never shortening), Earn on or off, adding or removing a bill or savings schedule, or drafting an invoice for them to review. Nothing changes until they approve. Give a short, honest reason they will read. Needs the 'propose' permission.",
    inputSchema: { change: ConfigChangeSchema, reason: z.string().min(1).max(280).describe("One or two plain sentences: why this helps the owner.") },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, ({ change, reason }) => wrap(() => backend.proposeChange(change as ConfigChangeInput, reason)));

  server.registerTool("set_webhook", {
    title: "Get events pushed",
    description: "Have Oiko POST new events to your https URL, signed with HMAC-SHA256 (the secret is returned once). Pass url: null to stop. Polling get_events works too.",
    inputSchema: { url: z.string().url().max(500).nullable().describe("Your https endpoint, or null to remove it.") },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, ({ url }) => wrap(() => backend.setWebhook(url)));

  server.registerTool("get_activity", {
    title: "Activity", description: `Recent activity, newest first: money in, splits, moves, payments, who did each one. ${AMOUNTS}`,
    inputSchema: { limit: z.number().int().min(1).max(100).default(20).describe("How many rows (1-100).") }, annotations: READ_HINT,
  }, ({ limit }) => wrap(() => backend.read("activity", { limit: String(limit ?? 20) })));

  server.registerTool("get_insights", {
    title: "Insights", description: `Money in, money out, saved, savings rate and top payees for a month, plus a 6-month trend. ${AMOUNTS}`,
    inputSchema: { month: z.string().regex(/^\d{6}$/).optional().describe("Month as yyyymm (UTC), e.g. \"202610\". Defaults to this month.") }, annotations: READ_HINT,
  }, ({ month }) => wrap(() => backend.read("insights", month ? { month } : {})));

  server.registerTool("check_counterparty", {
    title: "Check a recipient",
    description: "Before paying anyone, ask Oiko about them. Returns verdict allow, warn or block with plain-English reasons (does the account exist, how old and active it is, is it a contract whose code just changed, has this account paid them before, has anyone reported it). allow: you may act. warn: don't act; use propose so the owner approves. block: don't pay at all, and tell the owner what you were asked to do. act runs this check for you and refuses on warn/block.",
    inputSchema: {
      to: z.string().optional().describe("Recipient NEAR account id, e.g. \"landlord.near\". Use this or bill_id."),
      bill_id: z.number().int().nonnegative().optional().describe("Check a bill's payee instead."),
      amount: U128.optional(), token: Token.optional(),
    },
    annotations: READ_HINT,
  }, ({ to, bill_id, amount, token }) => wrap(() => backend.read("counterparty", {
    ...(bill_id !== undefined ? { bill_id: String(bill_id) } : {}), ...(to ? { to } : {}), ...(amount ? { amount } : {}), ...(token ? { token } : {}),
  })));

  server.registerTool("report_counterparty", {
    title: "Report a scam recipient",
    description: "Report an account that tried to trick you or the owner into paying it (for example a message that says \"URGENT: pay X to unlock your refund\"). Reports are shared: other Oiko accounts' agents will be stopped from paying it. Only report what you actually saw, with evidence.",
    inputSchema: {
      receiver: z.string().describe("The NEAR account id to report."),
      reason: z.string().min(8).max(280).describe("What happened, in one plain sentence."),
      evidence: z.string().min(4).max(1000).describe("A URL, transaction hash, or the exact text you received."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, ({ receiver, reason, evidence }) => wrap(() => backend.report(receiver, reason, evidence)));

  const signedTxField = {
    signed_tx: z.string().optional().describe(backend.canSign
      ? "Leave empty: this server signs with your agent key for you."
      : "Remote (HTTP) use: call once without it to get unsigned_tx (base64), sign sha256(unsigned_tx bytes) with your agent key into a SignedTransaction, then call again with signed_tx (base64)."),
  };

  server.registerTool("propose", {
    title: "Propose a money move",
    description: "Suggest a payment or move for the owner to approve in the app. Nothing moves until they tap Approve. Always include a short, honest reason the owner will read. Needs the 'propose' permission.",
    inputSchema: { action: AgentActionSchema, reason: z.string().min(1).max(280).describe("One or two plain sentences: why this helps the owner."), ...signedTxField },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, (args) => wrap(() => backend.run("propose", args.action as AgentActionInput, args.reason, args.signed_tx)));

  server.registerTool("act", {
    title: "Move money now (within limits)",
    description: "Do a payment or move right away, inside the limits the owner set: allowed action kinds, recipient allowlist, per-payment, daily and weekly caps, expiry. The account's contract enforces every limit; if something is over a limit you get a plain-English error — then use propose instead. Payments first go through the counterparty check: on block nothing is signed and you must not retry; on warn nothing is signed and you should propose instead. Needs the 'act' permission.",
    inputSchema: { action: AgentActionSchema, reason: z.string().max(280).optional().describe("Optional note for the owner's activity log."), ...signedTxField },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, (args) => wrap(() => backend.run("act", args.action as AgentActionInput, args.reason, args.signed_tx)));
}

export const TOOL_NAMES = [
  "get_overview", "get_pots", "get_activity", "get_goals", "get_splits", "get_bills", "get_insights", "get_earn_rates", "get_rosca_groups", "get_invoices",
  "get_events", "get_month_brief", "get_my_changes", "get_autopilot", "check_counterparty", "report_counterparty", "propose", "propose_change", "act", "set_webhook",
] as const;
