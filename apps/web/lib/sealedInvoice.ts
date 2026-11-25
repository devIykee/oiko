// Private invoices (Veil). The owner's browser encrypts the parts of an invoice that say who and what
// (client, email, sender name, line descriptions, note) before the invoice reaches Oiko's server:
//   box     the real details, encrypted with a fresh content key for this invoice
//   link    /i/<id>#k=<content key>: browsers never send the #fragment, so the server can't read the key
//   keyBox  the content key sealed with the owner's view key, so the owner can rebuild the link on any device
//   fields  the server's own copies hold Veil tokens (sealed with the view key) where they fit, else "Private",
//           so exports and agents with the view key can still read them, and the server never can.
// Amounts, quantities, prices, currency, dates and status stay readable: the server needs them to take payment.
import {
  PRIVATE_LABEL, decodeBoxKey, encodeBoxKey, isSealed, maskText, newBoxKey, openBox, sealBox, unwrapBoxKey, wrapBoxKey, type Veil,
} from "@oiko/sdk";
import type { InvoiceInput, OwnerInvoice, PublicInvoice } from "./invoices";

export interface InvoiceSecrets { fromName: string; client: { name: string; email: string | null }; items: string[]; note: string | null }

const ctx = (owner: string) => `invoice:${owner}`;
/** Seal with the view key if it fits the server's limit for that field, else a neutral placeholder. */
const sealOr = (veil: Veil, s: string, max: number) => { try { return veil.seal(s, max); } catch { return PRIVATE_LABEL; } };

export function sealInvoiceInput(veil: Veil, owner: string, input: InvoiceInput, keyBox?: string | null): InvoiceInput {
  const key = (keyBox && unwrapBoxKey(veil, keyBox)) || newBoxKey(); // keep the same key when editing, so shared links still open
  const secrets: InvoiceSecrets = {
    fromName: input.fromName, client: { name: input.client.name, email: input.client.email ?? null },
    items: input.items.map((i) => i.description), note: input.note ?? null,
  };
  return {
    ...input,
    fromName: sealOr(veil, input.fromName, 80),
    client: { name: sealOr(veil, input.client.name, 120), email: null },
    items: input.items.map((i) => ({ ...i, description: sealOr(veil, i.description, 200) })),
    note: input.note ? sealOr(veil, input.note, 1000) : null,
    sealed: { box: sealBox(key, secrets, ctx(owner)), keyBox: wrapBoxKey(veil, key) },
  };
}

function overlay<T extends PublicInvoice>(inv: T, s: InvoiceSecrets): T {
  return {
    ...inv, fromName: s.fromName, client: { ...inv.client, name: s.client.name, ...("email" in inv.client ? { email: s.client.email } : {}) },
    items: inv.items.map((it, i) => ({ ...it, description: s.items[i] ?? it.description })), note: s.note,
  };
}

/** Owner side: opens the details with the view key; without it, sealed text reads "Private". */
export function openOwnerInvoice(veil: Veil | null, inv: OwnerInvoice): OwnerInvoice & { shareKey: string | null } {
  if (!inv.sealed) return { ...inv, shareKey: null };
  const key = veil ? unwrapBoxKey(veil, inv.sealed.keyBox) : null;
  const secrets = key ? openBox<InvoiceSecrets>(key, inv.sealed.box, ctx(inv.owner)) : null;
  if (secrets) return { ...overlay(inv, secrets), shareKey: encodeBoxKey(key!) };
  return { ...maskInvoice(inv), shareKey: null };
}

/** Payer side: opens the details with the key from the link's #fragment; without it, they read "Private". */
export function openPublicInvoice(inv: PublicInvoice, fragmentKey: string | null): PublicInvoice & { private: boolean; unlocked: boolean } {
  if (!inv.sealed) return { ...inv, private: false, unlocked: false };
  const key = fragmentKey ? decodeBoxKey(fragmentKey) : null;
  const secrets = key ? openBox<InvoiceSecrets>(key, inv.sealed.box, ctx(inv.owner)) : null;
  return secrets ? { ...overlay(inv, secrets), private: true, unlocked: true } : { ...maskInvoice(inv), private: true, unlocked: false };
}

function maskInvoice<T extends PublicInvoice>(inv: T): T {
  return {
    ...inv, fromName: maskText(inv.fromName), client: { ...inv.client, name: maskText(inv.client.name) },
    items: inv.items.map((it) => ({ ...it, description: maskText(it.description) })), note: inv.note ? maskText(inv.note) : null,
  };
}

/** The key part of a private invoice link: "#k=<key>". */
export const fragmentFor = (shareKey: string | null) => (shareKey ? `#k=${shareKey}` : "");
export function keyFromFragment(hash: string): string | null {
  const m = /(?:^#|&)k=([A-Za-z0-9_-]{43})(?:&|$)/.exec(hash);
  return m ? m[1]! : null;
}

/** RFC 4180 field (same rule as the server's csvField). */
function csvField(v: string): string {
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Opens the Veil tokens in the server's CSV export. Tokens are always a whole, unquoted field there. */
export function openCsv(veil: Veil | null, csv: string): string {
  return csv.split(/(\r\n)/).map((line) => line.split(",").map((f) => (isSealed(f) ? csvField(veil?.tryOpen(f) ?? PRIVATE_LABEL) : f)).join(",")).join("");
}
