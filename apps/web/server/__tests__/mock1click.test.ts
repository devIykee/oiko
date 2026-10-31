import { beforeEach, describe, expect, it } from "vitest";
import { loadConfig, setServerConfig } from "../config";
import { MemoryStore, setStore, store } from "../store";
import { decodeTicket, mockQuote, mockStatus, mockStatusAt, mockSubmitDeposit, MINT_DELAY_MS, type Minter, type MockSwap } from "../mock1click";
import { feeUnits, upstreamError } from "../intents";

const TRON_USDT = "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near";
const BSC_USDT = "nep245:v2_1.omni.hot.tg:56_2CMMyVTGZkeyNZTSvS5sarzfir6g";
const VAULT = "vault.ada.oiko.testnet";
const T0 = Date.parse("2026-10-30T12:00:00Z");

beforeEach(() => {
  setServerConfig(loadConfig({ OIKO_NETWORK: "testnet", RELAYER_ACCOUNT_ID: "relayer.oiko.testnet", RELAYER_PRIVATE_KEY: "ed25519:x" }));
  setStore(new MemoryStore());
});
const quoteReq = (o: Record<string, unknown> = {}) => ({
  dry: false, swapType: "EXACT_INPUT" as const, slippageTolerance: 100, originAsset: TRON_USDT, depositType: "ORIGIN_CHAIN" as const,
  destinationAsset: "nep141:usdt.oiko.testnet", amount: "50000000", refundTo: "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7", refundType: "ORIGIN_CHAIN" as const,
  recipient: VAULT, recipientType: "DESTINATION_CHAIN" as const, deadline: new Date(T0 + 3_600_000).toISOString(), ...o,
});

describe("mock 1Click", () => {
  it("quotes with the real response shape and a TRON-style deposit address", async () => {
    const r = await mockQuote(quoteReq(), T0);
    // Real 1Click fields, plus the mock-only signed `ticket` that keeps the mock stateless across instances.
    expect(Object.keys(r).filter((k) => k !== "ticket").sort()).toEqual(["correlationId", "quote", "quoteRequest", "signature", "timestamp"]);
    expect(typeof (r as { ticket?: string }).ticket).toBe("string");
    expect(r.quote.depositAddress).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
    expect(r.quote.amountIn).toBe("50000000");
    expect(r.quote.amountOut).toBe("49975000"); // 0.05% fee
    expect(r.quote.amountOutFormatted).toBe("49.975");
    expect(BigInt(r.quote.minAmountOut)).toBeLessThan(BigInt(r.quote.amountOut));
  });
  it("dry quotes have no deposit address; 18-decimal origins convert", async () => {
    expect((await mockQuote(quoteReq({ dry: true }), T0)).quote.depositAddress).toBeUndefined();
    const r = await mockQuote(quoteReq({ originAsset: BSC_USDT, amount: "10000000000000000000" }), T0); // 10 USDT at 18 dec
    expect(r.quote.amountOut).toBe("9995000");
    expect(r.quote.depositAddress).toMatch(/^0x[0-9a-f]{40}$/);
  });
  it("validates required fields like the real API", async () => {
    await expect(mockQuote({ ...quoteReq(), refundTo: "" }, T0)).rejects.toThrow(/refundTo/);
    await expect(mockQuote(quoteReq({ originAsset: "nep141:nope" }), T0)).rejects.toThrow(/originAsset/);
  });
  it("walks PENDING_DEPOSIT → KNOWN_DEPOSIT_TX → PROCESSING → (mint) → SUCCESS, minting once", async () => {
    const r = await mockQuote(quoteReq(), T0);
    const addr = r.quote.depositAddress!;
    const mints: string[] = [];
    const minter: Minter = async (s) => { mints.push(s.quoteResponse.quote.amountOut); return { mintTxHash: "MINT", syncTxHash: "SYNC" }; };
    expect((await mockStatus(addr, T0 + 10, minter)).status).toBe("PENDING_DEPOSIT");
    expect((await mockSubmitDeposit({ depositAddress: addr, txHash: "abc" }, T0 + 1000, minter)).status).toBe("KNOWN_DEPOSIT_TX");
    expect((await mockStatus(addr, T0 + 2500, minter)).status).toBe("PROCESSING");
    expect(mints).toEqual([]);
    const done = await mockStatus(addr, T0 + 1000 + MINT_DELAY_MS, minter);
    expect(done.status).toBe("SUCCESS");
    expect(done.swapDetails.nearTxHashes).toEqual(["MINT", "SYNC"]);
    expect((await mockStatus(addr, T0 + 9000, minter)).status).toBe("SUCCESS");
    expect(mints).toEqual(["49975000"]);
  });
  it("FAILED when the mint fails or the deadline passes without a deposit", async () => {
    const r = await mockQuote(quoteReq(), T0);
    const addr = r.quote.depositAddress!;
    await mockSubmitDeposit({ depositAddress: addr, txHash: "abc" }, T0, async () => ({ mintTxHash: "", syncTxHash: null }));
    const failing: Minter = async () => { throw new Error("boom"); };
    expect((await mockStatus(addr, T0 + MINT_DELAY_MS, failing)).status).toBe("FAILED");
    const r2 = await mockQuote(quoteReq(), T0);
    const swap = await store().getMockSwap<MockSwap>(r2.quote.depositAddress!);
    expect(mockStatusAt(swap!, T0 + 3_600_001).status).toBe("FAILED");
  });
  it("NEAR-origin quotes (withdrawals) use the relayer account + a memo and never mint", async () => {
    const r = await mockQuote(quoteReq({ originAsset: "nep141:usdc.oiko.testnet", destinationAsset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", recipient: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D", refundTo: VAULT }), T0);
    expect(r.quote.depositAddress).toBe("relayer.oiko.testnet");
    expect(r.quote.depositMemo).toMatch(/^\d{8}$/);
    await mockSubmitDeposit({ depositAddress: "relayer.oiko.testnet", memo: r.quote.depositMemo, txHash: "w" }, T0);
    const minter: Minter = async () => { throw new Error("must not mint"); };
    expect((await mockStatus("relayer.oiko.testnet", T0 + MINT_DELAY_MS, minter, r.quote.depositMemo)).status).toBe("SUCCESS");
  });
});

