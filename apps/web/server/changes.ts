// Non-money proposals ("proposals for everything"): an agent proposes a plan/pot/lock/Earn/bill/schedule change or a
// draft invoice with a reason; it is stored off-chain; the owner approves in the app and the app key carries it out
// (changeCalls in @oiko/sdk). Money proposals stay on-chain (agent_propose).
import { randomBytes } from "node:crypto";
import { changeCalls, describeChange, validateChange, type ConfigChange, type Overview } from "@oiko/sdk";
import { z } from "zod";
import { ApiError } from "./errors";
import type { AuthedAgent } from "./gateway";
import { createInvoice, type InvoiceDeps } from "./invoicesHttp";
import type { Store } from "./store";

export const CHANGE_TTL_MS = 7 * 86_400_000;
export const MAX_PENDING_CHANGES = 20;

export type ChangeStatus = "pending" | "approved" | "rejected" | "expired";
export interface ChangeProposal {
  id: string;
  vaultId: string;
  publicKey: string;
  agentName: string;
  change: ConfigChange;
  reason: string;
  /** describeChange() at the time it was proposed. */
  summary: string;
  status: ChangeStatus;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  /** Transactions the app sent to carry it out (approve). */
  txHashes: string[];
  /** draft_invoice: the invoice created on approval. */
  invoiceId: string | null;
}

const U = z.string().regex(/^\d{1,39}$/, "must be an amount in units (integer string)");
const Tok = z.enum(["usdc", "usdt"]);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date yyyy-mm-dd");
const PotId = z.number().int().nonnegative();
export const ConfigChangeZ = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set_splits"), rules: z.array(z.object({ pot_id: PotId, mode: z.enum(["percent", "fixed"]), value: U })).max(20) }),
  z.object({ type: z.literal("create_pot"), name: z.string().trim().min(1).max(32), kind: z.enum(["autosave", "goal", "bills"]), target: U.nullable().default(null), target_date: Day.nullable().default(null) }),
  z.object({ type: z.literal("update_pot"), pot_id: PotId, name: z.string().trim().min(1).max(32).optional(), target: U.nullable().optional(), target_date: Day.nullable().optional() }),
  z.object({ type: z.literal("lock"), pot_id: PotId, unlock_at: Day }),
  z.object({ type: z.literal("earn"), pot_id: PotId, on: z.boolean() }),
  z.object({ type: z.literal("add_bill"), name: z.string().trim().min(1).max(40), amount: U, token: Tok, due_day: z.number().int().min(1).max(28), payee: z.string().min(2).max(64), pot_id: PotId }),
  z.object({ type: z.literal("remove_bill"), bill_id: z.number().int().nonnegative() }),
  z.object({ type: z.literal("add_schedule"), to_pot: PotId, token: Tok, amount: U, every_days: z.union([z.literal(1), z.literal(7), z.literal(14), z.literal(30)]), first_run: Day }),
  z.object({ type: z.literal("remove_schedule"), schedule_id: z.number().int().nonnegative() }),
  z.object({
    type: z.literal("draft_invoice"), client: z.object({ name: z.string().trim().min(1).max(120), email: z.string().trim().email().max(200).nullable().optional() }),
    items: z.array(z.object({ description: z.string().trim().min(1).max(200), quantity: z.string().regex(/^\d{1,9}(\.\d{1,4})?$/), unitPrice: U })).min(1).max(50),
    token: Tok, due_date: Day, note: z.string().trim().max(1000).nullable().optional(),
  }),
]);
export const ProposeChangeBody = z.object({ change: ConfigChangeZ, reason: z.string().trim().min(1, "add a short reason the owner will read").max(280) });
export const DecideChangeBody = z.object({
  decision: z.enum(["approve", "reject"]),
  /** approve: the transactions the app sent to carry the change out. */
  txHashes: z.array(z.string().max(64)).max(10).default([]),
});

export interface ChangeDeps { store: Store; now: () => number; overview: (vaultId: string) => Promise<Overview> }

const effective = (p: ChangeProposal, nowMs: number): ChangeProposal =>
  p.status === "pending" && Date.parse(p.expiresAt) <= nowMs ? { ...p, status: "expired" } : p;

