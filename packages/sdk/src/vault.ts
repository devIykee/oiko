import type { NearRpc, TxResult } from "./rpc";
import { TGAS, type Signer } from "./tx";
import type {
  Activity, AgentAction, AgentPolicyInput, AgentView, Bill, Circle, MonthStats, NameInfo, Overview, Pot, PotKind, Proposal, SplitRule, Token,
} from "./types";

const G = (t: number) => (BigInt(t) * TGAS).toString();
const GAS = { small: G(30), std: G(100), xcc: G(200), max: G(300) };

/** Every owner method the app's function-call key may call (all except withdraw_large and rescue_sign). */
// Informational: the registry's config().app_key_methods is the source of truth.
export const APP_KEY_METHODS = [
  "create_pot", "update_pot", "delete_pot", "set_splits", "move_funds", "lock", "extend_lock", "withdraw", "earn_on", "earn_off",
  "add_agent", "revoke_agent", "approve_proposal", "reject_proposal", "add_schedule", "remove_schedule", "add_bill", "remove_bill",
  "pay_bill", "ajo_contribute", "ajo_post_bond", "ajo_join", "ajo_create", "ajo_start",
] as const;
export const AGENT_KEY_METHODS = ["agent_execute", "agent_propose"] as const;

export class VaultClient {
  constructor(public readonly rpc: NearRpc, public readonly vaultId: string, private readonly signer?: Signer) {}

  private s(): Signer {
    if (!this.signer) throw new Error("This action needs a signed-in key.");
    return this.signer;
  }
  private call(method: string, args: object, gas = GAS.std, deposit?: string): Promise<TxResult> {
    return this.s().call(this.vaultId, method, args, { gas, deposit });
  }

  // views
  overview(): Promise<Overview> { return this.rpc.view(this.vaultId, "get_overview"); }
  pot(potId: number): Promise<Pot | null> { return this.rpc.view(this.vaultId, "get_pot", { pot_id: potId }); }
  splits(): Promise<SplitRule[]> { return this.rpc.view(this.vaultId, "get_splits"); }
  agents(): Promise<AgentView[]> { return this.rpc.view(this.vaultId, "get_agents"); }
  agent(publicKey: string): Promise<AgentView | null> { return this.rpc.view(this.vaultId, "get_agent", { public_key: publicKey }); }
  proposals(includeClosed = false): Promise<Proposal[]> { return this.rpc.view(this.vaultId, "get_proposals", { include_closed: includeClosed }); }
  activity(fromSeq?: number, limit = 50): Promise<Activity[]> {
    return this.rpc.view(this.vaultId, "get_activity", { from_seq: fromSeq ?? null, limit });
  }
  monthStats(from: number, to: number): Promise<MonthStats[]> {
    return this.rpc.view(this.vaultId, "get_month_stats", { from_month: from, to_month: to });
  }
  bills(): Promise<Bill[]> { return this.rpc.view(this.vaultId, "get_bills"); }
  rescuePath(chain: "evm" | "tron"): Promise<string> { return this.rpc.view(this.vaultId, "get_rescue_path", { chain }); }
  version(): Promise<string> { return this.rpc.view(this.vaultId, "version"); }

