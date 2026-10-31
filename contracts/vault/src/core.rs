//! Pure vault logic: no `env::` calls, so it is unit/property testable without the VM.
//! Every function takes `now` (ns) explicitly and returns `Err("E_CODE: ...")` on refusal.
//!
//! Accounting model (per token `t`):
//! - `accounted[t] == Σ pots.balances[t] + in_flight[t]`                       (invariant 1)
//! - `in_flight` holds outflows (withdraw, payments, supply to lending, ajo) between the
//!   debit and their callback. A successful callback removes the amount from `accounted`;
//!   a failed one credits it back to the pot.
//! - `earn_supplied` is tracked per pot and is NOT part of `accounted` (those tokens sit in
//!   the lending contract, not in the vault's ft balance).
//! - `sync` credits `real_balance - accounted` only when positive and only when no outflow was
//!   finalised between the balance read and the callback (`epoch` unchanged), so a stale read
//!   can never over-credit.

use crate::types::*;
use near_sdk::json_types::{U128, U64};
use near_sdk::AccountId;
use oiko_common::{apply_bps, err, NS_PER_DAY, NS_PER_WEEK};

pub const FLEX_ID: u32 = 0;
pub const MAX_POTS: usize = 20;
pub const MAX_SPLITS: usize = 20;

pub type R<T> = Result<T, String>;

#[near_sdk::near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct PendingReturn {
    pub pot_id: u32,
    pub token: Token,
    pub amount: u128,
}

#[near_sdk::near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Ledger {
    pub pots: Vec<Pot>,
    pub next_pot_id: u32,
    pub splits: Vec<SplitRule>,
    pub accounted: Balances,
    pub in_flight: Balances,
    /// bumped per token whenever `accounted` decreases (an outflow was finalised)
    pub epoch: [u64; 2],
    /// lending withdrawals requested but not yet received; filled FIFO by incoming deposits
    pub pending_returns: Vec<PendingReturn>,
}

/// Result of crediting incoming tokens.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Credit {
    pub returns: Vec<(u32, u128)>,
    pub allocations: Vec<(u32, u128)>,
    pub split_amount: u128,
}

pub fn is_locked(p: &Pot, now: u64) -> bool {
    p.unlock_at.map(|u| now < u.0).unwrap_or(false)
}

fn push_alloc(v: &mut Vec<(u32, u128)>, pot: u32, amt: u128) {
    if amt == 0 {
        return;
    }
    if let Some(e) = v.iter_mut().find(|e| e.0 == pot) {
        e.1 += amt;
    } else {
        v.push((pot, amt));
    }
}

/// Splits `amount`: percent rules take `floor(amount * bps / 10000)` of the full amount (in rule
/// order), then fixed rules take their value capped by what is left, and the remainder goes to
/// flex (pot 0). Σ allocations == amount (invariant 2).
pub fn compute_split(rules: &[SplitRule], amount: u128) -> Vec<(u32, u128)> {
    let mut out = Vec::new();
    let mut left = amount;
    for r in rules.iter().filter(|r| r.mode == SplitMode::Percent) {
        let a = apply_bps(amount, r.value.0.min(10_000)).min(left);
        left -= a;
        push_alloc(&mut out, r.pot_id, a);
    }
    for r in rules.iter().filter(|r| r.mode == SplitMode::Fixed) {
        let a = r.value.0.min(left);
        left -= a;
        push_alloc(&mut out, r.pot_id, a);
    }
    push_alloc(&mut out, FLEX_ID, left);
    out
}

fn check_text(field: &str, s: &str, max: usize, allow_empty: bool) -> R<()> {
    if (!allow_empty && s.trim().is_empty()) || s.chars().count() > max {
        return Err(err("E_BAD_INPUT", format!("{} must be 1..={} characters", field, max)));
    }
    Ok(())
}

impl Ledger {
    pub fn new(now: u64) -> Self {
        Ledger {
            pots: vec![Pot {
                id: FLEX_ID,
                name: "Spend".into(),
                icon: "wallet".into(),
                color: "#3D5AFE".into(),
                kind: PotKind::Flex,
                balances: Balances::default(),
                earn_supplied: Balances::default(),
                unlock_at: None,
                target: None,
                target_date: None,
                earn: false,
                created_at: U64(now),
            }],
            next_pot_id: 1,
            splits: vec![],
            accounted: Balances::default(),
            in_flight: Balances::default(),
            epoch: [0, 0],
            pending_returns: vec![],
        }
    }

