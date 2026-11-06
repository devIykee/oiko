// Dev-only fixture data and a tiny in-memory backend so screens can be built and screenshotted without the API.
// Never imported in production (see ./mode.ts).
import type { Activity, AgentView, Bill, Circle, MonthStats, Overview, Pot, Proposal } from "@oiko/sdk";
import { invoicesCsv, newInvoiceId, ownerView, publicView, invoiceNumber, type Invoice, type InvoicePayment } from "../../server/invoices";

const U = (n: number) => Math.round(n * 1e6).toString();
const NOW = Date.now();
const ns = (ms: number) => (BigInt(Math.round(ms)) * 1_000_000n).toString();
const DAY = 86_400_000;
const root = "oiko.testnet";
const vaultId = `vault.steve.${root}`;

const pot = (p: Partial<Pot> & Pick<Pot, "id" | "name" | "kind" | "color" | "icon">): Pot => ({
  balances: { usdc: "0", usdt: "0" }, earn_supplied: { usdc: "0", usdt: "0" }, unlock_at: null, target: null, target_date: null,
  earn: false, created_at: ns(NOW - 40 * DAY), ...p,
});

const pots: Pot[] = [
  pot({ id: 0, name: "Spend", kind: "flex", color: "blue", icon: "spend", balances: { usdc: U(212.4), usdt: U(310.15) } }),
  pot({ id: 1, name: "Bills", kind: "bills", color: "sun", icon: "bill", balances: { usdc: U(96), usdt: U(184.5) } }),
  pot({ id: 2, name: "Savings", kind: "autosave", color: "mint", icon: "savings", balances: { usdc: U(140), usdt: U(98.25) }, earn: true, earn_supplied: { usdc: U(60), usdt: U(0) } }),
  pot({ id: 3, name: "Rainy day", kind: "locked", color: "violet", icon: "rainy", balances: { usdc: U(0), usdt: U(150) }, unlock_at: ns(Date.UTC(2027, 0, 1)) }),
  pot({ id: 4, name: "Laptop", kind: "goal", color: "rose", icon: "goal", balances: { usdc: U(0), usdt: U(212) }, target: U(800), target_date: ns(Date.UTC(2027, 2, 1)) }),
];

const agents: AgentView[] = [
  {
    public_key: "ed25519:7xKfPq3d9aQmZ1Bv5yR8nTcWuE2hJ6sL4oD0gNpXyAbC", label: "Money coach", agent_name: "Claude (Money coach)", agent_url: "https://claude.ai",
    scopes: ["read", "propose"], allowed_actions: ["save", "move_between_pots"], allowlist: [], per_tx: U(0), daily: U(0), weekly: U(0),
    expires_at: ns(NOW + 60 * DAY), spent_day: [0, "0"], spent_week: [0, "0"], revoked: false, created_at: ns(NOW - 9 * DAY),
  },
  {
    public_key: "ed25519:3mQe8VwYb2LtR5uN9cXzHa1KjP7sD4fG6hT0oEiWqBnM", label: "Bill payer", agent_name: "Bill payer bot", agent_url: "",
    scopes: ["read", "propose", "act"], allowed_actions: ["pay"], allowlist: [{ type: "near", account_id: "metro-power-co.testnet" }, { type: "near", account_id: "brightline-fibre.testnet" }],
    per_tx: U(60), daily: U(80), weekly: U(120), expires_at: ns(NOW + 30 * DAY), spent_day: [Math.floor(NOW / DAY), U(45)], spent_week: [Math.floor(NOW / (7 * DAY)), U(101)],
    revoked: false, created_at: ns(NOW - 20 * DAY),
  },
];

const proposals: Proposal[] = [
  {
    id: 7, public_key: agents[0]!.public_key, agent_name: "Claude (Money coach)", action: { type: "save", to_pot: 4, token: "usdt", amount: U(25) },
    reason: "You spent less on food this week. Putting 25 USDT toward the laptop keeps you on track for March.",
    created_at: ns(NOW - 2 * 3600_000), expires_at: ns(NOW + 7 * DAY), status: "pending",
  },
];

