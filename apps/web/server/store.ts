// Persistence: Postgres via drizzle when DATABASE_URL is set; otherwise an in-memory fallback.
// NOTE: the in-memory store is per process. On serverless hosts it resets on cold start and is not shared between
// instances, so nonce replay protection and the access log are best-effort there. Set DATABASE_URL for production.
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { serverConfig } from "./config";
import type { Invoice } from "./invoices";
import { agentAccessLog, appSettings, counterpartyCodeHashes, counterpartyReports, CREATE_SQL, invoices, mockOneclickSwaps, pushSubscriptions, usedNonces } from "./db/schema";

export interface AccessLogRow {
  at: string; vaultId: string; publicKey: string; method: string; path: string; status: number; code: string | null; tool: string | null; txHash: string | null;
  /** Payment receiver, set on successful agent submits of a pay action. */
  receiver?: string | null;
}
export interface CounterpartyReport {
  receiver: string; reason: string; evidence: string; reporter: string; reporterVault: string; verified: boolean; createdAt: string;
}
export interface CodeHashSeen { codeHash: string; changedAt: string | null }
export interface PushSub { accountId: string; endpoint: string; p256dh: string; auth: string }

export interface Store {
  readonly kind: "postgres" | "memory";
  /** Records a nonce; returns false if it was already used (replay). */
  useNonce(nonce: string, publicKey: string, expiresAt: number): Promise<boolean>;
  logAccess(row: Omit<AccessLogRow, "at"> & { at?: string }): Promise<void>;
  listAccess(vaultId: string, publicKey: string | null, limit: number): Promise<AccessLogRow[]>;
  savePush(sub: PushSub): Promise<void>;
  deletePush(endpoint: string): Promise<void>;
  listPush(accountId: string): Promise<PushSub[]>;
  getMockSwap<T>(depositAddress: string): Promise<T | null>;
  putMockSwap<T>(depositAddress: string, data: T): Promise<void>;
  /** Counterparty blocklist. Returns false if this vault already reported this receiver. */
  addReport(r: Omit<CounterpartyReport, "createdAt"> & { createdAt?: string }): Promise<boolean>;
  listReports(receiver: string, limit?: number): Promise<CounterpartyReport[]>;
  getCodeHash(accountId: string): Promise<CodeHashSeen | null>;
  setCodeHash(accountId: string, seen: CodeHashSeen): Promise<void>;
  /** Successful agent payments from this vault to this receiver recorded in the gateway access log. */
  countPaymentsTo(vaultId: string, receiver: string): Promise<number>;
  getInvoice(id: string): Promise<Invoice | null>;
  /** Insert or replace. */
  putInvoice(inv: Invoice): Promise<void>;
  /** Newest first. */
  listInvoices(owner: string): Promise<Invoice[]>;
  /** Operator settings (app_settings). null when unset. */
  getSetting<T>(key: string): Promise<T | null>;
  setSetting<T>(key: string, value: T): Promise<void>;
}

