//! Oiko ajo (rotating savings circles): `ajo.<root>`. Keyless, immutable, no admin, no withdraw.
//! Members are normally Oiko vaults. Contributions and bonds arrive with `ft_transfer_call`.

use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::store::LookupMap;
use near_sdk::{env, near, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError};
use oiko_common::{emit, fail, Token};
use std::collections::BTreeMap;

#[cfg(feature = "short-periods")]
pub const MIN_PERIOD_NS: u64 = 60_000_000_000;
#[cfg(not(feature = "short-periods"))]
pub const MIN_PERIOD_NS: u64 = 86_400_000_000_000;

pub const MAX_MEMBERS: u8 = 12;
const GAS_PAYOUT: Gas = Gas::from_tgas(80);
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
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Circle {
    pub id: u64,
    pub name: String,
    pub organiser: AccountId,
    pub token: Token,
    pub amount_per_round: U128,
    pub period_ns: near_sdk::json_types::U64,
    pub max_members: u8,
    pub members: Vec<AccountId>,
    pub order: Vec<AccountId>,
    pub bond_amount: U128,
    pub bonds: BTreeMap<AccountId, U128>,
    pub start_at: Option<near_sdk::json_types::U64>,
    pub round: u32,
    pub paid: Vec<(u32, AccountId)>,
    pub defaults: Vec<(u32, AccountId)>,
    pub collected: U128,
    pub status: CircleStatus,
    pub shuffle: bool,
    pub payouts: Vec<(u32, AccountId, U128)>,
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
}

fn now() -> u64 {
    env::block_timestamp()
}

fn sha256_hex(s: &str) -> String {
    env::sha256(s.as_bytes()).iter().map(|b| format!("{:02x}", b)).collect()
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
        // xorshift64*
        state ^= state >> 12;
        state ^= state << 25;
        state ^= state >> 27;
        let r = state.wrapping_mul(0x2545F4914F6CDD1D);
        let j = (r % (i as u64 + 1)) as usize;
        v.swap(i, j);
    }
}

#[near]
impl Ajo {
    #[init]
    pub fn new(usdc: AccountId, usdt: AccountId) -> Self {
        Self {
            usdc,
            usdt,
            circles: LookupMap::new(b"c"),
            invite_hashes: LookupMap::new(b"i"),
            by_member: LookupMap::new(b"m"),
            next_id: 1,
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_circle(
        &mut self,
        name: String,
        token: Token,
        amount_per_round: U128,
        period_ns: near_sdk::json_types::U64,
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
            fail("E_BAD_INPUT", format!("max_members must be 2..={}", MAX_MEMBERS));
        }
        let h = invite_code_hash.to_ascii_lowercase();
        if h.len() != 64 || !h.chars().all(|c| c.is_ascii_hexdigit()) {
            fail("E_BAD_INPUT", "invite_code_hash must be a hex sha256");
        }
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
            json!({"circle_id": id, "name": c.name, "organiser": organiser, "token": token,
                   "amount_per_round": amount_per_round, "period_ns": period_ns, "max_members": max_members,
                   "bond_amount": c.bond_amount}),
        );
        self.circles.insert(id, c);
        self.invite_hashes.insert(id, h);
        self.index_member(&organiser, id);
        id
    }

    pub fn join(&mut self, circle_id: u64, invite_code: String) {
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
        if self.invite_hashes.get(&circle_id).map(|h| h.as_str()) != Some(sha256_hex(&invite_code).as_str()) {
            fail("E_BAD_INVITE", "invite code does not match");
        }
        c.members.push(who.clone());
        self.circles.insert(circle_id, c);
        self.index_member(&who, circle_id);
        emit("ajo_joined", json!({"circle_id": circle_id, "member": who}));
    }

    pub fn start(&mut self, circle_id: u64) {
        let mut c = self.circle(circle_id);
        if env::predecessor_account_id() != c.organiser {
            fail("E_NOT_ORGANISER", "only the organiser can start the circle");
        }
        if c.status != CircleStatus::Forming {
            fail("E_NOT_FORMING", "circle already started");
        }
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
        c.start_at = Some(near_sdk::json_types::U64(now()));
        c.status = CircleStatus::Active;
        emit("ajo_started", json!({"circle_id": circle_id, "order": c.order, "start_at": c.start_at}));
        self.circles.insert(circle_id, c);
    }

