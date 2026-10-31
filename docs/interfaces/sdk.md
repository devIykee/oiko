# Frozen SDK surface (`@oiko/sdk`, packages/sdk)

Isomorphic TypeScript (browser + Node). No React inside the SDK. The web app wraps it in hooks under `apps/web/lib/`.

```ts
// types.ts — mirrors docs/interfaces/contracts.md exactly (snake_case JSON kept as-is)
export type Token = "usdc" | "usdt";
export type Balances = { usdc: string; usdt: string };
export type PotKind = "flex" | "autosave" | "locked" | "goal" | "bills";
export interface Pot { id: number; name: string; icon: string; color: string; kind: PotKind; balances: Balances;
  earn_supplied: Balances; unlock_at: string | null; target: string | null; target_date: string | null; earn: boolean; created_at: string }
export type SplitRule = { pot_id: number; mode: "percent" | "fixed"; value: string };
export type Recipient = { type: "near"; account_id: string } | { type: "intents"; chain: string; address: string; token: Token };
export type Scope = "read" | "propose" | "act";
export type AgentKind = "pay" | "move_between_pots" | "save";
export type AgentAction =
  | { type: "pay"; token: Token; amount: string; to: string; memo: string | null }
  | { type: "pay_bill"; bill_id: number }
  | { type: "move"; from_pot: number; to_pot: number; token: Token; amount: string }
  | { type: "save"; to_pot: number; token: Token; amount: string };
export interface AgentPolicyInput { label: string; agent_name: string; agent_url: string; scopes: Scope[]; allowed_actions: AgentKind[];
  allowlist: Recipient[]; per_tx: string; daily: string; weekly: string; expires_at: string }
export interface AgentView extends AgentPolicyInput { public_key: string; spent_day: [number, string]; spent_week: [number, string]; revoked: boolean; created_at: string }
export interface Proposal { id: number; public_key: string; agent_name: string; action: AgentAction; reason: string; created_at: string; expires_at: string; status: "pending" | "approved" | "rejected" | "expired" }
export interface Schedule { id: number; to_pot: number; token: Token; amount: string; period_ns: string; next_run: string }
export interface Bill { id: number; name: string; amount: string; token: Token; due_day: number; payee: string; pot_id: number; last_paid_month: number | null; created_at: string }
export interface Activity { seq: number; at: string; kind: string; by: string; token: Token | null; amount: string | null; pot_id: number | null; counterparty: string | null; note: string | null }
export interface MonthStats { month: number; in: Balances; out: Balances; saved: Balances }
export interface Overview { owner: string; tokens: { usdc: string; usdt: string }; pots: Pot[]; splits: SplitRule[]; totals: Balances; flex: Balances;
  locked: Balances; earning: Balances; agents: AgentView[]; proposals: Proposal[]; schedules: Schedule[]; bills: Bill[]; config: VaultConfig; accounted: Balances; now: string }
export interface Circle { /* as contracts.md Ajo */ }

// config.ts
export type NetworkId = "local" | "testnet" | "mainnet";
export interface OikoConfig { network: NetworkId; nodeUrl: string; root: string; contracts: { registry: string; usdc: string; usdt: string; lending: string | null; ajo: string | null; mpcSigner: string | null };
  explorerTx: (hash: string) => string; explorerAccount: (id: string) => string }
export function configFor(network: NetworkId, env?: Record<string, string | undefined>): OikoConfig;
export function accountIdFor(name: string, cfg: OikoConfig): string;   // "ada" -> "ada.oiko.testnet"
export function vaultIdFor(name: string, cfg: OikoConfig): string;     // "vault.ada.oiko.testnet"

// amounts.ts (6 decimals, bigint based, never floats for money)
export function toUnits(human: string, decimals?: number): string;     // "1.5" -> "1500000"
export function fromUnits(units: string, decimals?: number): string;   // "1500000" -> "1.5"
export function formatAmount(units: string, opts?: { decimals?: number; minFraction?: number }): string; // "1,240.50"
export function sumBalances(b: Balances): string;

// keys.ts
export function generateKeyPair(): { publicKey: string; secretKey: string };   // "ed25519:..." strings
export function keyPairFromSeed(seed32: Uint8Array): { publicKey: string; secretKey: string };

// rpc.ts
export class NearRpc { constructor(nodeUrl: string);
  view<T>(contractId: string, method: string, args?: object): Promise<T>;
  viewAccessKey(accountId: string, publicKey: string): Promise<{ nonce: number; permission: unknown } | null>;
  viewAccessKeyList(accountId: string): Promise<Array<{ public_key: string; access_key: { permission: unknown } }>>;
  accountExists(accountId: string): Promise<boolean>; block(): Promise<{ hash: string; height: number }>; }

// tx.ts — signing with a secret key held by the caller (browser key, agent key, relayer key)
export class Signer { constructor(rpc: NearRpc, accountId: string, secretKey: string);
  call(receiverId: string, method: string, args: object, opts?: { gas?: string; deposit?: string }): Promise<TxResult>;
  signDelegate(receiverId: string, actions: Action[]): Promise<string /* base64 SignedDelegate */>;
  buildUnsigned(...): Promise<{ bytes: Uint8Array; hash: Uint8Array }>; }
export interface TxResult { txHash: string; ok: boolean; value?: unknown; errorCode?: string; errorMessage?: string; logs: string[] }

// vault.ts — typed wrappers
export class VaultClient { constructor(rpc: NearRpc, vaultId: string, signer?: Signer);
  overview(): Promise<Overview>; activity(fromSeq?: number, limit?: number): Promise<Activity[]>; monthStats(from: number, to: number): Promise<MonthStats[]>;
  createPot(...); updatePot(...); deletePot(...); setSplits(rules: SplitRule[]); moveFunds(from, to, token, amount); lock(potId, unlockAtNs); extendLock(...);
  withdraw(potId, token, amount, to, memo?); withdrawLarge(...); earnOn(...); earnOff(...); addAgent(publicKey, policy: AgentPolicyInput); revokeAgent(publicKey);
  approveProposal(id); rejectProposal(id); addSchedule(...); removeSchedule(id); addBill(...); removeBill(id); payBill(id); ajoContribute(...); ajoJoin(...); }
export class RegistryClient { isAvailable(name); suggest(name); getName(name); stats(); vaultCodeHash(); }
export class AjoClient { circle(id); circlesFor(member); }

// nep413.ts
export function signNep413(secretKey: string, msg: { message: string; recipient: string; nonce?: Uint8Array; callbackUrl?: string }): { publicKey: string; signature: string; nonce: string };
export function verifyNep413(payload: { publicKey: string; signature: string; message: string; recipient: string; nonce: string; callbackUrl?: string }): boolean;
export function gatewayAuthHeader(secretKey: string, accountId: string, method: string, path: string, body: string, now?: number): string;

// errors.ts
export function friendlyError(codeOrMessage: string): { code: string; title: string; next: string }; // maps E_* codes to plain English

// insights.ts — deterministic, pure
export function computeInsights(stats: MonthStats[], activity: Activity[], month: number): { moneyIn: Balances; moneyOut: Balances; saved: Balances; savingsRateBps: number; topPayees: Array<{ to: string; amount: string }>; trend: MonthStats[] };
export function splitPreview(rules: SplitRule[], amount: string, pots: Pot[]): Array<{ pot_id: number; name: string; amount: string }>;
export function goalEta(pot: Pot, activity: Activity[], now: number): { etaMs: number | null; assumption: string };
export function billStatus(bill: Bill, nowMs: number): { status: "upcoming" | "due" | "paid" | "missed"; nextDue: Date };
```