const thisMonthDay = (d: number) => Date.UTC(new Date(NOW).getUTCFullYear(), new Date(NOW).getUTCMonth(), d);
const bills: Bill[] = [
  { id: 1, name: "Electricity", amount: U(35), token: "usdt", due_day: Math.min(28, new Date(NOW).getUTCDate() + 2), payee: "metro-power-co.testnet", pot_id: 1, last_paid_month: null, created_at: ns(NOW - 60 * DAY) },
  { id: 2, name: "Internet", amount: U(25), token: "usdc", due_day: 5, payee: "brightline-fibre.testnet", pot_id: 1, last_paid_month: Number(new Date(NOW).toISOString().slice(0, 7).replace("-", "")), created_at: ns(NOW - 60 * DAY) },
  { id: 3, name: "Rent share", amount: U(150), token: "usdt", due_day: 28, payee: "sam.oiko.testnet", pot_id: 1, last_paid_month: null, created_at: ns(NOW - 60 * DAY) },
];
void thisMonthDay;

let seq = 120;
const act0 = (h: number, a: Omit<Activity, "seq" | "at">): Activity => ({ seq: seq--, at: ns(NOW - h * 3600_000), ...a });
let activity: Activity[] = [
  act0(0.5, { kind: "deposit_received", by: "sync", token: "usdt", amount: U(200), pot_id: null, counterparty: "maya.oiko.testnet", note: null }),
  act0(0.5, { kind: "split_applied", by: "plan", token: "usdt", amount: U(200), pot_id: null, counterparty: null, note: null }),
  act0(5, { kind: "agent_action", by: `agent:${agents[1]!.public_key}`, token: "usdt", amount: U(35), pot_id: 1, counterparty: "metro-power-co.testnet", note: "pay" }),
  act0(26, { kind: "moved", by: "owner", token: "usdc", amount: U(40), pot_id: 2, counterparty: "pot:0", note: null }),
  act0(30, { kind: "withdrawn", by: "owner", token: "usdc", amount: U(60), pot_id: 0, counterparty: "exchange deposit", note: null }),
  act0(50, { kind: "bill_paid", by: "owner", token: "usdc", amount: U(25), pot_id: 1, counterparty: "brightline-fibre.testnet", note: "Internet" }),
  act0(74, { kind: "deposit_received", by: "sync", token: "usdc", amount: U(450), pot_id: null, counterparty: null, note: null }),
  act0(98, { kind: "locked", by: "owner", token: null, amount: null, pot_id: 3, counterparty: null, note: null }),
  act0(130, { kind: "agent_added", by: "owner", token: null, amount: null, pot_id: null, counterparty: "Bill payer bot", note: null }),
];

const month = (offset: number) => { const d = new Date(NOW); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - offset); return d.getUTCFullYear() * 100 + d.getUTCMonth() + 1; };
const stats: MonthStats[] = [5, 4, 3, 2, 1, 0].map((o, i) => {
  const inn = [380, 520, 410, 640, 590, 650][i]!, out = [300, 360, 330, 410, 380, 120][i]!, saved = [40, 90, 60, 150, 130, 140][i]!;
  return { month: month(o), in: { usdc: U(inn * 0.4), usdt: U(inn * 0.6) }, out: { usdc: U(out * 0.5), usdt: U(out * 0.5) }, saved: { usdc: U(saved / 2), usdt: U(saved / 2) } };
});

const sumB = (k: "balances" | "earn_supplied", f: (p: Pot) => boolean) => ({
  usdc: pots.filter(f).reduce((s, p) => s + BigInt(p[k].usdc), 0n).toString(),
  usdt: pots.filter(f).reduce((s, p) => s + BigInt(p[k].usdt), 0n).toString(),
});

let splits: Overview["splits"] = [{ pot_id: 1, mode: "percent", value: "3000" }, { pot_id: 2, mode: "percent", value: "2000" }, { pot_id: 3, mode: "percent", value: "1000" }, { pot_id: 4, mode: "percent", value: "1000" }];

