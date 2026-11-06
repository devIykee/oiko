import { describe, expect, it } from "vitest";
import { listReceipts, matchReceipt, recordReceipt, type Receipt } from "../receipts";
import { MemoryStore } from "../store";

const T = Date.parse("2026-11-05T12:00:00Z");
const r = (o: Partial<Receipt> = {}): Receipt => ({ depositAddress: "T1", amountIn: "400000000", originDecimals: 6, amountOut: "399800000", fee: "200000", token: "usdt", originSymbol: "USDT", createdAt: new Date(T).toISOString(), ...o });

describe("incoming payment receipts (fee shown on activity)", () => {
  it("records once per deposit address, newest first", async () => {
    const s = new MemoryStore();
    await recordReceipt("vault.ada.oiko.testnet", r(), s);
    await recordReceipt("vault.ada.oiko.testnet", r(), s);
    await recordReceipt("vault.ada.oiko.testnet", r({ depositAddress: "T2" }), s);
    expect((await listReceipts("vault.ada.oiko.testnet", s)).map((x) => x.depositAddress)).toEqual(["T2", "T1"]);
  });
  it("matches an arrival by amount, token and time (closest quote before it)", () => {
    const list = [r({ depositAddress: "old", createdAt: new Date(T - 5 * 3600_000).toISOString() }), r({ depositAddress: "near", createdAt: new Date(T - 60_000).toISOString() })];
    expect(matchReceipt(list, { amount: "399800000", token: "usdt", atMs: T })?.depositAddress).toBe("near");
    expect(matchReceipt(list, { amount: "399800000", token: "usdc", atMs: T })).toBeNull();
    expect(matchReceipt(list, { amount: "1", token: "usdt", atMs: T })).toBeNull();
    expect(matchReceipt(list, { amount: "399800000", token: "usdt", atMs: T + 7 * 3600_000 })).toBeNull();
  });
});
