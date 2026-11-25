"use client";
// Invoices client: owner calls are NEP-413 signed by the app key (same as the agent access log); the public view is plain.
import { gatewayAuthHeader, type Token, type Veil } from "@oiko/sdk";
import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { fixtureFetch, isFixtureMode } from "./fixtures/mode";
import { invalidate, useQuery } from "./query";
import { useSession, type Session } from "./session";
import { usePrivacy } from "./privacy";
import { keyFromFragment, openCsv, openOwnerInvoice, openPublicInvoice, sealInvoiceInput } from "./sealedInvoice";

export type InvoiceStatus = "draft" | "open" | "pending" | "paid" | "refunded" | "cancelled" | "overdue";
export interface InvoiceItemView { description: string; quantity: string; unitPrice: string; lineTotal: string }
export interface TxLink { hash: string; url: string | null }
export interface PublicInvoice {
  id: string; number: string; owner: string; ownerName: string; fromName: string; client: { name: string; email?: string | null };
  token: Token; items: InvoiceItemView[]; total: string; paid: string; received: string; fee: string; remaining: string;
  issueDate: string; dueDate: string; note: string | null; status: InvoiceStatus; payable: boolean; inFlight: boolean; paidAt: string | null;
  transactions: TxLink[];
  /** Private invoice: encrypted details (lib/sealedInvoice.ts). */
  sealed?: { box: string; keyBox?: string } | null;
  /** Set on the client: the invoice is private, and whether this browser could open it. */
  private?: boolean; unlocked?: boolean;
}
export interface InvoicePaymentView {
  originLabel: string; status: string; createdAt: string; updatedAt: string; completedAt: string | null; amountIn: string; originDecimals: number;
  amountOut: string; fee: string; transactions: TxLink[];
}
export interface OwnerInvoice extends PublicInvoice {
  client: { name: string; email: string | null }; state: "draft" | "open" | "cancelled"; editable: boolean; createdAt: string; updatedAt: string;
  payments: InvoicePaymentView[];
  sealed?: { box: string; keyBox: string } | null;
  /** Set on the client for a private invoice the owner opened: the key that goes in the link's #fragment. */
  shareKey?: string | null;
}
export interface InvoiceInput {
  fromName: string; client: { name: string; email: string | null }; items: Array<{ description: string; quantity: string; unitPrice: string }>;
  token: Token; dueDate: string; note: string | null; state?: "draft" | "open" | "cancelled";
  sealed?: { box: string; keyBox: string } | null;
}

/** Signed request as the owner (NEP-413 with the app key on the name account). */
export async function ownerFetch(session: Session, method: string, path: string, body?: unknown): Promise<Response> {
  const text = body === undefined ? "" : JSON.stringify(body);
  const auth = gatewayAuthHeader(session.appKey, session.accountId, method, path, text);
  let res: Response;
  try {
    res = await fetch(path, { method, headers: { authorization: auth, ...(text ? { "content-type": "application/json" } : {}) }, body: text || undefined, cache: "no-store" });
  } catch {
    throw new ApiError("E_RPC", "Oiko couldn't be reached.", 0);
  }
  if (!res.ok) {
    let err: { code?: string; message?: string } | undefined;
    try { err = ((await res.json()) as { error?: { code?: string; message?: string } }).error; } catch { /* not JSON */ }
    throw new ApiError(err?.code ?? "E_UPSTREAM", err?.message ?? res.statusText, res.status);
  }
  return res;
}
export async function ownerJson<T>(session: Session, method: string, path: string, body?: unknown): Promise<T> {
  if (isFixtureMode()) return fixtureFetch<T>(path, method, body);
  return (await (await ownerFetch(session, method, path, body)).json()) as T;
}

export function useInvoices() {
  const { session } = useSession();
  const { veil } = usePrivacy();
  return useQuery<OwnerInvoice[]>(
    session ? `invoices:${session.accountId}${veil ? ":open" : ""}` : null,
    async () => (await ownerJson<{ invoices: OwnerInvoice[] }>(session!, "GET", "/api/invoices")).invoices.map((i) => openOwnerInvoice(veil, i)),
    { refreshMs: 15_000 },
  );
}

/** Public invoice; a private one opens with the key in the page's #fragment (read here, never sent anywhere). */
export function usePublicInvoice(id: string | null) {
  const [fragmentKey, setFragmentKey] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setFragmentKey(keyFromFragment(window.location.hash));
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  return useQuery<PublicInvoice>(id ? `invoice:${id}${fragmentKey ? ":k" : ""}` : null,
    async () => openPublicInvoice(await api<PublicInvoice>(`/api/invoices/${encodeURIComponent(id!)}`), fragmentKey), { refreshMs: 10_000 });
}

/**
 * Creates or edits an invoice. With a Veil (private labels on), the details are sealed in this browser first; an edit keeps
 * the invoice's content key (`keyBox`) so links already shared keep working.
 */
export async function saveInvoice(session: Session, input: InvoiceInput, id?: string, veil?: Veil | null, keyBox?: string | null): Promise<OwnerInvoice> {
  const body = veil ? sealInvoiceInput(veil, session.accountId, input, keyBox) : { ...input, sealed: null };
  const r = id
    ? await ownerJson<OwnerInvoice>(session, "PATCH", `/api/invoices/${encodeURIComponent(id)}`, body)
    : await ownerJson<OwnerInvoice>(session, "POST", "/api/invoices", body);
  invalidate("invoices:");
  return openOwnerInvoice(veil ?? null, r);
}
export async function setInvoiceState(session: Session, id: string, state: "open" | "cancelled"): Promise<OwnerInvoice> {
  const r = await ownerJson<OwnerInvoice>(session, "PATCH", `/api/invoices/${encodeURIComponent(id)}`, { state });
  invalidate("invoices:");
  invalidate(`invoice:${id}`);
  return r;
}

/** Downloads the accountant CSV (owner-signed, so it can't be a plain link). Private details are opened here, in the browser. */
export async function downloadInvoicesCsv(session: Session, veil?: Veil | null): Promise<void> {
  const path = "/api/invoices/export.csv";
  const text = isFixtureMode() ? await fixtureFetch<string>(path, "GET") : await (await ownerFetch(session, "GET", path)).text();
  // text() drops the UTF-8 BOM; put it back so spreadsheet apps still detect UTF-8.
  const csv = openCsv(veil ?? null, text.replace(/^\uFEFF/, ""));
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `oiko-${session.name}-invoices-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The invoice link; a private invoice's link carries its key in the #fragment, which browsers never send to the server. */
export const invoiceUrl = (id: string, shareKey?: string | null) =>
  `${typeof window === "undefined" ? "" : window.location.origin}/i/${id}${shareKey ? `#k=${shareKey}` : ""}`;

export const STATUS_TONE: Record<InvoiceStatus, "neutral" | "accent" | "success" | "warning" | "danger"> = {
  draft: "neutral", open: "accent", pending: "warning", paid: "success", refunded: "danger", cancelled: "neutral", overdue: "danger",
};
