// Invoices: storage-backed operations and HTTP handlers (/api/invoices/*). Pure logic lives in invoices.ts.
// Create / edit / cancel / list / export need owner auth: NEP-413 signed by a key on the owner's name account
// (the app key), same as GET /api/agent/log. The public view (/api/invoices/:id) needs only the unguessable id.
import { nameFromAccount } from "@oiko/sdk";
import type { z } from "zod";
import { gatewayRequest } from "./agentHttp";
import { explorerBase, serverConfig } from "./config";
import { ApiError } from "./errors";
import { authenticateOwner, defaultDeps, type AuthedOwner, type GatewayDeps, type GatewayRequest } from "./gateway";
import { clientIp, errorResponse, json, parseBody, readText } from "./http";
import { depositAddress, intentStatusDetail, originToken, type IntentStatusDetail, type TokenGroup } from "./intents";
import {
  convertUnits, DECIMALS, deriveStatus, editable, invoiceNumber, invoicesCsv, invoiceTotal, newInvoiceId, ownerView, publicView, agentView,
  TERMINAL, todayUtc, type Invoice, type InvoicePayment,
} from "./invoices";
import { checkLimits } from "./ratelimit";
import { InvoiceBody, InvoicePatchBody } from "./schemas";
import { store, type Store } from "./store";

export interface InvoiceDeps {
  store: Store;
  now: () => number;
  explorer: string | null;
  status: (depositAddress: string, memo: string | null, ticket: string | null) => Promise<IntentStatusDetail>;
}
export function invoiceDeps(): InvoiceDeps {
  return { store: store(), now: () => Date.now(), explorer: explorerBase(serverConfig().network), status: intentStatusDetail };
}

/** Owner auth for invoices: NEP-413 by a key on an Oiko name account (not the vault, not an outside account). */
export async function authenticateInvoiceOwner(req: GatewayRequest, deps: GatewayDeps = defaultDeps()): Promise<AuthedOwner> {
  const owner = await authenticateOwner(req, deps);
  if (!deps.isVaultId(`vault.${owner.accountId}`)) throw new ApiError("E_UNAUTHORIZED", 403, "Sign with your Oiko account's key.");
  return owner;
}

// ---------- operations ----------

const MAX_TOTAL = 10n ** 15n; // 1,000,000,000.00 in base units: far above any real invoice, keeps numbers sane.

function checkTotal(items: Invoice["items"]) {
  const t = invoiceTotal(items);
  if (t <= 0n) throw new ApiError("E_BAD_AMOUNT", 400, "The invoice total must be more than 0. Check the prices.");
  if (t > MAX_TOTAL) throw new ApiError("E_BAD_AMOUNT", 400, "That total is too large. Check the prices.");
}

export async function createInvoice(owner: string, body: z.infer<typeof InvoiceBody>, deps: InvoiceDeps): Promise<Invoice> {
  checkTotal(body.items);
  const existing = await deps.store.listInvoices(owner);
  if (existing.length >= 500) throw new ApiError("E_LIMIT", 400, "You have 500 invoices. Export them, then cancel old drafts.");
  const max = existing.reduce((m, i) => Math.max(m, Number(i.number.replace(/\D/g, "")) || 0), 0);
  const now = new Date(deps.now()).toISOString();
  const inv: Invoice = {
    id: newInvoiceId(), number: invoiceNumber(max + 1), owner, fromName: body.fromName,
    client: { name: body.client.name, email: body.client.email || null },
    items: body.items.map((i) => ({ description: i.description, quantity: i.quantity, unitPrice: i.unitPrice })),
    token: body.token, issueDate: todayUtc(deps.now()), dueDate: body.dueDate, note: body.note || null, state: body.state,
    payments: [], createdAt: now, updatedAt: now,
  };
  await deps.store.putInvoice(inv);
  return inv;
}

async function loadOwned(owner: string, id: string, deps: InvoiceDeps): Promise<Invoice> {
  const inv = await deps.store.getInvoice(id);
  // Same answer for "not yours" and "doesn't exist".
  if (!inv || inv.owner !== owner) throw new ApiError("E_NOT_FOUND", 404, "We couldn't find that invoice.");
  return inv;
}

