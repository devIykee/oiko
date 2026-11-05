// Built-in mock of the NEAR Intents 1Click API (local/testnet; Intents has no testnet). Same paths and JSON shapes as
// https://1click.chaindefuser.com/docs/v0/openapi.yaml (verified in docs/DECISIONS.md §5). A "deposit" mints mock
// USDC/USDT to the recipient vault (the relayer is the mock-ft minter) ~3 s after it is marked sent, walking
// PENDING_DEPOSIT → KNOWN_DEPOSIT_TX → PROCESSING → SUCCESS, then calls the vault's permissionless sync().
import { sha256 } from "@noble/hashes/sha2.js";
import { hmac } from "@noble/hashes/hmac.js";
import { b58encode, hexEncode, isVaultId, TGAS, utf8 } from "@oiko/sdk";
import { serverConfig } from "./config";
import { ApiError } from "./errors";
import { relayer } from "./near";
import { syncVaultUnchecked } from "./relayer";
import { store } from "./store";

export type OneClickStatus = "PENDING_DEPOSIT" | "KNOWN_DEPOSIT_TX" | "PROCESSING" | "SUCCESS" | "INCOMPLETE_DEPOSIT" | "REFUNDED" | "FAILED";
export interface TokenResponse { assetId: string; decimals: number; blockchain: string; symbol: string; price: number; priceUpdatedAt: string; contractAddress?: string }
export interface QuoteRequest {
  dry: boolean; swapType: "EXACT_INPUT" | "EXACT_OUTPUT" | "FLEX_INPUT" | "ANY_INPUT"; slippageTolerance: number; originAsset: string;
  depositType: "ORIGIN_CHAIN" | "INTENTS" | "CONFIDENTIAL_INTENTS"; destinationAsset: string; amount: string; refundTo: string;
  refundType: "ORIGIN_CHAIN" | "INTENTS" | "CONFIDENTIAL_INTENTS"; recipient: string; recipientType: "DESTINATION_CHAIN" | "INTENTS" | "CONFIDENTIAL_INTENTS";
  deadline: string; depositMode?: "SIMPLE" | "MEMO"; referral?: string; quoteWaitingTimeMs?: number;
}
export interface Quote {
  depositAddress?: string; depositMemo?: string; amountIn: string; amountInFormatted: string; amountInUsd: string; minAmountIn: string;
  amountOut: string; amountOutFormatted: string; amountOutUsd: string; minAmountOut: string; deadline?: string; timeWhenInactive?: string;
  timeEstimate: number; refundFee?: string; withdrawFee?: string;
}
export interface QuoteResponse { correlationId: string; timestamp: string; signature: string; quoteRequest: QuoteRequest; quote: Quote }
export interface MockSwap {
  depositAddress: string; quoteResponse: QuoteResponse; createdAt: number; sentAt: number | null; depositTxHash: string | null;
  mint: "none" | "pending" | "done" | "failed" | "skip"; mintTxHash: string | null; syncTxHash: string | null; updatedAt: number;
  originDecimals: number;
}

export const MINT_DELAY_MS = 3000;
export const KNOWN_TX_MS = 1000;

// Signed tickets make the mock stateless across serverless instances: the quote response carries a
// ticket (HMAC over the swap), and status/simulate calls pass it back so any instance can rebuild the swap.
function ticketKey(): Uint8Array {
  const c = serverConfig();
  return sha256(utf8("oiko-mock-1click-ticket:" + (c.relayer?.privateKey ?? c.cronSecret ?? "local-dev")));
}
const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url");
export function encodeTicket(s: MockSwap): string {
  const body = b64u(utf8(JSON.stringify(s)));
  return `${body}.${b64u(hmac(sha256, ticketKey(), utf8(body)))}`;
}
export function decodeTicket(t: string, key: string): MockSwap | null {
  const [body, mac] = t.split(".");
  if (!body || !mac) return null;
  if (b64u(hmac(sha256, ticketKey(), utf8(body))) !== mac) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as MockSwap;
    return s.depositAddress === key ? s : null;
  } catch {
    return null;
  }
}
const FEE_BPS = 5n; // 0.05%, in line with observed stablecoin routes
const WITHDRAW_FEE_UNITS = 5_000n; // 0.005 of the destination token, like the observed withdrawFee

