import { beforeEach, describe, expect, it } from "vitest";
import { gatewayAuthHeader, keyPairFromSeed } from "@oiko/sdk";
import type { GatewayDeps } from "../gateway";
import {
  csvField, deriveStatus, editable, invoicesCsv, invoiceTotal, lineTotal, newInvoiceId, parseQuantity, plainDecimal, plainQuantity, publicView,
  INVOICE_ID_RE, type Invoice, type InvoicePayment,
} from "../invoices";
import { attachTicket, httpCreate, httpExport, httpGet, httpList, httpPatch, refreshInvoice, startInvoicePayment, updateInvoice, type InvoiceDeps, type PayDeps } from "../invoicesHttp";
import type { IntentStatusDetail } from "../intents";
import { serverConfig } from "../config";
import { MemoryStore } from "../store";

const NOW = Date.parse("2026-11-05T12:00:00Z");
const U = (n: number) => String(Math.round(n * 1e6));

const payment = (p: Partial<InvoicePayment> = {}): InvoicePayment => ({
  depositAddress: "TQ1", depositMemo: null, ticket: null, originLabel: "USDT on TRON", originAsset: "nep141:tron", originDecimals: 6,
  amountIn: U(100), amountOut: U(99.945), fee: U(0.055), deadline: "2026-11-05T13:00:00Z", createdAt: "2026-11-05T11:00:00Z",
  status: "PENDING_DEPOSIT", updatedAt: "2026-11-05T11:00:00Z", checkedAt: null, receivedAmount: null, depositedAmount: null,
  nearTxHashes: [], completedAt: null, ...p,
});
const invoice = (p: Partial<Invoice> = {}): Invoice => ({
  id: "4vJ9JU1bJJE96FWSJKvHsmmF", number: "INV-0001", owner: "ada.oiko.testnet", fromName: "Ada Studio", client: { name: "Acme Ltd", email: "pay@acme.test" },
  items: [{ description: "Design", quantity: "2", unitPrice: U(50) }], token: "usdt", issueDate: "2026-11-01", dueDate: "2026-11-30", note: null,
  state: "open", payments: [], createdAt: "2026-11-01T09:00:00Z", updatedAt: "2026-11-01T09:00:00Z", ...p,
});

describe("invoice totals (bigint)", () => {
  it("parses quantities with up to 4 decimals", () => {
    expect(parseQuantity("7.5")).toBe(75_000n);
    expect(parseQuantity("1")).toBe(10_000n);
    expect(parseQuantity("0.0001")).toBe(1n);
    expect(() => parseQuantity("1.23456")).toThrow();
    expect(() => parseQuantity("-1")).toThrow();
    expect(() => parseQuantity("1e3")).toThrow();
  });
  it("computes line totals exactly and rounds half up to a base unit", () => {
    expect(lineTotal({ quantity: "7.5", unitPrice: U(40) })).toBe(300_000_000n);
    expect(lineTotal({ quantity: "3", unitPrice: "333333" })).toBe(999_999n);
    // 1.5 × 0.333333 = 0.4999995 -> 0.500000
    expect(lineTotal({ quantity: "1.5", unitPrice: "333333" })).toBe(500_000n);
    // 0.0001 × 0.000004 rounds to 0
    expect(lineTotal({ quantity: "0.0001", unitPrice: "4" })).toBe(0n);
  });
  it("sums lines without floating point error", () => {
    const items = [{ quantity: "3", unitPrice: U(0.1) }, { quantity: "1", unitPrice: U(0.2) }];
    expect(invoiceTotal(items)).toBe(500_000n);
    expect(invoiceTotal([{ quantity: "999999999", unitPrice: "999999999999" }])).toBe(999_999_998_999_000_000_001n);
  });
  it("makes unguessable base58 ids", () => {
    const a = newInvoiceId(), b = newInvoiceId();
    expect(a).not.toBe(b);
    expect(a).toMatch(INVOICE_ID_RE);
  });
});

