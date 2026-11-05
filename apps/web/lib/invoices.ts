"use client";
// Invoices client: owner calls are NEP-413 signed by the app key (same as the agent access log); the public view is plain.
import { gatewayAuthHeader, type Token } from "@oiko/sdk";
import { api, ApiError } from "./api";
import { fixtureFetch, isFixtureMode } from "./fixtures/mode";
import { invalidate, useQuery } from "./query";
import { useSession, type Session } from "./session";

export type InvoiceStatus = "draft" | "open" | "pending" | "paid" | "refunded" | "cancelled" | "overdue";
export interface InvoiceItemView { description: string; quantity: string; unitPrice: string; lineTotal: string }
export interface TxLink { hash: string; url: string | null }
export interface PublicInvoice {
  id: string; number: string; owner: string; ownerName: string; fromName: string; client: { name: string; email?: string | null };
  token: Token; items: InvoiceItemView[]; total: string; paid: string; received: string; fee: string; remaining: string;
  issueDate: string; dueDate: string; note: string | null; status: InvoiceStatus; payable: boolean; inFlight: boolean; paidAt: string | null;
  transactions: TxLink[];
}
export interface InvoicePaymentView {
  originLabel: string; status: string; createdAt: string; updatedAt: string; completedAt: string | null; amountIn: string; originDecimals: number;
  amountOut: string; fee: string; transactions: TxLink[];
}
export interface OwnerInvoice extends PublicInvoice {
  client: { name: string; email: string | null }; state: "draft" | "open" | "cancelled"; editable: boolean; createdAt: string; updatedAt: string;
  payments: InvoicePaymentView[];
}
export interface InvoiceInput {
  fromName: string; client: { name: string; email: string | null }; items: Array<{ description: string; quantity: string; unitPrice: string }>;
  token: Token; dueDate: string; note: string | null; state?: "draft" | "open" | "cancelled";
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
  return useQuery<OwnerInvoice[]>(
    session ? `invoices:${session.accountId}` : null,
    async () => (await ownerJson<{ invoices: OwnerInvoice[] }>(session!, "GET", "/api/invoices")).invoices,
    { refreshMs: 15_000 },
  );
}

export function usePublicInvoice(id: string | null) {
  return useQuery<PublicInvoice>(id ? `invoice:${id}` : null, () => api(`/api/invoices/${encodeURIComponent(id!)}`), { refreshMs: 10_000 });
}

export async function saveInvoice(session: Session, input: InvoiceInput, id?: string): Promise<OwnerInvoice> {
  const r = id
    ? await ownerJson<OwnerInvoice>(session, "PATCH", `/api/invoices/${encodeURIComponent(id)}`, input)
    : await ownerJson<OwnerInvoice>(session, "POST", "/api/invoices", input);
  invalidate("invoices:");
  return r;
}
export async function setInvoiceState(session: Session, id: string, state: "open" | "cancelled"): Promise<OwnerInvoice> {
  const r = await ownerJson<OwnerInvoice>(session, "PATCH", `/api/invoices/${encodeURIComponent(id)}`, { state });
  invalidate("invoices:");
  invalidate(`invoice:${id}`);
  return r;
}

/** Downloads the accountant CSV (owner-signed, so it can't be a plain link). */
export async function downloadInvoicesCsv(session: Session): Promise<void> {
  const path = "/api/invoices/export.csv";
  const blob = isFixtureMode()
    ? new Blob([await fixtureFetch<string>(path, "GET")], { type: "text/csv;charset=utf-8" })
    : await (await ownerFetch(session, "GET", path)).blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `oiko-${session.name}-invoices-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const invoiceUrl = (id: string) => (typeof window === "undefined" ? `/i/${id}` : `${window.location.origin}/i/${id}`);

export const STATUS_TONE: Record<InvoiceStatus, "neutral" | "accent" | "success" | "warning" | "danger"> = {
  draft: "neutral", open: "accent", pending: "warning", paid: "success", refunded: "danger", cancelled: "neutral", overdue: "danger",
};
