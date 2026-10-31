//! Oiko vault: `vault.<name>.<root>`. Keyless (only agent function-call keys it adds to itself),
//! immutable (no upgrade method, no admin). See docs/interfaces/contracts.md.

pub mod core;
pub mod types;

use crate::core::*;
use crate::types::*;
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    env, near, AccountId, Allowance, Gas, GasWeight, NearToken, PanicOnDefault, Promise,
    PromiseError, PromiseOrValue, PublicKey,
};
use oiko_common::{emit, err, fail, next_month, yyyymm, NS_PER_DAY};

pub const VERSION: &str = "1.0.0";
pub const ACTIVITY_CAP: u64 = 200;
pub const MAX_AGENTS: usize = 10;
pub const MAX_PENDING_PER_AGENT: usize = 20;
pub const MAX_PROPOSALS_KEPT: usize = 100;
pub const PROPOSAL_TTL_NS: u64 = 7 * NS_PER_DAY;
pub const MAX_SCHEDULES: usize = 20;
pub const MAX_BILLS: usize = 30;
pub const MIN_SCHEDULE_PERIOD_NS: u64 = 60_000_000_000;
pub const MAX_UTILIZATION_CEILING_BPS: u16 = 9_500;
pub const RESCUE_PATH_PREFIX: &str = "oiko-rescue-v1/";
pub const AGENT_METHODS: &str = "agent_execute,agent_propose";

const GAS_VIEW: Gas = Gas::from_tgas(10);
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_FT_TRANSFER_CALL: Gas = Gas::from_tgas(60);
const GAS_CB: Gas = Gas::from_tgas(15);
const GAS_CB_BIG: Gas = Gas::from_tgas(100);
const GAS_STORAGE_DEPOSIT: Gas = Gas::from_tgas(10);
const GAS_LENDING_EXECUTE: Gas = Gas::from_tgas(70);
const GAS_CB_QUOTE: Gas = Gas::from_tgas(150);
const GAS_CB_EARN_OFF: Gas = Gas::from_tgas(40);
const GAS_AJO_CALL: Gas = Gas::from_tgas(25);
const GAS_MPC_SIGN_MIN: Gas = Gas::from_tgas(50);
/// minimum gas left in ft_on_transfer to schedule the balance read; otherwise rely on `sync()`
const GAS_FT_ON_TRANSFER_SYNC: Gas = Gas::from_tgas(25);

const FT_STORAGE_DEPOSIT: NearToken = NearToken::from_micronear(1_250); // 0.00125 NEAR
const LENDING_STORAGE_DEPOSIT: NearToken = NearToken::from_millinear(100); // 0.1 NEAR (Burrow min)
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const ZERO: NearToken = NearToken::from_yoctonear(0);

// ------------------------------------------------------------------------------------------
// Minimal shapes of the Rhea/Burrow views we read (unknown fields are ignored).
// ------------------------------------------------------------------------------------------
#[near(serializers = [json])]
pub struct LPool {
    pub balance: U128,
}
#[near(serializers = [json])]
pub struct LAssetConfig {
    pub extra_decimals: u8,
}
#[near(serializers = [json])]
pub struct LAsset {
    pub supplied: LPool,
    pub borrowed: LPool,
    pub config: LAssetConfig,
}
#[near(serializers = [json])]
pub struct LAccountAsset {
    pub token_id: AccountId,
    pub balance: U128,
}
#[near(serializers = [json])]
pub struct LAccount {
    pub supplied: Vec<LAccountAsset>,
}

/// Kinds of plain `ft_transfer` payouts, for the callback.
#[near(serializers = [json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum PayoutKind {
    Withdraw,
    Pay,
    Bill,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    owner: AccountId,
    usdc: AccountId,
    usdt: AccountId,
    config: Config,
    ledger: Ledger,
    agents: IterableMap<PublicKey, AgentPolicy>,
    proposals: IterableMap<u64, Proposal>,
    next_proposal_id: u64,
    schedules: Vec<Schedule>,
    next_schedule_id: u32,
    bills: Vec<Bill>,
    next_bill_id: u32,
    activity: LookupMap<u64, Activity>,
    next_seq: u64,
    months: LookupMap<u32, MonthStats>,
}

fn ok<T>(r: Result<T, String>) -> T {
    r.unwrap_or_else(|e| env::panic_str(&e))
}

fn now() -> u64 {
    env::block_timestamp()
}

fn pk_str(pk: &PublicKey) -> String {
    String::from(pk)
}

fn args(v: Value) -> Vec<u8> {
    serde_json::to_vec(&v).unwrap()
}

fn self_cb(method: &str, a: Value, gas: Gas) -> Promise {
    Promise::new(env::current_account_id()).function_call(method, args(a), ZERO, gas)
}