describe("invoice status", () => {
  it("draft, open, overdue, cancelled", () => {
    expect(deriveStatus(invoice({ state: "draft" }), NOW).status).toBe("draft");
    expect(deriveStatus(invoice(), NOW).status).toBe("open");
    expect(deriveStatus(invoice({ dueDate: "2026-11-04" }), NOW).status).toBe("overdue");
    expect(deriveStatus(invoice({ dueDate: "2026-11-05" }), NOW).status).toBe("open");
    expect(deriveStatus(invoice({ state: "cancelled" }), NOW).status).toBe("cancelled");
  });
  it("a deposit address nobody paid keeps the invoice open", () => {
    const d = deriveStatus(invoice({ payments: [payment()] }), NOW);
    expect(d.status).toBe("open");
    expect(d.payable).toBe(true);
  });
  it("pending while the deposit is on its way", () => {
    for (const status of ["KNOWN_DEPOSIT_TX", "PROCESSING", "INCOMPLETE_DEPOSIT"] as const) {
      const d = deriveStatus(invoice({ payments: [payment({ status })] }), NOW);
      expect(d.status).toBe("pending");
      expect(d.payable).toBe(false);
    }
  });
  it("paid on SUCCESS: counts what the payer sent, reports what arrived and the fee", () => {
    const d = deriveStatus(invoice({ payments: [payment({ status: "SUCCESS", receivedAmount: U(99.945), completedAt: "2026-11-05T11:05:00Z", nearTxHashes: ["h1", "h2"] })] }), NOW);
    expect(d.status).toBe("paid");
    expect(d.paid).toBe(100_000_000n);
    expect(d.received).toBe(99_945_000n);
    expect(d.fee).toBe(55_000n);
    expect(d.paidAt).toBe("2026-11-05T11:05:00Z");
    expect(d.txHashes).toEqual(["h1", "h2"]);
    expect(d.payable).toBe(false);
  });
  it("normalises 18-decimal deposits", () => {
    const p = payment({ status: "SUCCESS", originDecimals: 18, amountIn: "100" + "0".repeat(18), receivedAmount: U(100) });
    expect(deriveStatus(invoice({ payments: [p] }), NOW).status).toBe("paid");
  });
  it("partial payment = pending with the amount received, and the rest is still payable", () => {
    const d = deriveStatus(invoice({ payments: [payment({ status: "SUCCESS", amountIn: U(40), depositedAmount: U(40), receivedAmount: U(39.9) })] }), NOW);
    expect(d.status).toBe("pending");
    expect(d.received).toBe(39_900_000n);
    expect(d.remaining).toBe(60_000_000n);
    expect(d.payable).toBe(true);
  });
  it("refunded when the last attempt bounced; paid wins over cancelled", () => {
    expect(deriveStatus(invoice({ payments: [payment({ status: "REFUNDED" })] }), NOW).status).toBe("refunded");
    expect(deriveStatus(invoice({ payments: [payment({ status: "REFUNDED" }), payment({ status: "SUCCESS", createdAt: "2026-11-05T11:30:00Z" })] }), NOW).status).toBe("paid");
    expect(deriveStatus(invoice({ state: "cancelled", payments: [payment({ status: "SUCCESS" })] }), NOW).status).toBe("paid");
  });
  it("is not editable once money moves", () => {
    expect(editable(invoice({ payments: [payment()] }))).toBe(true);
    expect(editable(invoice({ payments: [payment({ status: "PROCESSING" })] }))).toBe(false);
  });
  it("the public view hides the client's email", () => {
    const v = publicView(invoice(), NOW, "https://testnet.nearblocks.io");
    expect(JSON.stringify(v)).not.toContain("pay@acme.test");
    expect(v.total).toBe(U(100));
  });
});

