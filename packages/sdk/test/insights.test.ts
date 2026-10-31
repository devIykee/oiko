import { describe, expect, it } from "vitest";
import { billStatus, computeInsights, goalEta, splitPreview, friendlyError, ERROR_CODES } from "../src";
import type { Activity, Bill, MonthStats, Pot } from "../src";

const ns = (iso: string) => (BigInt(Date.parse(iso)) * 1_000_000n).toString();
const U = (n: number) => String(n * 1_000_000);

// Fixture month: March 2026. Hand-computed:
//   in  = 500 USDC + 300 USDT = 800;  out = 120 USDC + 80 USDT = 200;  saved = 100 USDC + 60 USDT = 160
//   savings rate = 160 / 800 = 20.00% = 2000 bps
//   payees (March only): landlord.near 150 (100 + 50), shop.near 50 (bill), agent pay to grocer.near 30 -> top: landlord 150, shop 50, grocer 30
const stats: MonthStats[] = [
  { month: 202601, in: { usdc: U(400), usdt: U(0) }, out: { usdc: U(100), usdt: U(0) }, saved: { usdc: U(50), usdt: U(0) } },
  { month: 202603, in: { usdc: U(500), usdt: U(300) }, out: { usdc: U(120), usdt: U(80) }, saved: { usdc: U(100), usdt: U(60) } },
];
const row = (seq: number, at: string, kind: string, amount: number | null, counterparty: string | null, pot_id: number | null = 0, token: "usdc" | "usdt" = "usdc", note: string | null = null): Activity =>
  ({ seq, at: ns(at), kind, by: "owner", token, amount: amount === null ? null : U(amount), pot_id, counterparty, note });
const activity: Activity[] = [
  row(1, "2026-02-27T10:00:00Z", "withdrawn", 999, "landlord.near"), // February: excluded
  row(2, "2026-03-01T09:00:00Z", "deposit_received", 800, "payer.near"), // inflow: not a payee
  row(3, "2026-03-02T09:00:00Z", "withdrawn", 100, "landlord.near"),
  row(4, "2026-03-10T09:00:00Z", "bill_paid", 50, "shop.near", 2, "usdt"),
  row(5, "2026-03-15T09:00:00Z", "withdrawn", 50, "landlord.near", 0, "usdt"),
  row(6, "2026-03-20T09:00:00Z", "agent_action", 30, "grocer.near"),
  row(7, "2026-03-21T09:00:00Z", "moved", 40, "pot:0", 3),
  row(8, "2026-04-01T00:00:00Z", "withdrawn", 70, "landlord.near"), // April: excluded
];

describe("computeInsights", () => {
  it("matches the hand-computed March 2026 fixture", () => {
    const r = computeInsights(stats, activity, 202603);
    expect(r.moneyIn).toEqual({ usdc: U(500), usdt: U(300) });
    expect(r.moneyOut).toEqual({ usdc: U(120), usdt: U(80) });
    expect(r.saved).toEqual({ usdc: U(100), usdt: U(60) });
    expect(r.savingsRateBps).toBe(2000);
    expect(r.topPayees).toEqual([{ to: "landlord.near", amount: U(150) }, { to: "shop.near", amount: U(50) }, { to: "grocer.near", amount: U(30) }]);
    expect(r.trend.map((m) => m.month)).toEqual([202510, 202511, 202512, 202601, 202602, 202603]);
    expect(r.trend[3]!.in.usdc).toBe(U(400));
    expect(r.trend[4]!.in).toEqual({ usdc: "0", usdt: "0" });
  });
  it("empty month is zero with 0 bps", () => {
    const r = computeInsights([], [], 202605);
    expect(r.savingsRateBps).toBe(0);
    expect(r.topPayees).toEqual([]);
  });
});

const pot = (p: Partial<Pot>): Pot => ({ id: 0, name: "Spend", icon: "", color: "", kind: "flex", balances: { usdc: "0", usdt: "0" }, earn_supplied: { usdc: "0", usdt: "0" },
  unlock_at: null, target: null, target_date: null, earn: false, created_at: ns("2025-01-01T00:00:00Z"), ...p });
const pots = [pot({}), pot({ id: 1, name: "Bills", kind: "bills" }), pot({ id: 2, name: "Savings", kind: "autosave" }), pot({ id: 3, name: "Laptop", kind: "goal" })];

describe("splitPreview", () => {
  it("100 USDT: 30% bills, 20% savings, 10 fixed laptop, rest Spend", () => {
    const r = splitPreview([{ pot_id: 1, mode: "percent", value: "3000" }, { pot_id: 2, mode: "percent", value: "2000" }, { pot_id: 3, mode: "fixed", value: U(10) }], U(100), pots);
    expect(r).toEqual([
      { pot_id: 1, name: "Bills", amount: U(30) }, { pot_id: 2, name: "Savings", amount: U(20) },
      { pot_id: 3, name: "Laptop", amount: U(10) }, { pot_id: 0, name: "Spend", amount: U(40) },
    ]);
  });
  it("caps fixed rules at what is left and floors percents", () => {
    const r = splitPreview([{ pot_id: 1, mode: "percent", value: "3333" }, { pot_id: 3, mode: "fixed", value: U(50) }], "10", pots);
    expect(r).toEqual([{ pot_id: 1, name: "Bills", amount: "3" }, { pot_id: 3, name: "Laptop", amount: "7" }, { pot_id: 0, name: "Spend", amount: "0" }]);
  });
});