fn trunc(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

fn allocs_json(v: &[(u32, u128)]) -> Value {
    Value::Array(
        v.iter()
            .map(|(p, a)| json!({"pot_id": p, "amount": U128(*a)}))
            .collect(),
    )
}

#[near]
impl Vault {
    // --------------------------------------------------------------------------------------
    // Init
    // --------------------------------------------------------------------------------------
    #[init]
    pub fn new(owner: AccountId, usdc: AccountId, usdt: AccountId, config: Config) -> Self {
        let me = env::current_account_id();
        if me.as_str() != format!("vault.{}", owner) {
            fail("E_BAD_INIT", format!("vault account must be vault.{}", owner));
        }
        if env::predecessor_account_id() != owner {
            fail("E_BAD_INIT", "only the owner can initialise the vault");
        }
        if config.max_utilization_bps > MAX_UTILIZATION_CEILING_BPS {
            fail("E_BAD_CONFIG", "max_utilization_bps must be <= 9500");
        }
        if usdc == usdt {
            fail("E_BAD_CONFIG", "usdc and usdt must differ");
        }
        let t = now();
        let mut targets: Vec<(AccountId, NearToken, bool)> = vec![
            (usdc.clone(), FT_STORAGE_DEPOSIT, true),
            (usdt.clone(), FT_STORAGE_DEPOSIT, true),
        ];
        if let Some(l) = &config.lending {
            targets.push((l.clone(), LENDING_STORAGE_DEPOSIT, false));
        }
        for (acc, dep, reg_only) in targets {
            Promise::new(acc)
                .function_call(
                    "storage_deposit",
                    args(json!({"account_id": me, "registration_only": reg_only})),
                    dep,
                    GAS_STORAGE_DEPOSIT,
                )
                .detach();
        }
        emit("vault_created", json!({"vault_id": me, "owner": owner}));
        let mut v = Self {
            owner: owner.clone(),
            usdc,
            usdt,
            config,
            ledger: Ledger::new(t),
            agents: IterableMap::new(b"a"),
            proposals: IterableMap::new(b"p"),
            next_proposal_id: 1,
            schedules: vec![],
            next_schedule_id: 1,
            bills: vec![],
            next_bill_id: 1,
            activity: LookupMap::new(b"l"),
            next_seq: 0,
            months: LookupMap::new(b"m"),
        };
        v.record("vault_created", "owner", None, None, None, Some(owner.to_string()), None);
        v
    }

    // --------------------------------------------------------------------------------------
    // Pots and splits (owner)
    // --------------------------------------------------------------------------------------
    pub fn create_pot(
        &mut self,
        name: String,
        icon: String,
        color: String,
        kind: PotKind,
        target: Option<U128>,
        target_date: Option<U64>,
    ) -> u32 {
        self.assert_owner();
        let id = ok(self.ledger.create_pot(name, icon, color, kind, target, target_date, now()));
        let p = ok(self.ledger.pot(id)).clone();
        emit("pot_created", json!({"pot_id": id, "name": p.name, "kind": p.kind}));
        self.record("pot_created", "owner", None, None, Some(id), None, Some(trunc(&p.name, 40)));
        id
    }

    pub fn update_pot(
        &mut self,
        pot_id: u32,
        name: Option<String>,
        icon: Option<String>,
        color: Option<String>,
        target: Option<U128>,
        target_date: Option<U64>,
    ) {
        self.assert_owner();
        ok(self.ledger.update_pot(pot_id, name, icon, color, target, target_date));
        let p = ok(self.ledger.pot(pot_id)).clone();
        emit("pot_updated", json!({"pot_id": pot_id, "name": p.name, "kind": p.kind}));
    }

    pub fn delete_pot(&mut self, pot_id: u32) {
        self.assert_owner();
        if self.bills.iter().any(|b| b.pot_id == pot_id)
            || self.schedules.iter().any(|s| s.to_pot == pot_id)
        {
            fail("E_POT_IN_USE", "remove the bills and schedules that use this pot first");
        }
        let p = ok(self.ledger.delete_pot(pot_id));
        emit("pot_deleted", json!({"pot_id": pot_id, "name": p.name, "kind": p.kind}));
        self.record("pot_deleted", "owner", None, None, Some(pot_id), None, Some(trunc(&p.name, 40)));
    }

    pub fn set_splits(&mut self, rules: Vec<SplitRule>) {
        self.assert_owner();
        ok(self.ledger.set_splits(rules));
        emit("splits_updated", json!({"rules": self.ledger.splits}));
        self.record("splits_updated", "owner", None, None, None, None, None);
    }

    pub fn move_funds(&mut self, from_pot: u32, to_pot: u32, token: Token, amount: U128) {
        self.assert_owner();
        self.do_move(from_pot, to_pot, token, amount.0, "owner".into());
    }

    pub fn lock(&mut self, pot_id: u32, unlock_at: U64) {
        self.assert_owner();
        ok(self.ledger.lock(pot_id, unlock_at.0, now()));
        emit("locked", json!({"pot_id": pot_id, "unlock_at": unlock_at}));
        self.record("locked", "owner", None, None, Some(pot_id), None, Some(unlock_at.0.to_string()));
    }

    pub fn extend_lock(&mut self, pot_id: u32, new_unlock_at: U64) {
        self.assert_owner();
        ok(self.ledger.extend_lock(pot_id, new_unlock_at.0, now()));
        emit("lock_extended", json!({"pot_id": pot_id, "unlock_at": new_unlock_at}));
        self.record("lock_extended", "owner", None, None, Some(pot_id), None, Some(new_unlock_at.0.to_string()));
    }

    // --------------------------------------------------------------------------------------
    // Withdrawals (owner)
    // --------------------------------------------------------------------------------------
    pub fn withdraw(
        &mut self,
        pot_id: u32,
        token: Token,
        amount: U128,
        to: AccountId,
        memo: Option<String>,
    ) -> Promise {
        self.assert_owner();
        if amount.0 > self.config.large_withdrawal_threshold.0 {
            fail(
                "E_LARGE",
                format!(
                    "amount above {}; use withdraw_large with your login key",
                    self.config.large_withdrawal_threshold.0
                ),
            );
        }
        self.payout(pot_id, token, amount.0, to, memo, "owner".into(), PayoutKind::Withdraw, None, None)
    }

    pub fn withdraw_large(
        &mut self,
        pot_id: u32,
        token: Token,
        amount: U128,
        to: AccountId,
        memo: Option<String>,
    ) -> Promise {
        self.assert_owner();
        self.payout(pot_id, token, amount.0, to, memo, "owner".into(), PayoutKind::Withdraw, None, None)
    }

    // --------------------------------------------------------------------------------------
    // Earn (owner)
    // --------------------------------------------------------------------------------------
    pub fn earn_on(&mut self, pot_id: u32, token: Token, amount: U128) -> Promise {
        self.assert_owner();
        let lending = self.lending();
        if pot_id == FLEX_ID {
            fail("E_FLEX_EARN", "the Spend pot cannot earn");
        }
        if amount.0 == 0 {
            fail("E_BAD_AMOUNT", "amount must be > 0");
        }
        let have = ok(self.ledger.pot(pot_id)).balances.get(token);
        if have < amount.0 {
            fail("E_INSUFFICIENT", format!("pot has {} {}", have, token.as_str()));
        }
        Promise::new(lending)
            .function_call("get_asset", args(json!({"token_id": self.token_id(token)})), ZERO, GAS_VIEW)
            .then(self_cb(
                "on_earn_guard",
                json!({"pot_id": pot_id, "token": token, "amount": amount}),
                GAS_CB_BIG,
            ))
    }

    pub fn earn_off(&mut self, pot_id: u32, token: Token, amount: U128) -> Promise {
        self.assert_owner();
        let lending = self.lending();
        if pot_id == FLEX_ID {
            fail("E_FLEX_EARN", "the Spend pot cannot earn");
        }
        if amount.0 == 0 {
            fail("E_BAD_AMOUNT", "amount must be > 0");
        }
        if ok(self.ledger.pot(pot_id)).earn_supplied.get(token) == 0 {
            fail("E_INSUFFICIENT", "this pot has nothing in Earn for that token");
        }
        let tid = self.token_id(token);
        Promise::new(lending.clone())
            .function_call("get_asset", args(json!({"token_id": tid})), ZERO, GAS_VIEW)
            .and(Promise::new(lending).function_call(
                "get_account",
                args(json!({"account_id": env::current_account_id()})),
                ZERO,
                GAS_VIEW,
            ))
            .then(self_cb(
                "on_earn_off_quote",
                json!({"pot_id": pot_id, "token": token, "amount": amount}),
                GAS_CB_QUOTE,
            ))
    }

    // --------------------------------------------------------------------------------------
    // Agents (owner)
    // --------------------------------------------------------------------------------------
    pub fn add_agent(&mut self, public_key: PublicKey, policy: AgentPolicyInput) {
        self.assert_owner();
        let t = now();
        ok(validate_policy(&policy, t));
        if let Some(existing) = self.agents.get(&public_key) {
            if !existing.revoked {
                fail("E_AGENT_EXISTS", "this key is already an agent");
            }
        }
        let active = self.agents.values().filter(|a| !a.revoked).count();
        if active >= MAX_AGENTS {
            fail("E_TOO_MANY", format!("at most {} active agents", MAX_AGENTS));
        }
        let allowance = Allowance::limited(NearToken::from_yoctonear(self.config.agent_allowance.0))
            .unwrap_or_else(|| fail("E_BAD_CONFIG", "agent_allowance must be > 0"));
        let name = policy.agent_name.clone();
        self.agents.insert(public_key.clone(), policy_from_input(policy, t));
        Promise::new(env::current_account_id())
            .add_access_key_allowance(public_key.clone(), allowance, env::current_account_id(), AGENT_METHODS)
            .detach();
        emit("agent_added", json!({"public_key": public_key, "agent_name": name}));
        self.record("agent_added", "owner", None, None, None, Some(pk_str(&public_key)), Some(trunc(&name, 64)));
    }

    pub fn revoke_agent(&mut self, public_key: PublicKey) {
        self.assert_owner();
        let a = self
            .agents
            .get_mut(&public_key)
            .unwrap_or_else(|| fail("E_NO_AGENT", "no agent with this key"));
        if a.revoked {
            fail("E_AGENT_REVOKED", "this agent was already revoked");
        }
        a.revoked = true;
        let name = a.agent_name.clone();
        // expire its pending proposals
        let ids: Vec<u64> = self
            .proposals
            .iter()
            .filter(|(_, p)| p.public_key == public_key && p.status == ProposalStatus::Pending)
            .map(|(id, _)| *id)
            .collect();
        for id in ids {
            self.proposals.get_mut(&id).unwrap().status = ProposalStatus::Rejected;
        }
        Promise::new(env::current_account_id()).delete_key(public_key.clone()).detach();
        emit("agent_revoked", json!({"public_key": public_key, "agent_name": name}));
        self.record("agent_revoked", "owner", None, None, None, Some(pk_str(&public_key)), Some(trunc(&name, 64)));
    }

    pub fn approve_proposal(&mut self, id: u64) -> PromiseOrValue<bool> {
        self.assert_owner();
        let t = now();
        let p = self
            .proposals
            .get(&id)
            .cloned()
            .unwrap_or_else(|| fail("E_NO_PROPOSAL", "no such proposal"));
        if p.status != ProposalStatus::Pending {
            fail("E_PROPOSAL_CLOSED", "proposal is not pending");
        }
        if t >= p.expires_at.0 {
            fail("E_PROPOSAL_EXPIRED", "proposal expired");
        }
        self.proposals.get_mut(&id).unwrap().status = ProposalStatus::Approved;
        emit("proposal_approved", json!({"id": id}));
        self.record("proposal_approved", "owner", None, None, None, Some(pk_str(&p.public_key)), Some(id.to_string()));
        self.run_action(p.action, format!("proposal:{}", id), None)
    }

    pub fn reject_proposal(&mut self, id: u64) {
        self.assert_owner();
        let p = self
            .proposals
            .get_mut(&id)
            .unwrap_or_else(|| fail("E_NO_PROPOSAL", "no such proposal"));
        if p.status != ProposalStatus::Pending {
            fail("E_PROPOSAL_CLOSED", "proposal is not pending");
        }
        p.status = ProposalStatus::Rejected;
        emit("proposal_rejected", json!({"id": id}));
        self.record("proposal_rejected", "owner", None, None, None, None, Some(id.to_string()));
    }

    // --------------------------------------------------------------------------------------
    // Schedules and bills (owner)
    // --------------------------------------------------------------------------------------
    pub fn add_schedule(
        &mut self,
        to_pot: u32,
        token: Token,
        amount: U128,
        period_ns: U64,
        first_run: U64,
    ) -> u32 {
        self.assert_owner();
        if to_pot == FLEX_ID {
            fail("E_BAD_INPUT", "schedules move money from Spend into another pot");
        }
        ok(self.ledger.pot(to_pot));
        if amount.0 == 0 {
            fail("E_BAD_AMOUNT", "amount must be > 0");
        }
        if period_ns.0 < MIN_SCHEDULE_PERIOD_NS {
            fail("E_BAD_PERIOD", "period must be at least 60 seconds");
        }
        if self.schedules.len() >= MAX_SCHEDULES {
            fail("E_TOO_MANY", format!("at most {} schedules", MAX_SCHEDULES));
        }
        let id = self.next_schedule_id;
        self.next_schedule_id += 1;
        self.schedules.push(Schedule { id, to_pot, token, amount, period_ns, next_run: first_run });
        emit(
            "schedule_added",
            json!({"schedule_id": id, "to_pot": to_pot, "token": token, "amount": amount, "period_ns": period_ns, "next_run": first_run}),
        );
        self.record("schedule_added", "owner", Some(token), Some(amount.0), Some(to_pot), None, None);
        id
    }

    pub fn remove_schedule(&mut self, id: u32) {
        self.assert_owner();
        let i = self
            .schedules
            .iter()
            .position(|s| s.id == id)
            .unwrap_or_else(|| fail("E_NO_SCHEDULE", "no such schedule"));
        self.schedules.remove(i);
        emit("schedule_removed", json!({"schedule_id": id}));
        self.record("schedule_removed", "owner", None, None, None, None, Some(id.to_string()));
    }

    pub fn add_bill(
        &mut self,
        name: String,
        amount: U128,
        token: Token,
        due_day: u8,
        payee: AccountId,
        pot_id: u32,
    ) -> u32 {
        self.assert_owner();
        if name.trim().is_empty() || name.chars().count() > 40 {
            fail("E_BAD_INPUT", "name must be 1..=40 characters");
        }
        if !(1..=28).contains(&due_day) {
            fail("E_BAD_DUE_DAY", "due_day must be 1..=28");
        }
        if amount.0 == 0 {
            fail("E_BAD_AMOUNT", "amount must be > 0");
        }
        ok(self.ledger.pot(pot_id));
        if self.bills.len() >= MAX_BILLS {
            fail("E_TOO_MANY", format!("at most {} bills", MAX_BILLS));
        }
        let id = self.next_bill_id;
        self.next_bill_id += 1;
        let b = Bill {
            id,
            name,
            amount,
            token,
            due_day,
            payee,
            pot_id,
            last_paid_month: None,
            created_at: U64(now()),
        };
        emit(
            "bill_added",
            json!({"bill_id": id, "name": b.name, "amount": amount, "token": token, "payee": b.payee, "period": Value::Null, "by": "owner"}),
        );
        self.record("bill_added", "owner", Some(token), Some(amount.0), Some(pot_id), Some(b.payee.to_string()), Some(trunc(&b.name, 40)));
        self.bills.push(b);
        id
    }

    pub fn remove_bill(&mut self, id: u32) {
        self.assert_owner();
        let i = self.bill_idx(id);
        let b = self.bills.remove(i);
        emit(
            "bill_removed",
            json!({"bill_id": id, "name": b.name, "amount": b.amount, "token": b.token, "payee": b.payee, "period": Value::Null, "by": "owner"}),
        );
        self.record("bill_removed", "owner", None, None, None, None, Some(trunc(&b.name, 40)));
    }

    pub fn pay_bill(&mut self, id: u32) -> Promise {
        self.assert_owner();
        self.do_pay_bill(id, "owner".into(), None)
    }

    // --------------------------------------------------------------------------------------
    // Ajo (owner)
    // --------------------------------------------------------------------------------------
    pub fn ajo_contribute(&mut self, circle_id: u64, token: Token, amount: U128) -> Promise {
        self.assert_owner();
        self.ajo_send(circle_id, token, amount.0, "contribution")
    }

    pub fn ajo_post_bond(&mut self, circle_id: u64, token: Token, amount: U128) -> Promise {
        self.assert_owner();
        self.ajo_send(circle_id, token, amount.0, "bond")
    }

    pub fn ajo_join(&mut self, circle_id: u64, invite_code: String) -> Promise {
        self.assert_owner();
        let ajo = self.ajo();
        self.record("ajo_join", "owner", None, None, None, Some(ajo.to_string()), Some(circle_id.to_string()));
        Promise::new(ajo).function_call(
            "join",
            args(json!({"circle_id": circle_id, "invite_code": invite_code})),
            ZERO,
            GAS_AJO_CALL,
        )
    }

    /// Addition to the frozen interface (see DECISIONS "Contract deviations"): the vault must be
    /// the caller of `create_circle` so that it becomes the organiser and first member.
    #[allow(clippy::too_many_arguments)]
    pub fn ajo_create(
        &mut self,
        name: String,
        token: Token,
        amount_per_round: U128,
        period_ns: U64,
        max_members: u8,
        bond_amount: Option<U128>,
        shuffle: bool,
        invite_code_hash: String,
    ) -> Promise {
        self.assert_owner();
        let ajo = self.ajo();
        self.record("ajo_create", "owner", Some(token), Some(amount_per_round.0), None, Some(ajo.to_string()), Some(trunc(&name, 40)));
        Promise::new(ajo).function_call(
            "create_circle",
            args(json!({
                "name": name, "token": token, "amount_per_round": amount_per_round,
                "period_ns": period_ns, "max_members": max_members, "bond_amount": bond_amount,
                "shuffle": shuffle, "invite_code_hash": invite_code_hash
            })),
            ZERO,
            GAS_AJO_CALL,
        )
    }

    /// Addition to the frozen interface: the organiser vault starts its circle.
    pub fn ajo_start(&mut self, circle_id: u64) -> Promise {
        self.assert_owner();
        let ajo = self.ajo();
        Promise::new(ajo).function_call("start", args(json!({"circle_id": circle_id})), ZERO, GAS_AJO_CALL)
    }

    // --------------------------------------------------------------------------------------
    // Rescue (owner, payable: needs the full-access key)
    // --------------------------------------------------------------------------------------
    #[payable]
    pub fn rescue_sign(&mut self, chain: String, payload: String) -> Promise {
        self.assert_owner();
        let signer = self
            .config
            .mpc_signer
            .clone()
            .unwrap_or_else(|| fail("E_NO_MPC", "no MPC signer configured"));
        if chain != "evm" && chain != "tron" {
            fail("E_BAD_CHAIN", "chain must be evm or tron");
        }
        let p = payload.trim_start_matches("0x").to_ascii_lowercase();
        if p.len() != 64 || !p.chars().all(|c| c.is_ascii_hexdigit()) {
            fail("E_BAD_PAYLOAD", "payload must be 32 bytes hex");
        }
        let dep = env::attached_deposit();
        if dep.is_zero() {
            fail("E_DEPOSIT", "attach the signer deposit (at least 1 yoctoNEAR)");
        }
        if env::prepaid_gas().saturating_sub(env::used_gas()) < GAS_MPC_SIGN_MIN.saturating_add(Gas::from_tgas(10)) {
            fail("E_GAS", "attach at least 70 TGas");
        }
        self.record("rescue_sign", "owner", None, None, None, Some(signer.to_string()), Some(chain.clone()));
        Promise::new(signer).function_call_weight(
            "sign",
            args(json!({"request": {
                "path": format!("{}{}", RESCUE_PATH_PREFIX, chain),
                "payload_v2": {"Ecdsa": p},
                "domain_id": 0
            }})),
            dep,
            GAS_MPC_SIGN_MIN,
            GasWeight(1),
        )
    }

    // --------------------------------------------------------------------------------------
    // Agent-only (called through an agent function-call key on this account)
    // --------------------------------------------------------------------------------------
    pub fn agent_execute(&mut self, action: AgentAction) -> PromiseOrValue<bool> {
        let pk = self.assert_agent_call();
        let t = now();
        let mut policy = self.agents.get(&pk).cloned().unwrap();
        let (amount, token, recipient): (u128, Option<Token>, Option<AccountId>) = match &action {
            AgentAction::Pay { token, amount, to, .. } => (amount.0, Some(*token), Some(to.clone())),
            AgentAction::PayBill { bill_id } => {
                let b = &self.bills[self.bill_idx(*bill_id)];
                (b.amount.0, Some(b.token), Some(b.payee.clone()))
            }
            AgentAction::Move { token, amount, .. } => (amount.0, Some(*token), None),
            AgentAction::Save { token, amount, .. } => (amount.0, Some(*token), None),
        };
        let spend = ok(agent_check_and_record(&mut policy, action.kind(), amount, recipient.as_ref(), t));
        self.agents.insert(pk.clone(), policy.clone());
        emit(
            "agent_action",
            json!({
                "public_key": pk, "action": action.name(), "amount": U128(amount), "token": token,
                "recipient": recipient, "remaining_day": U128(spend.remaining_day),
                "remaining_week": U128(spend.remaining_week)
            }),
        );
        for (window, used, cap) in &spend.warnings {
            emit(
                "agent_cap_warning",
                json!({"public_key": pk, "window": window, "used": U128(*used), "cap": U128(*cap)}),
            );
        }
        self.run_action(action, format!("agent:{}", pk_str(&pk)), Some(pk))
    }

    pub fn agent_propose(&mut self, action: AgentAction, reason: String) -> u64 {
        let pk = self.assert_agent_call();
        let t = now();
        let policy = self.agents.get(&pk).cloned().unwrap();
        ok(check_agent_live(&policy, Scope::Propose, t));
        if reason.chars().count() > 280 {
            fail("E_REASON_TOO_LONG", "reason must be at most 280 characters");
        }
        if let AgentAction::PayBill { bill_id } = &action {
            self.bill_idx(*bill_id);
        }
        let pending = self
            .proposals
            .values()
            .filter(|p| p.public_key == pk && p.status == ProposalStatus::Pending && t < p.expires_at.0)
            .count();
        if pending >= MAX_PENDING_PER_AGENT {
            fail("E_TOO_MANY_PROPOSALS", format!("at most {} pending proposals per agent", MAX_PENDING_PER_AGENT));
        }
        let id = self.next_proposal_id;
        self.next_proposal_id += 1;
        emit(
            "agent_proposal",
            json!({"id": id, "public_key": pk, "action": action.name(), "reason": reason}),
        );
        self.record("agent_proposal", &format!("agent:{}", pk_str(&pk)), None, None, None, None, Some(trunc(&reason, 80)));
        self.proposals.insert(
            id,
            Proposal {
                id,
                public_key: pk,
                agent_name: policy.agent_name,
                action,
                reason,
                created_at: U64(t),
                expires_at: U64(t + PROPOSAL_TTL_NS),
                status: ProposalStatus::Pending,
            },
        );
        self.prune_proposals(t);
        id
    }

    // --------------------------------------------------------------------------------------
    // Permissionless
    // --------------------------------------------------------------------------------------
    /// Reads the real ft balance of each token and credits anything not yet accounted for.
    pub fn sync(&mut self) {
        for t in Token::ALL {
            self.read_balance(t, None, None).detach();
        }
    }

    /// NEP-141 receiver. Accepts only the configured USDC/USDT. Never refunds (returns "0");
    /// crediting happens through the same balance read as `sync()` so a deposit can never be
    /// counted twice.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        let _ = msg; // "lending_return" and any other msg are handled by pending-return matching
        let token = self
            .token_of(&env::predecessor_account_id())
            .unwrap_or_else(|| fail("E_BAD_TOKEN", "only the configured USDC and USDT are accepted"));
        if env::prepaid_gas().saturating_sub(env::used_gas()) >= GAS_FT_ON_TRANSFER_SYNC {
            self.read_balance(token, Some(sender_id), Some(amount)).detach();
        }
        U128(0)
    }

    /// Runs each due schedule once (skips a schedule while Spend is too low). Returns how many ran.
    pub fn run_schedules(&mut self) -> u32 {
        let t = now();
        let mut ran = 0;
        let mut scheds = std::mem::take(&mut self.schedules);
        for s in scheds.iter_mut() {
            if t < s.next_run.0 {
                continue;
            }
            let flex = ok(self.ledger.pot(FLEX_ID)).balances.get(s.token);
            if flex < s.amount.0 || self.ledger.pot(s.to_pot).is_err() {
                continue;
            }
            ok(self.ledger.move_funds(FLEX_ID, s.to_pot, s.token, s.amount.0, t));
            self.after_move(FLEX_ID, s.to_pot, s.token, s.amount.0, "schedule");
            let period = s.period_ns.0;
            let k = (t - s.next_run.0) / period + 1;
            s.next_run = U64(s.next_run.0 + k * period);
            emit(
                "schedule_ran",
                json!({"schedule_id": s.id, "to_pot": s.to_pot, "token": s.token, "amount": s.amount, "next_run": s.next_run}),
            );
            self.record("schedule_ran", "schedule", Some(s.token), Some(s.amount.0), Some(s.to_pot), Some("pot:0".into()), Some(s.id.to_string()));
            ran += 1;
        }
        self.schedules = scheds;
        ran
    }

    // --------------------------------------------------------------------------------------
    // Callbacks
    // --------------------------------------------------------------------------------------
    #[private]
    pub fn on_balance(
        &mut self,
        token: Token,
        epoch: u64,
        sender_id: Option<AccountId>,
        hint: Option<U128>,
        #[callback_result] balance: Result<U128, PromiseError>,
    ) -> U128 {
        let Ok(real) = balance else { return U128(0) };
        let delta = self.ledger.sync_delta(token, real.0, epoch);
        if delta == 0 {
            return U128(0);
        }
        let c = ok(self.ledger.credit(token, delta));
        let t = now();
        for (pot, a) in &c.returns {
            emit("earn_withdrawn", json!({"pot_id": pot, "token": token, "amount": U128(*a)}));
            self.record("earn_withdrawn", "lending", Some(token), Some(*a), Some(*pot), self.config.lending.as_ref().map(|l| l.to_string()), None);
        }
        if c.split_amount > 0 {
            let source = if hint.is_some() { "ft_on_transfer" } else { "sync" };
            let sender = if hint.is_some() { sender_id.clone() } else { None };
            emit(
                "deposit_received",
                json!({"token": token, "amount": U128(c.split_amount), "source": source, "sender_id": sender}),
            );
            emit(
                "split_applied",
                json!({"token": token, "amount": U128(c.split_amount), "allocations": allocs_json(&c.allocations)}),
            );
            let saved: u128 = c.allocations.iter().filter(|(p, _)| *p != FLEX_ID).map(|(_, a)| *a).sum();
            self.stat(t, token, |m| {
                m.in_.add(token, c.split_amount).ok();
                m.saved.add(token, saved).ok();
            });
            self.record(
                "deposit_received",
                source,
                Some(token),
                Some(c.split_amount),
                None,
                sender.map(|s| s.to_string()),
                None,
            );
            for (pot, a) in &c.allocations {
                self.record("split_applied", source, Some(token), Some(*a), Some(*pot), None, None);
            }
        }
        U128(delta)
    }

    #[private]
    #[allow(clippy::too_many_arguments)]
    pub fn on_payout(
        &mut self,
        pot_id: u32,
        token: Token,
        amount: U128,
        to: AccountId,
        by: String,
        kind: PayoutKind,
        bill_id: Option<u32>,
        prev_paid_month: Option<u32>,
        agent: Option<PublicKey>,
        at: U64,
        memo: Option<String>,
        #[callback_result] r: Result<(), PromiseError>,
    ) -> bool {
        let success = r.is_ok();
        ok(self.ledger.settle_out(pot_id, token, amount.0, if success { amount.0 } else { 0 }));
        if !success {
            if let Some(pk) = &agent {
                if let Some(p) = self.agents.get_mut(pk) {
                    agent_unrecord(p, amount.0, at.0);
                }
            }
            if let Some(id) = bill_id {
                if let Some(b) = self.bills.iter_mut().find(|b| b.id == id) {
                    b.last_paid_month = prev_paid_month;
                }
            }
            self.record("payout_failed", &by, Some(token), Some(amount.0), Some(pot_id), Some(to.to_string()), None);
            env::log_str(&err("E_TRANSFER_FAILED", "the token transfer failed; funds were returned to the pot"));
            return false;
        }
        let t = now();
        self.stat(t, token, |m| {
            m.out.add(token, amount.0).ok();
        });
        if kind == PayoutKind::Bill {
            let b = bill_id.and_then(|id| self.bills.iter().find(|b| b.id == id).cloned());
            if let Some(b) = b {
                emit(
                    "bill_paid",
                    json!({"bill_id": b.id, "name": b.name, "amount": b.amount, "token": b.token, "payee": b.payee, "period": b.last_paid_month, "by": by}),
                );
            }
            self.record("bill_paid", &by, Some(token), Some(amount.0), Some(pot_id), Some(to.to_string()), memo.map(|m| trunc(&m, 64)));
        } else {
            emit(
                "withdrawn",
                json!({"pot_id": pot_id, "token": token, "amount": amount, "to": to, "by": by}),
            );
            self.record("withdrawn", &by, Some(token), Some(amount.0), Some(pot_id), Some(to.to_string()), memo.map(|m| trunc(&m, 64)));
        }
        true
    }

    #[private]
    pub fn on_earn_guard(
        &mut self,
        pot_id: u32,
        token: Token,
        amount: U128,
        #[callback_result] asset: Result<Option<LAsset>, PromiseError>,
    ) -> PromiseOrValue<bool> {
        let asset = match asset {
            Ok(Some(a)) => a,
            _ => {
                env::log_str(&err("E_LENDING", "could not read the lending market"));
                return PromiseOrValue::Value(false);
            }
        };
        let supplied = asset.supplied.balance.0;
        let borrowed = asset.borrowed.balance.0;
        let util_bps: u128 = if supplied == 0 { 0 } else { mul_div(borrowed, 10_000, supplied) };
        if util_bps > self.config.max_utilization_bps as u128 {
            emit(
                "earn_refused",
                json!({"pot_id": pot_id, "token": token, "amount": amount, "utilization_bps": util_bps as u64}),
            );
            env::log_str(&err(
                "E_UTILIZATION",
                format!("utilization {} bps is above the {} bps limit", util_bps, self.config.max_utilization_bps),
            ));
            self.record("earn_refused", "owner", Some(token), Some(amount.0), Some(pot_id), None, Some(format!("{} bps", util_bps)));
            return PromiseOrValue::Value(false);
        }
        ok(self.ledger.begin_out(pot_id, token, amount.0, now(), false));
        let lending = self.lending();
        PromiseOrValue::Promise(
            Promise::new(self.token_id(token))
                .function_call(
                    "ft_transfer_call",
                    args(json!({"receiver_id": lending, "amount": amount, "msg": ""})),
                    ONE_YOCTO,
                    GAS_FT_TRANSFER_CALL,
                )
                .then(self_cb(
                    "on_earn_supplied",
                    json!({"pot_id": pot_id, "token": token, "amount": amount, "utilization_bps": util_bps as u64}),
                    GAS_CB,
                )),
        )
    }

    #[private]
    pub fn on_earn_supplied(
        &mut self,
        pot_id: u32,
        token: Token,
        amount: U128,
        utilization_bps: u64,
        #[callback_result] used: Result<U128, PromiseError>,
    ) -> bool {
        let used = used.map(|u| u.0).unwrap_or(0).min(amount.0);
        ok(self.ledger.settle_supply(pot_id, token, amount.0, used));
        if used > 0 {
            emit(
                "earn_supplied",
                json!({"pot_id": pot_id, "token": token, "amount": U128(used), "utilization_bps": utilization_bps}),
            );
            self.record("earn_supplied", "owner", Some(token), Some(used), Some(pot_id), self.config.lending.as_ref().map(|l| l.to_string()), None);
        }
        used > 0
    }

    #[private]
    pub fn on_earn_off_quote(
        &mut self,
        pot_id: u32,
        token: Token,
        amount: U128,
        #[callback_result] asset: Result<Option<LAsset>, PromiseError>,
        #[callback_result] account: Result<Option<LAccount>, PromiseError>,
    ) -> Promise {
        let asset = match asset {
            Ok(Some(a)) => a,
            _ => fail("E_LENDING", "could not read the lending market"),
        };
        let tid = self.token_id(token);
        let mult = 10u128.pow(asset.config.extra_decimals as u32);
        let real_inner = account
            .ok()
            .flatten()
            .and_then(|a| a.supplied.into_iter().find(|s| s.token_id == tid))
            .map(|s| s.balance.0)
            .unwrap_or(0);
        let real = real_inner / mult;
        let value = ok(self.ledger.earn_value(pot_id, token, real));
        let reduce = ok(self.ledger.begin_earn_off(pot_id, token, amount.0, value));
        let max_amount = amount.0.checked_mul(mult).unwrap_or_else(|| fail("E_OVERFLOW", "amount too large"));
        Promise::new(self.lending())
            .function_call(
                "execute",
                args(json!({"actions": [{"Withdraw": {"token_id": tid, "max_amount": U128(max_amount)}}]})),
                ONE_YOCTO,
                GAS_LENDING_EXECUTE,
            )
            .then(self_cb(
                "on_earn_off_started",
                json!({"pot_id": pot_id, "token": token, "amount": amount, "reduce": U128(reduce)}),
                GAS_CB_EARN_OFF,
            ))
    }

    #[private]
    pub fn on_earn_off_started(
        &mut self,
        pot_id: u32,
        token: Token,
        amount: U128,
        reduce: U128,
        #[callback_result] r: Result<(), PromiseError>,
    ) -> bool {
        if r.is_err() {
            ok(self.ledger.abort_earn_off(pot_id, token, amount.0, reduce.0));
            env::log_str(&err("E_LENDING", "the lending withdrawal failed; nothing changed"));
            return false;
        }
        // Rhea sends the tokens back with a plain ft_transfer; read the balance to credit them.
        self.read_balance(token, None, None).detach();
        true
    }

    #[private]
    pub fn on_ajo_sent(
        &mut self,
        token: Token,
        amount: U128,
        circle_id: u64,
        kind: String,
        #[callback_result] used: Result<U128, PromiseError>,
    ) -> bool {
        let used = used.map(|u| u.0).unwrap_or(0).min(amount.0);
        ok(self.ledger.settle_out(FLEX_ID, token, amount.0, used));
        if used > 0 {
            let t = now();
            self.stat(t, token, |m| {
                m.out.add(token, used).ok();
            });
            let ajo = self.config.ajo.as_ref().map(|a| a.to_string());
            emit(
                "withdrawn",
                json!({"pot_id": FLEX_ID, "token": token, "amount": U128(used), "to": ajo, "by": format!("ajo:{}", kind)}),
            );
            self.record(&format!("ajo_{}", kind), "owner", Some(token), Some(used), Some(FLEX_ID), ajo, Some(circle_id.to_string()));
        }
        used > 0
    }

    // --------------------------------------------------------------------------------------
    // Views
    // --------------------------------------------------------------------------------------
    pub fn get_overview(&self) -> Overview {
        let t = now();
        let mut totals = Balances::default();
        let mut locked = Balances::default();
        let mut earning = Balances::default();
        for p in &self.ledger.pots {
            for tk in Token::ALL {
                totals.add(tk, p.balances.get(tk) + p.earn_supplied.get(tk)).ok();
                earning.add(tk, p.earn_supplied.get(tk)).ok();
                if is_locked(p, t) {
                    locked.add(tk, p.balances.get(tk)).ok();
                }
            }
        }
        Overview {
            owner: self.owner.clone(),
            tokens: TokenIds { usdc: self.usdc.clone(), usdt: self.usdt.clone() },
            pots: self.ledger.pots.clone(),
            splits: self.ledger.splits.clone(),
            totals,
            flex: ok(self.ledger.pot(FLEX_ID)).balances,
            locked,
            earning,
            agents: self.get_agents(),
            proposals: self.get_proposals(false),
            schedules: self.schedules.clone(),
            bills: self.bills.clone(),
            config: self.config.clone(),
            accounted: self.ledger.accounted,
            now: U64(t),
        }
    }

    pub fn get_pot(&self, pot_id: u32) -> Option<Pot> {
        self.ledger.pot(pot_id).ok().cloned()
    }

    pub fn get_splits(&self) -> Vec<SplitRule> {
        self.ledger.splits.clone()
    }

    pub fn get_agents(&self) -> Vec<AgentView> {
        self.agents
            .iter()
            .map(|(k, p)| AgentView { public_key: k.clone(), policy: p.clone() })
            .collect()
    }

    pub fn get_agent(&self, public_key: PublicKey) -> Option<AgentView> {
        self.agents
            .get(&public_key)
            .map(|p| AgentView { public_key: public_key.clone(), policy: p.clone() })
    }

    pub fn get_proposals(&self, include_closed: bool) -> Vec<Proposal> {
        let t = now();
        let mut v: Vec<Proposal> = self
            .proposals
            .values()
            .map(|p| {
                let mut p = p.clone();
                if p.status == ProposalStatus::Pending && t >= p.expires_at.0 {
                    p.status = ProposalStatus::Expired;
                }
                p
            })
            .filter(|p| include_closed || p.status == ProposalStatus::Pending)
            .collect();
        v.sort_by(|a, b| b.id.cmp(&a.id));
        v
    }

    pub fn get_activity(&self, from_seq: Option<u64>, limit: u32) -> Vec<Activity> {
        if self.next_seq == 0 {
            return vec![];
        }
        let newest = self.next_seq - 1;
        let oldest = self.next_seq.saturating_sub(ACTIVITY_CAP);
        let mut s = from_seq.unwrap_or(newest).min(newest);
        let mut out = vec![];
        let limit = (limit as u64).min(ACTIVITY_CAP);
        while s >= oldest && (out.len() as u64) < limit {
            if let Some(a) = self.activity.get(&(s % ACTIVITY_CAP)) {
                if a.seq == s {
                    out.push(a.clone());
                }
            }
            if s == 0 {
                break;
            }
            s -= 1;
        }
        out
    }

    pub fn get_month_stats(&self, from_month: u32, to_month: u32) -> Vec<MonthStats> {
        let mut out = vec![];
        let mut m = from_month;
        let mut n = 0;
        while m <= to_month && n < 36 {
            out.push(self.months.get(&m).cloned().unwrap_or(MonthStats { month: m, ..Default::default() }));
            m = next_month(m);
            n += 1;
        }
        out
    }

    pub fn get_bills(&self) -> Vec<Bill> {
        self.bills.clone()
    }

    pub fn get_rescue_path(&self, chain: String) -> String {
        format!("{}{}", RESCUE_PATH_PREFIX, chain)
    }

    pub fn version(&self) -> String {
        VERSION.to_string()
    }
}

