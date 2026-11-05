// Invoices: pure logic (totals with bigint, status derived from 1Click deposit statuses, views, CSV).
// Storage and HTTP live in invoicesHttp.ts. Amounts are integer strings in base units (6 decimals) + a token ticker.
import { b58encode, formatAmount, type Token } from "@oiko/sdk";
import { invoiceTotal, lineTotal, parseQuantity, QTY_SCALE } from "../lib/invoiceMath";
import type { OneClickStatus } from "./mock1click";

export const DECIMALS = 6;
export const MAX_ITEMS = 50;

export interface InvoiceItem {
  description: string;
  /** Decimal string, up to 4 fraction digits, > 0. */
  quantity: string;
  /** Base units (6 decimals) per unit. */
  unitPrice: string;
}

export interface InvoicePayment {
  depositAddress: string;
  depositMemo: string | null;
  /** Signed mock 1Click ticket (test mode), so any instance can refresh the status. */
  ticket: string | null;
  /** "USDT on TRON" etc. */
  originLabel: string;
  originAsset: string;
  originDecimals: number;
  /** Quoted amounts. amountIn in origin decimals; amountOut and fee in 6 decimals. */
  amountIn: string;
  amountOut: string;
  fee: string;
  deadline: string;
  createdAt: string;
  status: OneClickStatus;
  updatedAt: string;
  checkedAt: string | null;
  /** Set on SUCCESS: what actually arrived (6 decimals). */
  receivedAmount: string | null;
  /** Deposited amount reported by 1Click (origin decimals), when known. */
  depositedAmount: string | null;
  nearTxHashes: string[];
  completedAt: string | null;
}

export type StoredState = "draft" | "open" | "cancelled";
export type InvoiceStatus = "draft" | "open" | "pending" | "paid" | "refunded" | "cancelled" | "overdue";

export interface Invoice {
  id: string;
  /** Per-owner sequence: INV-0001. */
  number: string;
  /** Owner's name account (ada.oiko.near). */
  owner: string;
  /** Shown as "From" on the invoice. */
  fromName: string;
  client: { name: string; email: string | null };
  items: InvoiceItem[];
  token: Token;
  /** yyyy-mm-dd (UTC). */
  issueDate: string;
  dueDate: string;
  note: string | null;
  state: StoredState;
  payments: InvoicePayment[];
  createdAt: string;
  updatedAt: string;
}

// ---------- ids ----------

/** 16 random bytes, base58: unguessable public id. */
export function newInvoiceId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return b58encode(b);
}
export const INVOICE_ID_RE = /^[1-9A-HJ-NP-Za-km-z]{16,24}$/;
export const invoiceNumber = (n: number) => `INV-${String(n).padStart(4, "0")}`;

// ---------- totals (shared with the browser: lib/invoiceMath.ts) ----------

export { lineTotal, invoiceTotal, parseQuantity, QTY_SCALE } from "../lib/invoiceMath";

/** Converts between decimal precisions (floors when reducing). */
export function convertUnits(units: bigint, from: number, to: number): bigint {
  return from === to ? units : from > to ? units / 10n ** BigInt(from - to) : units * 10n ** BigInt(to - from);
}

// ---------- status ----------

const IN_FLIGHT: OneClickStatus[] = ["KNOWN_DEPOSIT_TX", "PROCESSING", "INCOMPLETE_DEPOSIT"];
export const TERMINAL: OneClickStatus[] = ["SUCCESS", "REFUNDED", "FAILED"];

export interface Derived {
  status: InvoiceStatus;
  total: bigint;
  /** Gross amount paid (what the payer sent, 6 decimals) across successful deposits. */
  paid: bigint;
  /** What arrived in the owner's account (after fees, 6 decimals). */
  received: bigint;
  fee: bigint;
  remaining: bigint;
  paidAt: string | null;
  inFlight: boolean;
  /** Someone can start a payment now. */
  payable: boolean;
  txHashes: string[];
}

export const todayUtc = (nowMs: number) => new Date(nowMs).toISOString().slice(0, 10);

