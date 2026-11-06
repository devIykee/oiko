// Shared helpers for the Oiko end-to-end tests (local mode: NEAR sandbox + mock 1Click + mock lending).
import { expect, type Browser, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NearRpc, Signer, VaultClient, act, generateKeyPair, keyPairFromSeed, toUnits, type Token,
} from "../packages/sdk/src/index.ts";

export const BASE = (process.env.OIKO_E2E_URL ?? "http://localhost:3000").replace(/\/+$/, "");
export const TRON_REFUND = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(BASE + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${JSON.stringify(j)}`);
  return j as T;
}

export interface ApiConfig {
  network: string; root: string; nodeUrl: string; relayer: string | null; vaultCodeHash: string; vaultFunding: string;
  contracts: { usdc: string; usdt: string; lending: string | null; ajo: string | null; mpcSigner: string | null };
}
let cfgP: Promise<ApiConfig> | null = null;
export const config = () => (cfgP ??= api<ApiConfig>("/api/config"));
let rpcP: NearRpc | null = null;
export async function rpc(): Promise<NearRpc> { return (rpcP ??= new NearRpc((await config()).nodeUrl)); }

/** Unique, valid Oiko name for this run. */
export function uniqueName(prefix: string): string {
  return `${prefix}${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 36 ** 2).toString(36)}`.toLowerCase().slice(0, 32);
}

/**
 * The local devnet's relayer key. It is derived from a fixed seed (contracts/tests/src/bin/devnet.rs), so it is known
 * even when the chain runs inside Docker; `.oiko/relayer.json` is used when present.
 */
export async function relayer(): Promise<Signer> {
  const cfg = await config();
  const file = join(process.env.OIKO_STATE_DIR ?? join(__dirname, "..", ".oiko"), "relayer.json");
  let sk: string;
  if (existsSync(file)) sk = JSON.parse(readFileSync(file, "utf8")).private_key;
  else {
    const seed = new Uint8Array(32).fill(0x20); // near_crypto SecretKey::from_seed pads the seed with spaces
    seed.set(new TextEncoder().encode("oiko-local-relayer"));
    sk = keyPairFromSeed(seed).secretKey;
  }
  return new Signer(await rpc(), cfg.relayer ?? "relayer.test.near", sk);
}

/** A relayer call that retries when the web server used the same key at the same moment (nonce race). */
export async function relayerCall(receiver: string, method: string, args: object, tgas = 100n) {
  for (let i = 0; ; i++) {
    const r = await (await relayer()).call(receiver, method, args, { gas: (tgas * 10n ** 12n).toString() });
    if (r.ok || r.errorCode !== "E_NONCE" || i >= 5) return r;
    await sleep(500 + Math.random() * 1000);
  }
}

/** Same shape as apps/web/lib/session.tsx (localStorage "oiko.session.v1"). */
export interface Session {
  name: string; displayName: string; accountId: string; vaultId: string; appKey: string; ownerKey?: string;
  method: "browser" | "demo" | "passkey"; createdAt: number;
}

/** Creates a name + keyless savings account through the public API (what the sign-up screen does). */
export async function apiUser(prefix: string): Promise<Session> {
  const cfg = await config();
  const r = await rpc();
  const name = uniqueName(prefix);
  const owner = generateKeyPair(), app = generateKeyPair();
  const reg = await api<{ accountId: string; vaultId: string }>("/api/register", { name, ownerPublicKey: owner.publicKey, appPublicKey: app.publicKey });
  await until(async () => !!(await r.viewAccessKey(reg.accountId, owner.publicKey)), 30_000);
  const signer = new Signer(r, reg.accountId, owner.secretKey);
  const sd = await signer.signDelegate(reg.vaultId, [
    act.createAccount(),
    act.transfer(BigInt(cfg.vaultFunding)),
    act.useGlobalContract(cfg.vaultCodeHash),
    act.functionCall("new", {
      owner: reg.accountId, usdc: cfg.contracts.usdc, usdt: cfg.contracts.usdt,
      config: { max_utilization_bps: 9200, large_withdrawal_threshold: toUnits("1000"), lending: cfg.contracts.lending, ajo: cfg.contracts.ajo, mpc_signer: cfg.contracts.mpcSigner, agent_allowance: (10n ** 24n / 4n).toString() },
    }, 150n * 10n ** 12n),
  ]);
  await api("/api/relay", { signedDelegate: sd });
  await until(() => r.accountExists(reg.vaultId), 30_000);
  return { name, displayName: name, accountId: reg.accountId, vaultId: reg.vaultId, appKey: app.secretKey, ownerKey: owner.secretKey, method: "browser", createdAt: Date.now() };
}

/** Vault client for test setup, signed with the full-access key by default (the app key's 0.25 NEAR allowance reserves
 *  prepaid gas until refunds land, so rapid back-to-back scripted calls would trip it; the UI paces itself). */
export async function vaultOf(s: Session, key: "app" | "owner" = "owner"): Promise<VaultClient> {
  const r = await rpc();
  return new VaultClient(r, s.vaultId, new Signer(r, s.accountId, key === "owner" ? s.ownerKey! : s.appKey));
}

/** Test money: the relayer mints mock stablecoins straight into a savings account, then it is credited by sync(). */
export async function fund(s: Session, amount: string, token: Token = "usdt") {
  const cfg = await config();
  const res = await relayerCall(cfg.contracts[token], "mint", { account_id: s.vaultId, amount: toUnits(amount) }, 30n);
  expect(res.ok, JSON.stringify(res)).toBe(true);
  await api("/api/sync", { vaultId: s.vaultId }).catch(() => undefined);
}

/** Signs the browser in as `s` before any page script runs. */
export async function loginAs(page: Page, s: Session) {
  await page.addInitScript((v) => { try { localStorage.setItem("oiko.session.v1", v); } catch { /* ignore */ } }, JSON.stringify(s));
}

export async function readSession(page: Page): Promise<Session> {
  const raw = await page.evaluate(() => localStorage.getItem("oiko.session.v1"));
  if (!raw) throw new Error("no session in localStorage");
  return JSON.parse(raw) as Session;
}

export async function until(check: () => Promise<boolean>, ms = 60_000, every = 1000): Promise<void> {
  const end = Date.now() + ms;
  let last: unknown;
  while (Date.now() < end) {
    try { if (await check()) return; } catch (e) { last = e; }
    await sleep(every);
  }
  throw new Error(`timed out after ${ms} ms${last ? `: ${String(last)}` : ""}`);
}

/** "1,234.56" style text -> number. */
export const num = (s: string | null) => Number((s ?? "").replace(/[^0-9.]/g, ""));

/** Claims a name in the real sign-up UI, accepts the default pots, and lands on Home. */
export async function claimNameUI(page: Page, name: string): Promise<Session> {
  await page.goto("/start");
  await page.getByTestId("start-name").fill(name);
  await expect(page.getByText(/is available|available/i).first()).toBeVisible();
  await page.getByTestId("start-continue").click();
  // "Demo login" exists only in local mode; "Keep me signed in on this browser" works everywhere.
  const demo = page.getByTestId("login-demo");
  if (await demo.count()) await demo.click(); else await page.getByTestId("login-browser").click();
  await page.getByTestId("start-create").click();
  await expect(page.getByTestId("first-run")).toBeVisible({ timeout: 90_000 });
  await page.getByTestId("first-run-accept").click();
  await page.getByTestId("start-home").click({ timeout: 90_000 });
  await expect(page.getByTestId("home")).toBeVisible();
  return readSession(page);
}

/** Pays `name` from "USDT on TRON" in a fresh browser context with the test-mode Simulate button. Returns amountOut (units). */
export async function payFromTron(browser: Browser, name: string, amount: string): Promise<bigint> {
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  try {
    await page.goto(`/pay/${name}`);
    await expect(page.getByTestId("pay-recipient")).toBeVisible();
    await page.locator('[data-testid^="pay-origin-"]', { hasText: /USDT/ }).filter({ hasText: /TRON/i }).first().click();
    await page.getByTestId("pay-amount").fill(amount);
    await page.getByTestId("pay-continue-2").click();
    await page.getByTestId("pay-refund").fill(TRON_REFUND);
    const depResp = page.waitForResponse((r) => r.url().includes("/api/intents/deposit-address"));
    await page.getByTestId("pay-continue-3").click();
    const dep = await (await depResp).json();
    await page.getByTestId("pay-simulate").click();
    await expect(page.getByTestId("pay-done")).toBeVisible({ timeout: 120_000 });
    return BigInt(dep.amountOut);
  } finally {
    await ctx.close();
  }
}

/** Waits until the account's on-chain totals reach `units` of USDT (sync runs when the deposit completes / Home opens). */
export async function waitForUsdt(s: Session, atLeast: bigint) {
  const v = await vaultOf(s);
  await until(async () => {
    await api("/api/sync", { vaultId: s.vaultId }).catch(() => undefined);
    return BigInt((await v.overview()).totals.usdt) >= atLeast;
  }, 90_000, 2000);
}