export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private nonces = new Map<string, number>();
  private log: AccessLogRow[] = [];
  private push = new Map<string, PushSub>();
  private swaps = new Map<string, unknown>();
  private reports: CounterpartyReport[] = [];
  private codeHashes = new Map<string, CodeHashSeen>();
  private invoices = new Map<string, Invoice>();
  private settings = new Map<string, unknown>();
  async getSetting<T>(key: string) { return (this.settings.has(key) ? structuredClone(this.settings.get(key)) : null) as T | null; }
  async setSetting<T>(key: string, value: T) { this.settings.set(key, structuredClone(value)); }
  async useNonce(nonce: string, _pk: string, expiresAt: number) {
    const now = Date.now();
    if (this.nonces.size > 10_000) for (const [k, exp] of this.nonces) if (exp < now) this.nonces.delete(k);
    if (this.nonces.has(nonce)) return false;
    this.nonces.set(nonce, expiresAt);
    return true;
  }
  async logAccess(row: Omit<AccessLogRow, "at"> & { at?: string }) {
    this.log.push({ ...row, at: row.at ?? new Date().toISOString() });
    if (this.log.length > 5000) this.log.splice(0, 1000);
  }
  async listAccess(vaultId: string, publicKey: string | null, limit: number) {
    return this.log.filter((r) => r.vaultId === vaultId && (!publicKey || r.publicKey === publicKey)).slice(-limit).reverse();
  }
  async savePush(sub: PushSub) { this.push.set(sub.endpoint, sub); }
  async deletePush(endpoint: string) { this.push.delete(endpoint); }
  async listPush(accountId: string) { return [...this.push.values()].filter((p) => p.accountId === accountId); }
  async getMockSwap<T>(a: string) { return (this.swaps.get(a) as T) ?? null; }
  async putMockSwap<T>(a: string, d: T) { this.swaps.set(a, structuredClone(d)); }
  async addReport(r: Omit<CounterpartyReport, "createdAt"> & { createdAt?: string }) {
    if (this.reports.some((x) => x.receiver === r.receiver && x.reporterVault === r.reporterVault)) return false;
    this.reports.push({ ...r, createdAt: r.createdAt ?? new Date().toISOString() });
    return true;
  }
  async listReports(receiver: string, limit = 50) { return this.reports.filter((r) => r.receiver === receiver).slice(-limit).reverse(); }
  async getCodeHash(a: string) { return this.codeHashes.get(a) ?? null; }
  async setCodeHash(a: string, seen: CodeHashSeen) { this.codeHashes.set(a, { ...seen }); }
  async countPaymentsTo(vaultId: string, receiver: string) {
    return this.log.filter((r) => r.vaultId === vaultId && r.receiver === receiver && r.status === 200 && !r.code).length;
  }
  async getInvoice(id: string) { const i = this.invoices.get(id); return i ? structuredClone(i) : null; }
  async putInvoice(inv: Invoice) { this.invoices.set(inv.id, structuredClone(inv)); }
  async listInvoices(owner: string) {
    return [...this.invoices.values()].filter((i) => i.owner === owner).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((i) => structuredClone(i));
  }
}