function overview(): Overview {
  const all = sumB("balances", () => true), earn = sumB("earn_supplied", () => true);
  return {
    owner: `steve.${root}`, tokens: { usdc: `usdc.${root}`, usdt: `usdt.${root}` }, pots: structuredClone(pots),
    splits: structuredClone(splits),
    totals: { usdc: (BigInt(all.usdc) + BigInt(earn.usdc)).toString(), usdt: (BigInt(all.usdt) + BigInt(earn.usdt)).toString() },
    flex: structuredClone(pots[0]!.balances),
    locked: sumB("balances", (p) => !!p.unlock_at && BigInt(p.unlock_at) > BigInt(ns(Date.now()))),
    earning: earn, agents: structuredClone(agents.filter((a) => !a.revoked)), proposals: proposals.filter((p) => p.status === "pending"),
    schedules: [], bills: structuredClone(bills),
    config: { max_utilization_bps: 9200, large_withdrawal_threshold: U(1000), lending: `lending.${root}`, ajo: `ajo.${root}`, mpc_signer: null, agent_allowance: "250000000000000000000000" },
    accounted: all, now: ns(Date.now()),
  };
}

const circles: Circle[] = [{
  id: 3, name: "Office ROSCA", organiser: vaultId, token: "usdt", amount_per_round: U(50), period_ns: ns(7 * DAY), max_members: 5,
  members: [vaultId, "vault.maya.oiko.testnet", "vault.sam.oiko.testnet", "vault.lena.oiko.testnet"],
  order: ["vault.maya.oiko.testnet", vaultId, "vault.sam.oiko.testnet", "vault.lena.oiko.testnet"], bond_amount: U(50),
  bonds: { "vault.maya.oiko.testnet": U(50), [vaultId]: U(50) }, start_at: ns(NOW - 9 * DAY), round: 1,
  paid: [[0, "vault.maya.oiko.testnet"], [0, vaultId], [0, "vault.sam.oiko.testnet"], [0, "vault.lena.oiko.testnet"], [1, vaultId]], defaults: [],
  collected: U(50), status: "active", shuffle: false, payouts: [[0, "vault.maya.oiko.testnet", U(200)]],
}];

