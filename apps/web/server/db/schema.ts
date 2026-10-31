import { bigserial, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const agentAccessLog = pgTable("agent_access_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  vaultId: text("vault_id").notNull(),
  publicKey: text("public_key").notNull(),
  method: text("method").notNull(),
  path: text("path").notNull(),
  status: integer("status").notNull(),
  code: text("code"),
  tool: text("tool"),
  txHash: text("tx_hash"),
}, (t) => [index("agent_access_log_vault_idx").on(t.vaultId, t.at)]);

export const usedNonces = pgTable("used_nonces", {
  nonce: text("nonce").primaryKey(),
  publicKey: text("public_key").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  accountId: text("account_id").notNull(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Built-in 1Click mock state (local/testnet only), so the mock works across serverless instances when a DB is set. */
export const mockOneclickSwaps = pgTable("mock_oneclick_swaps", {
  depositAddress: text("deposit_address").primaryKey(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS agent_access_log (id BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(), vault_id TEXT NOT NULL,
  public_key TEXT NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL, status INTEGER NOT NULL, code TEXT, tool TEXT, tx_hash TEXT);
CREATE INDEX IF NOT EXISTS agent_access_log_vault_idx ON agent_access_log (vault_id, at);
CREATE TABLE IF NOT EXISTS used_nonces (nonce TEXT PRIMARY KEY, public_key TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS push_subscriptions (id BIGSERIAL PRIMARY KEY, account_id TEXT NOT NULL, endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS mock_oneclick_swaps (deposit_address TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
`;