export async function updateInvoice(owner: string, id: string, patch: z.infer<typeof InvoicePatchBody>, deps: InvoiceDeps): Promise<Invoice> {
  const inv = await loadOwned(owner, id, deps);
  const d = deriveStatus(inv, deps.now());
  const changesContent = patch.fromName !== undefined || patch.client !== undefined || patch.items !== undefined || patch.token !== undefined || patch.dueDate !== undefined || patch.note !== undefined;
  if (changesContent && !editable(inv)) throw new ApiError("E_NOT_EDITABLE", 409, "Money is already on its way for this invoice, so it can't be changed. Cancel it and create a new one if needed.");
  if (patch.state === "cancelled") {
    if (d.status === "paid") throw new ApiError("E_NOT_EDITABLE", 409, "This invoice is paid, so it can't be cancelled.");
    if (d.inFlight) throw new ApiError("E_NOT_EDITABLE", 409, "A payment for this invoice is on its way. Wait until it arrives or is refunded.");
  }
  if (patch.state && patch.state !== "cancelled" && inv.state === "cancelled") throw new ApiError("E_NOT_EDITABLE", 409, "This invoice was cancelled. Create a new one.");
  if (patch.state === "draft" && inv.state === "open" && inv.payments.length > 0) throw new ApiError("E_NOT_EDITABLE", 409, "Someone has started paying this invoice, so it can't go back to a draft.");
  const next: Invoice = {
    ...inv,
    ...(patch.fromName !== undefined ? { fromName: patch.fromName } : {}),
    ...(patch.client !== undefined ? { client: { name: patch.client.name, email: patch.client.email || null } } : {}),
    ...(patch.items !== undefined ? { items: patch.items.map((i) => ({ description: i.description, quantity: i.quantity, unitPrice: i.unitPrice })) } : {}),
    ...(patch.token !== undefined ? { token: patch.token } : {}),
    ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
    ...(patch.note !== undefined ? { note: patch.note || null } : {}),
    ...(patch.state !== undefined ? { state: patch.state } : {}),
    updatedAt: new Date(deps.now()).toISOString(),
  };
  if (patch.items) checkTotal(next.items);
  // A token or amount change makes waiting deposit addresses stale: drop the ones nobody paid.
  if (patch.items || patch.token) next.payments = next.payments.filter((p) => p.status !== "PENDING_DEPOSIT" && p.status !== "FAILED");
  await deps.store.putInvoice(next);
  return next;
}

const RECHECK_MS = 4_000;
const GIVE_UP_MS = 24 * 3_600_000;

/** Refreshes the 1Click status of every unfinished deposit on the invoice; saves when anything changed. */
export async function refreshInvoice(inv: Invoice, deps: InvoiceDeps): Promise<Invoice> {
  const now = deps.now();
  let changed = false;
  const payments = await Promise.all(inv.payments.map(async (p): Promise<InvoicePayment> => {
    if (TERMINAL.includes(p.status)) return p;
    if (p.checkedAt && now - Date.parse(p.checkedAt) < RECHECK_MS) return p;
    if (p.status === "PENDING_DEPOSIT" && now - Date.parse(p.deadline) > GIVE_UP_MS) {
      changed = true;
      return { ...p, status: "FAILED", updatedAt: new Date(now).toISOString() };
    }
    let s: IntentStatusDetail;
    try {
      s = await deps.status(p.depositAddress, p.depositMemo, p.ticket);
    } catch (e) {
      console.warn("[oiko] invoice status refresh failed", (e as Error).message);
      return p;
    }
    changed = true;
    const at = new Date(now).toISOString();
    return {
      ...p, status: s.status, checkedAt: at, updatedAt: s.status !== p.status ? at : p.updatedAt,
      nearTxHashes: [...new Set([...p.nearTxHashes, ...s.nearTxHashes])],
      depositedAmount: s.depositedAmount ?? p.depositedAmount,
      receivedAmount: s.status === "SUCCESS" ? s.amountOut ?? p.amountOut : p.receivedAmount,
      completedAt: s.status === "SUCCESS" && !p.completedAt ? at : p.completedAt,
    };
  }));
  if (!changed) return inv;
  const next = { ...inv, payments };
  await deps.store.putInvoice(next);
  return next;
}