/** Mainnet-identical asset ids for the chains Oiko shows, plus the Oiko mock tokens on NEAR. */
export function mockTokens(now = new Date()): TokenResponse[] {
  const cfg = serverConfig().oiko;
  const t = now.toISOString();
  const row = (blockchain: string, symbol: string, assetId: string, decimals = 6, contractAddress?: string): TokenResponse =>
    ({ assetId, decimals, blockchain, symbol, price: 1, priceUpdatedAt: t, ...(contractAddress ? { contractAddress } : {}) });
  return [
    row("tron", "USDT", "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near", 6, "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"),
    row("base", "USDC", "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", 6, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"),
    row("bsc", "USDT", "nep245:v2_1.omni.hot.tg:56_2CMMyVTGZkeyNZTSvS5sarzfir6g", 18),
    row("bsc", "USDC", "nep245:v2_1.omni.hot.tg:56_2w93GqMcEmQFDru84j3HZZWt557r", 18),
    row("eth", "USDT", "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near", 6, "0xdac17f958d2ee523a2206206994597c13d831ec7"),
    row("eth", "USDC", "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", 6, "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"),
    row("sol", "USDC", "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", 6, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
    row("sol", "USDT", "nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near", 6, "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"),
    row("arb", "USDC", "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", 6, "0xaf88d065e77c8cc2239327c5edb3a432268e5831"),
    row("pol", "USDT", "nep245:v2_1.omni.hot.tg:137_3hpYoaLtt8MP1Z2GH1U473DMRKgr", 6),
    row("near", "USDC", `nep141:${cfg.contracts.usdc}`, 6, cfg.contracts.usdc),
    row("near", "USDT", `nep141:${cfg.contracts.usdt}`, 6, cfg.contracts.usdt),
  ];
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function seeded(seed: string, n: number, alphabet: string): string {
  let out = "";
  let h = sha256(utf8(seed));
  while (out.length < n) {
    for (const b of h) if (out.length < n) out += alphabet[b % alphabet.length];
    h = sha256(h);
  }
  return out;
}
/** Realistic-looking deposit address for the origin chain. NEAR-origin quotes use the relayer account (it exists and holds storage). */
export function mockDepositAddress(chain: string, seed: string): string {
  switch (chain) {
    case "tron": return "T" + seeded(seed, 33, B58);
    case "sol": return seeded(seed, 44, B58);
    case "near": return serverConfig().relayer?.accountId ?? hexEncode(sha256(utf8(seed)));
    default: return "0x" + hexEncode(sha256(utf8(seed))).slice(0, 40);
  }
}

function fmt(units: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const frac = (units % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${units / base}${frac ? "." + frac : ""}`;
}
function convert(units: bigint, from: number, to: number): bigint {
  return from === to ? units : from > to ? units / 10n ** BigInt(from - to) : units * 10n ** BigInt(to - from);
}

const REQUIRED: Array<keyof QuoteRequest> = ["dry", "swapType", "slippageTolerance", "originAsset", "depositType", "destinationAsset", "amount", "refundTo", "refundType", "recipient", "recipientType", "deadline"];

export async function mockQuote(req: Partial<QuoteRequest>, now = Date.now()): Promise<QuoteResponse> {
  for (const k of REQUIRED) if (req[k] === undefined || req[k] === "") throw new ApiError("E_QUOTE", 400, `${k} should not be empty`);
  const q = req as QuoteRequest;
  if (!/^\d+$/.test(q.amount) || q.amount === "0") throw new ApiError("E_QUOTE", 400, "amount must be a positive integer string in base units");
  const tokens = mockTokens(new Date(now));
  const origin = tokens.find((t) => t.assetId === q.originAsset);
  const dest = tokens.find((t) => t.assetId === q.destinationAsset);
  if (!origin) throw new ApiError("E_QUOTE", 400, "originAsset is not supported");
  if (!dest) throw new ApiError("E_QUOTE", 400, "destinationAsset is not supported");
  if (q.swapType !== "EXACT_INPUT") throw new ApiError("E_QUOTE", 400, "the mock supports EXACT_INPUT only");
  const amountIn = BigInt(q.amount);
  const gross = convert(amountIn, origin.decimals, dest.decimals);
  const fee = (gross * FEE_BPS) / 10_000n + (dest.blockchain === "near" ? 0n : WITHDRAW_FEE_UNITS);
  const amountOut = gross > fee ? gross - fee : 0n;
  if (amountOut === 0n) throw new ApiError("E_MIN_AMOUNT", 400, "Amount is too low for bridge, try at least 0.01");
  const minOut = (amountOut * (10_000n - BigInt(Math.max(0, Math.min(10_000, Math.floor(q.slippageTolerance)))))) / 10_000n;
  const correlationId = crypto.randomUUID();
  const quote: Quote = {
    amountIn: amountIn.toString(), amountInFormatted: fmt(amountIn, origin.decimals), amountInUsd: fmt(convert(amountIn, origin.decimals, 6), 6), minAmountIn: amountIn.toString(),
    amountOut: amountOut.toString(), amountOutFormatted: fmt(amountOut, dest.decimals), amountOutUsd: fmt(convert(amountOut, dest.decimals, 6), 6), minAmountOut: minOut.toString(),
    timeEstimate: 20, refundFee: "0", ...(dest.blockchain === "near" ? {} : { withdrawFee: WITHDRAW_FEE_UNITS.toString() }),
  };
  if (!q.dry) {
    quote.depositAddress = mockDepositAddress(origin.blockchain, correlationId);
    // NEAR-origin quotes share one existing account as the deposit address, so they carry a memo (1Click MEMO mode).
    if (origin.blockchain === "near") quote.depositMemo = String(Number.parseInt(hexEncode(sha256(utf8(correlationId))).slice(0, 8), 16) % 100_000_000).padStart(8, "0");
    quote.deadline = q.deadline;
    quote.timeWhenInactive = q.deadline;
  }
  const resp: QuoteResponse = {
    correlationId, timestamp: new Date(now).toISOString(),
    signature: "ed25519:" + b58encode(sha256(utf8(correlationId + JSON.stringify(quote)))) + b58encode(sha256(utf8(correlationId))),
    quoteRequest: q, quote,
  };
  if (!q.dry && quote.depositAddress) {
    const key = swapKey(quote.depositAddress, quote.depositMemo);
    const swap: MockSwap = {
      depositAddress: key, quoteResponse: resp, createdAt: now, sentAt: null, depositTxHash: null, updatedAt: now,
      mint: dest.blockchain === "near" && isVaultId(q.recipient, serverConfig().oiko) ? "none" : "skip",
      mintTxHash: null, syncTxHash: null, originDecimals: origin.decimals,
    };
    await store().putMockSwap(key, swap);
    (resp as QuoteResponse & { ticket?: string }).ticket = encodeTicket(swap);
  }
  return resp;
}

/** Pure state machine: the status a swap shows at `now`, and whether the mint should fire now. */
/** A claimed mint that never finished (the minting instance died) is reported as failed, never re-minted. */
const PENDING_GIVE_UP_MS = 5 * 60_000;

export function mockStatusAt(s: MockSwap, now: number): { status: OneClickStatus; shouldMint: boolean } {
  const deadline = Date.parse(s.quoteResponse.quoteRequest.deadline);
  if (s.sentAt === null) return { status: Number.isFinite(deadline) && now > deadline ? "FAILED" : "PENDING_DEPOSIT", shouldMint: false };
  const elapsed = now - s.sentAt;
  if (s.mint === "failed") return { status: "FAILED", shouldMint: false };
  if (s.mint === "pending" && now - s.updatedAt > PENDING_GIVE_UP_MS) return { status: "FAILED", shouldMint: false };
  if (s.mint === "done") return { status: elapsed < KNOWN_TX_MS ? "KNOWN_DEPOSIT_TX" : elapsed < MINT_DELAY_MS ? "PROCESSING" : "SUCCESS", shouldMint: false };
  if (s.mint === "skip") return { status: elapsed < KNOWN_TX_MS ? "KNOWN_DEPOSIT_TX" : elapsed < MINT_DELAY_MS ? "PROCESSING" : "SUCCESS", shouldMint: false };
  if (elapsed < KNOWN_TX_MS) return { status: "KNOWN_DEPOSIT_TX", shouldMint: false };
  return { status: "PROCESSING", shouldMint: elapsed >= MINT_DELAY_MS && s.mint === "none" };
}

export type Minter = (s: MockSwap) => Promise<{ mintTxHash: string; syncTxHash: string | null }>;

/** Mints the quoted amountOut of the destination mock token to the vault, then syncs the vault. */
export const relayerMinter: Minter = async (s) => {
  const q = s.quoteResponse.quoteRequest;
  const token = q.destinationAsset.replace(/^nep141:/, "");
  const r = await relayer().call(token, "mint", { account_id: q.recipient, amount: s.quoteResponse.quote.amountOut }, { gas: (30n * TGAS).toString() });
  if (!r.ok) throw new Error(r.errorMessage ?? "mint failed");
  let syncTxHash: string | null = null;
  try {
    syncTxHash = (await syncVaultUnchecked(q.recipient)).txHash;
  } catch (e) {
    console.warn("[oiko] mock 1Click: sync after mint failed", e);
  }
  return { mintTxHash: r.txHash, syncTxHash };
};

export function swapKey(depositAddress: string, memo?: string | null): string {
  return memo ? `${depositAddress}#${memo}` : depositAddress;
}
async function loadSwap(key: string, ticket?: string | null): Promise<MockSwap> {
  const s = (await store().getMockSwap<MockSwap>(key)) ?? (ticket ? decodeTicket(ticket, key) : null);
  if (!s) throw new ApiError("E_NOT_FOUND", 404, "Deposit address not found");
  return s;
}

/** Mints for a swap whose mint this caller has already claimed (store.claimMockMint), then records the result. */
async function mintClaimed(key: string, s: MockSwap, minter: Minter): Promise<MockSwap> {
  let out: MockSwap;
  try {
    const r = await minter(s);
    out = { ...s, mint: "done", mintTxHash: r.mintTxHash, syncTxHash: r.syncTxHash, updatedAt: Date.now() };
  } catch (e) {
    console.error("[oiko] mock 1Click mint failed", e);
    out = { ...s, mint: "failed", updatedAt: Date.now() };
  }
  await store().putMockSwap(key, out);
  return out;
}

/** Advances a swap (mints when due) and returns the GetExecutionStatusResponse shape.
 *  Exactly-once: a status poll mints only if it wins the atomic claim; a claimed ("pending") swap is never minted again. */
export async function mockStatus(depositAddress: string, now = Date.now(), minter: Minter = relayerMinter, memo?: string | null, ticket?: string | null) {
  const key = swapKey(depositAddress, memo);
  let s = await loadSwap(key, ticket);
  if (mockStatusAt(s, now).shouldMint) {
    await store().putMockSwapIfAbsent(key, s);
    if (await store().claimMockMint(key, now)) s = await mintClaimed(key, { ...s, mint: "pending", updatedAt: now }, minter);
    else s = (await store().getMockSwap<MockSwap>(key)) ?? s;
  }
  return statusBody(s, mockStatusAt(s, now).status);
}

function statusBody(s: MockSwap, status: OneClickStatus) {
  const q = s.quoteResponse.quote;
  return {
    correlationId: s.quoteResponse.correlationId,
    quoteResponse: s.quoteResponse,
    status,
    updatedAt: new Date(s.updatedAt).toISOString(),
    swapDetails: {
      intentHashes: s.sentAt ? [b58encode(sha256(utf8("intent" + s.depositAddress)))] : [],
      nearTxHashes: [s.mintTxHash, s.syncTxHash].filter((x): x is string => !!x),
      ...(status === "SUCCESS" ? { amountIn: q.amountIn, amountInFormatted: q.amountInFormatted, amountInUsd: q.amountInUsd, amountOut: q.amountOut, amountOutFormatted: q.amountOutFormatted, amountOutUsd: q.amountOutUsd, slippage: 0 } : {}),
      ...(s.sentAt ? { depositedAmount: q.amountIn, depositedAmountFormatted: q.amountInFormatted, depositedAmountUsd: q.amountInUsd } : {}),
      originChainTxHashes: s.depositTxHash ? [{ hash: s.depositTxHash, explorerUrl: "" }] : [],
      destinationChainTxHashes: s.mintTxHash ? [{ hash: s.mintTxHash, explorerUrl: "" }] : [],
    },
  };
}

/** POST /v0/deposit/submit and the test-only simulate-deposit: marks the deposit as sent.
 *  Idempotent: double clicks and retries return the existing state; only the call that wins markMockSent can claim
 *  the mint, and the mint is claimed ("pending") before any slow relayer work so concurrent status polls can't mint. */
export async function mockSubmitDeposit(body: { txHash?: string; depositAddress?: string; memo?: string; ticket?: string }, now = Date.now(), minter: Minter = relayerMinter) {
  if (!body.depositAddress) throw new ApiError("E_BAD_REQUEST", 400, "depositAddress should not be empty");
  if (!body.txHash) throw new ApiError("E_BAD_REQUEST", 400, "txHash should not be empty");
  const key = swapKey(body.depositAddress, body.memo);
  let s = await loadSwap(key, body.ticket);
  await store().putMockSwapIfAbsent(key, s);
  if (s.sentAt === null && (await store().markMockSent(key, now, body.txHash))) {
    s = { ...s, sentAt: now, depositTxHash: body.txHash, updatedAt: now };
    if (s.mint === "none") {
      if (body.ticket) {
        // Ticket mode (serverless): mint now so no instance needs to remember the swap; the returned ticket records
        // the result and status walks KNOWN_DEPOSIT_TX -> PROCESSING -> SUCCESS by elapsed time.
        if (await store().claimMockMint(key, now)) s = await mintClaimed(key, { ...s, mint: "pending" }, minter);
      } else {
        // Long-running servers: the timer (or the next status poll) claims and performs the mint.
        const t = setTimeout(() => void mockStatus(body.depositAddress!, Date.now(), minter, body.memo).catch(() => undefined), MINT_DELAY_MS + 100);
        (t as { unref?: () => void }).unref?.();
      }
    }
  }
  s = (await store().getMockSwap<MockSwap>(key)) ?? s;
  return { ...statusBody(s, mockStatusAt(s, now).status), ticket: encodeTicket(s) };
}

export function isMockEnabled(): boolean {
  const c = serverConfig();
  return c.network !== "mainnet";
}