// ------------------------------------------------------------------------------------------
// Internal helpers
// ------------------------------------------------------------------------------------------
impl Vault {
    fn assert_owner(&self) {
        if env::predecessor_account_id() != self.owner {
            fail("E_NOT_OWNER", "only the owner can do this");
        }
    }

    /// Agent methods must arrive through a function-call key on this account.
    fn assert_agent_call(&self) -> PublicKey {
        if env::predecessor_account_id() != env::current_account_id() {
            fail("E_NOT_SELF", "agent methods must be signed with an agent key on this account");
        }
        let pk = env::signer_account_pk();
        if !self.agents.contains_key(&pk) {
            fail("E_NOT_AGENT", "the signing key is not a registered agent");
        }
        pk
    }

    fn token_id(&self, t: Token) -> AccountId {
        match t {
            Token::Usdc => self.usdc.clone(),
            Token::Usdt => self.usdt.clone(),
        }
    }

    fn token_of(&self, a: &AccountId) -> Option<Token> {
        if *a == self.usdc {
            Some(Token::Usdc)
        } else if *a == self.usdt {
            Some(Token::Usdt)
        } else {
            None
        }
    }

    fn lending(&self) -> AccountId {
        self.config
            .lending
            .clone()
            .unwrap_or_else(|| fail("E_NO_LENDING", "no lending market configured"))
    }

