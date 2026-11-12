import { describe, expect, it } from "vitest";
import { aprToPercent, utilizationBps } from "../rates";
import { checkLimits, resetLimitsForTests, spendBudget, budgetRemaining } from "../ratelimit";
import { circleDue } from "../cron";

describe("rates", () => {
  it("Rhea supply_apr fraction -> percent string", () => {
    expect(aprToPercent("0.13922541140783164835990027")).toBe("13.92");
    expect(aprToPercent("0")).toBe("0.00");
    expect(aprToPercent("1.5")).toBe("150.00");
  });
  it("utilization from inner balances", () => {
    expect(utilizationBps({ supplied: { shares: "0", balance: "12171836098075789094464244" }, borrowed: { shares: "0", balance: "10832631929584303515756244" } })).toBe(8899);
    expect(utilizationBps({ supplied: { shares: "0", balance: "0" }, borrowed: { shares: "0", balance: "0" } })).toBe(0);
  });
});

describe("rate limits and budget", () => {
  it("limits per IP and per account", () => {
    resetLimitsForTests();
    const t = 1_000_000;
    for (let i = 0; i < 2; i++) expect(checkLimits("register", "1.1.1.1", "ada", t)).toBe(true);
    expect(checkLimits("register", "1.1.1.1", "ada", t)).toBe(false); // per account 2/h
    expect(checkLimits("register", "1.1.1.1", "bob", t)).toBe(true);
  });
  it("daily budget resets each UTC day", () => {
    resetLimitsForTests();
    const day = 86_400_000 * 20_000;
    expect(spendBudget(10n, 7n, day)).toBe(true);
    expect(spendBudget(10n, 7n, day)).toBe(false);
    expect(budgetRemaining(10n, day)).toBe(3n);
    expect(spendBudget(10n, 7n, day + 86_400_000)).toBe(true);
  });
});

describe("cron", () => {
  it("a circle round is due after start + (round+1) × period", () => {
    const c = { status: "active", start_at: "1000", round: 1, period_ns: "100" } as never;
    expect(circleDue(c, 1199n)).toBe(false);
    expect(circleDue(c, 1200n)).toBe(true);
    expect(circleDue({ ...(c as object), status: "forming" } as never, 5000n)).toBe(false);
  });
});

describe("shared limits across instances (review S-1)", () => {
  it("two server instances sharing one store give out the limit once, not once each", async () => {
    const { checkSharedLimits } = await import("../ratelimit");
    const { MemoryStore } = await import("../store");
    const shared = new MemoryStore();
    const t = 1_800_000_000_000;
    let ok = 0;
    for (let i = 0; i < 6; i++) if (await checkSharedLimits("register", "9.9.9.9", `name${i}`, shared, t)) ok++;
    expect(ok).toBe(5); // 5 per IP per hour, however many instances answer
    expect(await checkSharedLimits("register", "8.8.8.8", "carol", shared, t)).toBe(true);
    expect(await checkSharedLimits("register", "8.8.8.8", "carol", shared, t)).toBe(true);
    expect(await checkSharedLimits("register", "8.8.8.8", "carol", shared, t)).toBe(false); // 2 per account per hour
    expect(await checkSharedLimits("register", "8.8.8.8", "carol", shared, t + 3_600_000)).toBe(true); // next window
  });

  it("skips shared limits in local mode, so the e2e suite can sign up more than 5 accounts from one IP", async () => {
    const { checkSharedLimits, checkLimits } = await import("../ratelimit");
    const { MemoryStore } = await import("../store");
    const shared = new MemoryStore();
    const prev = process.env.OIKO_NETWORK;
    process.env.OIKO_NETWORK = "local";
    try {
      let sharedOk = 0;
      let memOk = 0;
      const t = 1_800_000_000_000;
      for (let i = 0; i < 8; i++) {
        if (await checkSharedLimits("register", "9.9.9.9", `name${i}`, shared, t)) sharedOk++;
        if (checkLimits("register", "9.9.9.9", `name${i}`, t)) memOk++;
      }
      expect(sharedOk).toBe(8);
      expect(memOk).toBe(8);
    } finally {
      if (prev === undefined) delete process.env.OIKO_NETWORK;
      else process.env.OIKO_NETWORK = prev;
    }
  });
});