// ---------- invoices ----------
const iso = (ms: number) => new Date(ms).toISOString();
const isoDay = (ms: number) => iso(ms).slice(0, 10);
const EXPLORER = "https://testnet.nearblocks.io";
const fxPayment = (p: Partial<InvoicePayment>): InvoicePayment => ({
  depositAddress: "TQ9fixtureInvoice", depositMemo: null, ticket: null, originLabel: "USDT on TRON", originAsset: "nep141:tron-usdt", originDecimals: 6,
  amountIn: U(0), amountOut: U(0), fee: U(0), deadline: iso(NOW + 3600_000), createdAt: iso(NOW - 3600_000), status: "PENDING_DEPOSIT", updatedAt: iso(NOW - 3600_000),
  checkedAt: null, receivedAmount: null, depositedAmount: null, nearTxHashes: [], completedAt: null, ...p,
});
const fxInvoice = (p: Partial<Invoice> & Pick<Invoice, "id" | "number" | "client" | "items" | "token">): Invoice => ({
  owner: `steve.${root}`, fromName: "Steve Carter Design", issueDate: isoDay(NOW - 3 * DAY), dueDate: isoDay(NOW + 14 * DAY), note: null, state: "open",
  payments: [], createdAt: iso(NOW - 3 * DAY), updatedAt: iso(NOW - 3 * DAY), ...p,
});
const invoices: Invoice[] = [
  fxInvoice({
    id: "7Fq2LmXz9RkPw4TbNc8HsV", number: "INV-0006", client: { name: "Lena Fischer", email: "lena@fischer.example" }, token: "usdt",
    items: [{ description: "Translation, German to English (hours)", quantity: "7.5", unitPrice: U(40) }, { description: "Proofreading", quantity: "1", unitPrice: U(60) }],
    note: "Thank you, Lena. Payment within 14 days, please.", createdAt: iso(NOW - 1 * DAY), issueDate: isoDay(NOW - DAY),
  }),
  fxInvoice({
    id: "3bYk8QnWv5JtHc2RpMx7Ga", number: "INV-0005", client: { name: "Kofi & Co", email: null }, token: "usdc", createdAt: iso(NOW - 2 * DAY),
    items: [{ description: "Brand workshop", quantity: "1", unitPrice: U(300) }],
    payments: [fxPayment({ originLabel: "USDC on Base", amountIn: U(300), amountOut: U(299.85), fee: U(0.15), status: "PROCESSING", depositedAmount: U(300) })],
  }),
  fxInvoice({
    id: "9KcVt4ZpQ2mWx8RbLn6Hfd", number: "INV-0004", client: { name: "Northwind Studio", email: "accounts@northwind.example" }, token: "usdc", createdAt: iso(NOW - 9 * DAY),
    issueDate: isoDay(NOW - 9 * DAY), dueDate: isoDay(NOW + 5 * DAY),
    items: [{ description: "Website redesign", quantity: "1", unitPrice: U(850) }, { description: "Hosting setup", quantity: "1", unitPrice: U(45) }],
    payments: [fxPayment({ originLabel: "USDC on Base", amountIn: U(895), amountOut: U(894.55), fee: U(0.45), status: "SUCCESS", receivedAmount: U(894.55), depositedAmount: U(895),
      nearTxHashes: ["8vQn3XkL2mRt9WpZc4HbYs7JfGd5NaE1uKoPq6TxVy"], completedAt: iso(NOW - 2 * DAY), updatedAt: iso(NOW - 2 * DAY) })],
  }),
  fxInvoice({
    id: "5HtRw8NcKz3QbVm7Xp2LgJ", number: "INV-0003", client: { name: "Bright Path School", email: null }, token: "usdt", createdAt: iso(NOW - 25 * DAY),
    issueDate: isoDay(NOW - 25 * DAY), dueDate: isoDay(NOW - 4 * DAY),
    items: [{ description: "Yearbook layout", quantity: "40", unitPrice: U(6.5) }],
  }),
  fxInvoice({
    id: "2WmPx6RtQv9KbNc4HzLs8F", number: "INV-0007", client: { name: "Sam Mensah", email: null }, token: "usdt", state: "draft", createdAt: iso(NOW - 3600_000),
    items: [{ description: "Podcast cover art", quantity: "1", unitPrice: U(120) }],
  }),
  fxInvoice({
    id: "6NvLq3TbXw8ZkRm2Pc5HtY", number: "INV-0002", client: { name: "Acme Events", email: null }, token: "usdc", state: "cancelled", createdAt: iso(NOW - 40 * DAY),
    issueDate: isoDay(NOW - 40 * DAY), dueDate: isoDay(NOW - 26 * DAY), items: [{ description: "Event poster", quantity: "2", unitPrice: U(75) }],
  }),
];
const invoiceDeposits = new Map<string, string>();

function invoiceHandler(p: string, method: string, b: Record<string, unknown>): unknown {
  const now = Date.now();
  if (p === "/api/invoices/export.csv") return invoicesCsv(invoices, now, EXPLORER);
  if (p === "/api/invoices" && method === "GET") return { storage: "memory", invoices: [...invoices].sort((x, y) => y.createdAt.localeCompare(x.createdAt)).map((i) => ownerView(i, now, EXPLORER)) };
  if (p === "/api/invoices" && method === "POST") {
    const max = Math.max(0, ...invoices.map((i) => Number(i.number.slice(4))));
    const inv = fxInvoice({ ...(b as unknown as Invoice), id: newInvoiceId(), number: invoiceNumber(max + 1), issueDate: isoDay(now), createdAt: iso(now), updatedAt: iso(now), state: (b.state as Invoice["state"]) ?? "open", note: (b.note as string) ?? null });
    invoices.push(inv);
    return ownerView(inv, now, EXPLORER);
  }
  const id = decodeURIComponent(p.slice("/api/invoices/".length));
  const inv = invoices.find((i) => i.id === id);
  if (!inv || (method === "GET" && inv.state === "draft")) throw Object.assign(new Error("E_NOT_FOUND"), { code: "E_NOT_FOUND" });
  if (method === "PATCH") {
    Object.assign(inv, Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)), { updatedAt: iso(now) });
    return ownerView(inv, now, EXPLORER);
  }
  return publicView(inv, now, EXPLORER);
}