describe("invoice CSV", () => {
  it("escapes commas, quotes and newlines (RFC 4180) and defuses formulas", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
    expect(csvField("a\r\nb")).toBe('"a\r\nb"');
    expect(csvField("=SUM(A1)", true)).toBe("'=SUM(A1)");
    expect(csvField("-5", true)).toBe("'-5");
    expect(csvField(" padded")).toBe('" padded"');
  });
  it("plain decimals: no thousands separators, at least 2 decimals", () => {
    expect(plainDecimal("1234500000")).toBe("1234.50");
    expect(plainDecimal("1")).toBe("0.000001");
    expect(plainDecimal("0")).toBe("0.00");
    expect(plainDecimal(123_456_789_000_000n)).toBe("123456789.00");
    expect(plainQuantity("7.50")).toBe("7.5");
  });
  it("one row per line item with the accountant's columns", () => {
    const inv = invoice({
      client: { name: 'Acme, "Global"', email: null },
      items: [{ description: "Design\nround 2", quantity: "1.5", unitPrice: U(1000) }, { description: "Hosting", quantity: "1", unitPrice: U(25.5) }],
      payments: [payment({ status: "SUCCESS", amountIn: U(1525.5), receivedAmount: U(1525), completedAt: "2026-11-05T11:05:00Z", nearTxHashes: ["9xTx"] })],
    });
    const csv = invoicesCsv([inv], NOW, "https://testnet.nearblocks.io");
    expect(csv.startsWith("﻿Invoice number,Issue date,Due date,Client,Description,Quantity,Unit price,Line total,Currency,Invoice total,Status,Paid date,Amount received,Fee,Transaction link\r\n")).toBe(true);
    const rows = csv.slice(1).split("\r\n");
    expect(rows[1]).toBe('INV-0001,2026-11-01,2026-11-30,"Acme, ""Global""","Design\nround 2",1.5,1000.00,1500.00,USDT,1525.50,Paid,2026-11-05,1525.00,0.50,https://testnet.nearblocks.io/txns/9xTx');
    expect(rows[2]).toBe('INV-0001,2026-11-01,2026-11-30,"Acme, ""Global""",Hosting,1,25.50,25.50,USDT,1525.50,Paid,2026-11-05,1525.00,0.50,https://testnet.nearblocks.io/txns/9xTx');
    expect(rows[3]).toBe("");
    expect(csv).not.toMatch(/\$|USD[^CT]/);
  });
  it("unpaid invoices leave the paid columns empty", () => {
    const csv = invoicesCsv([invoice()], NOW, null);
    expect(csv.slice(1).split("\r\n")[1]).toBe("INV-0001,2026-11-01,2026-11-30,Acme Ltd,Design,2,50.00,100.00,USDT,100.00,Open,,,,");
  });
});

// ---------- owner auth + flows ----------

const root = serverConfig().oiko.root;
const OWNER = `ada.${root}`;
const appKey = keyPairFromSeed(new Uint8Array(32).fill(21));
const other = keyPairFromSeed(new Uint8Array(32).fill(22));
let s: MemoryStore;
let deps: InvoiceDeps;
let gdeps: GatewayDeps;
let statuses: Map<string, IntentStatusDetail>;

beforeEach(() => {
  s = new MemoryStore();
  statuses = new Map();
  deps = {
    store: s, now: () => NOW, explorer: "https://testnet.nearblocks.io",
    status: async (a) => statuses.get(a) ?? { status: "PENDING_DEPOSIT", updatedAt: "", nearTxHashes: [], depositedAmount: null, amountOut: null },
  };
  const keys = new Set([`${OWNER}|${appKey.publicKey}`, `bob.${root}|${other.publicKey}`, `outsider.near|${other.publicKey}`]);
  gdeps = {
    now: () => Date.now(), store: s,
    viewAccessKey: async (a, pk) => (keys.has(`${a}|${pk}`) ? { nonce: 1, permission: "FullAccess" } : null),
    getAgent: async () => null,
    isVaultId: (id) => id.startsWith("vault.") && id.endsWith(`.${root}`) && id.split(".").length === root.split(".").length + 2,
  };
});