    fn ajo(&self) -> AccountId {
        self.config
            .ajo
            .clone()
            .unwrap_or_else(|| fail("E_NO_AJO", "no ajo contract configured"))
    }

    fn bill_idx(&self, id: u32) -> usize {
        self.bills
            .iter()
            .position(|b| b.id == id)
            .unwrap_or_else(|| fail("E_NO_BILL", "no such bill"))
    }

    fn read_balance(&self, t: Token, sender: Option<AccountId>, hint: Option<U128>) -> Promise {
        Promise::new(self.token_id(t))
            .function_call(
                "ft_balance_of",
                args(json!({"account_id": env::current_account_id()})),
                ZERO,
                Gas::from_tgas(5),
            )
            .then(self_cb(
                "on_balance",
                json!({"token": t, "epoch": self.ledger.epoch[t.idx()], "sender_id": sender, "hint": hint}),
                GAS_CB,
            ))
    }

    fn stat(&mut self, t: u64, _token: Token, f: impl FnOnce(&mut MonthStats)) {
        let m = yyyymm(t);
        let mut s = self.months.get(&m).cloned().unwrap_or(MonthStats { month: m, ..Default::default() });
        f(&mut s);
        self.months.insert(m, s);
    }

    #[allow(clippy::too_many_arguments)]
    fn record(
        &mut self,
        kind: &str,
        by: &str,
        token: Option<Token>,
        amount: Option<u128>,
        pot_id: Option<u32>,
        counterparty: Option<String>,
        note: Option<String>,
    ) {
        let seq = self.next_seq;
        self.next_seq += 1;
        self.activity.insert(
            seq % ACTIVITY_CAP,
            Activity {
                seq,
                at: U64(now()),
                kind: kind.to_string(),
                by: trunc(by, 80),
                token,
                amount: amount.map(U128),
                pot_id,
                counterparty: counterparty.map(|c| trunc(&c, 80)),
                note,
            },
        );
    }