export async function listOwnerInvoices(owner: string, deps: InvoiceDeps): Promise<Invoice[]> {
  const all = await deps.store.listInvoices(owner);
  let budget = 20;
  return Promise.all(all.map((i) => (i.payments.some((p) => !TERMINAL.includes(p.status)) && budget-- > 0 ? refreshInvoice(i, deps) : i)));
}

export async function getPublicInvoice(id: string, deps: InvoiceDeps): Promise<Invoice> {
  const inv = await deps.store.getInvoice(id);
  if (!inv || inv.state === "draft") throw new ApiError("E_NOT_FOUND", 404, "We couldn't find that invoice. Check the link with the person who sent it.");
  return refreshInvoice(inv, deps);
}

export interface PayDeps extends InvoiceDeps {
  origin: (assetId: string) => Promise<TokenGroup | null>;
  quote: typeof depositAddress;
}
export function payDeps(): PayDeps {
  return { ...invoiceDeps(), origin: originToken, quote: depositAddress };
}

/** Deposit address for an invoice: the amount is what is left to pay, in the invoice's stablecoin, to the owner's account. */
export async function startInvoicePayment(input: { invoiceId: string; originAsset: string; refundTo: string }, deps: PayDeps) {
  let inv = await deps.store.getInvoice(input.invoiceId);
  if (!inv || inv.state === "draft") throw new ApiError("E_NOT_FOUND", 404, "We couldn't find that invoice. Check the link with the person who sent it.");
  inv = await refreshInvoice(inv, deps);
  const d = deriveStatus(inv, deps.now());
  if (d.status === "paid") throw new ApiError("E_INVOICE_PAID", 409, "This invoice is already paid. Nothing more to send.");
  if (d.status === "cancelled") throw new ApiError("E_INVOICE_CANCELLED", 409, "This invoice was cancelled. Ask the sender for a new one.");
  if (!d.payable) throw new ApiError("E_INVOICE_BUSY", 409, "A payment for this invoice is already on its way. Wait a few minutes and check again.");
  const origin = await deps.origin(input.originAsset);
  if (!origin || origin.symbol.toLowerCase() !== inv.token) throw new ApiError("E_BAD_TOKEN", 400, `This invoice is in ${inv.token.toUpperCase()}. Pick a ${inv.token.toUpperCase()} option.`);
  const name = nameFromAccount(inv.owner, serverConfig().oiko);
  if (!name) throw new ApiError("E_NOT_FOUND", 404);
  const amount = convertUnits(d.remaining, DECIMALS, origin.decimals).toString();
  const q = await deps.quote({ name, originAsset: origin.assetId, amount, refundTo: input.refundTo });
  const now = new Date(deps.now()).toISOString();
  const payment: InvoicePayment = {
    depositAddress: q.depositAddress, depositMemo: q.depositMemo ?? null, ticket: (q as { ticket?: string }).ticket ?? null,
    originLabel: origin.label, originAsset: origin.assetId, originDecimals: origin.decimals,
    amountIn: q.amountIn, amountOut: q.amountOut, fee: q.fee, deadline: q.deadline, createdAt: now, status: "PENDING_DEPOSIT", updatedAt: now,
    checkedAt: null, receivedAmount: null, depositedAmount: null, nearTxHashes: [], completedAt: null,
  };
  // Keep the record small: drop older addresses nobody paid.
  const keep = inv.payments.filter((p) => p.status !== "PENDING_DEPOSIT" && p.status !== "FAILED").concat(inv.payments.filter((p) => p.status === "PENDING_DEPOSIT").slice(-4));
  await deps.store.putInvoice({ ...inv, payments: [...keep, payment], updatedAt: now });
  return { ...q, invoiceId: inv.id };
}