const deposits = new Map<string, { created: number; simulated: number | null }>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function handle(path: string, method: string, body: unknown): Promise<unknown> {
  await sleep(250);
  const p = path.split("?")[0]!;
  const b = (body ?? {}) as Record<string, string>;
  if (p === "/api/config") return { network: "testnet", root, contracts: { registry: root, usdc: `usdc.${root}`, usdt: `usdt.${root}`, lending: `lending.${root}`, ajo: `ajo.${root}`, mpcSigner: null }, vaultCodeHash: "8Xq3fixture", explorer: "https://testnet.nearblocks.io", features: { earn: true, ajo: true, mcp: true, rescue: false, invest: false, ajoDao: false } };
  if (p === "/api/rates/earn") return { source: "fixture", fetchedAt: new Date(NOW - 300_000).toISOString(), assets: [{ token: "usdc", supplyApr: "0.0412", utilizationBps: 7840, paused: false }, { token: "usdt", supplyApr: "0.0388", utilizationBps: 9310, paused: true }] };
  if (p.startsWith("/api/names/")) {
    const name = decodeURIComponent(p.slice(11));
    const taken = ["steve", "maya", "sam", "admin"].includes(name);
    return { name, available: !taken && /^[a-z0-9_-]{2,32}$/.test(name), accountId: `${name}.${root}`, vaultId: `vault.${name}.${root}`, exists: taken, suggestions: taken ? [`${name}1`, `${name}-ng`, `${name}_pay`] : [] };
  }
  if (p.startsWith("/api/receipts")) return { receipts: [
    { depositAddress: "TFixture1", amountIn: U(200.2), originDecimals: 6, amountOut: U(200), fee: U(0.2), token: "usdt", originSymbol: "USDT", createdAt: new Date(NOW - 0.6 * 3600_000).toISOString() },
  ] };
  if (p === "/api/billers") return { billers: [
    { accountId: "brightline-fibre.testnet", name: "Brightline Fibre", category: "internet" },
    { accountId: "metro-power-co.testnet", name: "Metro Power", category: "electricity" },
  ] };
  if (p === "/api/intents/tokens") return { groups: [
    { id: "tron-usdt", label: "USDT on TRON", chain: "tron", symbol: "USDT", assetId: "nep141:tron-usdt", decimals: 6 },
    { id: "base-usdc", label: "USDC on Base", chain: "base", symbol: "USDC", assetId: "nep141:base-usdc", decimals: 6 },
    { id: "bsc-usdt", label: "USDT on BNB Chain", chain: "bsc", symbol: "USDT", assetId: "nep141:bsc-usdt", decimals: 18 },
    { id: "eth-usdc", label: "USDC on Ethereum", chain: "eth", symbol: "USDC", assetId: "nep141:eth-usdc", decimals: 6 },
    { id: "sol-usdc", label: "USDC on Solana", chain: "sol", symbol: "USDC", assetId: "nep141:sol-usdc", decimals: 6 },
    { id: "arb-usdt", label: "USDT on Arbitrum", chain: "arb", symbol: "USDT", assetId: "nep141:arb-usdt", decimals: 6 },
  ] };
  if (p.startsWith("/api/invoices")) return invoiceHandler(p, method, (body ?? {}) as Record<string, unknown>);
  if (p === "/api/intents/deposit-address") {
    const addr = "TQ9fixture" + Math.random().toString(36).slice(2, 12).toUpperCase();
    deposits.set(addr, { created: Date.now(), simulated: null });
    const fxInv = b.invoiceId ? invoices.find((i) => i.id === b.invoiceId) : undefined;
    if (fxInv) invoiceDeposits.set(addr, fxInv.id);
    const amt = fxInv ? BigInt(ownerView(fxInv, Date.now(), EXPLORER).remaining) : BigInt(b.amount ?? "0");
    return { depositAddress: addr, depositMemo: null, amountIn: amt.toString(), amountOut: (amt - amt / 200n).toString(), fee: (amt / 200n).toString(), deadline: new Date(Date.now() + 30 * 60_000).toISOString(), quoteId: "q1", destinationToken: "usdt" };
  }
  if (p.startsWith("/api/intents/status/")) {
    const d = deposits.get(decodeURIComponent(p.slice(20)));
    if (!d?.simulated) return { status: "PENDING_DEPOSIT", updatedAt: new Date().toISOString() };
    const el = Date.now() - d.simulated;
    const status = el < 2500 ? "KNOWN_DEPOSIT_TX" : el < 6000 ? "PROCESSING" : "SUCCESS";
    const addr = decodeURIComponent(p.slice(20));
    const fxInv = invoices.find((i) => i.id === invoiceDeposits.get(addr));
    if (fxInv && !fxInv.payments.some((x) => x.depositAddress === addr && x.status === "SUCCESS")) {
      const amt = ownerView(fxInv, Date.now(), EXPLORER).remaining;
      fxInv.payments = [...fxInv.payments.filter((x) => x.depositAddress !== addr), fxPayment({
        depositAddress: addr, amountIn: amt, amountOut: (BigInt(amt) - BigInt(amt) / 200n).toString(), fee: (BigInt(amt) / 200n).toString(),
        status, createdAt: new Date(d.created).toISOString(), updatedAt: new Date().toISOString(), receivedAmount: status === "SUCCESS" ? (BigInt(amt) - BigInt(amt) / 200n).toString() : null,
        nearTxHashes: status === "SUCCESS" ? ["Fx" + addr.slice(-10) + "mintTx", "Fx" + addr.slice(-10) + "syncTx"] : [], completedAt: status === "SUCCESS" ? new Date().toISOString() : null,
      })];
    }
    return { status, updatedAt: new Date().toISOString() };
  }
  if (p === "/api/intents/simulate-deposit") { const d = deposits.get(b.depositAddress ?? ""); if (d) d.simulated = Date.now(); return { ok: true }; }
  if (p === "/api/intents/withdraw-quote") {
    const amt = BigInt(b.amount ?? "0");
    return { depositAddress: "a1b2c3fixture.near", amountIn: amt.toString(), amountOut: (amt - 1_000_000n > 0n ? amt - 1_000_000n : 0n).toString(), fee: "1000000", deadline: new Date(Date.now() + 10 * 60_000).toISOString(), timeEstimate: 45 };
  }
  if (p === "/api/register") { await sleep(1200); return { accountId: `${b.name}.${root}`, vaultId: `vault.${b.name}.${root}`, txHash: "fixtureTx1" }; }
  if (p === "/api/relay") { await sleep(1200); return { txHash: "fixtureTx2", outcome: {} }; }
  if (p === "/api/topup" || p === "/api/sync") return { txHash: null };
  if (p === "/api/stats") return { names: 42, source: "registry" };
  if (p.startsWith("/api/agent/log")) return { rows: [
    { at: new Date(NOW - 5 * 3600_000).toISOString(), method: "POST", path: "/api/agent/submit", status: 200, outcome: "Approved", summary: "Payment · 35.00 USDT to metro-power-co.testnet", reason: null },
    { at: new Date(NOW - 5.1 * 3600_000).toISOString(), method: "GET", path: "/api/agent/bills", status: 200, outcome: "Read", summary: "Read bills", reason: null },
    { at: new Date(NOW - 26 * 3600_000).toISOString(), method: "POST", path: "/api/agent/prepare", status: 403, code: "E_NOT_ALLOWLISTED", outcome: "Blocked", summary: "Payment · 50.00 USDT to urgent-refund-desk.testnet", reason: "Blocked: That recipient isn't on the agent's list." },
    { at: new Date(NOW - 30 * 3600_000).toISOString(), method: "POST", path: "/api/agent/submit", status: 422, code: "E_CAP_WEEK", outcome: "Blocked", summary: "Payment · 90.00 USDT to brightline-fibre.testnet", reason: "Blocked: The agent has reached its weekly limit." },
  ] };
  if (p === "/api/owner/changes") return { changes: fixtureChanges.map((c) => ({ ...c, calls: c.status === "pending" ? [{ method: "setSplits", args: [(c.change as { rules: unknown }).rules] }] : [], problem: null })) };
  if (p.startsWith("/api/owner/changes/")) {
    const c = fixtureChanges.find((x) => x.id === decodeURIComponent(p.slice(19)));
    if (c) Object.assign(c, { status: b.decision === "approve" ? "approved" : "rejected", decidedAt: new Date().toISOString(), txHashes: b.txHashes ?? [] });
    return { ...c, calls: [], problem: null };
  }
  if (p === "/api/owner/autopilot") {
    if (method === "POST") fixtureAutopilot = { ...b, updatedAt: new Date().toISOString() };
    return { autopilot: fixtureAutopilot };
  }
  // vault views (virtual paths)
  if (p === "vault:overview") return overview();
  if (p === "vault:activity") return structuredClone(activity);
  if (p === "vault:proposals:all") return [...structuredClone(overview().proposals), { ...structuredClone(overview().proposals[0]!), id: 3, status: "approved" }];
  if (p === "vault:stats") return structuredClone(stats);
  if (p === "ajo:circles") return structuredClone(circles);
  if (p.startsWith("ajo:circle:")) return structuredClone(circles.find((c) => c.id === Number(p.slice(11))) ?? null);
  throw Object.assign(new Error(`fixture: no handler for ${method} ${p}`), { code: "E_NOT_FOUND" });
}