    fn do_move(&mut self, from: u32, to: u32, token: Token, amount: u128, by: String) {
        ok(self.ledger.move_funds(from, to, token, amount, now()));
        self.after_move(from, to, token, amount, &by);
    }

    fn after_move(&mut self, from: u32, to: u32, token: Token, amount: u128, by: &str) {
        emit(
            "moved",
            json!({"from_pot": from, "to_pot": to, "token": token, "amount": U128(amount), "by": by}),
        );
        let t = now();
        if from == FLEX_ID && to != FLEX_ID {
            self.stat(t, token, |m| {
                m.saved.add(token, amount).ok();
            });
        } else if to == FLEX_ID && from != FLEX_ID {
            self.stat(t, token, |m| {
                let v = m.saved.get(token).saturating_sub(amount);
                m.saved.set(token, v);
            });
        }
        // pot_id = receiving pot so per-pot inflows show in get_activity; counterparty = source pot
        self.record("moved", by, Some(token), Some(amount), Some(to), Some(format!("pot:{}", from)), None);
    }

    #[allow(clippy::too_many_arguments)]
    fn payout(
        &mut self,
        pot_id: u32,
        token: Token,
        amount: u128,
        to: AccountId,
        memo: Option<String>,
        by: String,
        kind: PayoutKind,
        bill: Option<(u32, Option<u32>)>,
        agent: Option<PublicKey>,
    ) -> Promise {
        let t = now();
        ok(self.ledger.begin_out(pot_id, token, amount, t, true));
        let memo = memo.map(|m| trunc(&m, 128));
        Promise::new(self.token_id(token))
            .function_call(
                "ft_transfer",
                args(json!({"receiver_id": to, "amount": U128(amount), "memo": memo})),
                ONE_YOCTO,
                GAS_FT_TRANSFER,
            )
            .then(self_cb(
                "on_payout",
                json!({
                    "pot_id": pot_id, "token": token, "amount": U128(amount), "to": to, "by": by,
                    "kind": kind, "bill_id": bill.map(|b| b.0), "prev_paid_month": bill.and_then(|b| b.1),
                    "agent": agent, "at": U64(t), "memo": memo
                }),
                GAS_CB,
            ))
    }

