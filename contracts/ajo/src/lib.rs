//! Oiko ajo (rotating savings circles): `ajo.<root>`. Keyless, immutable, no admin, no withdraw.
//! Members are normally Oiko vaults. Contributions and bonds arrive with `ft_transfer_call`.
//!
//! Rules:
//! - Invite codes are at least 10 characters; the stored hash is `sha256("<circle_id>:<code>")`
//!   (hex). `next_circle_id()` tells the organiser which id to use; `set_invite` rotates it.
//! - While forming, a member may `leave`, the organiser may `remove_member` or `cancel`, and
//!   anyone may `cancel` once the circle has been forming for `FORMING_EXPIRY_NS`. Bonds are
//!   refunded in all three cases.
//! - A member who misses contributions *before or in* their own payout round has those missed
//!   amounts withheld from their payout. Withheld money is returned at completion, split equally
//!   among members with no defaults (or among all members if everyone defaulted).
//! - A member who defaults *after* collecting has the missed amount covered from their bond.

use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError};
use oiko_common::{emit, fail, Token, J};
use std::collections::BTreeMap;

#[cfg(feature = "short-periods")]
pub const MIN_PERIOD_NS: u64 = 60_000_000_000;
#[cfg(not(feature = "short-periods"))]
pub const MIN_PERIOD_NS: u64 = 86_400_000_000_000;

#[cfg(feature = "short-periods")]
pub const FORMING_EXPIRY_NS: u64 = 600_000_000_000; // 10 minutes
#[cfg(not(feature = "short-periods"))]
pub const FORMING_EXPIRY_NS: u64 = 7 * 86_400_000_000_000; // 7 days

