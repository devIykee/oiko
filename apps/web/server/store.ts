// Persistence: Postgres via drizzle when DATABASE_URL is set; otherwise an in-memory fallback.
// NOTE: the in-memory store is per process. On serverless hosts it resets on cold start and is not shared between
// instances, so nonce replay protection and the access log are best-effort there. Set DATABASE_URL for production.
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { serverConfig } from "./config";
import { agentAccessLog, CREATE_SQL, mockOneclickSwaps, pushSubscriptions, usedNonces } from "./db/schema";

export interface AccessLogRow {
  at: string; vaultId: string; publicKey: string; method: string; path: string; status: number; code: string | null; tool: string | null; txHash: string | null;
}
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
}

export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private nonces = new Map<string, number>();
  private log: AccessLogRow[] = [];
  private push = new Map<string, PushSub>();
  private swaps = new Map<string, unknown>();
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
    return rows.map((r: typeof agentAccessLog.$inferSelect) => ({ at: r.at.toISOString(), vaultId: r.vaultId, publicKey: r.publicKey, method: r.method, path: r.path, status: r.status, code: r.code, tool: r.tool, txHash: r.txHash }));
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
}

const g = globalThis as unknown as { __oikoStore?: Store };
export function store(): Store {
  if (g.__oikoStore) return g.__oikoStore;
  const url = serverConfig().databaseUrl;
  if (!url) console.warn("[oiko] DATABASE_URL not set: using the in-memory store (access log, nonces, push, mock 1Click reset on restart).");
  return (g.__oikoStore = url ? new PgStore(url) : new MemoryStore());
}
export function setStore(s: Store | undefined): void {
  g.__oikoStore = s;
}