    fn do_pay_bill(&mut self, id: u32, by: String, agent: Option<PublicKey>) -> Promise {
        let i = self.bill_idx(id);
        let month = yyyymm(now());
        let b = self.bills[i].clone();
        if b.last_paid_month == Some(month) {
            fail("E_BILL_PAID", format!("bill already paid for {}", month));
        }
        self.bills[i].last_paid_month = Some(month);
        self.payout(
            b.pot_id,
            b.token,
            b.amount.0,
            b.payee,
            Some(b.name),
            by,
            PayoutKind::Bill,
            Some((id, b.last_paid_month)),
            agent,
        )
    }

    fn run_action(&mut self, action: AgentAction, by: String, agent: Option<PublicKey>) -> PromiseOrValue<bool> {
        match action {
            AgentAction::Pay { token, amount, to, memo } => PromiseOrValue::Promise(self.payout(
                FLEX_ID,
                token,
                amount.0,
                to,
                memo,
                by,
                PayoutKind::Pay,
                None,
                agent,
            )),
            AgentAction::PayBill { bill_id } => PromiseOrValue::Promise(self.do_pay_bill(bill_id, by, agent)),
            AgentAction::Move { from_pot, to_pot, token, amount } => {
                self.do_move(from_pot, to_pot, token, amount.0, by);
                PromiseOrValue::Value(true)
            }
            AgentAction::Save { to_pot, token, amount } => {
                if to_pot == FLEX_ID {
                    fail("E_BAD_INPUT", "save moves money out of Spend into another pot");
                }
                self.do_move(FLEX_ID, to_pot, token, amount.0, by);
                PromiseOrValue::Value(true)
            }
        }
    }

