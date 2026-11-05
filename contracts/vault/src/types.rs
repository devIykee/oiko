use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId, PublicKey};
pub use oiko_common::{Balances, Token};

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PotKind {
    Flex,
    Autosave,
    Locked,
    Goal,
    Bills,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Pot {
    pub id: u32,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub kind: PotKind,
    pub balances: Balances,
    pub earn_supplied: Balances,
    /// internal lending shares (not part of the JSON interface)
    #[serde(skip)]
    pub earn_shares: Balances,
    pub unlock_at: Option<U64>,
    pub target: Option<U128>,
    pub target_date: Option<U64>,
    pub earn: bool,
    pub created_at: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SplitMode {
    Percent,
    Fixed,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct SplitRule {
    pub pot_id: u32,
    pub mode: SplitMode,
    /// percent: basis points (0..=10000); fixed: token base units
    pub value: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case", try_from = "RawRecipient")]
pub enum Recipient {
    Near { account_id: AccountId },
    Intents { chain: String, address: String, token: Token },
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Scope {
    Read,
    Propose,
    Act,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentKind {
    Pay,
    MoveBetweenPots,
    Save,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case", try_from = "RawAction")]
pub enum AgentAction {
    Pay { token: Token, amount: U128, to: AccountId, memo: Option<String> },
    PayBill { bill_id: u32 },
    Move { from_pot: u32, to_pot: u32, token: Token, amount: U128 },
    Save { to_pot: u32, token: Token, amount: U128 },
}

impl AgentAction {
    pub fn name(&self) -> &'static str {
        match self {
            AgentAction::Pay { .. } => "pay",
            AgentAction::PayBill { .. } => "pay_bill",
            AgentAction::Move { .. } => "move",
            AgentAction::Save { .. } => "save",
        }
    }
    pub fn kind(&self) -> AgentKind {
        match self {
            AgentAction::Pay { .. } | AgentAction::PayBill { .. } => AgentKind::Pay,
            AgentAction::Move { .. } => AgentKind::MoveBetweenPots,
            AgentAction::Save { .. } => AgentKind::Save,
        }
    }
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct AgentPolicyInput {
    pub label: String,
    pub agent_name: String,
    pub agent_url: String,
    pub scopes: Vec<Scope>,
    pub allowed_actions: Vec<AgentKind>,
    pub allowlist: Vec<Recipient>,
    pub per_tx: U128,
    pub daily: U128,
    pub weekly: U128,
    pub expires_at: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct AgentPolicy {
    pub label: String,
    pub agent_name: String,
    pub agent_url: String,
    pub scopes: Vec<Scope>,
    pub allowed_actions: Vec<AgentKind>,
    pub allowlist: Vec<Recipient>,
    pub per_tx: U128,
    pub daily: U128,
    pub weekly: U128,
    pub expires_at: U64,
    pub spent_day: (u64, U128),
    pub spent_week: (u64, U128),
    pub revoked: bool,
    pub created_at: U64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct AgentView {
    pub public_key: PublicKey,
    #[serde(flatten)]
    pub policy: AgentPolicy,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProposalStatus {
    Pending,
    Approved,
    Rejected,
    Expired,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Proposal {
    pub id: u64,
    pub public_key: PublicKey,
    pub agent_name: String,
    pub action: AgentAction,
    pub reason: String,
    pub created_at: U64,
    pub expires_at: U64,
    pub status: ProposalStatus,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Schedule {
    pub id: u32,
    pub to_pot: u32,
    pub token: Token,
    pub amount: U128,
    pub period_ns: U64,
    pub next_run: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Bill {
    pub id: u32,
    pub name: String,
    pub amount: U128,
    pub token: Token,
    pub due_day: u8,
    pub payee: AccountId,
    pub pot_id: u32,
    pub last_paid_month: Option<u32>,
    pub created_at: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Activity {
    pub seq: u64,
    pub at: U64,
    pub kind: String,
    pub by: String,
    pub token: Option<Token>,
    pub amount: Option<U128>,
    pub pot_id: Option<u32>,
    pub counterparty: Option<String>,
    pub note: Option<String>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, Default)]
pub struct MonthStats {
    pub month: u32,
    #[serde(rename = "in")]
    pub in_: Balances,
    pub out: Balances,
    pub saved: Balances,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Config {
    pub max_utilization_bps: u16,
    pub large_withdrawal_threshold: U128,
    pub lending: Option<AccountId>,
    pub ajo: Option<AccountId>,
    pub mpc_signer: Option<AccountId>,
    /// yoctoNEAR allowance given to each agent function-call key
    pub agent_allowance: U128,
}

#[near(serializers = [json])]
pub struct TokenIds {
    pub usdc: AccountId,
    pub usdt: AccountId,
}

#[near(serializers = [json])]
pub struct Overview {
    pub owner: AccountId,
    pub tokens: TokenIds,
    pub pots: Vec<Pot>,
    pub splits: Vec<SplitRule>,
    pub totals: Balances,
    pub flex: Balances,
    pub locked: Balances,
    pub earning: Balances,
    pub agents: Vec<AgentView>,
    pub proposals: Vec<Proposal>,
    pub schedules: Vec<Schedule>,
    pub bills: Vec<Bill>,
    pub config: Config,
    pub accounted: Balances,
    pub now: U64,
}

// Internally tagged enums are deserialized through flat structs: serde's tagged-enum path
// buffers into `Content` (with float support), which costs a lot of wasm. JSON shape unchanged.
#[near(serializers = [json])]
pub struct RawRecipient {
    #[serde(rename = "type")]
    pub ty: String,
    pub account_id: Option<AccountId>,
    pub chain: Option<String>,
    pub address: Option<String>,
    pub token: Option<Token>,
}

impl TryFrom<RawRecipient> for Recipient {
    type Error = String;
    fn try_from(r: RawRecipient) -> Result<Self, String> {
        let miss = |f: &str| format!("missing field `{}`", f);
        match r.ty.as_str() {
            "near" => Ok(Recipient::Near { account_id: r.account_id.ok_or_else(|| miss("account_id"))? }),
            "intents" => Ok(Recipient::Intents {
                chain: r.chain.ok_or_else(|| miss("chain"))?,
                address: r.address.ok_or_else(|| miss("address"))?,
                token: r.token.ok_or_else(|| miss("token"))?,
            }),
            _ => Err("unknown recipient type".into()),
        }
    }
}

#[near(serializers = [json])]
pub struct RawAction {
    #[serde(rename = "type")]
    pub ty: String,
    pub token: Option<Token>,
    pub amount: Option<U128>,
    pub to: Option<AccountId>,
    pub memo: Option<String>,
    pub bill_id: Option<u32>,
    pub from_pot: Option<u32>,
    pub to_pot: Option<u32>,
}

impl TryFrom<RawAction> for AgentAction {
    type Error = String;
    fn try_from(r: RawAction) -> Result<Self, String> {
        let miss = |f: &str| format!("missing field `{}`", f);
        match r.ty.as_str() {
            "pay" => Ok(AgentAction::Pay {
                token: r.token.ok_or_else(|| miss("token"))?,
                amount: r.amount.ok_or_else(|| miss("amount"))?,
                to: r.to.ok_or_else(|| miss("to"))?,
                memo: r.memo,
            }),
            "pay_bill" => Ok(AgentAction::PayBill { bill_id: r.bill_id.ok_or_else(|| miss("bill_id"))? }),
            "move" => Ok(AgentAction::Move {
                from_pot: r.from_pot.ok_or_else(|| miss("from_pot"))?,
                to_pot: r.to_pot.ok_or_else(|| miss("to_pot"))?,
                token: r.token.ok_or_else(|| miss("token"))?,
                amount: r.amount.ok_or_else(|| miss("amount"))?,
            }),
            "save" => Ok(AgentAction::Save {
                to_pot: r.to_pot.ok_or_else(|| miss("to_pot"))?,
                token: r.token.ok_or_else(|| miss("token"))?,
                amount: r.amount.ok_or_else(|| miss("amount"))?,
            }),
            _ => Err("unknown action type".into()),
        }
    }
}

impl PotKind {
    pub fn as_str(self) -> &'static str {
        match self {
            PotKind::Flex => "flex",
            PotKind::Autosave => "autosave",
            PotKind::Locked => "locked",
            PotKind::Goal => "goal",
            PotKind::Bills => "bills",
        }
    }
}

impl SplitMode {
    pub fn as_str(self) -> &'static str {
        match self {
            SplitMode::Percent => "percent",
            SplitMode::Fixed => "fixed",
        }
    }
}