// Agent change proposals and autopilot (owner endpoints), for screenshots.
const fixtureChanges: Array<Record<string, unknown> & { id: string; status: string; change: unknown }> = [{
  id: "chg_fixture1", publicKey: "ed25519:7xKfPq3d9aQmZ1Bv5yR8nTcWuE2hJ6sL4oD0gNpXyAbC", agentName: "Claude (Money coach)",
  change: { type: "set_splits", rules: [{ pot_id: 1, mode: "percent", value: "3500" }, { pot_id: 2, mode: "percent", value: "2000" }, { pot_id: 3, mode: "percent", value: "1000" }, { pot_id: 4, mode: "percent", value: "1000" }] },
  reason: "Your bills went up by 45.00 this month. 35% to Bills covers them without touching Spend.",
  summary: "Change your plan to: Bills 35%, Savings 20%, Rainy day 10%, Laptop 10%, Spend gets the rest (25%).",
  status: "pending", createdAt: new Date(NOW - 2 * 3600_000).toISOString(), expiresAt: new Date(NOW + 6 * 86_400_000).toISOString(), decidedAt: null, txHashes: [], invoiceId: null,
}];
let fixtureAutopilot: Record<string, unknown> = {
  top_up_bills: { on: true }, sweep_spend: { on: false, above: U(300), to_pot: 2, weekday: 5 }, pay_bills_on_due_day: { on: true }, spend_floor: null, updatedAt: null,
};