    pub fn idx(&self, id: u32) -> R<usize> {
        self.pots
            .iter()
            .position(|p| p.id == id)
            .ok_or_else(|| err("E_NO_POT", format!("pot {} does not exist", id)))
    }
    pub fn pot(&self, id: u32) -> R<&Pot> {
        Ok(&self.pots[self.idx(id)?])
    }
    pub fn pot_mut(&mut self, id: u32) -> R<&mut Pot> {
        let i = self.idx(id)?;
        Ok(&mut self.pots[i])
    }
    fn assert_unlocked(&self, id: u32, now: u64) -> R<()> {
        let p = self.pot(id)?;
        if is_locked(p, now) {
            return Err(err(
                "E_LOCKED",
                format!("pot is locked until {}", p.unlock_at.unwrap().0),
            ));
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_pot(
        &mut self,
        name: String,
        icon: String,
        color: String,
        kind: PotKind,
        target: Option<U128>,
        target_date: Option<U64>,
        now: u64,
    ) -> R<u32> {
        if kind == PotKind::Flex {
            return Err(err("E_FLEX", "there is exactly one Spend (flex) pot"));
        }
        if self.pots.len() >= MAX_POTS {
            return Err(err("E_TOO_MANY", format!("at most {} pots", MAX_POTS)));
        }
        check_text("name", &name, 40, false)?;
        check_text("icon", &icon, 40, true)?;
        check_text("color", &color, 16, true)?;
        let id = self.next_pot_id;
        self.next_pot_id += 1;
        self.pots.push(Pot {
            id,
            name,
            icon,
            color,
            kind,
            balances: Balances::default(),
            earn_supplied: Balances::default(),
            unlock_at: None,
            target,
            target_date,
            earn: false,
            created_at: U64(now),
        });
        Ok(id)
    }

    pub fn update_pot(
        &mut self,
        id: u32,
        name: Option<String>,
        icon: Option<String>,
        color: Option<String>,
        target: Option<U128>,
        target_date: Option<U64>,
    ) -> R<()> {
        if let Some(n) = &name {
            check_text("name", n, 40, false)?;
        }
        if let Some(n) = &icon {
            check_text("icon", n, 40, true)?;
        }
        if let Some(n) = &color {
            check_text("color", n, 16, true)?;
        }
        let p = self.pot_mut(id)?;
        if let Some(n) = name {
            p.name = n;
        }
        if let Some(n) = icon {
            p.icon = n;
        }
        if let Some(n) = color {
            p.color = n;
        }
        if target.is_some() {
            p.target = target;
        }
        if target_date.is_some() {
            p.target_date = target_date;
        }
        Ok(())
    }

    pub fn delete_pot(&mut self, id: u32) -> R<Pot> {
        if id == FLEX_ID {
            return Err(err("E_FLEX", "the Spend pot cannot be deleted"));
        }
        let i = self.idx(id)?;
        let p = &self.pots[i];
        if !p.balances.is_zero() || !p.earn_supplied.is_zero() {
            return Err(err("E_POT_NOT_EMPTY", "move or withdraw all funds first"));
        }
        if self.pending_returns.iter().any(|r| r.pot_id == id) {
            return Err(err("E_POT_NOT_EMPTY", "a lending withdrawal for this pot is pending"));
        }
        self.splits.retain(|r| r.pot_id != id);
        Ok(self.pots.remove(i))
    }

    pub fn set_splits(&mut self, rules: Vec<SplitRule>) -> R<()> {
        if rules.len() > MAX_SPLITS {
            return Err(err("E_BAD_SPLITS", format!("at most {} rules", MAX_SPLITS)));
        }
        let mut pct: u128 = 0;
        for r in &rules {
            if r.pot_id == FLEX_ID {
                return Err(err("E_BAD_SPLITS", "Spend gets the remainder; it cannot be a target"));
            }
            self.idx(r.pot_id)
                .map_err(|_| err("E_BAD_SPLITS", format!("pot {} does not exist", r.pot_id)))?;
            if r.value.0 == 0 {
                return Err(err("E_BAD_SPLITS", "rule value must be > 0"));
            }
            if r.mode == SplitMode::Percent {
                pct += r.value.0;
                if pct > 10_000 {
                    return Err(err("E_BAD_SPLITS", "percent rules add up to more than 100%"));
                }
            }
        }
        self.splits = rules;
        Ok(())
    }

    /// Credits `amount` of incoming tokens: first to pending lending returns (FIFO), then splits.
    pub fn credit(&mut self, t: Token, amount: u128) -> R<Credit> {
        let mut c = Credit::default();
        if amount == 0 {
            return Ok(c);
        }
        self.accounted.add(t, amount)?;
        let mut left = amount;
        let mut i = 0;
        while i < self.pending_returns.len() && left > 0 {
            if self.pending_returns[i].token != t {
                i += 1;
                continue;
            }
            let pr = self.pending_returns[i].clone();
            let take = pr.amount.min(left);
            left -= take;
            // pot may have been deleted meanwhile (not possible while pending, but be safe)
            let target = if self.idx(pr.pot_id).is_ok() { pr.pot_id } else { FLEX_ID };
            self.pot_mut(target)?.balances.add(t, take)?;
            push_alloc(&mut c.returns, target, take);
            if take == pr.amount {
                self.pending_returns.remove(i);
            } else {
                self.pending_returns[i].amount -= take;
                i += 1;
            }
        }
        if left > 0 {
            let allocs = compute_split(&self.splits, left);
            for (pot, a) in &allocs {
                self.pot_mut(*pot)?.balances.add(t, *a)?;
            }
            c.allocations = allocs;
            c.split_amount = left;
        }
        Ok(c)
    }

    /// Result of an `ft_balance_of` read started at `start_epoch`. Returns the amount to credit.
    pub fn sync_delta(&self, t: Token, real: u128, start_epoch: u64) -> u128 {
        if self.epoch[t.idx()] != start_epoch {
            return 0;
        }
        real.saturating_sub(self.accounted.get(t))
    }

    pub fn move_funds(&mut self, from: u32, to: u32, t: Token, amount: u128, now: u64) -> R<()> {
        if amount == 0 {
            return Err(err("E_BAD_AMOUNT", "amount must be > 0"));
        }
        if from == to {
            return Err(err("E_BAD_INPUT", "from_pot and to_pot are the same"));
        }
        self.idx(to)?;
        self.assert_unlocked(from, now)?;
        self.pot_mut(from)?.balances.sub(t, amount)?;
        self.pot_mut(to)?.balances.add(t, amount)?;
        Ok(())
    }

    /// Debits a pot for an outflow and marks the amount in flight.
    pub fn begin_out(&mut self, pot: u32, t: Token, amount: u128, now: u64, respect_lock: bool) -> R<()> {
        if amount == 0 {
            return Err(err("E_BAD_AMOUNT", "amount must be > 0"));
        }
        if respect_lock {
            self.assert_unlocked(pot, now)?;
        }
        self.pot_mut(pot)?.balances.sub(t, amount)?;
        self.in_flight.add(t, amount)?;
        Ok(())
    }

    /// Finalises an outflow of `amount` of which `used` actually left; the rest returns to `pot`.
    pub fn settle_out(&mut self, pot: u32, t: Token, amount: u128, used: u128) -> R<()> {
        let used = used.min(amount);
        self.in_flight.sub(t, amount)?;
        self.accounted.sub(t, used)?;
        let refund = amount - used;
        if refund > 0 {
            let target = if self.idx(pot).is_ok() { pot } else { FLEX_ID };
            self.pot_mut(target)?.balances.add(t, refund)?;
        }
        if used > 0 {
            self.epoch[t.idx()] += 1;
        }
        Ok(())
    }

    pub fn settle_supply(&mut self, pot: u32, t: Token, amount: u128, used: u128) -> R<()> {
        self.settle_out(pot, t, amount, used)?;
        let used = used.min(amount);
        let target = if self.idx(pot).is_ok() { pot } else { FLEX_ID };
        let p = self.pot_mut(target)?;
        p.earn_supplied.add(t, used)?;
        if used > 0 {
            p.earn = true;
        }
        Ok(())
    }

    /// Value of a pot's lending position given the vault's real lending balance (token units).
    /// Interest is shared pro rata to principal.
    pub fn earn_value(&self, pot: u32, t: Token, real_lending: u128) -> R<u128> {
        let principal = self.pot(pot)?.earn_supplied.get(t);
        let total: u128 = self.pots.iter().map(|p| p.earn_supplied.get(t)).sum();
        if total == 0 || principal == 0 {
            return Ok(0);
        }
        if real_lending <= total {
            // never report more than principal if the pool lost value / rounding
            return Ok(mul_div(principal, real_lending, total));
        }
        Ok(mul_div(principal, real_lending, total))
    }

    /// Starts a lending withdrawal of `amount` tokens for `pot`. Reduces principal pro rata and
    /// records a pending return. Returns the principal reduction (needed to roll back).
    pub fn begin_earn_off(&mut self, pot: u32, t: Token, amount: u128, value: u128) -> R<u128> {
        if amount == 0 {
            return Err(err("E_BAD_AMOUNT", "amount must be > 0"));
        }
        if amount > value {
            return Err(err(
                "E_INSUFFICIENT",
                format!("pot has {} {} in Earn, asked for {}", value, t.as_str(), amount),
            ));
        }
        let p = self.pot_mut(pot)?;
        let principal = p.earn_supplied.get(t);
        let reduce = if amount == value { principal } else { mul_div_ceil(principal, amount, value).min(principal) };
        p.earn_supplied.sub(t, reduce)?;
        if p.earn_supplied.is_zero() {
            p.earn = false;
        }
        self.pending_returns.push(PendingReturn { pot_id: pot, token: t, amount });
        Ok(reduce)
    }

    /// Rolls back `begin_earn_off` when the lending call failed.
    pub fn abort_earn_off(&mut self, pot: u32, t: Token, amount: u128, reduce: u128) -> R<()> {
        if let Some(i) = self
            .pending_returns
            .iter()
            .rposition(|r| r.pot_id == pot && r.token == t && r.amount == amount)
        {
            self.pending_returns.remove(i);
        }
        let target = if self.idx(pot).is_ok() { pot } else { FLEX_ID };
        let p = self.pot_mut(target)?;
        p.earn_supplied.add(t, reduce)?;
        p.earn = true;
        Ok(())
    }

    pub fn lock(&mut self, pot: u32, unlock_at: u64, now: u64) -> R<()> {
        if pot == FLEX_ID {
            return Err(err("E_FLEX", "the Spend pot cannot be locked"));
        }
        if unlock_at <= now {
            return Err(err("E_BAD_TIME", "unlock_at must be in the future"));
        }
        let p = self.pot_mut(pot)?;
        if let Some(cur) = p.unlock_at {
            if unlock_at < cur.0 {
                return Err(err("E_LOCK_SHORTEN", format!("pot is locked until {}; locks cannot be shortened", cur.0)));
            }
        }
        p.unlock_at = Some(U64(unlock_at));
        Ok(())
    }

    pub fn extend_lock(&mut self, pot: u32, new_unlock_at: u64, now: u64) -> R<()> {
        let cur = self.pot(pot)?.unlock_at;
        match cur {
            None => Err(err("E_NOT_LOCKED", "pot has no lock to extend; use lock")),
            Some(c) if new_unlock_at < c.0 => Err(err(
                "E_LOCK_SHORTEN",
                format!("pot is locked until {}; locks cannot be shortened", c.0),
            )),
            Some(_) => {
                let _ = now;
                self.pot_mut(pot)?.unlock_at = Some(U64(new_unlock_at));
                Ok(())
            }
        }
    }

    pub fn sum_balances(&self, t: Token) -> u128 {
        self.pots.iter().map(|p| p.balances.get(t)).sum()
    }

    /// Invariant 1 check (used by tests and debug assertions).
    pub fn check_invariant(&self) -> bool {
        Token::ALL.iter().all(|&t| {
            self.accounted.get(t) == self.sum_balances(t) + self.in_flight.get(t)
        })
    }
}

pub fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    // a*b/c without overflow for the ranges we deal with (falls back to slower path)
    match a.checked_mul(b) {
        Some(x) => x / c,
        None => (a / c) * b + (a % c) * b / c,
    }
}

pub fn mul_div_ceil(a: u128, b: u128, c: u128) -> u128 {
    match a.checked_mul(b) {
        Some(x) => x.div_ceil(c),
        None => mul_div(a, b, c) + 1,
    }
}

// ---------------------------------------------------------------------------------------------
// Agent policy
// ---------------------------------------------------------------------------------------------

pub const MAX_AGENT_TTL_NS: u64 = 90 * NS_PER_DAY;

pub fn validate_policy(p: &AgentPolicyInput, now: u64) -> R<()> {
    check_text("label", &p.label, 64, true)?;
    check_text("agent_name", &p.agent_name, 64, false)?;
    check_text("agent_url", &p.agent_url, 200, true)?;
    if p.scopes.is_empty() {
        return Err(err("E_BAD_POLICY", "at least one scope is required"));
    }
    if p.allowlist.len() > 50 {
        return Err(err("E_BAD_POLICY", "allowlist has more than 50 entries"));
    }
    if p.expires_at.0 <= now || p.expires_at.0 > now + MAX_AGENT_TTL_NS {
        return Err(err("E_BAD_POLICY", "expires_at must be in the future and within 90 days"));
    }
    if p.scopes.contains(&Scope::Act) {
        if p.allowed_actions.is_empty() {
            return Err(err("E_BAD_POLICY", "act scope needs at least one allowed action"));
        }
        if !(p.per_tx.0 <= p.daily.0 && p.daily.0 <= p.weekly.0) {
            return Err(err("E_BAD_POLICY", "caps must satisfy per_tx <= daily <= weekly"));
        }
        if p.per_tx.0 == 0 {
            return Err(err("E_BAD_POLICY", "per_tx must be > 0"));
        }
    }
    for r in &p.allowlist {
        if let Recipient::Intents { chain, address, .. } = r {
            check_text("chain", chain, 32, false)?;
            check_text("address", address, 128, false)?;
        }
    }
    Ok(())
}

pub fn policy_from_input(p: AgentPolicyInput, now: u64) -> AgentPolicy {
    AgentPolicy {
        label: p.label,
        agent_name: p.agent_name,
        agent_url: p.agent_url,
        scopes: p.scopes,
        allowed_actions: p.allowed_actions,
        allowlist: p.allowlist,
        per_tx: p.per_tx,
        daily: p.daily,
        weekly: p.weekly,
        expires_at: p.expires_at,
        spent_day: (now / NS_PER_DAY, U128(0)),
        spent_week: (now / NS_PER_WEEK, U128(0)),
        revoked: false,
        created_at: U64(now),
    }
}

/// Common checks for any agent call: revoked, expired, scope.
pub fn check_agent_live(p: &AgentPolicy, scope: Scope, now: u64) -> R<()> {
    if p.revoked {
        return Err(err("E_AGENT_REVOKED", "this agent was revoked"));
    }
    if now >= p.expires_at.0 {
        return Err(err("E_AGENT_EXPIRED", format!("this agent expired at {}", p.expires_at.0)));
    }
    if !p.scopes.contains(&scope) {
        let s = match scope {
            Scope::Act => "act",
            Scope::Propose => "propose",
            Scope::Read => "read",
        };
        return Err(err("E_SCOPE", format!("agent lacks the {} scope", s)));
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq)]
pub struct AgentSpend {
    pub remaining_day: u128,
    pub remaining_week: u128,
    /// (window, used, cap) for windows that crossed 80% with this action
    pub warnings: Vec<(&'static str, u128, u128)>,
}

fn crossed_80(before: u128, after: u128, cap: u128) -> bool {
    // after*10 >= cap*8 and before*10 < cap*8 (overflow-safe enough for 6-decimal stablecoins)
    let th = |x: u128| x.saturating_mul(10) >= cap.saturating_mul(8);
    cap > 0 && th(after) && !th(before)
}

/// Full `agent_execute` policy check; on success records the spend in the windows.
pub fn agent_check_and_record(
    p: &mut AgentPolicy,
    kind: AgentKind,
    amount: u128,
    recipient: Option<&AccountId>,
    now: u64,
) -> R<AgentSpend> {
    check_agent_live(p, Scope::Act, now)?;
    if !p.allowed_actions.contains(&kind) {
        return Err(err("E_ACTION_NOT_ALLOWED", "this agent may not perform that kind of action"));
    }
    if let Some(to) = recipient {
        let ok = p
            .allowlist
            .iter()
            .any(|r| matches!(r, Recipient::Near { account_id } if account_id == to));
        if !ok {
            return Err(err("E_NOT_ALLOWLISTED", format!("{} is not on this agent's allowlist", to)));
        }
    }
    if amount == 0 {
        return Err(err("E_BAD_AMOUNT", "amount must be > 0"));
    }
    if amount > p.per_tx.0 {
        return Err(err("E_CAP_PER_TX", format!("{} is above the per-transaction cap {}", amount, p.per_tx.0)));
    }
    let day = now / NS_PER_DAY;
    let week = now / NS_PER_WEEK;
    let used_day = if p.spent_day.0 == day { p.spent_day.1 .0 } else { 0 };
    let used_week = if p.spent_week.0 == week { p.spent_week.1 .0 } else { 0 };
    let new_day = used_day.saturating_add(amount);
    let new_week = used_week.saturating_add(amount);
    if new_day > p.daily.0 {
        return Err(err("E_CAP_DAY", format!("daily cap {} would be exceeded ({} used)", p.daily.0, used_day)));
    }
    if new_week > p.weekly.0 {
        return Err(err("E_CAP_WEEK", format!("weekly cap {} would be exceeded ({} used)", p.weekly.0, used_week)));
    }
    let mut warnings = vec![];
    if crossed_80(used_day, new_day, p.daily.0) {
        warnings.push(("day", new_day, p.daily.0));
    }
    if crossed_80(used_week, new_week, p.weekly.0) {
        warnings.push(("week", new_week, p.weekly.0));
    }
    p.spent_day = (day, U128(new_day));
    p.spent_week = (week, U128(new_week));
    Ok(AgentSpend {
        remaining_day: p.daily.0 - new_day,
        remaining_week: p.weekly.0 - new_week,
        warnings,
    })
}

/// Rolls back a recorded agent spend when the transfer failed.
pub fn agent_unrecord(p: &mut AgentPolicy, amount: u128, at: u64) {
    if p.spent_day.0 == at / NS_PER_DAY {
        p.spent_day.1 = U128(p.spent_day.1 .0.saturating_sub(amount));
    }
    if p.spent_week.0 == at / NS_PER_WEEK {
        p.spent_week.1 = U128(p.spent_week.1 .0.saturating_sub(amount));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    const T0: u64 = 1_793_361_600_000_000_000;

    fn acct(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn ledger_with_pots() -> Ledger {
        let mut l = Ledger::new(T0);
        for (n, k) in [("Bills", PotKind::Bills), ("Savings", PotKind::Autosave), ("Rainy", PotKind::Locked), ("Laptop", PotKind::Goal)] {
            l.create_pot(n.into(), "".into(), "".into(), k, None, None, T0).unwrap();
        }
        l
    }

    #[test]
    fn plan_preview_example() {
        let mut l = ledger_with_pots();
        l.set_splits(vec![
            SplitRule { pot_id: 1, mode: SplitMode::Percent, value: U128(3000) },
            SplitRule { pot_id: 2, mode: SplitMode::Percent, value: U128(2000) },
            SplitRule { pot_id: 4, mode: SplitMode::Fixed, value: U128(10_000_000) },
        ])
        .unwrap();
        let c = l.credit(Token::Usdt, 100_000_000).unwrap();
        assert_eq!(c.allocations, vec![(1, 30_000_000), (2, 20_000_000), (4, 10_000_000), (0, 40_000_000)]);
        assert!(l.check_invariant());
    }

    #[test]
    fn splits_validation() {
        let mut l = ledger_with_pots();
        let e = l.set_splits(vec![SplitRule { pot_id: 0, mode: SplitMode::Percent, value: U128(1) }]).unwrap_err();
        assert!(e.starts_with("E_BAD_SPLITS"));
        let e = l
            .set_splits(vec![
                SplitRule { pot_id: 1, mode: SplitMode::Percent, value: U128(6000) },
                SplitRule { pot_id: 2, mode: SplitMode::Percent, value: U128(5000) },
            ])
            .unwrap_err();
        assert!(e.starts_with("E_BAD_SPLITS"));
        assert!(l.set_splits(vec![SplitRule { pot_id: 99, mode: SplitMode::Fixed, value: U128(1) }]).unwrap_err().starts_with("E_BAD_SPLITS"));
    }

    #[test]
    fn lock_rules() {
        let mut l = ledger_with_pots();
        l.credit(Token::Usdc, 10).unwrap();
        l.move_funds(0, 3, Token::Usdc, 5, T0).unwrap();
        l.lock(3, T0 + 60_000_000_000, T0).unwrap();
        assert!(l.move_funds(3, 0, Token::Usdc, 1, T0).unwrap_err().starts_with("E_LOCKED"));
        assert!(l.begin_out(3, Token::Usdc, 1, T0, true).unwrap_err().starts_with("E_LOCKED"));
        assert!(l.lock(3, T0 + 1, T0).unwrap_err().starts_with("E_LOCK_SHORTEN"));
        assert!(l.extend_lock(3, T0 + 1, T0).unwrap_err().starts_with("E_LOCK_SHORTEN"));
        assert!(l.lock(0, T0 + 1, T0).unwrap_err().starts_with("E_FLEX"));
        l.extend_lock(3, T0 + 120_000_000_000, T0).unwrap();
        let later = T0 + 120_000_000_000;
        l.move_funds(3, 0, Token::Usdc, 5, later).unwrap();
    }

    #[test]
    fn outflow_success_and_failure() {
        let mut l = ledger_with_pots();
        l.credit(Token::Usdc, 100).unwrap();
        l.begin_out(0, Token::Usdc, 40, T0, true).unwrap();
        assert!(l.check_invariant());
        l.settle_out(0, Token::Usdc, 40, 0).unwrap(); // failed
        assert_eq!(l.pot(0).unwrap().balances.get(Token::Usdc), 100);
        assert_eq!(l.epoch[0], 0);
        l.begin_out(0, Token::Usdc, 40, T0, true).unwrap();
        l.settle_out(0, Token::Usdc, 40, 40).unwrap();
        assert_eq!(l.accounted.get(Token::Usdc), 60);
        assert_eq!(l.epoch[0], 1);
        assert!(l.check_invariant());
    }

    #[test]
    fn stale_sync_never_overcredits() {
        let mut l = ledger_with_pots();
        l.credit(Token::Usdc, 100).unwrap();
        let start = l.epoch[0];
        // balance read = 100 while a withdraw of 40 completes before the callback
        l.begin_out(0, Token::Usdc, 40, T0, true).unwrap();
        l.settle_out(0, Token::Usdc, 40, 40).unwrap();
        assert_eq!(l.sync_delta(Token::Usdc, 100, start), 0);
        assert_eq!(l.sync_delta(Token::Usdc, 60, l.epoch[0]), 0);
        assert_eq!(l.sync_delta(Token::Usdc, 70, l.epoch[0]), 10);
    }

    #[test]
    fn earn_roundtrip_with_interest() {
        let mut l = ledger_with_pots();
        l.credit(Token::Usdc, 100).unwrap();
        l.move_funds(0, 2, Token::Usdc, 100, T0).unwrap();
        l.begin_out(2, Token::Usdc, 100, T0, false).unwrap();
        l.settle_supply(2, Token::Usdc, 100, 100).unwrap();
        assert_eq!(l.pot(2).unwrap().earn_supplied.get(Token::Usdc), 100);
        assert_eq!(l.accounted.get(Token::Usdc), 0);
        // lending balance grew to 110
        let v = l.earn_value(2, Token::Usdc, 110).unwrap();
        assert_eq!(v, 110);
        let red = l.begin_earn_off(2, Token::Usdc, 55, v).unwrap();
        assert_eq!(red, 50);
        let c = l.credit(Token::Usdc, 55).unwrap();
        assert_eq!(c.returns, vec![(2, 55)]);
        assert!(c.allocations.is_empty());
        assert!(l.check_invariant());
        assert!(l.begin_earn_off(2, Token::Usdc, 56, l.earn_value(2, Token::Usdc, 55).unwrap()).unwrap_err().starts_with("E_INSUFFICIENT"));
    }

    fn policy(per_tx: u128, daily: u128, weekly: u128) -> AgentPolicy {
        policy_from_input(
            AgentPolicyInput {
                label: "x".into(),
                agent_name: "bot".into(),
                agent_url: "".into(),
                scopes: vec![Scope::Act, Scope::Propose],
                allowed_actions: vec![AgentKind::Pay],
                allowlist: vec![Recipient::Near { account_id: acct("shop.near") }],
                per_tx: U128(per_tx),
                daily: U128(daily),
                weekly: U128(weekly),
                expires_at: U64(T0 + NS_PER_DAY * 30),
            },
            T0,
        )
    }

    #[test]
    fn agent_checks() {
        let mut p = policy(5, 5, 10);
        let shop = acct("shop.near");
        let s = agent_check_and_record(&mut p, AgentKind::Pay, 4, Some(&shop), T0).unwrap();
        assert_eq!(s.remaining_day, 1);
        assert_eq!(s.warnings.len(), 1); // day crossed 80%
        assert!(agent_check_and_record(&mut p, AgentKind::Pay, 6, Some(&shop), T0).unwrap_err().starts_with("E_CAP_PER_TX"));
        assert!(agent_check_and_record(&mut p, AgentKind::Pay, 2, Some(&shop), T0).unwrap_err().starts_with("E_CAP_DAY"));
        assert!(agent_check_and_record(&mut p, AgentKind::Pay, 1, Some(&acct("evil.near")), T0).unwrap_err().starts_with("E_NOT_ALLOWLISTED"));
        assert!(agent_check_and_record(&mut p, AgentKind::Save, 1, None, T0).unwrap_err().starts_with("E_ACTION_NOT_ALLOWED"));
        // next day: day window resets, week still counts
        let t1 = T0 + NS_PER_DAY;
        let wk_same = t1 / NS_PER_WEEK == T0 / NS_PER_WEEK;
        let r = agent_check_and_record(&mut p, AgentKind::Pay, 5, Some(&shop), t1);
        if wk_same {
            assert!(r.is_ok());
            assert!(agent_check_and_record(&mut p, AgentKind::Pay, 2, Some(&shop), t1 + NS_PER_DAY).unwrap_err().starts_with("E_CAP_WEEK"));
        }
        assert!(agent_check_and_record(&mut p, AgentKind::Pay, 1, Some(&shop), T0 + NS_PER_DAY * 31).unwrap_err().starts_with("E_AGENT_EXPIRED"));
        p.revoked = true;
        assert!(agent_check_and_record(&mut p, AgentKind::Pay, 1, Some(&shop), T0).unwrap_err().starts_with("E_AGENT_REVOKED"));
    }

    #[test]
    fn policy_validation() {
        let mut i = AgentPolicyInput {
            label: "".into(),
            agent_name: "bot".into(),
            agent_url: "".into(),
            scopes: vec![Scope::Act],
            allowed_actions: vec![AgentKind::Pay],
            allowlist: vec![],
            per_tx: U128(10),
            daily: U128(5),
            weekly: U128(50),
            expires_at: U64(T0 + NS_PER_DAY),
        };
        assert!(validate_policy(&i, T0).unwrap_err().starts_with("E_BAD_POLICY"));
        i.per_tx = U128(5);
        assert!(validate_policy(&i, T0).is_ok());
        i.expires_at = U64(T0 + 91 * NS_PER_DAY);
        assert!(validate_policy(&i, T0).unwrap_err().starts_with("E_BAD_POLICY"));
    }

    // -----------------------------------------------------------------------------------------
    // Property tests for the vault invariants:
    // 1. accounted[t] == Σ pots.balances[t] + in_flight[t] after every operation
    // 2. splits conserve value: Σ allocations == deposit, flex gets the remainder
    // 3. a locked pot's balance never decreases before unlock_at
    // 4. unlock_at never decreases
    // 5. agent spend never exceeds per_tx / daily / weekly caps
    // 6. sync is idempotent and never over-credits (credit only real - accounted, once)
    // -----------------------------------------------------------------------------------------

    #[derive(Debug, Clone)]
    enum Op {
        Deposit(bool, u64),
        Move(u32, u32, bool, u64),
        Out(u32, bool, u64, bool),
        Lock(u32, u64),
        Supply(u32, bool, u64, bool),
        Tick(u64),
    }

    fn tok(b: bool) -> Token {
        if b { Token::Usdc } else { Token::Usdt }
    }

    fn op() -> impl Strategy<Value = Op> {
        prop_oneof![
            (any::<bool>(), 0u64..1_000_000).prop_map(|(t, a)| Op::Deposit(t, a)),
            (0u32..5, 0u32..5, any::<bool>(), 0u64..500_000).prop_map(|(f, to, t, a)| Op::Move(f, to, t, a)),
            (0u32..5, any::<bool>(), 0u64..500_000, any::<bool>()).prop_map(|(p, t, a, ok)| Op::Out(p, t, a, ok)),
            (1u32..5, 0u64..1_000).prop_map(|(p, d)| Op::Lock(p, d)),
            (1u32..5, any::<bool>(), 0u64..500_000, any::<bool>()).prop_map(|(p, t, a, ok)| Op::Supply(p, t, a, ok)),
            (0u64..600).prop_map(Op::Tick),
        ]
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(256))]

        #[test]
        fn ledger_invariants(
            pcts in proptest::collection::vec(0u128..4000, 2),
            fixed in 0u128..300_000,
            ops in proptest::collection::vec(op(), 1..60),
        ) {
            let mut l = ledger_with_pots();
            let mut rules = vec![];
            if pcts[0] > 0 { rules.push(SplitRule { pot_id: 1, mode: SplitMode::Percent, value: U128(pcts[0]) }); }
            if pcts[1] > 0 { rules.push(SplitRule { pot_id: 3, mode: SplitMode::Percent, value: U128(pcts[1]) }); }
            if fixed > 0 { rules.push(SplitRule { pot_id: 4, mode: SplitMode::Fixed, value: U128(fixed) }); }
            l.set_splits(rules).unwrap();
            let mut now = T0;
            for o in ops {
                let before = l.clone();
                match o {
                    Op::Deposit(t, a) => {
                        let c = l.credit(tok(t), a as u128).unwrap();
                        let s: u128 = c.allocations.iter().map(|x| x.1).sum::<u128>() + c.returns.iter().map(|x| x.1).sum::<u128>();
                        prop_assert_eq!(s, a as u128); // invariant 2
                        // invariant 6: a sync right after crediting the real balance is a no-op
                        let real = l.accounted.get(tok(t));
                        prop_assert_eq!(l.sync_delta(tok(t), real, l.epoch[tok(t).idx()]), 0);
                    }
                    Op::Move(f, to, t, a) => { let _ = l.move_funds(f, to, tok(t), a as u128, now); }
                    Op::Out(p, t, a, ok) => {
                        if l.begin_out(p, tok(t), a as u128, now, true).is_ok() {
                            prop_assert!(l.check_invariant());
                            l.settle_out(p, tok(t), a as u128, if ok { a as u128 } else { 0 }).unwrap();
                        }
                    }
                    Op::Lock(p, d) => { let _ = l.lock(p, now + d * 1_000_000_000 + 1, now); }
                    Op::Supply(p, t, a, ok) => {
                        if l.begin_out(p, tok(t), a as u128, now, false).is_ok() {
                            l.settle_supply(p, tok(t), a as u128, if ok { a as u128 } else { 0 }).unwrap();
                        }
                    }
                    Op::Tick(s) => now += s * 1_000_000_000,
                }
                prop_assert!(l.check_invariant()); // invariant 1
                for p in &before.pots {
                    if let Ok(np) = l.pot(p.id) {
                        // invariant 4
                        if let Some(u) = p.unlock_at { prop_assert!(np.unlock_at.unwrap().0 >= u.0); }
                        // invariant 3 (Supply moves locked funds to earn_supplied of the same pot,
                        // so compare balances + earn_supplied)
                        if is_locked(p, now) {
                            for t in Token::ALL {
                                prop_assert!(np.balances.get(t) + np.earn_supplied.get(t) >= p.balances.get(t) + p.earn_supplied.get(t));
                            }
                        }
                    }
                }
            }
        }

        #[test]
        fn agent_caps_hold(
            per_tx in 1u128..100, daily_extra in 0u128..200, weekly_extra in 0u128..400,
            spends in proptest::collection::vec((1u128..150, 0u64..(3 * NS_PER_DAY / 1_000_000_000)), 1..80),
        ) {
            let daily = per_tx + daily_extra;
            let weekly = daily + weekly_extra;
            let mut p = policy(per_tx, daily, weekly);
            p.expires_at = U64(T0 + 80 * NS_PER_DAY);
            let shop = acct("shop.near");
            let mut now = T0;
            let mut by_day = std::collections::HashMap::<u64, u128>::new();
            let mut by_week = std::collections::HashMap::<u64, u128>::new();
            for (amt, dt) in spends {
                now += dt * 1_000_000_000;
                if agent_check_and_record(&mut p, AgentKind::Pay, amt, Some(&shop), now).is_ok() {
                    prop_assert!(amt <= per_tx);
                    *by_day.entry(now / NS_PER_DAY).or_default() += amt;
                    *by_week.entry(now / NS_PER_WEEK).or_default() += amt;
                }
            }
            for v in by_day.values() { prop_assert!(*v <= daily); }
            for v in by_week.values() { prop_assert!(*v <= weekly); }
        }

        #[test]
        fn split_conserves(amount in 0u128..u64::MAX as u128, a in 0u128..5000, b in 0u128..5000, f in 0u128..1_000_000_000) {
            let rules = vec![
                SplitRule { pot_id: 1, mode: SplitMode::Percent, value: U128(a) },
                SplitRule { pot_id: 2, mode: SplitMode::Fixed, value: U128(f) },
                SplitRule { pot_id: 3, mode: SplitMode::Percent, value: U128(b) },
            ];
            let out = compute_split(&rules, amount);
            prop_assert_eq!(out.iter().map(|x| x.1).sum::<u128>(), amount);
        }
    }
}
