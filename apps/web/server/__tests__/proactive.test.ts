import { describe, expect, it } from "vitest";
import { changeCalls, describeChange, validateChange, type Activity, type AgentView, type Bill, type Overview, type Pot } from "@oiko/sdk";
import { createHmac } from "node:crypto";
import { monthBrief } from "../brief";
import { decideChange, listChanges, proposeChange, type ChangeDeps } from "../changes";
import { DEFAULT_AUTOPILOT, deriveEvents, eventsSince, type AutopilotSettings, type EventInputs } from "../events";
import type { AuthedAgent } from "../gateway";
import { howToFix } from "../howToFix";
import { invoiceDeps } from "../invoicesHttp";
import type { Invoice } from "../invoices";
import { MemoryStore } from "../store";
import { checkWebhookUrl, deliver, registerWebhook, signWebhook, webhookKey, type Webhook } from "../webhooks";

const NOW = Date.UTC(2026, 10, 12, 9, 0, 0); // Thu 12 Nov 2026 09:00 UTC
const ns = (ms: number) => (BigInt(ms) * 1_000_000n).toString();
const U = (n: number) => String(Math.round(n * 1_000_000));
const VAULT = "vault.ada.oiko.testnet";
const PK = "ed25519:9gCdSjExwnZ5V5NsBQExgXwUw8zCumg5njKyqLgwTSKR";

const pot = (p: Partial<Pot> & { id: number; name: string; kind: Pot["kind"] }): Pot => ({
  icon: "x", color: "mint", balances: { usdc: "0", usdt: "0" }, earn_supplied: { usdc: "0", usdt: "0" }, unlock_at: null, target: null, target_date: null,
  earn: false, created_at: ns(NOW - 60 * 86_400_000), ...p,
});
const bill = (b: Partial<Bill> & { id: number; due_day: number }): Bill => ({
  name: `Bill ${b.id}`, amount: U(50), token: "usdt", payee: "metro-power-co.testnet", pot_id: 1, last_paid_month: null, created_at: ns(NOW - 60 * 86_400_000), ...b,
});
function overview(o: Partial<Overview> = {}): Overview {
  return {
    owner: "ada.oiko.testnet", tokens: { usdc: "usdc.t", usdt: "usdt.t" },
    pots: [
      pot({ id: 0, name: "Spend", kind: "flex", balances: { usdc: "0", usdt: U(500) } }),
      pot({ id: 1, name: "Bills", kind: "bills", balances: { usdc: "0", usdt: U(30) } }),
      pot({ id: 2, name: "Savings", kind: "autosave", balances: { usdc: "0", usdt: U(200) } }),
      pot({ id: 3, name: "Laptop", kind: "goal", target: U(100), balances: { usdc: U(60), usdt: U(40) } }),
      pot({ id: 4, name: "Rainy day", kind: "locked", unlock_at: ns(NOW - 2 * 86_400_000), balances: { usdc: "0", usdt: U(10) } }),
    ],
    splits: [{ pot_id: 1, mode: "percent", value: "3000" }], totals: { usdc: "0", usdt: "0" }, flex: { usdc: "0", usdt: U(500) },
    locked: { usdc: "0", usdt: "0" }, earning: { usdc: "0", usdt: "0" }, agents: [], proposals: [], schedules: [], bills: [],
    config: { max_utilization_bps: 9000, large_withdrawal_threshold: U(1000), lending: "lending.t", ajo: null, mpc_signer: null, agent_allowance: "0" },
    accounted: { usdc: "0", usdt: "0" }, now: ns(NOW), ...o,
  };
}
const policy = (p: Partial<AgentView> = {}): AgentView => ({
  label: "Helper", agent_name: "Helper", agent_url: "", scopes: ["read", "propose", "act"], allowed_actions: ["pay", "move_between_pots", "save"],
  allowlist: [], per_tx: U(40), daily: U(50), weekly: U(100), expires_at: ns(NOW + 86_400_000), public_key: PK,
  spent_day: [0, "0"], spent_week: [0, "0"], revoked: false, created_at: "0", ...p,
});
const act = (seq: number, msAgo: number, a: Partial<Activity>): Activity => ({ seq, at: ns(NOW - msAgo), kind: "x", by: "sync", token: "usdt", amount: null, pot_id: null, counterparty: null, note: null, ...a });
const inputs = (x: Partial<EventInputs> = {}): EventInputs => ({
  vaultId: VAULT, overview: overview(), activity: [], invoices: [], circles: [], policy: policy(), autopilot: DEFAULT_AUTOPILOT, nowMs: NOW, ...x,
});
const types = (x: Partial<EventInputs>) => deriveEvents(inputs(x)).map((e) => e.type);