    /// NEP-141 receiver for contributions and bonds. Returns the unused amount (refunded).
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
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
                        json!({"circle_id": c.id, "round": r, "member": sender_id, "amount": c.amount_per_round}),
                    );
                    amount.0 - c.amount_per_round.0
                }
            }
            "bond" => {
                if c.bond_amount.0 == 0 || c.status == CircleStatus::Completed {
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
                        json!({"circle_id": c.id, "member": sender_id, "amount": c.bond_amount}),
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
    pub fn settle_round(&mut self, circle_id: u64) {
        let mut c = self.circle(circle_id);
        if c.status != CircleStatus::Active {
            fail("E_NOT_ACTIVE", "circle is not active");
        }
        let r = c.round;
        let deadline = c.start_at.unwrap().0 + (r as u64 + 1) * c.period_ns.0;
        if now() < deadline {
            fail("E_TOO_EARLY", format!("round {} ends at {}", r, deadline));
        }
        let token_id = self.token_id(c.token);
        let recipient = c.order[r as usize].clone();
        let order = c.order.clone();
        for (pos, m) in order.iter().enumerate() {
            if c.paid.iter().any(|(pr, a)| *pr == r && a == m) {
                continue;
            }
            c.defaults.push((r, m.clone()));
            emit("ajo_default", json!({"circle_id": circle_id, "round": r, "member": m}));
            if (pos as u32) < r {
                let bond = c.bonds.get(m).map(|b| b.0).unwrap_or(0);
                let cover = bond.min(c.amount_per_round.0);
                if cover > 0 {
                    c.bonds.insert(m.clone(), U128(bond - cover));
                    c.collected = U128(c.collected.0 + cover);
                    emit(
                        "ajo_bond_used",
                        json!({"circle_id": circle_id, "round": r, "member": m, "amount": U128(cover)}),
                    );
                }
            }
        }
        let amount = c.collected.0;
        if amount > 0 {
            c.payouts.push((r, recipient.clone(), U128(amount)));
            Promise::new(token_id.clone())
                .function_call(
                    "ft_transfer_call",
                    serde_json::to_vec(&json!({"receiver_id": recipient, "amount": U128(amount), "msg": "ajo_payout"})).unwrap(),
                    ONE_YOCTO,
                    GAS_PAYOUT,
                )
                .then(Promise::new(env::current_account_id()).function_call(
                    "on_payout",
                    serde_json::to_vec(&json!({"token_id": token_id, "to": recipient, "amount": U128(amount)})).unwrap(),
                    NearToken::from_yoctonear(0),
                    GAS_CB,
                ))
                .detach();
        }
        emit(
            "ajo_round_settled",
            json!({"circle_id": circle_id, "round": r, "recipient": recipient, "amount": U128(amount)}),
        );
        c.collected = U128(0);
        c.round += 1;
        if c.round as usize >= c.order.len() {
            c.status = CircleStatus::Completed;
            let bonds: Vec<(AccountId, U128)> = c.bonds.iter().map(|(a, b)| (a.clone(), *b)).collect();
            for (m, b) in bonds {
                if b.0 > 0 {
                    c.bonds.insert(m.clone(), U128(0));
                    // plain transfer: the member vault credits it on its next sync()
                    Promise::new(token_id.clone())
                        .function_call(
                            "ft_transfer",
                            serde_json::to_vec(&json!({"receiver_id": m, "amount": b, "memo": "ajo bond return"})).unwrap(),
                            ONE_YOCTO,
                            GAS_FT_TRANSFER,
                        )
                        .detach();
                    emit("ajo_bond_returned", json!({"circle_id": circle_id, "member": m, "amount": b}));
                }
            }
            emit("ajo_completed", json!({"circle_id": circle_id}));
        }
        self.circles.insert(circle_id, c);
    }

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
            Promise::new(token_id)
                .function_call(
                    "ft_transfer",
                    serde_json::to_vec(&json!({"receiver_id": to, "amount": U128(amount.0 - used), "memo": "ajo payout"})).unwrap(),
                    ONE_YOCTO,
                    GAS_FT_TRANSFER,
                )
                .detach();
        }
    }

    // ---------------------------------------------------------------------------------- views
    pub fn get_circle(&self, id: u64) -> Option<Circle> {
        self.circles.get(&id).cloned()
    }

    pub fn get_circles_for(&self, member: AccountId) -> Vec<Circle> {
        self.by_member
            .get(&member)
            .map(|ids| ids.iter().filter_map(|i| self.circles.get(i).cloned()).collect())
            .unwrap_or_default()
    }

    pub fn get_circles(&self, from: u64, limit: u32) -> Vec<Circle> {
        (from.max(1)..self.next_id)
            .take(limit.min(50) as usize)
            .filter_map(|i| self.circles.get(&i).cloned())
            .collect()
    }

    pub fn min_period_ns(&self) -> near_sdk::json_types::U64 {
        near_sdk::json_types::U64(MIN_PERIOD_NS)
    }

    pub fn version(&self) -> String {
        "1.0.0".into()
    }
}