const BASE = "http://localhost:3000";
function signed(method: string, path: string, body = "", sk = appKey.secretKey, account = OWNER): Request {
  return new Request(BASE + path, { method, body: body || undefined, headers: { authorization: gatewayAuthHeader(sk, account, method, path, body), ...(body ? { "content-type": "application/json" } : {}) } });
}
const newBody = JSON.stringify({ fromName: "Ada", client: { name: "Acme", email: "a@acme.test" }, items: [{ description: "Logo", quantity: "1", unitPrice: U(120.5) }], token: "usdc", dueDate: "2026-12-01" });

describe("invoice owner auth", () => {
  it("creates with the owner's app key and numbers invoices per owner", async () => {
    const r = await httpCreate(signed("POST", "/api/invoices", newBody), deps, gdeps);
    expect(r.status).toBe(201);
    const v = await r.json();
    expect(v.number).toBe("INV-0001");
    expect(v.total).toBe(U(120.5));
    expect(v.status).toBe("open");
    expect(v.id).toMatch(INVOICE_ID_RE);
    const r2 = await httpCreate(signed("POST", "/api/invoices", newBody), deps, gdeps);
    expect((await r2.json()).number).toBe("INV-0002");
  });
  it("refuses create without a signature, with a key not on the account, for a non-Oiko account, or with a tampered body", async () => {
    const plain = new Request(BASE + "/api/invoices", { method: "POST", body: newBody });
    expect((await httpCreate(plain, deps, gdeps)).status).toBe(401);
    expect((await httpCreate(signed("POST", "/api/invoices", newBody, other.secretKey), deps, gdeps)).status).toBe(401);
    expect((await httpCreate(signed("POST", "/api/invoices", newBody, other.secretKey, "outsider.near"), deps, gdeps)).status).toBe(403);
    const tampered = signed("POST", "/api/invoices", newBody);
    const t2 = new Request(tampered.url, { method: "POST", headers: tampered.headers, body: newBody.replace("120500000", "1") });
    expect((await httpCreate(t2, deps, gdeps)).status).toBe(401);
    expect(await s.listInvoices(OWNER)).toHaveLength(0);
  });
  it("export needs the owner and only returns their invoices", async () => {
    await httpCreate(signed("POST", "/api/invoices", newBody), deps, gdeps);
    await httpCreate(signed("POST", "/api/invoices", newBody.replace("Acme", "Bobs client"), other.secretKey, `bob.${root}`), deps, gdeps);
    expect((await httpExport(new Request(BASE + "/api/invoices/export.csv"), deps, gdeps)).status).toBe(401);
    const r = await httpExport(signed("GET", "/api/invoices/export.csv"), deps, gdeps);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/csv");
    expect(r.headers.get("content-disposition")).toContain("attachment");
    const csv = await r.text();
    expect(csv).toContain("Acme");
    expect(csv).not.toContain("Bobs client");
  });
  it("list, edit and cancel are owner-only; the public view needs only the id", async () => {
    const v = await (await httpCreate(signed("POST", "/api/invoices", newBody), deps, gdeps)).json();
    expect((await (await httpList(signed("GET", "/api/invoices"), deps, gdeps)).json()).invoices).toHaveLength(1);
    expect((await (await httpList(signed("GET", "/api/invoices", "", other.secretKey, `bob.${root}`), deps, gdeps)).json()).invoices).toHaveLength(0);
    const cancel = JSON.stringify({ state: "cancelled" });
    expect((await httpPatch(signed("PATCH", `/api/invoices/${v.id}`, cancel, other.secretKey, `bob.${root}`), v.id, deps, gdeps)).status).toBe(404);
    const pub = await (await httpGet(new Request(`${BASE}/api/invoices/${v.id}`), v.id, deps, gdeps)).json();
    expect(pub.client).toEqual({ name: "Acme" });
    expect(pub.status).toBe("open");
    const r = await httpPatch(signed("PATCH", `/api/invoices/${v.id}`, cancel), v.id, deps, gdeps);
    expect((await r.json()).status).toBe("cancelled");
  });
  it("drafts are not public", async () => {
    const v = await (await httpCreate(signed("POST", "/api/invoices", newBody.replace('"dueDate"', '"state":"draft","dueDate"')), deps, gdeps)).json();
    expect(v.status).toBe("draft");
    expect((await httpGet(new Request(`${BASE}/api/invoices/${v.id}`), v.id, deps, gdeps)).status).toBe(404);
  });
});

