// Mirrors docs/interfaces/contracts.md exactly (snake_case JSON kept as-is).
export type Token = "usdc" | "usdt";
export const TOKENS: readonly Token[] = ["usdc", "usdt"] as const;
export type Balances = { usdc: string; usdt: string };
export type PotKind = "flex" | "autosave" | "locked" | "goal" | "bills";
export interface Pot {
  id: number; name: string; icon: string; color: string; kind: PotKind; balances: Balances;
  earn_supplied: Balances; unlock_at: string | null; target: string | null; target_date: string | null; earn: boolean; created_at: string;
}
export type SplitRule = { pot_id: number; mode: "percent" | "fixed"; value: string };
export type Recipient = { type: "near"; account_id: string } | { type: "intents"; chain: string; address: string; token: Token };
export type Scope = "read" | "propose" | "act";
export type AgentKind = "pay" | "move_between_pots" | "save";
export type AgentAction =
  | { type: "pay"; token: Token; amount: string; to: string; memo: string | null }
  | { type: "pay_bill"; bill_id: number }
  | { type: "move"; from_pot: number; to_pot: number; token: Token; amount: string }
  | { type: "save"; to_pot: number; token: Token; amount: string };
export interface AgentPolicyInput {
  label: string; agent_name: string; agent_url: string; scopes: Scope[]; allowed_actions: AgentKind[];
  allowlist: Recipient[]; per_tx: string; daily: string; weekly: string; expires_at: string;
}
export interface AgentView extends AgentPolicyInput {
  public_key: string; spent_day: [number, string]; spent_week: [number, string]; revoked: boolean; created_at: string;
}
export interface Proposal {
  id: number; public_key: string; agent_name: string; action: AgentAction; reason: string; created_at: string; expires_at: string;
  status: "pending" | "approved" | "rejected" | "expired";
}
export interface Schedule { id: number; to_pot: number; token: Token; amount: string; period_ns: string; next_run: string }
export interface Bill {
  id: number; name: string; amount: string; token: Token; due_day: number; payee: string; pot_id: number;
  last_paid_month: number | null; created_at: string;
}
export interface Activity {
  seq: number; at: string; kind: string; by: string; token: Token | null; amount: string | null; pot_id: number | null;
  counterparty: string | null; note: string | null;
}
export interface MonthStats { month: number; in: Balances; out: Balances; saved: Balances }
export interface VaultConfig {
  max_utilization_bps: number; large_withdrawal_threshold: string; lending: string | null; ajo: string | null;
  mpc_signer: string | null; agent_allowance: string;
}
export interface Overview {
  owner: string; tokens: { usdc: string; usdt: string }; pots: Pot[]; splits: SplitRule[]; totals: Balances; flex: Balances;
  locked: Balances; earning: Balances; agents: AgentView[]; proposals: Proposal[]; schedules: Schedule[]; bills: Bill[];
  config: VaultConfig; accounted: Balances; now: string;
}
export interface Circle {
  id: number; name: string; organiser: string; token: Token; amount_per_round: string; period_ns: string; max_members: number;
  members: string[]; order: string[]; bond_amount: string; bonds: Record<string, string>; start_at: string | null; round: number;
  paid: Array<[number, string]>; defaults: Array<[number, string]>; collected: string; status: "forming" | "active" | "completed" | "cancelled";
  shuffle: boolean; payouts: Array<[number, string, string]>;
}
export interface NameInfo { account_id: string; vault_id: string; created_at: string }
