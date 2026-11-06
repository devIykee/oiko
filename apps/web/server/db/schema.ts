import { bigserial, boolean, index, integer, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

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
  /** Who received the payment (set on successful agent submits of a pay action); used by the counterparty check. */
  receiver: text("receiver"),
  /** What the agent tried and how it ended (owner-facing log). */
  amount: text("amount"),
  token: text("token"),
  actionType: text("action_type"),
  outcome: text("outcome"),
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

/** Shared counterparty blocklist: reports filed by authenticated agents (POST /api/agent/report). */
export const counterpartyReports = pgTable("counterparty_reports", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  receiver: text("receiver").notNull(),
  reason: text("reason").notNull(),
  /** URL, tx hash or text. */
  evidence: text("evidence").notNull(),
  /** "agent:<public key>" of the reporting agent. */
  reporter: text("reporter").notNull(),
  reporterVault: text("reporter_vault").notNull(),
  /** true = the reporter proved control of a live agent key on an Oiko account (NEP-413). */
  verified: boolean("verified").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("counterparty_reports_receiver_idx").on(t.receiver), unique("counterparty_reports_once").on(t.receiver, t.reporterVault)]);

/** Last code hash the counterparty check saw for a contract account (fallback change detector when NearBlocks is unavailable). */
export const counterpartyCodeHashes = pgTable("counterparty_code_hashes", {
  accountId: text("account_id").primaryKey(),
  codeHash: text("code_hash").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Invoices (owner-created, paid through a public link). The whole invoice is one JSON document; owner/number for listing. */
export const invoices = pgTable("invoices", {
  id: text("id").primaryKey(),
  owner: text("owner").notNull(),
  number: text("number").notNull(),
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("invoices_owner_idx").on(t.owner, t.createdAt)]);

/** Small operator settings (e.g. the public "framing" switched from /admin). One JSON value per key. */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Non-money changes proposed by agents (plan, pots, locks, Earn, bills, schedules, draft invoices). One JSON document each. */
export const agentChanges = pgTable("agent_changes", {
  id: text("id").primaryKey(),
  vaultId: text("vault_id").notNull(),
  publicKey: text("public_key").notNull(),
  status: text("status").notNull(),
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("agent_changes_vault_idx").on(t.vaultId, t.createdAt)]);

export const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS agent_access_log (id BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(), vault_id TEXT NOT NULL,
  public_key TEXT NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL, status INTEGER NOT NULL, code TEXT, tool TEXT, tx_hash TEXT);
CREATE INDEX IF NOT EXISTS agent_access_log_vault_idx ON agent_access_log (vault_id, at);
CREATE TABLE IF NOT EXISTS used_nonces (nonce TEXT PRIMARY KEY, public_key TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS push_subscriptions (id BIGSERIAL PRIMARY KEY, account_id TEXT NOT NULL, endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS mock_oneclick_swaps (deposit_address TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE agent_access_log ADD COLUMN IF NOT EXISTS receiver TEXT;
CREATE INDEX IF NOT EXISTS agent_access_log_receiver_idx ON agent_access_log (vault_id, receiver);
ALTER TABLE agent_access_log ADD COLUMN IF NOT EXISTS amount TEXT;
ALTER TABLE agent_access_log ADD COLUMN IF NOT EXISTS token TEXT;
ALTER TABLE agent_access_log ADD COLUMN IF NOT EXISTS action_type TEXT;
ALTER TABLE agent_access_log ADD COLUMN IF NOT EXISTS outcome TEXT;
CREATE TABLE IF NOT EXISTS counterparty_reports (id BIGSERIAL PRIMARY KEY, receiver TEXT NOT NULL, reason TEXT NOT NULL, evidence TEXT NOT NULL,
  reporter TEXT NOT NULL, reporter_vault TEXT NOT NULL, verified BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT counterparty_reports_once UNIQUE (receiver, reporter_vault));
CREATE INDEX IF NOT EXISTS counterparty_reports_receiver_idx ON counterparty_reports (receiver);
CREATE TABLE IF NOT EXISTS counterparty_code_hashes (account_id TEXT PRIMARY KEY, code_hash TEXT NOT NULL, changed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS invoices (id TEXT PRIMARY KEY, owner TEXT NOT NULL, number TEXT NOT NULL, data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS invoices_owner_idx ON invoices (owner, created_at);
CREATE TABLE IF NOT EXISTS agent_changes (id TEXT PRIMARY KEY, vault_id TEXT NOT NULL, public_key TEXT NOT NULL, status TEXT NOT NULL,
  data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS agent_changes_vault_idx ON agent_changes (vault_id, created_at);
`;