/** Test mode: after simulate-deposit, store the newer signed ticket so any instance can follow the deposit. */
export async function attachTicket(invoiceId: string, depositAddress: string, memo: string | null, ticket: string | null, deps: InvoiceDeps) {
  if (!ticket) return;
  const inv = await deps.store.getInvoice(invoiceId);
  if (!inv) return;
  const i = inv.payments.findIndex((p) => p.depositAddress === depositAddress && (p.depositMemo ?? null) === (memo ?? null));
  if (i < 0) return;
  const payments = inv.payments.slice();
  payments[i] = { ...payments[i]!, ticket, checkedAt: null };
  await deps.store.putInvoice({ ...inv, payments });
}

export async function agentInvoices(vaultId: string, deps: InvoiceDeps) {
  const owner = vaultId.replace(/^vault\./, "");
  const list = await listOwnerInvoices(owner, deps);
  const now = deps.now();
  return {
    _help: "The owner's invoices to their clients (read only). status: draft, open, pending (payment on its way or partly paid), paid, refunded, cancelled, overdue. received is what arrived after fees. Amounts are { units (6 decimals), token, display }.",
    invoices: list.map((i) => agentView(i, now, deps.explorer)),
  };
}

// ---------- HTTP ----------

function limited(req: Request, who: string | null) {
  if (!checkLimits("invoice", clientIp(req), who)) throw new ApiError("E_RATE_LIMIT", 429);
}

/** GET /api/invoices (owner) */
export async function httpList(req: Request, deps = invoiceDeps(), gdeps?: GatewayDeps): Promise<Response> {
  try {
    limited(req, null);
    const owner = await authenticateInvoiceOwner(gatewayRequest(req, ""), gdeps);
    const list = await listOwnerInvoices(owner.accountId, deps);
    const now = deps.now();
    return json({ storage: deps.store.kind, invoices: list.map((i) => ownerView(i, now, deps.explorer)) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** POST /api/invoices (owner) */
export async function httpCreate(req: Request, deps = invoiceDeps(), gdeps?: GatewayDeps): Promise<Response> {
  try {
    limited(req, null);
    const text = await readText(req);
    const owner = await authenticateInvoiceOwner(gatewayRequest(req, text), gdeps);
    const body = parseBody(InvoiceBody, text);
    const inv = await createInvoice(owner.accountId, body, deps);
    return json(ownerView(inv, deps.now(), deps.explorer), 201);
  } catch (e) {
    return errorResponse(e);
  }
}

/** PATCH /api/invoices/:id (owner): edit, open, cancel. */
export async function httpPatch(req: Request, id: string, deps = invoiceDeps(), gdeps?: GatewayDeps): Promise<Response> {
  try {
    limited(req, null);
    const text = await readText(req);
    const owner = await authenticateInvoiceOwner(gatewayRequest(req, text), gdeps);
    const inv = await updateInvoice(owner.accountId, id, parseBody(InvoicePatchBody, text), deps);
    return json(ownerView(inv, deps.now(), deps.explorer));
  } catch (e) {
    return errorResponse(e);
  }
}

/** GET /api/invoices/:id: public view; with a valid owner Authorization header, the owner view. */
export async function httpGet(req: Request, id: string, deps = invoiceDeps(), gdeps?: GatewayDeps): Promise<Response> {
  try {
    limited(req, id);
    if (req.headers.get("authorization")) {
      const owner = await authenticateInvoiceOwner(gatewayRequest(req, ""), gdeps);
      const inv = await refreshInvoice(await loadOwned(owner.accountId, id, deps), deps);
      return json(ownerView(inv, deps.now(), deps.explorer));
    }
    const inv = await getPublicInvoice(id, deps);
    return json(publicView(inv, deps.now(), deps.explorer));
  } catch (e) {
    return errorResponse(e);
  }
}

/** GET /api/invoices/export.csv (owner) */
export async function httpExport(req: Request, deps = invoiceDeps(), gdeps?: GatewayDeps): Promise<Response> {
  try {
    limited(req, null);
    const owner = await authenticateInvoiceOwner(gatewayRequest(req, ""), gdeps);
    const list = await listOwnerInvoices(owner.accountId, deps);
    const csv = invoicesCsv(list, deps.now(), deps.explorer);
    const name = owner.accountId.split(".")[0];
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8", "cache-control": "no-store",
        "content-disposition": `attachment; filename="oiko-${name}-invoices-${todayUtc(deps.now())}.csv"`,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