/** What a successful payment counts for: the gross amount sent (6 decimals) and what arrived. */
export function paymentAmounts(p: InvoicePayment): { gross: bigint; received: bigint; fee: bigint } {
  const received = BigInt(p.receivedAmount ?? p.amountOut);
  const gross = convertUnits(BigInt(p.depositedAmount ?? p.amountIn), p.originDecimals, DECIMALS);
  const fee = gross > received ? gross - received : 0n;
  return { gross, received, fee };
}

export function deriveStatus(inv: Pick<Invoice, "state" | "items" | "payments" | "dueDate">, nowMs: number): Derived {
  const total = invoiceTotal(inv.items);
  let paid = 0n, received = 0n, fee = 0n, paidAt: string | null = null;
  const txHashes: string[] = [];
  const ordered = [...inv.payments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const p of ordered) {
    txHashes.push(...p.nearTxHashes);
    if (p.status !== "SUCCESS") continue;
    const a = paymentAmounts(p);
    paid += a.gross; received += a.received; fee += a.fee;
    if (paid >= total && !paidAt) paidAt = p.completedAt ?? p.updatedAt;
  }
  const inFlight = inv.payments.some((p) => IN_FLIGHT.includes(p.status));
  const remaining = total > paid ? total - paid : 0n;
  // The latest payment that got past "waiting for the deposit".
  const lastStarted = [...ordered].reverse().find((p) => p.status !== "PENDING_DEPOSIT" && p.status !== "FAILED");
  let status: InvoiceStatus;
  if (inv.state === "draft") status = "draft";
  else if (total > 0n && paid >= total) status = "paid";
  else if (inv.state === "cancelled") status = "cancelled";
  else if (inFlight || paid > 0n) status = "pending";
  else if (lastStarted?.status === "REFUNDED") status = "refunded";
  else status = inv.dueDate < todayUtc(nowMs) ? "overdue" : "open";
  const payable = (status === "open" || status === "overdue" || status === "refunded" || (status === "pending" && !inFlight)) && remaining > 0n;
  return { status, total, paid, received, fee, remaining, paidAt, inFlight, payable, txHashes: [...new Set(txHashes)] };
}

/** Editing is allowed until money starts moving. */
export function editable(inv: Pick<Invoice, "state" | "payments">): boolean {
  return inv.state !== "cancelled" && !inv.payments.some((p) => p.status !== "PENDING_DEPOSIT" && p.status !== "FAILED");
}

// ---------- views ----------

const money = (units: bigint | string, token: Token) => ({ units: units.toString(), token: token.toUpperCase(), display: `${formatAmount(units.toString())} ${token.toUpperCase()}` });

export function txUrl(explorer: string | null, hash: string): string | null {
  return explorer ? `${explorer}/txns/${hash}` : null;
}

/** Public view: no client email, no deposit tickets. */
export function publicView(inv: Invoice, nowMs: number, explorer: string | null) {
  const d = deriveStatus(inv, nowMs);
  return {
    id: inv.id, number: inv.number, owner: inv.owner, ownerName: inv.owner.split(".")[0]!, fromName: inv.fromName,
    client: { name: inv.client.name }, token: inv.token,
    items: inv.items.map((i) => ({ ...i, lineTotal: lineTotal(i).toString() })),
    total: d.total.toString(), paid: d.paid.toString(), received: d.received.toString(), fee: d.fee.toString(), remaining: d.remaining.toString(),
    issueDate: inv.issueDate, dueDate: inv.dueDate, note: inv.note, status: d.status, payable: d.payable, inFlight: d.inFlight, paidAt: d.paidAt,
    transactions: d.txHashes.map((h) => ({ hash: h, url: txUrl(explorer, h) })),
  };
}

