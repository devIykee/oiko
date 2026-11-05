// NEAR Intents 1Click proxy. Real API on mainnet (fields per docs/DECISIONS.md §5); the built-in mock elsewhere.
import { isVaultId, nameFromAccount, NAME_RE, vaultIdFor, type Token } from "@oiko/sdk";
import { serverConfig } from "./config";
import { ApiError } from "./errors";
import { mockQuote, mockStatus, mockSubmitDeposit, mockTokens, type OneClickStatus, type QuoteRequest, type QuoteResponse, type TokenResponse } from "./mock1click";
import { rpc } from "./near";
import { syncVaultUnchecked } from "./relayer";

const CHAIN_LABEL: Record<string, string> = {
  near: "NEAR", tron: "TRON", eth: "Ethereum", base: "Base", arb: "Arbitrum", sol: "Solana", bsc: "BNB Chain", pol: "Polygon",
  op: "Optimism", avax: "Avalanche", ton: "TON", gnosis: "Gnosis", aptos: "Aptos", sui: "Sui", plasma: "Plasma", monad: "Monad",
  scroll: "Scroll", xlayer: "X Layer", stellar: "Stellar",
};
const CHAIN_ORDER = ["tron", "base", "bsc", "eth", "sol", "arb", "pol", "op", "avax", "ton", "near"];
const STABLE = /^(USDC|USDT|USDT0|USDt)$/;

export interface TokenGroup { id: string; label: string; chain: string; symbol: string; assetId: string; decimals: number }

