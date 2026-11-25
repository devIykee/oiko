// Operator dashboard (/admin): one admin-only summary of how this deployment is doing.
// Built from public chain data (registry, account code hashes, access keys, balances) and aggregate counts from the
// store. It shows no private labels (they're sealed and the server can't open them anyway), no invoice contents and
// no per-user access-log rows: an operator gets the shape of the system, not people's finances.
import { RegistryClient, TOKENS, isSealed, type NearRpc, type Overview } from "@oiko/sdk";
import { serverConfig, type ServerConfig } from "./config";
import { rpc as defaultRpc } from "./near";
import { budgetRemaining } from "./ratelimit";
import { store as defaultStore, type AdminCounts, type Store } from "./store";

const YOCTO = 10n ** 24n;
const DAY = 86_400_000;
/** Vault code that accounts created before 2026-11-05 still run (docs/SECURITY.md section 7). */
export const OLDER_VAULT_HASHES = ["3G9Gwhrtq8gN1ugLLNBShdjbw3s1imNH8FVrUXYWTPPR"];
/** Below this the relayer can't sponsor many more signups (each costs about 1.55 NEAR on testnet). */
export const RELAYER_LOW_NEAR = 10n;

export type Severity = "ok" | "warn" | "bad";
export interface Check { id: string; label: string; status: Severity; detail: string }
export type VaultVersion = "current" | "older" | "other" | "missing";
export type PrivacyState = "on" | "partial" | "off" | "none";
export interface AccountRow {
  name: string; vaultId: string; createdAt: string; version: VaultVersion; privacy: PrivacyState;
  pots: number; bills: number; agents: number; total: string;
}
export interface Dashboard {
  generatedAt: string; network: string; cached: boolean;
  checks: Check[];
  relayer: { accountId: string | null; balance: string | null; budgetLimit: string; budgetRemaining: string };
  contracts: Array<{ role: string; accountId: string; keys: number | null; keyless: boolean | null; expectKeyless: boolean }>;
  vaultCode: { current: string | null; trusted: string[] };
  accounts: {
    total: number | null; sampled: number;
    versions: Record<VaultVersion, number>; privacy: Record<PrivacyState, number>;
    signupsByDay: Array<{ day: string; count: number }>;
    balanceSampled: string; recent: AccountRow[];
  };
  counts: AdminCounts & { sinceHours: number };
  features: ServerConfig["features"];
}

export interface DashboardDeps {
  now: () => number;
  cfg: ServerConfig;
  rpc: Pick<NearRpc, "view" | "viewAccount" | "viewAccessKeyList" | "block">;
  store: Store;
  budgetRemaining: (limit: bigint) => bigint;
}
const defaultDeps = (): DashboardDeps => ({ now: () => Date.now(), cfg: serverConfig(), rpc: defaultRpc(), store: defaultStore(), budgetRemaining: (l) => budgetRemaining(l) });

/** "1.5" from yocto, two decimals at most. */
export function near(yocto: bigint): string {
  const whole = yocto / YOCTO, frac = (yocto % YOCTO) / 10n ** 22n;
  return frac === 0n ? whole.toString() : `${whole}.${frac.toString().padStart(2, "0").replace(/0$/, "")}`;
}
/** Token base units (6 decimals) to a plain decimal. */
const units = (u: bigint) => (Number(u) / 1e6).toFixed(2);

/** Private labels in one account: every named pot sealed ("on"), some ("partial"), none ("off"), or nothing to seal. */
export function privacyOf(ov: Pick<Overview, "pots" | "bills">): PrivacyState {
  const labels = [...ov.pots.filter((p) => p.kind !== "flex").map((p) => p.name), ...ov.bills.map((b) => b.name)];
  if (!labels.length) return "none";
  const sealed = labels.filter((l) => isSealed(l)).length;
  return sealed === labels.length ? "on" : sealed === 0 ? "off" : "partial";
}
export function versionOf(hash: string | null | undefined, current: string | null): VaultVersion {
  if (!hash) return "missing";
  if (current && hash === current) return "current";
  return OLDER_VAULT_HASHES.includes(hash) ? "older" : "other";
}

async function pool<T, R>(items: T[], n: number, f: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await f(items[k]!); }
  }));
  return out;
}

const cache: { at: number; key: string; value: Dashboard } | { at: 0 } = { at: 0 };
const CACHE_MS = 30_000;