describe("events", () => {
  it("payment in and how the plan split it", () => {
    const at = 3_600_000;
    const evs = deriveEvents(inputs({ activity: [
      act(12, at, { kind: "split_applied", amount: U(30), pot_id: 1 }), act(11, at, { kind: "deposit_received", amount: U(100), counterparty: "maya.testnet" }),
    ] }));
    // The goal pot was last touched 60 days ago (outside the 30-day window), so only the lock release joins these.
    expect(evs.map((e) => e.id)).toEqual(["lock_released:4:" + ns(NOW - 2 * 86_400_000), "payment_received:11", "plan_applied:11"]);
    const pay = evs.find((e) => e.type === "payment_received")!;
    expect(pay.title).toBe("100.00 USDT arrived from maya.testnet");
    expect(evs.find((e) => e.type === "plan_applied")!.data.allocations).toEqual([{ pot_id: 1, pot_name: "Bills", amount: { units: U(30), token: "USDT", display: "30.00 USDT" } }]);
  });

  it("a bill due in 3 days with a short pot suggests a top-up from Spend; act only within caps", () => {
    const ov = overview({ bills: [bill({ id: 7, due_day: 14 })] });
    const e = deriveEvents(inputs({ overview: ov })).find((x) => x.type === "bill_due_soon")!;
    expect(e.id).toBe("bill_due_soon:7:2026-11-14");
    expect(e.at).toBe("2026-11-11T00:00:00.000Z");
    expect(e.suggested_actions).toEqual([{ kind: "act", action: { type: "move", from_pot: 0, to_pot: 1, token: "usdt", amount: U(20) }, reason: expect.stringContaining("Bills has 30.00 USDT but Bill 7 needs 50.00") }]);
    // Over the per-payment cap: propose instead.
    const big = overview({ bills: [bill({ id: 7, due_day: 14, amount: U(90) })] });
    expect(deriveEvents(inputs({ overview: big })).find((x) => x.type === "bill_due_soon")!.suggested_actions[0]!.kind).toBe("propose");
    // No propose scope: tell the owner.
    expect(deriveEvents(inputs({ overview: big, policy: policy({ scopes: ["read"] }) })).find((x) => x.type === "bill_due_soon")!.suggested_actions[0]!.kind).toBe("tell_owner");
  });

  it("due today: pay it, marked autopilot when the owner turned that on; missed bills show up", () => {
    const ov = overview({ bills: [bill({ id: 1, due_day: 12, amount: U(20) }), bill({ id: 2, due_day: 5, amount: U(5), name: "Phone" })] });
    const ap: AutopilotSettings = { ...DEFAULT_AUTOPILOT, pay_bills_on_due_day: { on: true } };
    const evs = deriveEvents(inputs({ overview: ov, autopilot: ap }));
    const today = evs.find((e) => e.type === "bill_due_today")!;
    expect(today.suggested_actions).toEqual([{ kind: "act", action: { type: "pay_bill", bill_id: 1 }, reason: expect.any(String), autopilot: "pay_bills_on_due_day" }]);
    const missed = evs.find((e) => e.type === "bill_missed")!;
    expect(missed.id).toBe("bill_missed:2:2026-11-05");
    expect(missed.suggested_actions[0]).toMatchObject({ kind: "act", action: { type: "pay_bill", bill_id: 2 } });
  });

  it("spend low, cap at 80%, weekly summary and invoices", () => {
    const ov = overview();
    const ap: AutopilotSettings = { ...DEFAULT_AUTOPILOT, spend_floor: U(600) };
    const week = Number((BigInt(NOW) * 1_000_000n) / (7n * 86_400_000_000_000n));
    const inv = {
      id: "inv1", number: "INV-0001", owner: "ada.oiko.testnet", fromName: "Ada", client: { name: "Acme", email: null }, items: [{ description: "Work", quantity: "1", unitPrice: U(10) }],
      token: "usdt", issueDate: "2026-10-01", dueDate: "2026-11-01", note: null, state: "open", payments: [], createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
    } as Invoice;
    const evs = deriveEvents(inputs({
      overview: ov, autopilot: ap, invoices: [inv], policy: policy({ spent_week: [week, U(85)] }),
      activity: [act(3, 5 * 86_400_000, { kind: "deposit_received", amount: U(70) }), act(4, 4 * 86_400_000, { kind: "withdrawn", amount: U(12), counterparty: "shop.testnet", pot_id: 0 })],
    }));
    const low = evs.find((e) => e.type === "spend_low")!;
    expect(low.suggested_actions[0]).toMatchObject({ kind: "propose", action: { type: "move", from_pot: 2, to_pot: 0, token: "usdt", amount: U(100) } });
    expect(evs.find((e) => e.type === "cap_80")!.data.used).toMatchObject({ units: U(85) });
    const wk = evs.find((e) => e.type === "weekly_summary")!;
    expect(wk.id).toBe("weekly_summary:2026-11-09");
    expect(wk.data).toMatchObject({ from: "2026-11-02", to: "2026-11-08", money_in: { units: U(70) }, money_out: { units: U(12) }, payments_in: 1 });
    expect(evs.find((e) => e.type === "invoice_overdue")!.id).toBe("invoice_overdue:inv1");
  });

  it("autopilot: top up Bills after a payment; sweep Spend above the line on the chosen weekday", () => {
    const ov = overview({ bills: [bill({ id: 1, due_day: 20, amount: U(80) })] });
    const ap: AutopilotSettings = { ...DEFAULT_AUTOPILOT, top_up_bills: { on: true }, sweep_spend: { on: true, above: U(300), to_pot: 2, weekday: 3 } };
    const evs = deriveEvents(inputs({ overview: ov, autopilot: ap, activity: [act(9, 600_000, { kind: "deposit_received", amount: U(100) })] }));
    const top = evs.find((e) => e.id === "autopilot_due:top_up_bills:9")!;
    expect(top.suggested_actions).toEqual([{ kind: "propose", action: { type: "move", from_pot: 0, to_pot: 1, token: "usdt", amount: U(50) }, reason: expect.stringContaining("Autopilot"), autopilot: "top_up_bills" }]);
    const sweep = evs.find((e) => e.id === "autopilot_due:sweep_spend:2026-11-11")!; // Wednesday
    expect(sweep.suggested_actions[0]).toMatchObject({ kind: "propose", action: { type: "save", to_pot: 2, token: "usdt", amount: U(200) }, autopilot: "sweep_spend" });
  });

  it("is deterministic, oldest first, and the cursor returns only newer events", () => {
    const x = inputs({ overview: overview({ bills: [bill({ id: 7, due_day: 14 })] }), activity: [act(1, 3_600_000, { kind: "deposit_received", amount: U(5) })] });
    const a = deriveEvents(x), b = deriveEvents(x);
    expect(a).toEqual(b);
    expect([...a].sort((p, q) => p.at.localeCompare(q.at))).toEqual(a);
    const first = eventsSince(a, undefined);
    expect(first.events).toEqual(a);
    expect(eventsSince(a, first.cursor).events).toEqual([]);
    const mid = a[1]!.at;
    expect(eventsSince(a, mid).events.every((e) => e.at > mid)).toBe(true);
    expect(eventsSince(a, String(Date.parse(mid))).events).toEqual(eventsSince(a, mid).events);
  });

  it("drops events older than 30 days", () => {
    expect(types({ activity: [act(1, 40 * 86_400_000, { kind: "deposit_received", amount: U(5) })] })).not.toContain("payment_received");
  });
});

