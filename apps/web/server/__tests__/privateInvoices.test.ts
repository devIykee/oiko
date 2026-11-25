// Private invoices (Veil): the owner's browser seals the details; the server stores and serves only ciphertext,
// the payer opens them with the key in the link's #fragment, and the owner's export opens them in the browser.
import { beforeEach, describe, expect, it } from "vitest";
import { PRIVATE_LABEL, Veil, gatewayAuthHeader, generateKeyPair, keyPairFromSeed } from "@oiko/sdk";
import type { GatewayDeps } from "../gateway";
import { httpCreate, httpExport, httpGet, httpList, httpPatch, type InvoiceDeps } from "../invoicesHttp";
import { serverConfig } from "../config";
import { MemoryStore } from "../store";
import { keyFromFragment, openCsv, openOwnerInvoice, openPublicInvoice, sealInvoiceInput } from "../../lib/sealedInvoice";
import type { InvoiceInput, OwnerInvoice, PublicInvoice } from "../../lib/invoices";

const root = serverConfig().oiko.root;
const OWNER = `ada.${root}`;
const appKey = keyPairFromSeed(new Uint8Array(32).fill(31));
const ownerKey = generateKeyPair();
const veil = Veil.fromOwnerKey(ownerKey.secretKey, OWNER);
const BASE = "http://localhost:3000";
let s: MemoryStore, deps: InvoiceDeps, gdeps: GatewayDeps;

beforeEach(() => {
  s = new MemoryStore();
  deps = {
    store: s, now: () => Date.parse("2026-11-05T12:00:00Z"), explorer: null,
    status: async () => ({ status: "PENDING_DEPOSIT", updatedAt: "", nearTxHashes: [], depositedAmount: null, amountOut: null }),
  };
  gdeps = {
    now: () => Date.now(), store: s,
    viewAccessKey: async (a, pk) => (a === OWNER && pk === appKey.publicKey ? { nonce: 1, permission: "FullAccess" } : null),
    getAgent: async () => null,
    isVaultId: (id) => id === `vault.${OWNER}`,
  };
});
const signed = (method: string, path: string, body = "") =>
  new Request(BASE + path, { method, body: body || undefined, headers: { authorization: gatewayAuthHeader(appKey.secretKey, OWNER, method, path, body), ...(body ? { "content-type": "application/json" } : {}) } });

const input: InvoiceInput = {
  fromName: "Ada Studio", client: { name: "Discreet Clinic, Ltd", email: "billing@clinic.test" },
  items: [{ description: "Session notes, November", quantity: "2", unitPrice: "60000000" }, { description: "=SUM(A1)", quantity: "1", unitPrice: "1000000" }],
  token: "usdc", dueDate: "2026-12-01", note: "Thanks, see you in December", state: "open",
};
const SECRETS = ["Ada Studio", "Discreet Clinic", "billing@clinic.test", "Session notes", "=SUM", "see you in December"];

async function create(): Promise<{ id: string; owner: OwnerInvoice & { shareKey: string | null } }> {
  const body = JSON.stringify(sealInvoiceInput(veil, OWNER, input));
  for (const x of SECRETS) expect(body).not.toContain(x);
  const r = await httpCreate(signed("POST", "/api/invoices", body), deps, gdeps);
  expect(r.status).toBe(201);
  const v = (await r.json()) as OwnerInvoice;
  return { id: v.id, owner: openOwnerInvoice(veil, v) };
}

describe("private invoices", () => {
  it("the server stores no names, emails, descriptions or notes, only amounts", async () => {
    const { id } = await create();
    const stored = JSON.stringify(await s.getInvoice(id));
    for (const x of SECRETS) expect(stored).not.toContain(x);
    expect(stored).toContain("60000000"); // the server still needs amounts to take payment
  });

  it("the owner opens everything with the view key and gets a link whose key is only in the #fragment", async () => {
    const { owner } = await create();
    expect(owner.client).toEqual({ name: "Discreet Clinic, Ltd", email: "billing@clinic.test" });
    expect(owner.items.map((i) => i.description)).toEqual(["Session notes, November", "=SUM(A1)"]);
    expect(owner.note).toBe("Thanks, see you in December");
    expect(owner.total).toBe("121000000");
    expect(owner.shareKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // another device without the view key, or a different owner key, sees "Private"
    const list = (await (await httpList(signed("GET", "/api/invoices"), deps, gdeps)).json()) as { invoices: OwnerInvoice[] };
    expect(openOwnerInvoice(null, list.invoices[0]!).client.name).toBe(PRIVATE_LABEL);
    expect(openOwnerInvoice(Veil.fromOwnerKey(generateKeyPair().secretKey, OWNER), list.invoices[0]!).client.name).toBe(PRIVATE_LABEL);
  });

  it("the payer opens the details with the fragment key; without it they read Private", async () => {
    const { id, owner } = await create();
    const pub = (await (await httpGet(new Request(`${BASE}/api/invoices/${id}`), id, deps, gdeps)).json()) as PublicInvoice;
    expect(pub.sealed?.keyBox).toBeUndefined(); // the payer never gets the owner's wrapped key
    expect(pub.total).toBe("121000000");
    const k = keyFromFragment(`#k=${owner.shareKey}`);
    const open = openPublicInvoice(pub, k);
    expect(open.unlocked).toBe(true);
    expect(open.fromName).toBe("Ada Studio");
    expect(open.client.name).toBe("Discreet Clinic, Ltd");
    expect(open.items[0]!.description).toBe("Session notes, November");
    const locked = openPublicInvoice(pub, null);
    expect(locked.private && !locked.unlocked).toBe(true);
    expect(locked.client.name).toBe(PRIVATE_LABEL);
    expect(locked.items[0]!.description).toBe(PRIVATE_LABEL);
    const wrong = openPublicInvoice(pub, "A".repeat(43));
    expect(wrong.unlocked).toBe(false);
  });

  it("editing keeps the same link key", async () => {
    const { id, owner } = await create();
    const patch = JSON.stringify(sealInvoiceInput(veil, OWNER, { ...input, note: "Updated" }, owner.sealed!.keyBox));
    const r = await httpPatch(signed("PATCH", `/api/invoices/${id}`, patch), id, deps, gdeps);
    expect(r.status).toBe(200);
    const again = openOwnerInvoice(veil, (await r.json()) as OwnerInvoice);
    expect(again.note).toBe("Updated");
    expect(again.shareKey).toBe(owner.shareKey);
  });

  it("the CSV export is opened in the browser, with RFC 4180 quoting and formula guards intact", async () => {
    await create();
    const csv = await (await httpExport(signed("GET", "/api/invoices/export.csv"), deps, gdeps)).text();
    for (const x of SECRETS) expect(csv).not.toContain(x);
    const opened = openCsv(veil, csv);
    expect(opened).toContain('"Discreet Clinic, Ltd"');
    expect(opened).toContain('"Session notes, November"');
    expect(opened).toContain("'=SUM(A1)");
    expect(opened.split("\r\n").length).toBe(csv.split("\r\n").length);
    expect(openCsv(null, csv)).toContain(`,${PRIVATE_LABEL},`);
  });

  it("refuses a box that isn't one", async () => {
    const bad = JSON.stringify({ ...input, sealed: { box: "plain text", keyBox: "x" } });
    expect((await httpCreate(signed("POST", "/api/invoices", bad), deps, gdeps)).status).toBe(400);
  });
});