  // owner
  createPot(p: { name: string; icon: string; color: string; kind: PotKind; target?: string | null; target_date?: string | null }) {
    return this.call("create_pot", { target: null, target_date: null, ...p });
  }
  updatePot(potId: number, p: { name?: string; icon?: string; color?: string; target?: string | null; target_date?: string | null }) {
    return this.call("update_pot", { pot_id: potId, ...p });
  }
  deletePot(potId: number) { return this.call("delete_pot", { pot_id: potId }); }
  setSplits(rules: SplitRule[]) { return this.call("set_splits", { rules }); }
  moveFunds(fromPot: number, toPot: number, token: Token, amount: string) {
    return this.call("move_funds", { from_pot: fromPot, to_pot: toPot, token, amount });
  }
  lock(potId: number, unlockAtNs: string) { return this.call("lock", { pot_id: potId, unlock_at: unlockAtNs }); }
  extendLock(potId: number, newUnlockAtNs: string) { return this.call("extend_lock", { pot_id: potId, new_unlock_at: newUnlockAtNs }); }
  withdraw(potId: number, token: Token, amount: string, to: string, memo?: string) {
    return this.call("withdraw", { pot_id: potId, token, amount, to, memo: memo ?? null }, GAS.xcc);
  }
  withdrawLarge(potId: number, token: Token, amount: string, to: string, memo?: string) {
    return this.call("withdraw_large", { pot_id: potId, token, amount, to, memo: memo ?? null }, GAS.xcc);
  }
  earnOn(potId: number, token: Token, amount: string) { return this.call("earn_on", { pot_id: potId, token, amount }, GAS.max); }
  earnOff(potId: number, token: Token, amount: string) { return this.call("earn_off", { pot_id: potId, token, amount }, GAS.max); }
  addAgent(publicKey: string, policy: AgentPolicyInput) { return this.call("add_agent", { public_key: publicKey, policy }); }
  revokeAgent(publicKey: string) { return this.call("revoke_agent", { public_key: publicKey }); }
  approveProposal(id: number) { return this.call("approve_proposal", { id }, GAS.xcc); }
  rejectProposal(id: number) { return this.call("reject_proposal", { id }); }
  addSchedule(toPot: number, token: Token, amount: string, periodNs: string, firstRunNs: string) {
    return this.call("add_schedule", { to_pot: toPot, token, amount, period_ns: periodNs, first_run: firstRunNs });
  }
  removeSchedule(id: number) { return this.call("remove_schedule", { id }); }
  addBill(b: { name: string; amount: string; token: Token; due_day: number; payee: string; pot_id: number }) { return this.call("add_bill", b); }
  removeBill(id: number) { return this.call("remove_bill", { id }); }
  payBill(id: number) { return this.call("pay_bill", { id }, GAS.xcc); }
  ajoContribute(circleId: number, token: Token, amount: string) { return this.call("ajo_contribute", { circle_id: circleId, token, amount }, GAS.xcc); }
  ajoPostBond(circleId: number, token: Token, amount: string) { return this.call("ajo_post_bond", { circle_id: circleId, token, amount }, GAS.xcc); }
  ajoJoin(circleId: number, inviteCode: string) { return this.call("ajo_join", { circle_id: circleId, invite_code: inviteCode }, GAS.xcc); }
  /** inviteCodeHash = hex sha256 of the invite code. */
  ajoCreate(c: { name: string; token: Token; amount_per_round: string; period_ns: string; max_members: number; bond_amount: string | null; shuffle: boolean; invite_code_hash: string }) {
    return this.call("ajo_create", c, GAS.xcc);
  }
  ajoStart(circleId: number) { return this.call("ajo_start", { circle_id: circleId }, GAS.xcc); }

  // agent (signed by the agent key on the vault itself)
  agentExecute(action: AgentAction) { return this.call("agent_execute", { action }, GAS.xcc); }
  agentPropose(action: AgentAction, reason: string) { return this.call("agent_propose", { action, reason }); }

  // permissionless
  sync() { return this.call("sync", {}, GAS.xcc); }
  runSchedules() { return this.call("run_schedules", {}, GAS.max); }
}

export class RegistryClient {
  constructor(public readonly rpc: NearRpc, public readonly registryId: string) {}
  isAvailable(name: string): Promise<boolean> { return this.rpc.view(this.registryId, "is_available", { name }); }
  suggest(name: string): Promise<string[]> { return this.rpc.view(this.registryId, "suggest", { name }); }
  getName(name: string): Promise<NameInfo | null> { return this.rpc.view(this.registryId, "get_name", { name }); }
  stats(): Promise<{ names: number }> { return this.rpc.view(this.registryId, "stats"); }
  vaultCodeHash(): Promise<string | null> { return this.rpc.view(this.registryId, "vault_code_hash"); }
  trustedCodeHashes(): Promise<string[]> { return this.rpc.view(this.registryId, "trusted_code_hashes"); }
  config(): Promise<Record<string, unknown>> { return this.rpc.view(this.registryId, "config"); }
  /** Requested from the contracts workstream (docs/DECISIONS.md "Requests to contracts"). */
  listNames(fromIndex: number, limit: number): Promise<Array<{ name: string } & NameInfo>> {
    return this.rpc.view(this.registryId, "list_names", { from_index: fromIndex, limit });
  }
}

export class AjoClient {
  constructor(public readonly rpc: NearRpc, public readonly ajoId: string) {}
  circle(id: number): Promise<Circle | null> { return this.rpc.view(this.ajoId, "get_circle", { id }); }
  circlesFor(member: string): Promise<Circle[]> { return this.rpc.view(this.ajoId, "get_circles_for", { member }); }
  circles(from: number, limit: number): Promise<Circle[]> { return this.rpc.view(this.ajoId, "get_circles", { from, limit }); }
}