const ok = (value?: unknown) => ({ txHash: "fx" + Math.random().toString(36).slice(2, 10), ok: true, value, logs: [] as string[] });
const pushAct = (a: Omit<Activity, "seq" | "at">) => { activity = [{ seq: 200 + activity.length, at: ns(Date.now()), ...a }, ...activity]; };

export async function act(name: string, args: unknown[]): Promise<{ txHash: string; ok: boolean; value?: unknown; logs: string[] }> {
  await sleep(900);
  const [a0, a1, a2, a3] = args as [any, any, any, any];
  const potById = (id: number) => pots.find((p) => p.id === id)!;
  const sub = (p: Pot, t: "usdc" | "usdt", amt: string) => {
    if (p.unlock_at && BigInt(p.unlock_at) > BigInt(ns(Date.now()))) throw new Error("E_LOCKED: pot is locked");
    if (BigInt(p.balances[t]) < BigInt(amt)) throw new Error("E_INSUFFICIENT: not enough");
    p.balances[t] = (BigInt(p.balances[t]) - BigInt(amt)).toString();
  };
  const addTo = (p: Pot, t: "usdc" | "usdt", amt: string) => { p.balances[t] = (BigInt(p.balances[t]) + BigInt(amt)).toString(); };
  switch (name) {
    case "moveFunds": sub(potById(a0), a2, a3); addTo(potById(a1), a2, a3); pushAct({ kind: "moved", by: "owner", token: a2, amount: a3, pot_id: a1, counterparty: `pot:${a0}`, note: null }); return ok();
    case "withdraw": case "withdrawLarge": sub(potById(a0), a1, a2); pushAct({ kind: "withdrawn", by: "owner", token: a1, amount: a2, pot_id: a0, counterparty: a3, note: null }); return ok();
    case "createPot": { const id = Math.max(...pots.map((p) => p.id)) + 1; pots.push(pot({ id, name: a0.name, kind: a0.kind, color: a0.color, icon: a0.icon, target: a0.target ?? null, created_at: ns(Date.now()) })); return ok(id); }
    case "updatePot": Object.assign(potById(a0), Object.fromEntries(Object.entries(a1).filter(([, v]) => v !== undefined))); return ok();
    case "deletePot": { const i = pots.findIndex((p) => p.id === a0); if (i > 0) pots.splice(i, 1); return ok(); }
    case "lock": case "extendLock": potById(a0).unlock_at = a1; pushAct({ kind: "locked", by: "owner", token: null, amount: null, pot_id: a0, counterparty: null, note: null }); return ok();
    case "earnOn": { const p = potById(a0); sub(p, a1, a2); p.earn_supplied[a1 as "usdc"] = (BigInt(p.earn_supplied[a1 as "usdc"]) + BigInt(a2)).toString(); p.earn = true; return ok(); }
    case "earnOff": { const p = potById(a0); p.earn_supplied[a1 as "usdc"] = (BigInt(p.earn_supplied[a1 as "usdc"]) - BigInt(a2)).toString(); addTo(p, a1, a2); return ok(); }
    case "approveProposal": { const pr = proposals.find((x) => x.id === a0)!; pr.status = "approved"; if (pr.action.type === "save") { sub(potById(0), pr.action.token, pr.action.amount); addTo(potById(pr.action.to_pot), pr.action.token, pr.action.amount); } return ok(); }
    case "rejectProposal": proposals.find((x) => x.id === a0)!.status = "rejected"; return ok();
    case "revokeAgent": { const ag = agents.find((x) => x.public_key === a0); if (ag) ag.revoked = true; pushAct({ kind: "agent_revoked", by: "owner", token: null, amount: null, pot_id: null, counterparty: ag?.agent_name ?? null, note: null }); return ok(); }
    case "addAgent": agents.push({ ...a1, public_key: a0, spent_day: [0, "0"], spent_week: [0, "0"], revoked: false, created_at: ns(Date.now()) }); return ok();
    case "payBill": { const bl = bills.find((x) => x.id === a0)!; sub(potById(bl.pot_id), bl.token, bl.amount); bl.last_paid_month = Number(new Date().toISOString().slice(0, 7).replace("-", "")); pushAct({ kind: "bill_paid", by: "owner", token: bl.token, amount: bl.amount, pot_id: bl.pot_id, counterparty: bl.payee, note: bl.name }); return ok(); }
    case "addBill": bills.push({ id: Math.max(0, ...bills.map((x) => x.id)) + 1, ...a0, last_paid_month: null, created_at: ns(Date.now()) }); return ok();
    case "removeBill": { const i = bills.findIndex((x) => x.id === a0); if (i >= 0) bills.splice(i, 1); return ok(); }
    case "setSplits": splits = a0; return ok();
    case "ajoContribute": case "ajoJoin": case "ajoPostBond": case "ajoCreate": return ok(3);
    default: return ok();
  }
}