describe("change proposals", () => {
  const ov = overview({ bills: [bill({ id: 3, due_day: 10 })] });
  it("validates against the account as it is", () => {
    expect(validateChange({ type: "set_splits", rules: [{ pot_id: 1, mode: "percent", value: "6000" }, { pot_id: 2, mode: "percent", value: "5000" }] }, ov, NOW)).toMatch(/110%/);
    expect(validateChange({ type: "set_splits", rules: [{ pot_id: 0, mode: "percent", value: "1000" }] }, ov, NOW)).toMatch(/Spend/);
    expect(validateChange({ type: "set_splits", rules: [{ pot_id: 1, mode: "percent", value: "4000" }] }, ov, NOW)).toBeNull();
    const locked = overview({ pots: [...ov.pots.slice(0, 4), pot({ id: 4, name: "Rainy day", kind: "locked", unlock_at: ns(Date.UTC(2027, 0, 1)) })] });
    expect(validateChange({ type: "lock", pot_id: 4, unlock_at: "2026-12-01" }, locked, NOW)).toMatch(/never shortened/);
    expect(validateChange({ type: "lock", pot_id: 4, unlock_at: "2027-02-01" }, locked, NOW)).toBeNull();
    expect(validateChange({ type: "lock", pot_id: 0, unlock_at: "2027-02-01" }, ov, NOW)).toMatch(/Spend/);
    expect(validateChange({ type: "earn", pot_id: 2, on: false }, ov, NOW)).toMatch(/Nothing/);
    expect(validateChange({ type: "remove_bill", bill_id: 9 }, ov, NOW)).toMatch(/no bill/);
    expect(validateChange({ type: "add_bill", name: "Rent", amount: U(500), token: "usdt", due_day: 31, payee: "landlord.testnet", pot_id: 1 }, ov, NOW)).toMatch(/1 to 28/);
  });
  it("maps to the owner's vault calls and a plain sentence", () => {
    const locked = overview({ pots: [...ov.pots.slice(0, 4), pot({ id: 4, name: "Rainy day", kind: "locked", unlock_at: ns(Date.UTC(2027, 0, 1)) })] });
    expect(changeCalls({ type: "lock", pot_id: 4, unlock_at: "2027-02-01" }, locked, NOW)).toEqual([{ method: "extendLock", args: [4, ns(Date.UTC(2027, 1, 1))] }]);
    expect(changeCalls({ type: "lock", pot_id: 2, unlock_at: "2027-02-01" }, locked, NOW)[0]!.method).toBe("lock");
    expect(changeCalls({ type: "earn", pot_id: 3, on: true }, ov, NOW)).toEqual([{ method: "earnOn", args: [3, "usdc", U(60)] }, { method: "earnOn", args: [3, "usdt", U(40)] }]);
    expect(describeChange({ type: "set_splits", rules: [{ pot_id: 1, mode: "percent", value: "3500" }, { pot_id: 2, mode: "percent", value: "2000" }] }, ov))
      .toBe("Change your plan to: Bills 35%, Savings 20%, Spend gets the rest (45%).");
    expect(describeChange({ type: "draft_invoice", client: { name: "Acme" }, items: [{ description: "Design", quantity: "7.5", unitPrice: U(40) }], token: "usdc", due_date: "2026-12-01" }, ov))
      .toBe("Draft an invoice to Acme for 300.00 USDC, due 2026-12-01. You review it before sending.");
  });

  const ctx = (p: Partial<AgentView> = {}): AuthedAgent => ({ kind: "agent", vaultId: VAULT, publicKey: PK, policy: policy(p) });
  const mk = () => {
    let now = NOW;
    const store = new MemoryStore();
    const deps: ChangeDeps = { store, now: () => now, overview: async () => ov };
    return { store, deps, tick: (ms: number) => { now += ms; } };
  };
  it("propose → owner approves; can't decide twice; other owners can't see it", async () => {
    const { deps } = mk();
    const p = await proposeChange(ctx(), { type: "set_splits", rules: [{ pot_id: 1, mode: "percent", value: "3500" }] }, "Bills went up this month.", deps);
    expect(p.status).toBe("pending");
    expect(p.calls).toEqual([{ method: "setSplits", args: [[{ pot_id: 1, mode: "percent", value: "3500" }]] }]);
    await expect(decideChange("bob.oiko.testnet", p.id, { decision: "approve", txHashes: [] }, deps)).rejects.toMatchObject({ code: "E_NOT_FOUND" });
    const done = await decideChange("ada.oiko.testnet", p.id, { decision: "approve", txHashes: ["abc"] }, deps);
    expect(done).toMatchObject({ status: "approved", txHashes: ["abc"] });
    await expect(decideChange("ada.oiko.testnet", p.id, { decision: "reject", txHashes: [] }, deps)).rejects.toMatchObject({ code: "E_PROPOSAL_CLOSED" });
  });
  it("refuses without propose scope, refuses invalid changes, expires after 7 days", async () => {
    const { deps, tick } = mk();
    await expect(proposeChange(ctx({ scopes: ["read", "act"] }), { type: "earn", pot_id: 2, on: true }, "Earn a little.", deps)).rejects.toMatchObject({ code: "E_SCOPE" });
    await expect(proposeChange(ctx(), { type: "earn", pot_id: 2, on: false }, "Stop.", deps)).rejects.toMatchObject({ code: "E_CHANGE_INVALID" });
    const p = await proposeChange(ctx(), { type: "earn", pot_id: 2, on: true }, "Earn a little.", deps);
    tick(7 * 86_400_000 + 1);
    expect((await listChanges(VAULT, deps))[0]!.status).toBe("expired");
    await expect(decideChange("ada.oiko.testnet", p.id, { decision: "approve", txHashes: [] }, deps)).rejects.toMatchObject({ code: "E_PROPOSAL_CLOSED" });
  });
  it("approving a draft invoice saves a draft for the owner to review", async () => {
    const { deps, store } = mk();
    const p = await proposeChange(ctx(), { type: "draft_invoice", client: { name: "Acme" }, items: [{ description: "Design", quantity: "2", unitPrice: U(40) }], token: "usdc", due_date: "2026-12-01" }, "You finished the logo.", deps);
    expect(p.calls).toEqual([]);
    const done = await decideChange("ada.oiko.testnet", p.id, { decision: "approve", txHashes: [] }, deps, { ...invoiceDeps(), store, now: () => NOW });
    const inv = await store.getInvoice(done.invoiceId!);
    expect(inv).toMatchObject({ owner: "ada.oiko.testnet", state: "draft", client: { name: "Acme" } });
  });
});