describe("invoice payments", () => {
  const pay = (): PayDeps => ({
    ...deps,
    origin: async (assetId) => (assetId === "nep141:base-usdc" ? { id: assetId, label: "USDC on Base", chain: "base", symbol: "USDC", assetId, decimals: 6 } : assetId === "nep141:tron-usdt" ? { id: assetId, label: "USDT on TRON", chain: "tron", symbol: "USDT", assetId, decimals: 6 } : null),
    quote: async (i) => ({ depositAddress: "0xdep1", amountIn: i.amount, amountOut: String(BigInt(i.amount) - 60_000n), fee: "60000", deadline: "2026-11-05T13:00:00Z", quoteId: "q", destinationToken: "usdc" as const, timeEstimate: 20, minAmountOut: "0", ticket: "t1" }),
  });

  it("fixes the amount, checks the stablecoin, records the deposit, and follows it to Paid", async () => {
    const v = await (await httpCreate(signed("POST", "/api/invoices", newBody), deps, gdeps)).json();
    await expect(startInvoicePayment({ invoiceId: v.id, originAsset: "nep141:tron-usdt", refundTo: "T1" }, pay())).rejects.toMatchObject({ code: "E_BAD_TOKEN" });
    const q = await startInvoicePayment({ invoiceId: v.id, originAsset: "nep141:base-usdc", refundTo: "0xabc" }, pay());
    expect(q.amountIn).toBe(U(120.5));
    let inv = (await s.getInvoice(v.id))!;
    expect(inv.payments).toHaveLength(1);
    expect(inv.payments[0]!.ticket).toBe("t1");

    await attachTicket(v.id, "0xdep1", null, "t2", deps);
    expect((await s.getInvoice(v.id))!.payments[0]!.ticket).toBe("t2");

    statuses.set("0xdep1", { status: "PROCESSING", updatedAt: "", nearTxHashes: [], depositedAmount: U(120.5), amountOut: null });
    inv = await refreshInvoice(inv, deps);
    expect(deriveStatus(inv, NOW).status).toBe("pending");
    await expect(startInvoicePayment({ invoiceId: v.id, originAsset: "nep141:base-usdc", refundTo: "0xabc" }, pay())).rejects.toMatchObject({ code: "E_INVOICE_BUSY" });

    statuses.set("0xdep1", { status: "SUCCESS", updatedAt: "", nearTxHashes: ["mintTx", "syncTx"], depositedAmount: U(120.5), amountOut: U(120.44) });
    deps.now = () => NOW + 10_000;
    inv = await refreshInvoice(inv, deps);
    const d = deriveStatus(inv, NOW);
    expect(d.status).toBe("paid");
    expect(d.received).toBe(120_440_000n);
    expect(d.txHashes).toEqual(["mintTx", "syncTx"]);
    await expect(startInvoicePayment({ invoiceId: v.id, originAsset: "nep141:base-usdc", refundTo: "0xabc" }, pay())).rejects.toMatchObject({ code: "E_INVOICE_PAID" });
    await expect(updateInvoice(OWNER, v.id, { state: "cancelled" }, deps)).rejects.toMatchObject({ code: "E_NOT_EDITABLE" });
  });
  it("refuses to pay drafts and cancelled invoices", async () => {
    const v = await (await httpCreate(signed("POST", "/api/invoices", newBody), deps, gdeps)).json();
    await updateInvoice(OWNER, v.id, { state: "cancelled" }, deps);
    await expect(startInvoicePayment({ invoiceId: v.id, originAsset: "nep141:base-usdc", refundTo: "0xabc" }, pay())).rejects.toMatchObject({ code: "E_INVOICE_CANCELLED" });
  });
});