describe("1Click proxy helpers", () => {
  it("turns the live minimum error into plain words without a currency sign", () => {
    const e = upstreamError(400, "Temporary swap limits: minimum swap amount is $100", "USDT");
    expect(e.code).toBe("E_MIN_AMOUNT");
    expect(e.message).toBe("Minimum 100 USDT right now.");
    expect(e.message).not.toMatch(/\$/);
  });
  it("fee = formatted in − formatted out in 6-decimal units", () => {
    expect(feeUnits("200", "199.974779")).toBe("25221");
    expect(feeUnits("1", "2")).toBe("0");
  });
});

describe("mock 1Click tickets (stateless across serverless instances)", () => {
  const minter: Minter = async () => ({ mintTxHash: "MINT", syncTxHash: "SYNC" });
  it("rebuilds a swap from its ticket on a fresh instance and mints once on simulate", async () => {
    const r = (await mockQuote(quoteReq(), T0)) as unknown as { quote: { depositAddress: string }; ticket: string };
    setStore(new MemoryStore()); // a different instance: nothing in memory
    const sent = await mockSubmitDeposit({ depositAddress: r.quote.depositAddress, txHash: "SIM1", ticket: r.ticket }, T0, minter);
    setStore(new MemoryStore());
    const later = await mockStatus(r.quote.depositAddress, T0 + MINT_DELAY_MS + 1, minter, null, sent.ticket);
    expect(later.status).toBe("SUCCESS");
    expect(later.swapDetails.nearTxHashes).toContain("MINT");
  });
  it("rejects a tampered ticket or one for another address", async () => {
    const r = (await mockQuote(quoteReq(), T0)) as unknown as { quote: { depositAddress: string }; ticket: string };
    const [body, mac] = r.ticket.split(".");
    expect(decodeTicket(`${body}x.${mac}`, r.quote.depositAddress)).toBeNull();
    expect(decodeTicket(r.ticket, "TSomeOtherAddress")).toBeNull();
    setStore(new MemoryStore());
    await expect(mockStatus(r.quote.depositAddress, T0, minter, null, `${body}x.${mac}`)).rejects.toThrow();
  });
});