    fn ajo_send(&mut self, circle_id: u64, token: Token, amount: u128, kind: &str) -> Promise {
        let ajo = self.ajo();
        ok(self.ledger.begin_out(FLEX_ID, token, amount, now(), true));
        Promise::new(self.token_id(token))
            .function_call(
                "ft_transfer_call",
                args(json!({
                    "receiver_id": ajo, "amount": U128(amount),
                    "msg": json!({"circle_id": circle_id, "kind": kind}).to_string()
                })),
                ONE_YOCTO,
                GAS_FT_TRANSFER_CALL,
            )
            .then(self_cb(
                "on_ajo_sent",
                json!({"token": token, "amount": U128(amount), "circle_id": circle_id, "kind": kind}),
                GAS_CB,
            ))
    }

    fn prune_proposals(&mut self, t: u64) {
        if (self.proposals.len() as usize) <= MAX_PROPOSALS_KEPT {
            return;
        }
        let mut closed: Vec<u64> = self
            .proposals
            .iter()
            .filter(|(_, p)| p.status != ProposalStatus::Pending || t >= p.expires_at.0)
            .map(|(id, _)| *id)
            .collect();
        closed.sort();
        let excess = self.proposals.len() as usize - MAX_PROPOSALS_KEPT;
        for id in closed.into_iter().take(excess) {
            self.proposals.remove(&id);
        }
    }
}

#[cfg(test)]
mod tests;