pub const MAX_MEMBERS: u8 = 12;
pub const MIN_INVITE_LEN: usize = 10;
const GAS_PAYOUT: Gas = Gas::from_tgas(120);
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_CB: Gas = Gas::from_tgas(20);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CircleStatus {
    Forming,
    Active,
    Completed,
    Cancelled,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Circle {
    pub id: u64,
    pub name: String,
    pub organiser: AccountId,
    pub token: Token,
    pub amount_per_round: U128,
    pub period_ns: U64,
    pub max_members: u8,
    pub members: Vec<AccountId>,
    pub order: Vec<AccountId>,
    pub bond_amount: U128,
    pub bonds: BTreeMap<AccountId, U128>,
    pub start_at: Option<U64>,
    pub round: u32,
    pub paid: Vec<(u32, AccountId)>,
    pub defaults: Vec<(u32, AccountId)>,
    pub collected: U128,
    pub status: CircleStatus,
    pub shuffle: bool,
    pub payouts: Vec<(u32, AccountId, U128)>,
}

/// Bookkeeping kept outside `Circle` so the frozen JSON shape doesn't change.
#[near(serializers = [borsh])]
#[derive(Clone, Debug, Default)]
pub struct Extra {
    pub created_at: u64,
    /// missed contributions not yet deducted from the member's payout
    pub owed: BTreeMap<AccountId, u128>,
    /// deducted from payouts, returned at completion
    pub withheld: u128,
}

#[near(serializers = [json])]
struct TransferMsg {
    circle_id: u64,
    kind: String,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Ajo {
    usdc: AccountId,
    usdt: AccountId,
    circles: LookupMap<u64, Circle>,
    invite_hashes: LookupMap<u64, String>,
    by_member: LookupMap<AccountId, Vec<u64>>,
    next_id: u64,
    extra: LookupMap<u64, Extra>,
}

fn now() -> u64 {
    env::block_timestamp()
}

fn hex(b: &[u8]) -> String {
    const H: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(b.len() * 2);
    for x in b {
        s.push(H[(x >> 4) as usize] as char);
        s.push(H[(x & 15) as usize] as char);
    }
    s
}

/// `sha256("<circle_id>:<code>")` as hex.
pub fn invite_hash(circle_id: u64, code: &str) -> String {
    hex(&env::sha256(format!("{}:{}", circle_id, code).as_bytes()))
}

/// Positions that collect before the last round must be bonded: the first ceil(n/2).
pub fn bonded_positions(n: usize) -> usize {
    n.div_ceil(2)
}

/// Fisher-Yates shuffle driven by a seed (env::random_seed in the contract).
pub fn shuffle_with_seed<T>(v: &mut [T], seed: &[u8]) {
    if v.len() < 2 {
        return;
    }
    let h = env::sha256(seed);
    let mut state = u64::from_le_bytes(h[0..8].try_into().unwrap()) | 1;
    for i in (1..v.len()).rev() {
        state ^= state >> 12;
        state ^= state << 25;
        state ^= state >> 27;
        let r = state.wrapping_mul(0x2545F4914F6CDD1D);
        let j = (r % (i as u64 + 1)) as usize;
        v.swap(i, j);
    }
}

fn check_hash(h: &str) -> String {
    let h = h.to_ascii_lowercase();
    if h.len() != 64 || !h.bytes().all(|c| c.is_ascii_hexdigit()) {
        fail("E_BAD_INPUT", "invite_code_hash must be a hex sha256");
    }
    h
}

fn transfer(token_id: &AccountId, to: &AccountId, amount: u128, memo: &str) {
    Promise::new(token_id.clone())
        .function_call(
            "ft_transfer",
            J::new().s("receiver_id", to.as_str()).u("amount", amount).s("memo", memo).bytes(),
            ONE_YOCTO,
            GAS_FT_TRANSFER,
        )
        .detach();
}

#[near]
impl Ajo {
    /// If the receiver refunded part of a payout (not a contract / failed), resend it plainly.
    #[private]
    pub fn on_payout(
        &mut self,
        token_id: AccountId,
        to: AccountId,
        amount: U128,
        #[callback_result] used: Result<U128, PromiseError>,
    ) {
        let used = used.map(|u| u.0).unwrap_or(0);
        if used < amount.0 {
            transfer(&token_id, &to, amount.0 - used, "ajo payout");
        }
    }

    // ---------------------------------------------------------------------------------- views
    /// The id the next `create_circle` will get (for computing the invite hash).
    pub fn next_circle_id(&self) -> u64 {
        self.next_id
    }

    pub fn min_period_ns(&self) -> U64 {
        U64(MIN_PERIOD_NS)
    }

    pub fn version(&self) -> String {
        "1.0.0".into()
    }
    // JSON-argument wrappers (args parsed with oiko_common::args; see vault for rationale)
    #[init]
    pub fn new() -> Self {
        let a = oiko_common::args::input();
        Self::new_t(a.req("usdc").account(), a.req("usdt").account())
    }

    pub fn create_circle(&mut self) -> u64 {
        let a = oiko_common::args::input();
        self.create_circle_t(a.req("name").string(), a.req("token").token(), U128(a.req("amount_per_round").dec()), U64(a.req("period_ns").dec64()), a.req("max_members").u8(), a.opt("bond_amount").map(|x| U128(x.dec())), a.req("shuffle").boolean(), a.req("invite_code_hash").string())
    }

    pub fn join(&mut self)  {
        let a = oiko_common::args::input();
        self.join_t(a.req("circle_id").u64(), a.req("invite_code").string())
    }

    pub fn set_invite(&mut self)  {
        let a = oiko_common::args::input();
        self.set_invite_t(a.req("circle_id").u64(), a.req("invite_code_hash").string())
    }

    pub fn leave(&mut self)  {
        let a = oiko_common::args::input();
        self.leave_t(a.req("circle_id").u64())
    }

    pub fn remove_member(&mut self)  {
        let a = oiko_common::args::input();
        self.remove_member_t(a.req("circle_id").u64(), a.req("member").account())
    }

    pub fn cancel(&mut self)  {
        let a = oiko_common::args::input();
        self.cancel_t(a.req("circle_id").u64())
    }

    pub fn start(&mut self)  {
        let a = oiko_common::args::input();
        self.start_t(a.req("circle_id").u64())
    }

    pub fn ft_on_transfer(&mut self) -> U128 {
        let a = oiko_common::args::input();
        self.ft_on_transfer_t(a.req("sender_id").account(), U128(a.req("amount").dec()), a.req("msg").string())
    }

    pub fn settle_round(&mut self)  {
        let a = oiko_common::args::input();
        self.settle_round_t(a.req("circle_id").u64())
    }

    pub fn get_circle(&self) -> Option<Circle> {
        let a = oiko_common::args::input();
        self.get_circle_t(a.req("id").u64())
    }

    pub fn get_circles_for(&self) -> Vec<Circle> {
        let a = oiko_common::args::input();
        self.get_circles_for_t(a.req("member").account())
    }

    pub fn get_circles(&self) -> Vec<Circle> {
        let a = oiko_common::args::input();
        self.get_circles_t(a.req("from").u64(), a.req("limit").u32())
    }

    pub fn get_withheld(&self) -> U128 {
        let a = oiko_common::args::input();
        self.get_withheld_t(a.req("circle_id").u64())
    }

}

/// Typed implementations behind the JSON wrappers.
impl Ajo {
    pub fn new_t(usdc: AccountId, usdt: AccountId) -> Self {
        Self {
            usdc,
            usdt,
            circles: LookupMap::new(b"c"),
            invite_hashes: LookupMap::new(b"i"),
            by_member: LookupMap::new(b"m"),
            next_id: 1,
            extra: LookupMap::new(b"x"),
        }
    }

    /// `invite_code_hash` = hex sha256("<id>:<code>") where `<id>` is `next_circle_id()`.
    #[allow(clippy::too_many_arguments)]
    pub fn create_circle_t(
        &mut self,
        name: String,
        token: Token,
        amount_per_round: U128,
        period_ns: U64,
        max_members: u8,
        bond_amount: Option<U128>,
        shuffle: bool,
        invite_code_hash: String,
    ) -> u64 {
        if name.trim().is_empty() || name.chars().count() > 40 {
            fail("E_BAD_INPUT", "name must be 1..=40 characters");
        }
        if amount_per_round.0 == 0 {
            fail("E_BAD_AMOUNT", "amount_per_round must be > 0");
        }
        if period_ns.0 < MIN_PERIOD_NS {
            fail("E_BAD_PERIOD", format!("period must be at least {} ns", MIN_PERIOD_NS));
        }
        if !(2..=MAX_MEMBERS).contains(&max_members) {
            fail("E_BAD_INPUT", "max_members must be 2..=12");
        }
        let h = check_hash(&invite_code_hash);
        let organiser = env::predecessor_account_id();
        let id = self.next_id;
        self.next_id += 1;
        let c = Circle {
            id,
            name,
            organiser: organiser.clone(),
            token,
            amount_per_round,
            period_ns,
            max_members,
            members: vec![organiser.clone()],
            order: vec![],
            bond_amount: bond_amount.unwrap_or(U128(0)),
            bonds: BTreeMap::new(),
            start_at: None,
            round: 0,
            paid: vec![],
            defaults: vec![],
            collected: U128(0),
            status: CircleStatus::Forming,
            shuffle,
            payouts: vec![],
        };
        emit(
            "ajo_created",
            J::new()
                .n("circle_id", id)
                .s("name", &c.name)
                .s("organiser", organiser.as_str())
                .s("token", token.as_str())
                .u("amount_per_round", amount_per_round.0)
                .u("period_ns", period_ns.0 as u128)
                .n("max_members", max_members as u64)
                .u("bond_amount", c.bond_amount.0),
        );
        self.circles.insert(id, c);
        self.invite_hashes.insert(id, h);
        self.extra.insert(id, Extra { created_at: now(), ..Default::default() });
        self.index_member(&organiser, id);
        id
    }

    pub fn join_t(&mut self, circle_id: u64, invite_code: String) {
        let who = env::predecessor_account_id();
        let mut c = self.circle(circle_id);
        if c.status != CircleStatus::Forming {
            fail("E_NOT_FORMING", "circle already started");
        }
        if c.members.contains(&who) {
            fail("E_ALREADY_MEMBER", "already a member");
        }
        if c.members.len() >= c.max_members as usize {
            fail("E_FULL", "circle is full");
        }
        if invite_code.chars().count() < MIN_INVITE_LEN
            || self.invite_hashes.get(&circle_id).map(|h| h.as_str()) != Some(invite_hash(circle_id, &invite_code).as_str())
        {
            fail("E_BAD_INVITE", "invite code does not match");
        }
        c.members.push(who.clone());
        self.circles.insert(circle_id, c);
        self.index_member(&who, circle_id);
        emit("ajo_joined", J::new().n("circle_id", circle_id).s("member", who.as_str()));
    }

    /// Organiser only, while forming: replace the invite hash (e.g. after removing a member).
    pub fn set_invite_t(&mut self, circle_id: u64, invite_code_hash: String) {
        let c = self.forming_as_organiser(circle_id);
        self.invite_hashes.insert(c.id, check_hash(&invite_code_hash));
        emit("ajo_invite_changed", J::new().n("circle_id", circle_id));
    }

    /// Member (not the organiser) leaves a circle that has not started; bond refunded.
    pub fn leave_t(&mut self, circle_id: u64) {
        let who = env::predecessor_account_id();
        let c = self.circle(circle_id);
        if c.status != CircleStatus::Forming {
            fail("E_NOT_FORMING", "circle already started");
        }
        if who == c.organiser {
            fail("E_NOT_ORGANISER", "the organiser cancels the circle instead of leaving");
        }
        if !c.members.contains(&who) {
            fail("E_NOT_MEMBER", "not a member");
        }
        self.drop_member(c, &who, "ajo_left");
    }

    /// Organiser removes a member before start; their bond is refunded.
    pub fn remove_member_t(&mut self, circle_id: u64, member: AccountId) {
        let c = self.forming_as_organiser(circle_id);
        if member == c.organiser {
            fail("E_BAD_INPUT", "the organiser can't remove themselves; cancel instead");
        }
        if !c.members.contains(&member) {
            fail("E_NOT_MEMBER", "not a member");
        }
        self.drop_member(c, &member, "ajo_member_removed");
    }

    /// Organiser (any time while forming) or anyone (after the forming expiry) cancels a circle
    /// that has not started. All bonds are refunded.
    pub fn cancel_t(&mut self, circle_id: u64) {
        let mut c = self.circle(circle_id);
        if c.status != CircleStatus::Forming {
            fail("E_NOT_FORMING", "circle already started");
        }
        let created = self.extra.get(&circle_id).map(|e| e.created_at).unwrap_or(0);
        if env::predecessor_account_id() != c.organiser && now() < created + FORMING_EXPIRY_NS {
            fail("E_NOT_ORGANISER", "only the organiser can cancel before the forming period expires");
        }
        let token_id = self.token_id(c.token);
        for (m, b) in std::mem::take(&mut c.bonds) {
            if b.0 > 0 {
                transfer(&token_id, &m, b.0, "ajo bond refund");
                emit("ajo_bond_returned", J::new().n("circle_id", circle_id).s("member", m.as_str()).u("amount", b.0));
            }
        }
        c.status = CircleStatus::Cancelled;
        emit("ajo_cancelled", J::new().n("circle_id", circle_id));
        self.circles.insert(circle_id, c);
    }

    pub fn start_t(&mut self, circle_id: u64) {
        let mut c = self.forming_as_organiser(circle_id);
        if c.members.len() < 2 {
            fail("E_TOO_FEW", "a circle needs at least 2 members");
        }
        let n = c.members.len();
        let need = bonded_positions(n);
        let bonded = |m: &AccountId| c.bond_amount.0 == 0 || c.bonds.get(m).map(|b| b.0 >= c.bond_amount.0).unwrap_or(false);
        let order: Vec<AccountId> = if c.shuffle {
            // bonded members first (shuffled), then the rest (shuffled), so the bond rule holds
            let seed = env::random_seed();
            let mut a: Vec<AccountId> = c.members.iter().filter(|m| bonded(m)).cloned().collect();
            let mut b: Vec<AccountId> = c.members.iter().filter(|m| !bonded(m)).cloned().collect();
            shuffle_with_seed(&mut a, &seed);
            let mut seed2 = seed.clone();
            seed2.push(1);
            shuffle_with_seed(&mut b, &seed2);
            a.extend(b);
            a
        } else {
            c.members.clone()
        };
        if let Some(m) = order.iter().take(need).find(|m| !bonded(m)) {
            fail("E_BOND_MISSING", format!("{} collects early and must post a bond first", m));
        }
        c.order = order;
        c.start_at = Some(U64(now()));
        c.status = CircleStatus::Active;
        let mut arr = String::from("[");
        for (i, m) in c.order.iter().enumerate() {
            if i > 0 {
                arr.push(',');
            }
            oiko_common::json_str(&mut arr, m.as_str());
        }
        arr.push(']');
        emit(
            "ajo_started",
            J::new().n("circle_id", circle_id).raw("order", &arr).u("start_at", c.start_at.unwrap().0 as u128),
        );
        self.circles.insert(circle_id, c);
    }

    /// NEP-141 receiver for contributions and bonds. Returns the unused amount (refunded).
    pub fn ft_on_transfer_t(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        let m: TransferMsg = serde_json::from_str(&msg)
            .unwrap_or_else(|_| fail("E_BAD_MSG", "msg must be {\"circle_id\":n,\"kind\":\"contribution\"|\"bond\"}"));
        let mut c = self.circle(m.circle_id);
        if env::predecessor_account_id() != self.token_id(c.token) {
            fail("E_BAD_TOKEN", "wrong token for this circle");
        }
        if !c.members.contains(&sender_id) {
            fail("E_NOT_MEMBER", "sender is not a member");
        }
        let unused = match m.kind.as_str() {
            "contribution" => {
                if c.status != CircleStatus::Active {
                    fail("E_NOT_ACTIVE", "circle is not active");
                }
                let deadline = c.start_at.unwrap().0 + (c.round as u64 + 1) * c.period_ns.0;
                let r = c.round;
                if now() >= deadline {
                    env::log_str("E_TOO_LATE: this round has ended; settle it first");
                    amount.0
                } else if c.paid.iter().any(|(pr, a)| *pr == r && *a == sender_id) {
                    env::log_str("E_ALREADY_PAID: already contributed this round");
                    amount.0
                } else if amount.0 < c.amount_per_round.0 {
                    env::log_str("E_BAD_AMOUNT: contribution must equal amount_per_round");
                    amount.0
                } else {
                    c.paid.push((r, sender_id.clone()));
                    c.collected = U128(c.collected.0 + c.amount_per_round.0);
                    emit(
                        "ajo_contribution",
                        J::new().n("circle_id", c.id).n("round", r as u64).s("member", sender_id.as_str()).u("amount", c.amount_per_round.0),
                    );
                    amount.0 - c.amount_per_round.0
                }
            }
            "bond" => {
                if c.bond_amount.0 == 0 || c.status != CircleStatus::Forming && c.status != CircleStatus::Active {
                    env::log_str("E_NO_BOND: this circle takes no bond now");
                    amount.0
                } else if c.bonds.get(&sender_id).map(|b| b.0 > 0).unwrap_or(false) {
                    env::log_str("E_ALREADY_PAID: bond already posted");
                    amount.0
                } else if amount.0 < c.bond_amount.0 {
                    env::log_str("E_BAD_AMOUNT: bond must equal bond_amount");
                    amount.0
                } else {
                    c.bonds.insert(sender_id.clone(), c.bond_amount);
                    emit(
                        "ajo_bond_posted",
                        J::new().n("circle_id", c.id).s("member", sender_id.as_str()).u("amount", c.bond_amount.0),
                    );
                    amount.0 - c.bond_amount.0
                }
            }
            _ => fail("E_BAD_MSG", "kind must be contribution or bond"),
        };
        self.circles.insert(c.id, c);
        U128(unused)
    }

    /// Permissionless once the current round's period is over.
    pub fn settle_round_t(&mut self, circle_id: u64) {
        let mut c = self.circle(circle_id);
        if c.status != CircleStatus::Active {
            fail("E_NOT_ACTIVE", "circle is not active");
        }
        let r = c.round;
        let deadline = c.start_at.unwrap().0 + (r as u64 + 1) * c.period_ns.0;
        if now() < deadline {
            fail("E_TOO_EARLY", format!("round {} ends at {}", r, deadline));
        }
        let mut x = self.extra.get(&circle_id).cloned().unwrap_or_default();
        let token_id = self.token_id(c.token);
        let recipient = c.order[r as usize].clone();
        let per = c.amount_per_round.0;
        let order = c.order.clone();
        for (pos, m) in order.iter().enumerate() {
            if c.paid.iter().any(|(pr, a)| *pr == r && a == m) {
                continue;
            }
            c.defaults.push((r, m.clone()));
            emit("ajo_default", J::new().n("circle_id", circle_id).n("round", r as u64).s("member", m.as_str()));
            if (pos as u32) < r {
                // already collected: cover from bond
                let bond = c.bonds.get(m).map(|b| b.0).unwrap_or(0);
                let cover = bond.min(per);
                if cover > 0 {
                    c.bonds.insert(m.clone(), U128(bond - cover));
                    c.collected = U128(c.collected.0 + cover);
                    emit(
                        "ajo_bond_used",
                        J::new().n("circle_id", circle_id).n("round", r as u64).s("member", m.as_str()).u("amount", cover),
                    );
                }
            } else {
                // not yet collected: withheld from their payout
                *x.owed.entry(m.clone()).or_insert(0) += per;
            }
        }
        let owed = x.owed.remove(&recipient).unwrap_or(0);
        let withhold = owed.min(c.collected.0);
        x.withheld += withhold;
        if withhold > 0 {
            emit(
                "ajo_withheld",
                J::new().n("circle_id", circle_id).n("round", r as u64).s("member", recipient.as_str()).u("amount", withhold),
            );
        }
        let amount = c.collected.0 - withhold;
        if amount > 0 {
            c.payouts.push((r, recipient.clone(), U128(amount)));
            Promise::new(token_id.clone())
                .function_call(
                    "ft_transfer_call",
                    J::new().s("receiver_id", recipient.as_str()).u("amount", amount).s("msg", "ajo_payout").bytes(),
                    ONE_YOCTO,
                    GAS_PAYOUT,
                )
                .then(Promise::new(env::current_account_id()).function_call(
                    "on_payout",
                    J::new().s("token_id", token_id.as_str()).s("to", recipient.as_str()).u("amount", amount).bytes(),
                    NearToken::from_yoctonear(0),
                    GAS_CB,
                ))
                .detach();
        }
        emit(
            "ajo_round_settled",
            J::new().n("circle_id", circle_id).n("round", r as u64).s("recipient", recipient.as_str()).u("amount", amount),
        );
        c.collected = U128(0);
        c.round += 1;
        if c.round as usize >= c.order.len() {
            c.status = CircleStatus::Completed;
            for (m, b) in std::mem::take(&mut c.bonds) {
                c.bonds.insert(m.clone(), U128(0));
                if b.0 > 0 {
                    // plain transfer: the member vault credits it on its next sync()
                    transfer(&token_id, &m, b.0, "ajo bond return");
                    emit("ajo_bond_returned", J::new().n("circle_id", circle_id).s("member", m.as_str()).u("amount", b.0));
                }
            }
            if x.withheld > 0 {
                for (m, a) in withheld_shares(&c, x.withheld) {
                    transfer(&token_id, &m, a, "ajo withheld return");
                    emit("ajo_withheld_returned", J::new().n("circle_id", circle_id).s("member", m.as_str()).u("amount", a));
                }
                x.withheld = 0;
            }
            emit("ajo_completed", J::new().n("circle_id", circle_id));
        }
        self.extra.insert(circle_id, x);
        self.circles.insert(circle_id, c);
    }

    pub fn get_circle_t(&self, id: u64) -> Option<Circle> {
        self.circles.get(&id).cloned()
    }

    pub fn get_circles_for_t(&self, member: AccountId) -> Vec<Circle> {
        self.by_member
            .get(&member)
            .map(|ids| ids.iter().filter_map(|i| self.circles.get(i).cloned()).collect())
            .unwrap_or_default()
    }

    pub fn get_circles_t(&self, from: u64, limit: u32) -> Vec<Circle> {
        (from.max(1)..self.next_id)
            .take(limit.min(50) as usize)
            .filter_map(|i| self.circles.get(&i).cloned())
            .collect()
    }

    /// Amount currently withheld from defaulters' payouts (returned at completion).
    pub fn get_withheld_t(&self, circle_id: u64) -> U128 {
        U128(self.extra.get(&circle_id).map(|e| e.withheld).unwrap_or(0))
    }

}

/// Withheld money at completion: equal shares to members with no defaults (all members if
/// everyone defaulted); the remainder unit(s) go to the first of them.
pub fn withheld_shares(c: &Circle, withheld: u128) -> Vec<(AccountId, u128)> {
    let mut good: Vec<AccountId> =
        c.order.iter().filter(|m| !c.defaults.iter().any(|(_, d)| d == *m)).cloned().collect();
    if good.is_empty() {
        good = c.order.clone();
    }
    let n = good.len() as u128;
    let each = withheld / n;
    let rem = withheld - each * n;
    good.into_iter()
        .enumerate()
        .map(|(i, m)| (m, each + if i == 0 { rem } else { 0 }))
        .filter(|(_, a)| *a > 0)
        .collect()
}

impl Ajo {
    fn circle(&self, id: u64) -> Circle {
        self.circles
            .get(&id)
            .cloned()
            .unwrap_or_else(|| fail("E_NO_CIRCLE", "no such circle"))
    }

    fn forming_as_organiser(&self, id: u64) -> Circle {
        let c = self.circle(id);
        if env::predecessor_account_id() != c.organiser {
            fail("E_NOT_ORGANISER", "only the organiser can do this");
        }
        if c.status != CircleStatus::Forming {
            fail("E_NOT_FORMING", "circle already started");
        }
        c
    }

    fn drop_member(&mut self, mut c: Circle, who: &AccountId, event: &str) {
        c.members.retain(|m| m != who);
        if let Some(b) = c.bonds.remove(who) {
            if b.0 > 0 {
                transfer(&self.token_id(c.token), who, b.0, "ajo bond refund");
                emit("ajo_bond_returned", J::new().n("circle_id", c.id).s("member", who.as_str()).u("amount", b.0));
            }
        }
        if let Some(mut v) = self.by_member.get(who).cloned() {
            v.retain(|i| *i != c.id);
            self.by_member.insert(who.clone(), v);
        }
        emit(event, J::new().n("circle_id", c.id).s("member", who.as_str()));
        self.circles.insert(c.id, c);
    }

    fn token_id(&self, t: Token) -> AccountId {
        match t {
            Token::Usdc => self.usdc.clone(),
            Token::Usdt => self.usdt.clone(),
        }
    }

    fn index_member(&mut self, who: &AccountId, id: u64) {
        let mut v = self.by_member.get(who).cloned().unwrap_or_default();
        v.push(id);
        self.by_member.insert(who.clone(), v);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn a(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn ctx(pred: &str, ts: u64) {
        let mut c = VMContextBuilder::new();
        c.current_account_id(a("ajo.near")).predecessor_account_id(a(pred)).block_timestamp(ts);
        testing_env!(c.build());
    }
    fn panics<F: FnOnce()>(f: F) -> String {
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
            Ok(_) => String::new(),
            Err(e) => e.downcast_ref::<String>().cloned().unwrap_or_default(),
        }
    }
    const P: u64 = 60_000_000_000;
    const CODE: &str = "join-me-please";

    fn setup3(bond: u128) -> (Ajo, u64) {
        ctx("x.near", 1);
        let mut j = Ajo::new_t(a("usdc.near"), a("usdt.near"));
        ctx("ada.near", 1);
        let id = j.next_circle_id();
        let id = j.create_circle_t("c".into(), Token::Usdt, U128(10), U64(P), 3, Some(U128(bond)), false, invite_hash(id, CODE));
        for m in ["bola.near", "chi.near"] {
            ctx(m, 1);
            j.join_t(id, CODE.into());
        }
        (j, id)
    }

    fn contribute(j: &mut Ajo, m: &str, ts: u64) -> u128 {
        ctx("usdt.near", ts);
        j.ft_on_transfer_t(a(m), U128(10), r#"{"circle_id":1,"kind":"contribution"}"#.into()).0
    }

    #[test]
    fn full_cycle_with_default_covered_by_bond() {
        let (mut j, id) = setup3(10);
        for m in ["ada.near", "bola.near", "chi.near"] {
            ctx("usdt.near", 2);
            assert_eq!(j.ft_on_transfer_t(a(m), U128(15), r#"{"circle_id":1,"kind":"bond"}"#.into()).0, 5);
        }
        ctx("ada.near", 10);
        j.start_t(id);
        for m in ["ada.near", "bola.near", "chi.near"] {
            assert_eq!(contribute(&mut j, m, 11), 0);
        }
        ctx("anyone.near", 10 + P);
        j.settle_round_t(id);
        for m in ["bola.near", "chi.near"] {
            contribute(&mut j, m, 11 + P);
        }
        ctx("anyone.near", 10 + 2 * P);
        j.settle_round_t(id);
        let c = j.get_circle_t(id).unwrap();
        assert_eq!(c.defaults, vec![(1, a("ada.near"))]);
        assert_eq!(c.payouts[1], (1, a("bola.near"), U128(30)));
        assert_eq!(c.bonds.get(&a("ada.near")).unwrap().0, 0);
        for m in ["ada.near", "bola.near", "chi.near"] {
            contribute(&mut j, m, 11 + 2 * P);
        }
        ctx("anyone.near", 10 + 3 * P);
        j.settle_round_t(id);
        let c = j.get_circle_t(id).unwrap();
        assert_eq!(c.status, CircleStatus::Completed);
        assert_eq!(c.payouts.len(), 3);
        assert!(c.bonds.values().all(|b| b.0 == 0));
    }

    #[test]
    fn default_before_turn_is_withheld_and_returned() {
        // A-3: chi skips round 0 (before her turn) and still collects in round 2 — minus 10.
        let (mut j, id) = setup3(0);
        ctx("ada.near", 10);
        j.start_t(id);
        for m in ["ada.near", "bola.near"] {
            contribute(&mut j, m, 11);
        }
        ctx("anyone.near", 10 + P);
        j.settle_round_t(id);
        for (r, ms) in [(1u64, ["ada.near", "bola.near", "chi.near"]), (2, ["ada.near", "bola.near", "chi.near"])] {
            for m in ms {
                contribute(&mut j, m, 11 + r * P);
            }
            ctx("anyone.near", 10 + (r + 1) * P);
            j.settle_round_t(id);
        }
        let c = j.get_circle_t(id).unwrap();
        assert_eq!(c.payouts[0].2 .0, 20); // ada got only what was paid
        assert_eq!(c.payouts[2], (2, a("chi.near"), U128(20))); // 30 - 10 withheld
        assert_eq!(c.status, CircleStatus::Completed);
        assert_eq!(j.get_withheld_t(id).0, 0);
        let shares = withheld_shares(&c, 10);
        assert_eq!(shares, vec![(a("ada.near"), 5), (a("bola.near"), 5)]);
    }

    #[test]
    fn invite_rules() {
        ctx("x.near", 1);
        let mut j = Ajo::new_t(a("usdc.near"), a("usdt.near"));
        ctx("ada.near", 1);
        // hash bound to a different id doesn't work
        let id = j.create_circle_t("c".into(), Token::Usdt, U128(10), U64(P), 3, None, false, invite_hash(99, CODE));
        ctx("bola.near", 1);
        assert!(panics(|| j.join_t(id, CODE.into())).contains("E_BAD_INVITE"));
        // short codes are refused even if the hash matches
        ctx("ada.near", 1);
        j.set_invite_t(id, invite_hash(id, "short"));
        ctx("bola.near", 1);
        assert!(panics(|| j.join_t(id, "short".into())).contains("E_BAD_INVITE"));
        ctx("ada.near", 1);
        j.set_invite_t(id, invite_hash(id, CODE));
        ctx("bola.near", 1);
        j.join_t(id, CODE.into());
        ctx("bola.near", 1);
        assert!(panics(|| j.set_invite_t(id, invite_hash(id, CODE))).contains("E_NOT_ORGANISER"));
    }

    #[test]
    fn leave_remove_cancel_refund_bonds() {
        let (mut j, id) = setup3(10);
        for m in ["ada.near", "bola.near", "chi.near"] {
            ctx("usdt.near", 2);
            j.ft_on_transfer_t(a(m), U128(10), r#"{"circle_id":1,"kind":"bond"}"#.into());
        }
        ctx("bola.near", 3);
        j.leave_t(id);
        let c = j.get_circle_t(id).unwrap();
        assert!(!c.members.contains(&a("bola.near")));
        assert!(c.bonds.get(&a("bola.near")).is_none());
        assert!(j.get_circles_for_t(a("bola.near")).is_empty());
        ctx("ada.near", 3);
        assert!(panics(|| j.leave_t(id)).contains("E_NOT_ORGANISER"));
        j.remove_member_t(id, a("chi.near"));
        assert_eq!(j.get_circle_t(id).unwrap().members, vec![a("ada.near")]);
        // a stranger can't cancel before expiry, can after
        ctx("eve.near", 4);
        assert!(panics(|| j.cancel_t(id)).contains("E_NOT_ORGANISER"));
        ctx("eve.near", 1 + FORMING_EXPIRY_NS);
        j.cancel_t(id);
        let c = j.get_circle_t(id).unwrap();
        assert_eq!(c.status, CircleStatus::Cancelled);
        assert!(c.bonds.is_empty());
        ctx("ada.near", 2 + FORMING_EXPIRY_NS);
        assert!(panics(|| j.start_t(id)).contains("E_NOT_FORMING"));
    }

    #[test]
    fn bonded_positions_rule() {
        assert_eq!(bonded_positions(2), 1);
        assert_eq!(bonded_positions(3), 2);
        assert_eq!(bonded_positions(10), 5);
    }
}