async function oneClick<T>(path: string, init: { method: "GET" | "POST"; body?: unknown; query?: Record<string, string> } = { method: "GET" }): Promise<T> {
  const cfg = serverConfig();
  if (cfg.oneclick.isMock) {
    // In-process: avoids a self-HTTP call (and works behind deployment protection).
    if (path === "/v0/tokens") return mockTokens() as T;
    if (path === "/v0/quote") return (await mockQuote(init.body as Partial<QuoteRequest>)) as T;
    if (path === "/v0/status") return (await mockStatus(init.query!.depositAddress!, Date.now(), undefined, init.query?.depositMemo, init.query?.ticket)) as T;
    if (path === "/v0/deposit/submit") return (await mockSubmitDeposit(init.body as { txHash: string; depositAddress: string })) as T;
    throw new ApiError("E_NOT_FOUND", 404);
  }
  const url = new URL(cfg.oneclick.baseUrl + path);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = { accept: "application/json" };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (cfg.oneclick.jwt) headers.authorization = `Bearer ${cfg.oneclick.jwt}`;
  let res: Response;
  try {
    res = await fetch(url, { method: init.method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    console.warn("[oiko] 1Click request failed", path, (e as Error).message);
    throw new ApiError("E_UPSTREAM", 502);
  }
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = { message: text.slice(0, 200) };
  }
  if (!res.ok) throw upstreamError(res.status, (json as { message?: string }).message ?? "");
  return json as T;
}

/** Maps 1Click errors to plain English. "minimum swap amount is $100" -> "Minimum 100 USDT right now." (never a $ sign). */
export function upstreamError(status: number, message: string, symbol = "USDT"): ApiError {
  const min = /minimum swap amount is \$?\s*([\d.,]+)/i.exec(message);
  if (min) return new ApiError("E_MIN_AMOUNT", 422, `Minimum ${min[1]} ${symbol} right now.`);
  if (/refundTo is not valid/i.test(message)) return new ApiError("E_BAD_REQUEST", 400, "That refund address doesn't look right. Check it and try again.");
  if (/recipient.*not valid/i.test(message)) return new ApiError("E_BAD_REQUEST", 400, "That address doesn't look right. Check it and try again.");
  if (/too low/i.test(message)) return new ApiError("E_MIN_AMOUNT", 422, "That amount is too small to send. Try a larger amount.");
  if (status === 404) return new ApiError("E_NOT_FOUND", 404);
  if (status === 401 || status === 403) return new ApiError("E_CONFIG", 503, "The payment service rejected Oiko's credentials. The operator needs to check ONECLICK_JWT.");
  if (status >= 500) return new ApiError("E_UPSTREAM", 502);
  return new ApiError("E_QUOTE", 400, message ? `We couldn't get a price: ${message}` : undefined);
}

let tokenCache: { at: number; tokens: TokenResponse[] } | null = null;
async function tokens(): Promise<TokenResponse[]> {
  if (tokenCache && Date.now() - tokenCache.at < 5 * 60_000) return tokenCache.tokens;
  const t = await oneClick<TokenResponse[]>("/v0/tokens");
  tokenCache = { at: Date.now(), tokens: t };
  return t;
}

export async function tokenGroups(): Promise<{ groups: TokenGroup[] }> {
  const groups = (await tokens())
    .filter((t) => STABLE.test(t.symbol) && CHAIN_LABEL[t.blockchain])
    .map((t) => {
      const symbol = t.symbol === "USDt" ? "USDT" : t.symbol;
      return { id: t.assetId, label: `${symbol} on ${CHAIN_LABEL[t.blockchain]}`, chain: t.blockchain, symbol, assetId: t.assetId, decimals: t.decimals };
    })
    .sort((a, b) => {
      const ia = CHAIN_ORDER.indexOf(a.chain), ib = CHAIN_ORDER.indexOf(b.chain);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || (a.symbol === "USDT" ? -1 : 1) - (b.symbol === "USDT" ? -1 : 1);
    });
  return { groups };
}

function destinationFor(symbol: string): { token: Token; assetId: string } {
  const c = serverConfig().oiko.contracts;
  return /^USDC/.test(symbol) ? { token: "usdc", assetId: `nep141:${c.usdc}` } : { token: "usdt", assetId: `nep141:${c.usdt}` };
}

/** depositAddress -> vault, so status polling can trigger sync() on SUCCESS. */
const g = globalThis as unknown as { __oikoDeposits?: Map<string, string>; __oikoSynced?: Set<string> };
const deposits = (g.__oikoDeposits ??= new Map());
const synced = (g.__oikoSynced ??= new Set());

export async function depositAddress(input: { name: string; originAsset: string; amount: string; refundTo: string }) {
  const cfg = serverConfig();
  const name = input.name.toLowerCase();
  if (!NAME_RE.test(name)) throw new ApiError("E_NAME_INVALID", 400);
  if (!/^\d+$/.test(input.amount) || BigInt(input.amount) === 0n) throw new ApiError("E_BAD_AMOUNT", 400);
  const origin = (await tokens()).find((t) => t.assetId === input.originAsset);
  if (!origin || !STABLE.test(origin.symbol)) throw new ApiError("E_BAD_TOKEN", 400, "Pick USDC or USDT from the list.");
  const vaultId = vaultIdFor(name, cfg.oiko);
  if (!(await rpc().accountExists(vaultId))) throw new ApiError("E_NOT_FOUND", 404, `${name} doesn't have an Oiko account yet. Check the name.`);
  const dest = destinationFor(origin.symbol);
  const body: QuoteRequest = {
    dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: origin.assetId, depositType: "ORIGIN_CHAIN",
    destinationAsset: dest.assetId, amount: input.amount, refundTo: input.refundTo, refundType: "ORIGIN_CHAIN",
    recipient: vaultId, recipientType: "DESTINATION_CHAIN", deadline: new Date(Date.now() + 60 * 60_000).toISOString(), referral: "oiko",
  };
  let r: QuoteResponse;
  try {
    r = await oneClick<QuoteResponse>("/v0/quote", { method: "POST", body });
  } catch (e) {
    if (e instanceof ApiError && e.code === "E_MIN_AMOUNT") throw new ApiError(e.code, e.status, e.message.replace(/USDT/, origin.symbol === "USDt" ? "USDT" : origin.symbol));
    throw e;
  }
  const q = r.quote;
  if (!q.depositAddress) throw new ApiError("E_QUOTE", 502);
  deposits.set(q.depositAddress, vaultId);
  return {
    depositAddress: q.depositAddress, ...(q.depositMemo ? { depositMemo: q.depositMemo } : {}),
    amountIn: q.amountIn, amountOut: q.amountOut, fee: feeUnits(q.amountInFormatted, q.amountOutFormatted),
    deadline: q.deadline ?? body.deadline, quoteId: r.correlationId, destinationToken: dest.token,
    timeEstimate: q.timeEstimate, minAmountOut: q.minAmountOut,
    ...((r as { ticket?: string }).ticket ? { ticket: (r as { ticket?: string }).ticket } : {}),
  };
}

/** Fee in destination base units (6 decimals) = formatted in − formatted out, floored at 0. Stable-to-stable only. */
export function feeUnits(inFormatted: string, outFormatted: string): string {
  const u = (s: string) => {
    const [w, f = ""] = s.split(".");
    return BigInt(w || "0") * 1_000_000n + BigInt((f + "000000").slice(0, 6));
  };
  const d = u(inFormatted) - u(outFormatted);
  return (d > 0n ? d : 0n).toString();
}

export async function withdrawQuote(input: { vaultId: string; potId: number; token: Token; amount: string; destinationAsset: string; destinationAddress: string }) {
  const cfg = serverConfig();
  if (!isVaultId(input.vaultId, cfg.oiko)) throw new ApiError("E_BAD_REQUEST", 400, "vaultId must be an Oiko account.");
  if (!/^\d+$/.test(input.amount) || BigInt(input.amount) === 0n) throw new ApiError("E_BAD_AMOUNT", 400);
  const dest = (await tokens()).find((t) => t.assetId === input.destinationAsset);
  if (!dest || !STABLE.test(dest.symbol)) throw new ApiError("E_BAD_TOKEN", 400, "Pick USDC or USDT from the list.");
  const originAsset = `nep141:${input.token === "usdc" ? cfg.oiko.contracts.usdc : cfg.oiko.contracts.usdt}`;
  const body: QuoteRequest = {
    dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset, depositType: "ORIGIN_CHAIN", destinationAsset: dest.assetId,
    amount: input.amount, refundTo: input.vaultId, refundType: "ORIGIN_CHAIN", recipient: input.destinationAddress, recipientType: "DESTINATION_CHAIN",
    deadline: new Date(Date.now() + 30 * 60_000).toISOString(), referral: "oiko",
  };
  const r = await oneClick<QuoteResponse>("/v0/quote", { method: "POST", body }).catch((e) => {
    if (e instanceof ApiError && e.code === "E_MIN_AMOUNT") throw new ApiError(e.code, e.status, e.message.replace(/USDT/, input.token.toUpperCase()));
    throw e;
  });
  const q = r.quote;
  if (!q.depositAddress) throw new ApiError("E_QUOTE", 502);
  return {
    depositAddress: q.depositAddress, ...(q.depositMemo ? { depositMemo: q.depositMemo } : {}), amountIn: q.amountIn, amountOut: q.amountOut,
    fee: feeUnits(q.amountInFormatted, q.amountOutFormatted), deadline: q.deadline ?? body.deadline, timeEstimate: q.timeEstimate,
    ...((r as { ticket?: string }).ticket ? { ticket: (r as { ticket?: string }).ticket } : {}),
  };
}

export interface IntentStatusDetail {
  status: OneClickStatus; updatedAt: string;
  /** NEAR transaction hashes reported by 1Click (delivery to the account and, in test mode, the account's sync). */
  nearTxHashes: string[];
  /** Origin decimals; what the payer actually deposited, when known. */
  depositedAmount: string | null;
  /** 6 decimals; what was delivered, on SUCCESS. */
  amountOut: string | null;
}

/** Full status (used by invoices). On SUCCESS the recipient vault is synced (real 1Click; the mock syncs after its mint). */
export async function intentStatusDetail(depositAddress: string, memo?: string | null, ticket?: string | null): Promise<IntentStatusDetail> {
  const r = await oneClick<{ status: OneClickStatus; updatedAt: string; quoteResponse?: QuoteResponse; swapDetails?: { nearTxHashes?: string[]; depositedAmount?: string; amountOut?: string } }>("/v0/status", {
    method: "GET", query: { depositAddress, ...(memo ? { depositMemo: memo } : {}), ...(ticket && serverConfig().oneclick.isMock ? { ticket } : {}) },
  });
  if (r.status === "SUCCESS" && !serverConfig().oneclick.isMock && !synced.has(depositAddress)) {
    const cfg = serverConfig();
    const recipient = deposits.get(depositAddress) ?? r.quoteResponse?.quoteRequest?.recipient;
    if (recipient && isVaultId(recipient, cfg.oiko) && nameFromAccount(recipient, cfg.oiko)) {
      synced.add(depositAddress);
      await syncVaultUnchecked(recipient).catch((e) => {
        synced.delete(depositAddress);
        console.warn("[oiko] sync after intent SUCCESS failed", e);
      });
    }
  }
  const sd = r.swapDetails ?? {};
  return {
    status: r.status, updatedAt: r.updatedAt, nearTxHashes: (sd.nearTxHashes ?? []).filter((h) => typeof h === "string" && h.length > 0),
    depositedAmount: sd.depositedAmount && /^\d+$/.test(sd.depositedAmount) ? sd.depositedAmount : null,
    amountOut: r.status === "SUCCESS" && sd.amountOut && /^\d+$/.test(sd.amountOut) ? sd.amountOut : null,
  };
}

export async function intentStatus(depositAddress: string, memo?: string | null, ticket?: string | null): Promise<{ status: OneClickStatus; updatedAt: string }> {
  const r = await intentStatusDetail(depositAddress, memo, ticket);
  return { status: r.status, updatedAt: r.updatedAt };
}

/** A payable stablecoin by 1Click asset id (null if unknown or not USDC/USDT). */
export async function originToken(assetId: string): Promise<TokenGroup | null> {
  return (await tokenGroups()).groups.find((g) => g.assetId === assetId) ?? null;
}

export async function simulateDeposit(depositAddress: string, memo?: string, ticket?: string) {
  const cfg = serverConfig();
  if (cfg.network === "mainnet" || !cfg.oneclick.isMock) throw new ApiError("E_TEST_ONLY", 403);
  const fakeTx = "SIM" + Math.random().toString(36).slice(2, 12).toUpperCase();
  const r = await mockSubmitDeposit({ depositAddress, txHash: fakeTx, memo, ticket });
  return { ok: true, status: r.status, ticket: r.ticket };
}