/** Owner view: everything, plus each payment's progress. */
export function ownerView(inv: Invoice, nowMs: number, explorer: string | null) {
  return {
    ...publicView(inv, nowMs, explorer),
    client: inv.client, state: inv.state, editable: editable(inv), createdAt: inv.createdAt, updatedAt: inv.updatedAt,
    payments: inv.payments.map((p) => ({
      originLabel: p.originLabel, status: p.status, createdAt: p.createdAt, updatedAt: p.updatedAt, completedAt: p.completedAt,
      amountIn: p.amountIn, originDecimals: p.originDecimals, amountOut: p.receivedAmount ?? p.amountOut, fee: p.fee,
      transactions: p.nearTxHashes.map((h) => ({ hash: h, url: txUrl(explorer, h) })),
    })),
  };
}

/** Agent view (read scope): amounts as { units, token, display }. */
export function agentView(inv: Invoice, nowMs: number, explorer: string | null) {
  const d = deriveStatus(inv, nowMs);
  return {
    id: inv.id, number: inv.number, client: inv.client.name, status: d.status, issue_date: inv.issueDate, due_date: inv.dueDate,
    items: inv.items.map((i) => ({ description: i.description, quantity: i.quantity, unit_price: money(i.unitPrice, inv.token), line_total: money(lineTotal(i), inv.token) })),
    total: money(d.total, inv.token), paid: money(d.paid, inv.token), received: money(d.received, inv.token), fee: money(d.fee, inv.token),
    remaining: money(d.remaining, inv.token), paid_at: d.paidAt, note: inv.note,
    transactions: d.txHashes.map((h) => txUrl(explorer, h) ?? h),
  };
}

// ---------- CSV ----------

/** Plain decimal for spreadsheets: "1234.5" -> "1234.50"; no thousands separators, at least 2 decimals. */
export function plainDecimal(units: bigint | string, decimals = DECIMALS): string {
  let v = BigInt(units);
  const neg = v < 0n;
  if (neg) v = -v;
  const base = 10n ** BigInt(decimals);
  let frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  return `${neg ? "-" : ""}${v / base}.${frac}`;
}
/** Quantity as typed, normalised ("7.50" -> "7.5", "2" -> "2"). */
export function plainQuantity(q: string): string {
  const s = parseQuantity(q);
  const frac = (s % QTY_SCALE).toString().padStart(4, "0").replace(/0+$/, "");
  return `${s / QTY_SCALE}${frac ? "." + frac : ""}`;
}

/**
 * RFC 4180 field. Quotes fields containing a comma, quote, CR or LF (doubling quotes). Text fields that a spreadsheet
 * would run as a formula (= + - @ tab CR at the start) get a leading apostrophe.
 */
export function csvField(v: string, text = false): string {
  let s = v;
  if (text && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_HEADER = [
  "Invoice number", "Issue date", "Due date", "Client", "Description", "Quantity", "Unit price", "Line total", "Currency",
  "Invoice total", "Status", "Paid date", "Amount received", "Fee", "Transaction link",
] as const;

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft", open: "Open", pending: "Pending", paid: "Paid", refunded: "Refunded", cancelled: "Cancelled", overdue: "Overdue",
};

/** One row per line item; invoice-level columns repeat. UTF-8 with a BOM (so spreadsheet apps detect it), CRLF line ends. */
export function invoicesCsv(invoices: Invoice[], nowMs: number, explorer: string | null): string {
  const lines = [CSV_HEADER.map((h) => csvField(h)).join(",")];
  const sorted = [...invoices].sort((a, b) => a.number.localeCompare(b.number));
  for (const inv of sorted) {
    const d = deriveStatus(inv, nowMs);
    const links = d.txHashes.map((h) => txUrl(explorer, h) ?? h).join(" ");
    for (const item of inv.items) {
      lines.push([
        csvField(inv.number), inv.issueDate, inv.dueDate, csvField(inv.client.name, true), csvField(item.description, true),
        plainQuantity(item.quantity), plainDecimal(item.unitPrice), plainDecimal(lineTotal(item)), inv.token.toUpperCase(),
        plainDecimal(d.total), STATUS_LABEL[d.status], d.paidAt ? d.paidAt.slice(0, 10) : "",
        d.received > 0n ? plainDecimal(d.received) : "", d.received > 0n ? plainDecimal(d.fee) : "", csvField(links),
      ].join(","));
    }
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