impl Ajo {
    fn circle(&self, id: u64) -> Circle {
        self.circles
            .get(&id)
            .cloned()
            .unwrap_or_else(|| fail("E_NO_CIRCLE", "no such circle"))
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
    use near_sdk::json_types::U64;
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
    const P: u64 = 60_000_000_000;

    #[test]
    fn full_cycle_with_default_covered_by_bond() {
        ctx("x.near", 1);
        let mut j = Ajo::new(a("usdc.near"), a("usdt.near"));
        ctx("ada.near", 1);
        let id = j.create_circle("c".into(), Token::Usdt, U128(10), U64(P), 3, Some(U128(10)), false, sha256_hex("code"));
        ctx("bola.near", 1);
        j.join(id, "code".into());
        ctx("chi.near", 1);
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let mut j2 = Ajo::new(a("usdc.near"), a("usdt.near"));
            j2.join(id, "wrong".into())
        }));
        assert!(r.is_err());
        j.join(id, "code".into());
        for m in ["ada.near", "bola.near", "chi.near"] {
            ctx("usdt.near", 2);
            assert_eq!(j.ft_on_transfer(a(m), U128(15), r#"{"circle_id":1,"kind":"bond"}"#.into()).0, 5);
        }
        ctx("ada.near", 10);
        j.start(id);
        // round 0: all pay
        for m in ["ada.near", "bola.near", "chi.near"] {
            ctx("usdt.near", 11);
            assert_eq!(j.ft_on_transfer(a(m), U128(10), r#"{"circle_id":1,"kind":"contribution"}"#.into()).0, 0);
        }
        ctx("anyone.near", 10 + P);
        j.settle_round(id);
        // round 1: ada (already paid out) defaults
        for m in ["bola.near", "chi.near"] {
            ctx("usdt.near", 11 + P);
            j.ft_on_transfer(a(m), U128(10), r#"{"circle_id":1,"kind":"contribution"}"#.into());
        }
        ctx("anyone.near", 10 + 2 * P);
        j.settle_round(id);
        let c = j.get_circle(id).unwrap();
        assert_eq!(c.defaults, vec![(1, a("ada.near"))]);
        assert_eq!(c.payouts[1], (1, a("bola.near"), U128(30)));
        assert_eq!(c.bonds.get(&a("ada.near")).unwrap().0, 0);
        for m in ["ada.near", "bola.near", "chi.near"] {
            ctx("usdt.near", 11 + 2 * P);
            j.ft_on_transfer(a(m), U128(10), r#"{"circle_id":1,"kind":"contribution"}"#.into());
        }
        ctx("anyone.near", 10 + 3 * P);
        j.settle_round(id);
        let c = j.get_circle(id).unwrap();
        assert_eq!(c.status, CircleStatus::Completed);
        assert_eq!(c.payouts.len(), 3);
        assert!(c.bonds.values().all(|b| b.0 == 0));
    }

    #[test]
    fn bonded_positions_rule() {
        assert_eq!(bonded_positions(2), 1);
        assert_eq!(bonded_positions(3), 2);
        assert_eq!(bonded_positions(10), 5);
    }
}