describe("month brief and how_to_fix", () => {
  it("summarises the month from stats and activity", () => {
    const ov = overview({ bills: [bill({ id: 1, due_day: 20, amount: U(80) })] });
    const stats = [
      { month: 202610, in: { usdc: "0", usdt: U(1000) }, out: { usdc: "0", usdt: U(400) }, saved: { usdc: "0", usdt: U(200) } },
      { month: 202611, in: { usdc: "0", usdt: U(1200) }, out: { usdc: "0", usdt: U(300) }, saved: { usdc: "0", usdt: U(360) } },
    ];
    const b = monthBrief(202611, stats, [act(1, 86_400_000, { kind: "withdrawn", amount: U(120), counterparty: "landlord.testnet" })], ov, NOW);
    expect(b.money_in.units).toBe(U(1200));
    expect(b.savings_rate_bps).toBe(3000);
    expect(b.vs_last_month).toEqual({ money_in_pct: 20, money_out_pct: -25, saved_pct: 80 });
    expect(b.biggest_outflows[0]).toMatchObject({ to: "landlord.testnet", amount: { units: U(120) } });
    expect(b.bill_shortfalls).toEqual([{ pot_id: 1, pot_name: "Bills", token: "USDT", needed: "80.00", has: "30.00", short: "50.00" }]);
    expect(b.facts).toContain("Bills is 50.00 USDT short of this month's bills.");
  });
  it("tells the agent exactly what to do", () => {
    const week = Number((BigInt(NOW) * 1_000_000n) / (7n * 86_400_000_000_000n));
    const p = policy({ spent_week: [week, U(90)] });
    expect(howToFix("E_CAP_WEEK", p, { type: "save", amount: U(25) }, NOW)).toMatch(/used 90.00 of your 100.00 weekly cap.*raise the weekly cap to at least 115.00/);
    expect(howToFix("E_NOT_ALLOWLISTED", p, { type: "pay", to: "shop.testnet", amount: U(5) })).toMatch(/add shop.testnet to your allowlist/);
    expect(howToFix("E_COUNTERPARTY_WARN")).toMatch(/propose/);
    expect(howToFix("E_LOCKED").length).toBeGreaterThan(20);
  });
});

