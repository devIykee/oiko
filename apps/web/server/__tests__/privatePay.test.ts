import { afterEach, describe, expect, it } from "vitest";
import { cashOutFee, cashOutFor, gloamOrigin } from "../../lib/privatePay";
import { loadConfig, setServerConfig } from "../config";
import { gloamFeeBps, privatePayQuote, resetPrivatePayCacheForTests } from "../privatePay";

const BASE_USDC = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const TRON_USDT = "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near";
const word = (n: number) => "0x" + n.toString(16).padStart(64, "0");
/** A fake JSON-RPC endpoint that answers every eth_call with `result` and records the calls. */
function rpc(result: unknown, ok = true) {
  const calls: Array<{ url: string; body: { method: string; params: [{ to: string; data: string }, string] } }> = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: ok ? 200 : 503 });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const withFlag = (on: boolean) => {
  const c = loadConfig({ OIKO_NETWORK: "testnet", FEATURE_PRIVATE_PAY: on ? "true" : "" });
  setServerConfig(c);
};

afterEach(() => { setServerConfig(null); resetPrivatePayCacheForTests(); });

describe("Gloam cash-out math", () => {
  it("rounds the fee down like the pool", () => {
    expect(cashOutFee(100_000_000n, 50)).toBe(500_000n);
    expect(cashOutFee(199n, 50)).toBe(0n);
    expect(cashOutFee(12_345n, 50)).toBe(61n);
  });
  it("cashes out the smallest amount that still delivers the full payment", () => {
    for (const bps of [0, 1, 25, 50, 333, 9_999]) {
      for (const receive of [1n, 2n, 199n, 1_000_000n, 100_000_000n, 123_456_789n]) {
        const g = cashOutFor(receive, bps);
        expect(g - cashOutFee(g, bps)).toBeGreaterThanOrEqual(receive);
        expect(g - 1n - cashOutFee(g - 1n, bps)).toBeLessThan(receive);
      }
    }
    expect(cashOutFor(100_000_000n, 50)).toBe(100_502_512n); // 100 USDC arrives at 0.5%
    expect(() => cashOutFor(1n, 10_000)).toThrow();
  });
  it("only Gloam's Base and Ethereum USDC/USDT count", () => {
    expect(gloamOrigin(BASE_USDC)?.chainId).toBe(8453);
    expect(gloamOrigin(TRON_USDT)).toBeNull();
    expect(gloamOrigin("toString")).toBeNull();
  });
});

describe("Gloam fee read", () => {
  it("calls withdrawFeeBps() on the pool and caches it", async () => {
    const { f, calls } = rpc(word(50));
    expect(await gloamFeeBps(8453, "0xPool", f, 1_000)).toBe(50);
    expect(await gloamFeeBps(8453, "0xPool", f, 2_000)).toBe(50);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://mainnet.base.org");
    expect(calls[0].body.params[0]).toEqual({ to: "0xPool", data: "0x7aca2b59" });
  });
  it("is null, never a guess, when the answer is missing or not a fee", async () => {
    expect(await gloamFeeBps(1, "0xA", rpc("0x").f)).toBeNull();
    expect(await gloamFeeBps(1, "0xB", rpc(word(10_000)).f)).toBeNull();
    expect(await gloamFeeBps(1, "0xC", rpc(word(50), false).f)).toBeNull();
    expect(await gloamFeeBps(1, "0xD", (async () => { throw new Error("down"); }) as unknown as typeof fetch)).toBeNull();
  });
});

describe("private pay quote", () => {
  it("is refused while the flag is off (the default)", async () => {
    withFlag(false);
    await expect(privatePayQuote(BASE_USDC, "1000000", rpc(word(50)).f)).rejects.toMatchObject({ code: "E_DISABLED", status: 404 });
  });
  it("grosses up the amount when on", async () => {
    withFlag(true);
    expect(await privatePayQuote(BASE_USDC, "100000000", rpc(word(50)).f)).toMatchObject({ receive: "100000000", feeBps: 50, cashOut: "100502512", chainId: 8453 });
  });
  it("gives no amount when the fee can't be read, and refuses other places and bad amounts", async () => {
    withFlag(true);
    expect(await privatePayQuote(BASE_USDC, "5", rpc("0x").f)).toMatchObject({ feeBps: null, cashOut: null });
    await expect(privatePayQuote(TRON_USDT, "5", rpc(word(50)).f)).rejects.toMatchObject({ code: "E_BAD_REQUEST" });
    for (const bad of ["", "0", "-1", "1.5", "01"]) await expect(privatePayQuote(BASE_USDC, bad, rpc(word(50)).f)).rejects.toMatchObject({ code: "E_BAD_REQUEST" });
  });
});