export async function adminDashboard(opts: { fresh?: boolean; sample?: number } = {}, deps: DashboardDeps = defaultDeps()): Promise<Dashboard> {
  const now = deps.now();
  const key = `${deps.cfg.network}:${opts.sample ?? 30}`;
  const c = cache as { at: number; key?: string; value?: Dashboard };
  if (!opts.fresh && c.value && c.key === key && now - c.at < CACHE_MS) return { ...c.value, cached: true };

  const { cfg, rpc } = deps;
  const checks: Check[] = [];
  const contractsCfg = cfg.oiko.contracts;

  // RPC
  const t0 = Date.now();
  let height: number | null = null, rpcErr: string | null = null;
  try { height = (await rpc.block()).height; } catch (e) { rpcErr = (e as Error).message.slice(0, 120); }
  const ms = Date.now() - t0;
  checks.push(rpcErr
    ? { id: "rpc", label: "NEAR RPC", status: "bad", detail: `Unreachable: ${rpcErr}` }
    : { id: "rpc", label: "NEAR RPC", status: ms > 3000 ? "warn" : "ok", detail: `Block ${height} in ${ms} ms` });

  // Storage
  checks.push(deps.store.kind === "postgres"
    ? { id: "storage", label: "Storage", status: "ok", detail: "Postgres: nonces, access log, invoices and settings are shared by every instance" }
    : { id: "storage", label: "Storage", status: cfg.network === "local" ? "ok" : "warn", detail: "In memory: nonces, invoices and the access log reset on restart (set DATABASE_URL)" });

  // Relayer
  let relayerBalance: bigint | null = null;
  if (cfg.relayer && !rpcErr) {
    try { const a = await rpc.viewAccount(cfg.relayer.accountId); relayerBalance = a ? BigInt(a.amount) : null; } catch { /* reported below */ }
  }
  const budgetLeft = deps.budgetRemaining(cfg.limits.dailyBudget);
  checks.push(!cfg.relayer
    ? { id: "relayer", label: "Relayer", status: "bad", detail: "No relayer configured: signups and sync can't be sponsored" }
    : relayerBalance === null
      ? { id: "relayer", label: "Relayer", status: "warn", detail: `Couldn't read ${cfg.relayer.accountId}` }
      : { id: "relayer", label: "Relayer", status: relayerBalance < RELAYER_LOW_NEAR * YOCTO ? "bad" : "ok", detail: `${cfg.relayer.accountId}: ${near(relayerBalance)} NEAR${relayerBalance < RELAYER_LOW_NEAR * YOCTO ? " (top it up: signups will fail)" : ""}` });
  checks.push({ id: "budget", label: "Daily relayer budget", status: budgetLeft <= 0n ? "bad" : budgetLeft * 5n < cfg.limits.dailyBudget ? "warn" : "ok",
    detail: `${near(budgetLeft > 0n ? budgetLeft : 0n)} of ${near(cfg.limits.dailyBudget)} NEAR left today on this instance` });
  checks.push({ id: "cron", label: "Scheduled jobs", status: cfg.cronSecret ? "ok" : cfg.network === "local" ? "ok" : "warn", detail: cfg.cronSecret ? "CRON_SECRET set: bills, schedules, ROSCA rounds and webhooks run" : cfg.network === "local" ? "Local mode: scheduled jobs run when something calls /api/cron" : "CRON_SECRET not set: /api/cron is closed, so bill reminders, schedules and webhooks don't run" });
  checks.push({ id: "payments", label: "Payments from other chains", status: "ok", detail: cfg.oneclick.isMock ? "Test mode (simulated 1Click)" : `1Click at ${cfg.oneclick.baseUrl}${cfg.oneclick.jwt ? " with a key" : ""}` });

  // Contracts: the registry and ROSCA contract should have no keys (nobody can change them).
  const roles: Array<[string, string | null | undefined, boolean]> = [
    ["Registry", contractsCfg.registry, true], ["ROSCA savings", contractsCfg.ajo, true],
    ["USDC", contractsCfg.usdc, false], ["USDT", contractsCfg.usdt, false], ["Lending", contractsCfg.lending, false],
  ];
  const contracts = await pool(roles.filter(([, id]) => !!id), 4, async ([role, id, expectKeyless]) => {
    let keys: number | null = null;
    if (!rpcErr) { try { keys = (await rpc.viewAccessKeyList(id!)).length; } catch { keys = null; } }
    return { role, accountId: id!, keys, keyless: keys === null ? null : keys === 0, expectKeyless };
  });
  // Local sandboxes keep their keys on purpose; only real networks should be locked.
  if (cfg.network === "local") for (const k of contracts) k.expectKeyless = false;
  for (const k of contracts.filter((x) => x.expectKeyless && x.keyless === false)) {
    checks.push({ id: `keys:${k.accountId}`, label: `${k.role} keys`, status: "warn", detail: `${k.accountId} has ${k.keys} access key(s); run scripts/redeploy-testnet.sh --lock to make it keyless` });
  }

  // Accounts
  const registry = new RegistryClient(rpc as NearRpc, contractsCfg.registry);
  let total: number | null = null, trusted: string[] = [];
  let entries: Array<{ name: string; account_id: string; vault_id: string; created_at: string }> = [];
  if (!rpcErr) {
    try { total = Number((await registry.stats()).names); } catch { total = null; }
    try { trusted = await registry.trustedCodeHashes(); } catch { trusted = []; }
    const sample = Math.max(0, Math.min(100, opts.sample ?? 30));
    if (total && sample) {
      try { entries = await registry.listNames(Math.max(0, total - sample), sample); } catch { entries = []; }
    }
  }
  const recent: AccountRow[] = (await pool(entries, 6, async (e): Promise<AccountRow> => {
    const base = { name: e.name, vaultId: e.vault_id, createdAt: new Date(Number(BigInt(e.created_at) / 1_000_000n)).toISOString() };
    try {
      const acct = await rpc.viewAccount(e.vault_id);
      if (!acct) return { ...base, version: "missing", privacy: "none", pots: 0, bills: 0, agents: 0, total: "0.00" };
      const version = versionOf(acct.global_contract_hash ?? null, cfg.vaultCodeHash);
      const ov = await rpc.view<Overview>(e.vault_id, "get_overview");
      const sum = TOKENS.reduce((a, t) => a + BigInt(ov.totals[t]), 0n);
      return { ...base, version, privacy: privacyOf(ov), pots: ov.pots.length, bills: ov.bills.length, agents: ov.agents.filter((a) => !a.revoked).length, total: units(sum) };
    } catch {
      return { ...base, version: "missing", privacy: "none", pots: 0, bills: 0, agents: 0, total: "0.00" };
    }
  })).reverse(); // newest first

  const versions: Record<VaultVersion, number> = { current: 0, older: 0, other: 0, missing: 0 };
  const privacy: Record<PrivacyState, number> = { on: 0, partial: 0, off: 0, none: 0 };
  let balance = 0;
  for (const r of recent) { versions[r.version]++; privacy[r.privacy]++; balance += Number(r.total); }
  const days = Array.from({ length: 14 }, (_, i) => new Date(now - (13 - i) * DAY).toISOString().slice(0, 10));
  const signupsByDay = days.map((day) => ({ day, count: recent.filter((r) => r.createdAt.slice(0, 10) === day).length }));
  if (versions.older) checks.push({ id: "older", label: "Older account code", status: "warn", detail: `${versions.older} of the ${recent.length} newest accounts run the earlier vault; the app shows them the "older version" notice` });
  if (versions.other) checks.push({ id: "other", label: "Unknown account code", status: "bad", detail: `${versions.other} accounts run code that is neither the current nor the earlier vault` });
  if (cfg.vaultCodeHash && trusted.length && !trusted.includes(cfg.vaultCodeHash)) {
    checks.push({ id: "vaultcode", label: "Vault code", status: "bad", detail: "OIKO_VAULT_CODE_HASH is not in the registry's trusted list: the relayer will refuse new accounts" });
  }

  const sinceHours = 24;
  const counts = await deps.store.adminCounts(now - sinceHours * 3_600_000).catch((): AdminCounts => ({
    invoices: 0, invoicesPrivate: 0, invoicesRecent: 0, changesPending: 0, accessRecent: 0, accessRefusedRecent: 0, reports: 0, pushSubscriptions: 0, webhooks: 0,
  }));

  const value: Dashboard = {
    generatedAt: new Date(now).toISOString(), network: cfg.network, cached: false, checks,
    relayer: { accountId: cfg.relayer?.accountId ?? null, balance: relayerBalance === null ? null : near(relayerBalance), budgetLimit: near(cfg.limits.dailyBudget), budgetRemaining: near(budgetLeft > 0n ? budgetLeft : 0n) },
    contracts, vaultCode: { current: cfg.vaultCodeHash, trusted },
    accounts: { total, sampled: recent.length, versions, privacy, signupsByDay, balanceSampled: balance.toFixed(2), recent },
    counts: { ...counts, sinceHours }, features: cfg.features,
  };
  Object.assign(cache, { at: now, key, value });
  return value;
}