describe("webhooks", () => {
  it("accepts only public https URLs (http://localhost only in local mode)", () => {
    expect(checkWebhookUrl("https://agent.example.com/hook", false)).toBe("https://agent.example.com/hook");
    for (const bad of ["http://agent.example.com", "https://localhost/x", "https://127.0.0.1/x", "https://10.1.2.3/", "https://[::1]/", "https://169.254.169.254/latest", "https://u:p@agent.example.com", "nope"]) {
      expect(() => checkWebhookUrl(bad, false), bad).toThrow();
    }
    expect(checkWebhookUrl("http://localhost:9999/hook", true)).toBe("http://localhost:9999/hook");
  });
  it("signs deliveries, doesn't resend delivered events, and switches off after 20 failures", async () => {
    const s = new MemoryStore();
    const reg = await registerWebhook(s, VAULT, PK, "https://agent.example.com/hook", NOW);
    const evs = deriveEvents(inputs({ activity: [act(1, 3_600_000, { kind: "deposit_received", amount: U(5) })] }));
    const sent: Array<{ body: string; headers: Record<string, string> }> = [];
    const okPost = async (_u: string, body: string, headers: Record<string, string>) => { sent.push({ body, headers }); return { ok: true, status: 200 }; };
    const w = () => s.getSetting<Webhook>(webhookKey(VAULT, PK)) as Promise<Webhook>;
    expect(await deliver(s, await w(), evs, NOW, okPost)).toBe(evs.length);
    const h = sent[0]!.headers;
    expect(h["x-oiko-signature"]).toBe(`sha256=${createHmac("sha256", reg.secret).update(`${h["x-oiko-timestamp"]}.${sent[0]!.body}`).digest("hex")}`);
    expect(signWebhook(reg.secret, NOW, sent[0]!.body)).toBe(h["x-oiko-signature"]);
    expect(await deliver(s, await w(), evs, NOW + 1, okPost)).toBe(0);
    const more = [...evs, { ...evs[0]!, id: "payment_received:99", at: new Date(NOW).toISOString() }];
    const failPost = async () => ({ ok: false, status: 500 });
    for (let i = 0; i < 20; i++) expect(await deliver(s, await w(), more, NOW + 2, failPost)).toBe(0);
    expect(await w()).toMatchObject({ disabled: true, failures: 20, lastError: "HTTP 500" });
  });
});