describe("goalEta", () => {
  const now = Date.parse("2026-03-31T00:00:00Z");
  it("uses the 30-day inflow pace", () => {
    // Laptop: has 100, target 400 -> 300 left; 30-day inflow 150 (moved 40 + split 110) -> 5/day -> 60 days
    const laptop = pot({ id: 3, name: "Laptop", kind: "goal", target: U(400), balances: { usdc: U(100), usdt: "0" } });
    const acts = [row(1, "2026-03-21T09:00:00Z", "moved", 40, null, 0, "usdc", "to pot 3"), row(2, "2026-03-05T00:00:00Z", "split_applied", 110, null, 3), row(3, "2026-01-01T00:00:00Z", "split_applied", 999, null, 3)];
    const r = goalEta(laptop, acts, now);
    expect(r.etaMs).toBe(now + 60 * 86_400_000);
    expect(r.assumption).toContain("35.00 USDC + USDT a week");
  });
  it("no inflow -> null; reached -> 0", () => {
    expect(goalEta(pot({ id: 3, target: U(10) }), [], now).etaMs).toBeNull();
    expect(goalEta(pot({ id: 3, target: U(10), balances: { usdc: U(10), usdt: "0" } }), [], now).etaMs).toBe(0);
  });
});

describe("billStatus", () => {
  const bill: Bill = { id: 1, name: "Rent", amount: U(100), token: "usdt", due_day: 15, payee: "landlord.near", pot_id: 1, last_paid_month: null, created_at: ns("2026-01-01T00:00:00Z") };
  it("upcoming / due / missed / paid", () => {
    expect(billStatus(bill, Date.parse("2026-03-05T00:00:00Z")).status).toBe("upcoming");
    expect(billStatus(bill, Date.parse("2026-03-12T00:00:00Z")).status).toBe("due");
    expect(billStatus(bill, Date.parse("2026-03-15T20:00:00Z")).status).toBe("due");
    expect(billStatus(bill, Date.parse("2026-03-16T00:00:00Z")).status).toBe("missed");
    const paid = billStatus({ ...bill, last_paid_month: 202603 }, Date.parse("2026-03-20T00:00:00Z"));
    expect(paid.status).toBe("paid");
    expect(paid.nextDue.toISOString()).toBe("2026-04-15T00:00:00.000Z");
  });
  it("a bill created after this month's due day starts next month", () => {
    const r = billStatus({ ...bill, created_at: ns("2026-03-20T00:00:00Z") }, Date.parse("2026-03-21T00:00:00Z"));
    expect(r).toEqual({ status: "upcoming", nextDue: new Date("2026-04-15T00:00:00Z") });
  });
});

describe("friendlyError", () => {
  it("maps codes found inside panic messages", () => {
    const e = friendlyError("Smart contract panicked: E_LOCKED: pot is locked until 1798761600000000000");
    expect(e.code).toBe("E_LOCKED");
    expect(e.title).toMatch(/locked/);
  });
  it("covers every code named in the frozen contract interface", () => {
    for (const c of ["E_LOCKED", "E_LARGE", "E_FLEX_EARN"]) expect(ERROR_CODES).toContain(c);
  });
  it("covers every code the contracts use (scanned from contracts/**/*.rs when present)", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = join(new URL(".", import.meta.url).pathname, "../../../contracts");
    const codes = new Set<string>();
    const walk = (d: string) => { let es: string[] = []; try { es = readdirSync(d); } catch { return; }
      for (const e of es) { if (e === "target") continue; const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (e.endsWith(".rs")) for (const m of readFileSync(p, "utf8").matchAll(/"(E_[A-Z0-9_]+)"/g)) codes.add(m[1]!); } };
    walk(root);
    const missing = [...codes].filter((c) => !ERROR_CODES.includes(c));
    expect(missing).toEqual([]);
  });
  it("falls back by family and for unknown codes", () => {
    expect(friendlyError("E_AGENT_SOMETHING_NEW").title).toMatch(/agent/i);
    expect(friendlyError("E_ZZZ").code).toBe("E_ZZZ");
    expect(friendlyError("random").code).toBe("E_UNKNOWN");
  });
  it("never uses banned words", () => {
    for (const c of ERROR_CODES) {
      const { title, next } = friendlyError(c);
      expect(`${title} ${next}`).not.toMatch(/\b(gas|seed phrase|bridge|RPC|chain ID|wallet|dollars?|USD)\b|\$\d/i);
    }
  });
});