class PgStore implements Store {
  readonly kind = "postgres" as const;
  private ready: Promise<void> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private dbp: Promise<any>;
  constructor(url: string) {
    this.dbp = (async () => {
      const { default: postgres } = await import("postgres");
      const { drizzle } = await import("drizzle-orm/postgres-js");
      const client = postgres(url, { max: 3, prepare: false, idle_timeout: 20 });
      return drizzle(client);
    })();
  }
  private async db() {
    const db = await this.dbp;
    this.ready ??= (async () => { await db.execute(sql.raw(CREATE_SQL)); })();
    await this.ready;
    return db;
  }
  async useNonce(nonce: string, publicKey: string, expiresAt: number) {
    const db = await this.db();
    if (Math.random() < 0.02) await db.delete(usedNonces).where(lt(usedNonces.expiresAt, new Date()));
    const r = await db.insert(usedNonces).values({ nonce, publicKey, expiresAt: new Date(expiresAt) }).onConflictDoNothing().returning({ nonce: usedNonces.nonce });
    return r.length === 1;
  }
  async logAccess(row: Omit<AccessLogRow, "at"> & { at?: string }) {
    const db = await this.db();
    await db.insert(agentAccessLog).values({ ...row, at: row.at ? new Date(row.at) : new Date() });
  }
  async listAccess(vaultId: string, publicKey: string | null, limit: number) {
    const db = await this.db();
    const where = publicKey ? and(eq(agentAccessLog.vaultId, vaultId), eq(agentAccessLog.publicKey, publicKey)) : eq(agentAccessLog.vaultId, vaultId);
    const rows = await db.select().from(agentAccessLog).where(where).orderBy(desc(agentAccessLog.at)).limit(limit);
    return rows.map((r: typeof agentAccessLog.$inferSelect) => ({ at: r.at.toISOString(), vaultId: r.vaultId, publicKey: r.publicKey, method: r.method, path: r.path, status: r.status, code: r.code, tool: r.tool, txHash: r.txHash, receiver: r.receiver }));
  }
  async savePush(sub: PushSub) {
    const db = await this.db();
    await db.insert(pushSubscriptions).values(sub).onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { accountId: sub.accountId, p256dh: sub.p256dh, auth: sub.auth } });
  }
  async deletePush(endpoint: string) {
    const db = await this.db();
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  }
  async listPush(accountId: string) {
    const db = await this.db();
    const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.accountId, accountId));
    return rows.map((r: typeof pushSubscriptions.$inferSelect) => ({ accountId: r.accountId, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth }));
  }
  async getMockSwap<T>(a: string) {
    const db = await this.db();
    const rows = await db.select().from(mockOneclickSwaps).where(eq(mockOneclickSwaps.depositAddress, a)).limit(1);
    return (rows[0]?.data as T) ?? null;
  }
  async putMockSwap<T>(a: string, d: T) {
    const db = await this.db();
    await db.insert(mockOneclickSwaps).values({ depositAddress: a, data: d }).onConflictDoUpdate({ target: mockOneclickSwaps.depositAddress, set: { data: d, updatedAt: new Date() } });
  }
  async addReport(r: Omit<CounterpartyReport, "createdAt"> & { createdAt?: string }) {
    const db = await this.db();
    const out = await db.insert(counterpartyReports)
      .values({ receiver: r.receiver, reason: r.reason, evidence: r.evidence, reporter: r.reporter, reporterVault: r.reporterVault, verified: r.verified, createdAt: r.createdAt ? new Date(r.createdAt) : new Date() })
      .onConflictDoNothing().returning({ id: counterpartyReports.id });
    return out.length === 1;
  }
  async listReports(receiver: string, limit = 50) {
    const db = await this.db();
    const rows = await db.select().from(counterpartyReports).where(eq(counterpartyReports.receiver, receiver)).orderBy(desc(counterpartyReports.createdAt)).limit(limit);
    return rows.map((r: typeof counterpartyReports.$inferSelect) => ({
      receiver: r.receiver, reason: r.reason, evidence: r.evidence, reporter: r.reporter, reporterVault: r.reporterVault, verified: r.verified, createdAt: r.createdAt.toISOString(),
    }));
  }
  async getCodeHash(a: string) {
    const db = await this.db();
    const rows = await db.select().from(counterpartyCodeHashes).where(eq(counterpartyCodeHashes.accountId, a)).limit(1);
    const r = rows[0] as typeof counterpartyCodeHashes.$inferSelect | undefined;
    return r ? { codeHash: r.codeHash, changedAt: r.changedAt ? r.changedAt.toISOString() : null } : null;
  }
  async setCodeHash(a: string, seen: CodeHashSeen) {
    const db = await this.db();
    const v = { codeHash: seen.codeHash, changedAt: seen.changedAt ? new Date(seen.changedAt) : null, updatedAt: new Date() };
    await db.insert(counterpartyCodeHashes).values({ accountId: a, ...v }).onConflictDoUpdate({ target: counterpartyCodeHashes.accountId, set: v });
  }
  async countPaymentsTo(vaultId: string, receiver: string) {
    const db = await this.db();
    const rows = await db.select({ n: sql<number>`count(*)::int` }).from(agentAccessLog)
      .where(and(eq(agentAccessLog.vaultId, vaultId), eq(agentAccessLog.receiver, receiver), eq(agentAccessLog.status, 200), isNull(agentAccessLog.code)));
    return Number(rows[0]?.n ?? 0);
  }
  async getInvoice(id: string) {
    const db = await this.db();
    const rows = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    return (rows[0]?.data as Invoice | undefined) ?? null;
  }
  async putInvoice(inv: Invoice) {
    const db = await this.db();
    const v = { owner: inv.owner, number: inv.number, data: inv, updatedAt: new Date() };
    await db.insert(invoices).values({ id: inv.id, ...v, createdAt: new Date(inv.createdAt) }).onConflictDoUpdate({ target: invoices.id, set: v });
  }
  async getSetting<T>(key: string) {
    const db = await this.db();
    const rows = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
    return (rows[0]?.value as T | undefined) ?? null;
  }
  async setSetting<T>(key: string, value: T) {
    const db = await this.db();
    await db.insert(appSettings).values({ key, value, updatedAt: new Date() }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  }
  async listInvoices(owner: string) {
    const db = await this.db();
    const rows = await db.select().from(invoices).where(eq(invoices.owner, owner)).orderBy(desc(invoices.createdAt)).limit(500);
    return rows.map((r: typeof invoices.$inferSelect) => r.data as Invoice);
  }
}

const g = globalThis as unknown as { __oikoStore?: Store };
export function store(): Store {
  if (g.__oikoStore) return g.__oikoStore;
  const url = serverConfig().databaseUrl;
  if (!url) console.warn("[oiko] DATABASE_URL not set: using the in-memory store (access log, nonces, push, invoices, mock 1Click reset on restart).");
  return (g.__oikoStore = url ? new PgStore(url) : new MemoryStore());
}
export function setStore(s: Store | undefined): void {
  g.__oikoStore = s;
}