/** For the owner and the agent: summary plus what the app will run (`calls`) when approved. */
export function changeView(p: ChangeProposal, ov: Overview | null, nowMs: number) {
  const e = effective(p, nowMs);
  return {
    ...e,
    calls: ov && e.status === "pending" ? changeCalls(e.change, ov, nowMs) : [],
    problem: ov && e.status === "pending" ? validateChange(e.change, ov, nowMs) : null,
  };
}

export async function proposeChange(ctx: AuthedAgent, change: ConfigChange, reason: string, deps: ChangeDeps) {
  if (!ctx.policy.scopes.includes("propose")) throw new ApiError("E_SCOPE", 403, "This agent doesn't have the \"propose\" permission.");
  const now = deps.now();
  const ov = await deps.overview(ctx.vaultId);
  const problem = validateChange(change, ov, now);
  if (problem) throw new ApiError("E_CHANGE_INVALID", 400, problem);
  if (change.type === "add_bill" && /\s/.test(change.payee)) throw new ApiError("E_CHANGE_INVALID", 400, "payee must be a NEAR account id.");
  const mine = (await deps.store.listChanges(ctx.vaultId, 200)).map((p) => effective(p, now)).filter((p) => p.publicKey === ctx.publicKey && p.status === "pending");
  if (mine.length >= MAX_PENDING_CHANGES) throw new ApiError("E_TOO_MANY_PROPOSALS", 409, `You already have ${MAX_PENDING_CHANGES} changes waiting for the owner.`);
  const p: ChangeProposal = {
    id: `chg_${randomBytes(9).toString("base64url")}`, vaultId: ctx.vaultId, publicKey: ctx.publicKey, agentName: ctx.policy.agent_name || ctx.policy.label,
    change, reason: reason.trim(), summary: describeChange(change, ov), status: "pending",
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + CHANGE_TTL_MS).toISOString(), decidedAt: null, txHashes: [], invoiceId: null,
  };
  await deps.store.putChange(p);
  return { ...changeView(p, ov, now), note: "The owner will see this in Oiko and can approve or reject it. Nothing changes until they approve." };
}

export async function listChanges(vaultId: string, deps: ChangeDeps, opts: { publicKey?: string; withOverview?: boolean } = {}) {
  const now = deps.now();
  const rows = (await deps.store.listChanges(vaultId, 200)).filter((p) => !opts.publicKey || p.publicKey === opts.publicKey);
  const ov = opts.withOverview && rows.some((r) => effective(r, now).status === "pending") ? await deps.overview(vaultId) : null;
  return rows.map((p) => changeView(p, ov, now));
}

/** Owner decision. Approve is recorded after the app has run `calls` with its key (draft_invoice: the server creates the draft here). */
export async function decideChange(ownerAccountId: string, id: string, body: z.infer<typeof DecideChangeBody>, deps: ChangeDeps, invoiceDeps?: InvoiceDeps) {
  const vaultId = `vault.${ownerAccountId}`;
  const now = deps.now();
  const raw = await deps.store.getChange(id);
  if (!raw || raw.vaultId !== vaultId) throw new ApiError("E_NOT_FOUND", 404, "We couldn't find that proposal.");
  const p = effective(raw, now);
  if (p.status !== "pending") throw new ApiError("E_PROPOSAL_CLOSED", 409, `This proposal is already ${p.status}.`);
  const next: ChangeProposal = { ...p, status: body.decision === "approve" ? "approved" : "rejected", decidedAt: new Date(now).toISOString(), txHashes: body.txHashes };
  if (body.decision === "approve" && p.change.type === "draft_invoice") {
    if (!invoiceDeps) throw new ApiError("E_CONFIG", 500);
    const c = p.change;
    const inv = await createInvoice(ownerAccountId, {
      fromName: ownerAccountId.split(".")[0]!, client: { name: c.client.name, email: c.client.email ?? null }, items: c.items, token: c.token,
      dueDate: c.due_date, note: c.note ?? null, state: "draft",
    }, invoiceDeps);
    next.invoiceId = inv.id;
  }
  await deps.store.putChange(next);
  return changeView(next, null, now);
}
