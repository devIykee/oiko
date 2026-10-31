//! Test-only lending pool that mirrors the Rhea (Burrow) method names and JSON shapes Oiko uses:
//! - `storage_deposit(account_id?, registration_only?)` (min 0.1 NEAR, like Burrow)
//! - supply: `ft_transfer_call(lending, amount, msg: "")` -> `ft_on_transfer` deposits to `supplied`
//! - withdraw: `execute({actions:[{Withdraw:{token_id, max_amount}}]})` with exactly 1 yocto;
//!   tokens come back by plain `ft_transfer` followed by an `after_ft_transfer` callback
//! - views: `get_asset(token_id)` and `get_account(account_id)`
//!
//! Inner amounts use `token decimals + extra_decimals` like Burrow (extra_decimals is 12 on Rhea
//! for 6-decimal stablecoins). `set_state` lets the `admin` set pool totals and APR for tests.
//! No interest accrues. Never deployed to mainnet.

use near_contract_standards::storage_management::{StorageBalance, StorageBalanceBounds};
use near_sdk::json_types::{U128, U64};
use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, require, serde_json, AccountId, Gas, NearToken, PanicOnDefault, Promise,
    PromiseOrValue,
};
use std::collections::HashMap;

const MIN_STORAGE_BALANCE: u128 = 10_000 * 10_000_000_000_000_000_000; // 0.1 NEAR (Burrow value)

#[near(serializers = [json, borsh])]
#[derive(Clone, Default)]
pub struct Pool {
    pub shares: U128,
    pub balance: U128,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct MockAsset {
    pub supplied: u128,
    pub borrowed: u128,
    pub apy_bps: u32,
}

#[near(serializers = [json])]
pub struct AssetConfig {
    pub reserve_ratio: u32,
    pub target_utilization: u32,
    pub target_utilization_rate: U128,
    pub max_utilization_rate: U128,
    pub volatility_ratio: u32,
    pub extra_decimals: u8,
    pub can_deposit: bool,
    pub can_withdraw: bool,
    pub can_use_as_collateral: bool,
    pub can_borrow: bool,
    pub net_tvl_multiplier: u32,
}

#[near(serializers = [json])]
pub struct AssetDetailedView {
    pub token_id: AccountId,
    pub supplied: Pool,
    pub borrowed: Pool,
    pub reserved: U128,
    pub last_update_timestamp: U64,
    pub config: AssetConfig,
    pub supply_apr: String,
    pub borrow_apr: String,
    pub farms: Vec<serde_json::Value>,
}

#[near(serializers = [json])]
pub struct AssetView {
    pub token_id: AccountId,
    pub balance: U128,
    pub shares: U128,
    pub apr: String,
}

#[near(serializers = [json])]
pub struct AccountDetailedView {
    pub account_id: AccountId,
    pub supplied: Vec<AssetView>,
    pub collateral: Vec<AssetView>,
    pub borrowed: Vec<AssetView>,
    pub farms: Vec<serde_json::Value>,
    pub has_non_farmed_assets: bool,
    pub booster_staking: Option<serde_json::Value>,
}

#[near(serializers = [json])]
pub struct AssetAmount {
    pub token_id: AccountId,
    pub amount: Option<U128>,
    pub max_amount: Option<U128>,
}

/// Externally tagged like Burrow: `{"Withdraw": {...}}`. Only `Withdraw` is supported here.
#[near(serializers = [json])]
pub enum Action {
    Withdraw(AssetAmount),
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockLending {
    admin: AccountId,
    extra_decimals: u8,
    assets: HashMap<AccountId, MockAsset>,
    storage: LookupMap<AccountId, u128>,
    /// account -> token -> inner balance
    accounts: LookupMap<AccountId, HashMap<AccountId, u128>>,
}

fn bps_to_decimal(bps: u32) -> String {
    format!("{}.{:04}", bps / 10_000, bps % 10_000)
}

#[near]
impl MockLending {
    #[init]
    pub fn new(admin: AccountId, tokens: Vec<AccountId>, extra_decimals: Option<u8>) -> Self {
        let mut assets = HashMap::new();
        for t in tokens {
            assets.insert(t, MockAsset { supplied: 0, borrowed: 0, apy_bps: 0 });
        }
        Self {
            admin,
            extra_decimals: extra_decimals.unwrap_or(12),
            assets,
            storage: LookupMap::new(b"s"),
            accounts: LookupMap::new(b"a"),
        }
    }

    /// Admin only: overwrite pool totals (inner units) and the supply APR (bps) of a token.
    pub fn set_state(&mut self, token_id: AccountId, supplied: U128, borrowed: U128, apy_bps: u32) {
        require!(env::predecessor_account_id() == self.admin, "E_NOT_ADMIN: admin only");
        self.assets.insert(
            token_id,
            MockAsset { supplied: supplied.0, borrowed: borrowed.0, apy_bps },
        );
    }

    fn mult(&self) -> u128 {
        10u128.pow(self.extra_decimals as u32)
    }

    pub fn get_asset(&self, token_id: AccountId) -> Option<AssetDetailedView> {
        let a = self.assets.get(&token_id)?;
        Some(AssetDetailedView {
            token_id,
            supplied: Pool { shares: U128(a.supplied), balance: U128(a.supplied) },
            borrowed: Pool { shares: U128(a.borrowed), balance: U128(a.borrowed) },
            reserved: U128(0),
            last_update_timestamp: U64(env::block_timestamp()),
            config: AssetConfig {
                reserve_ratio: 2500,
                target_utilization: 8000,
                target_utilization_rate: U128(1_000_000_000_002_440_418_605_283_556),
                max_utilization_rate: U128(1_000_000_000_039_724_853_136_740_579),
                volatility_ratio: 9500,
                extra_decimals: self.extra_decimals,
                can_deposit: true,
                can_withdraw: true,
                can_use_as_collateral: true,
                can_borrow: true,
                net_tvl_multiplier: 10000,
            },
            supply_apr: bps_to_decimal(a.apy_bps),
            borrow_apr: bps_to_decimal(a.apy_bps.saturating_mul(3) / 2),
            farms: vec![],
        })
    }

    pub fn get_account(&self, account_id: AccountId) -> Option<AccountDetailedView> {
        self.storage.get(&account_id)?;
        let mut supplied: Vec<AssetView> = self
            .accounts
            .get(&account_id)
            .map(|m| {
                m.iter()
                    .filter(|(_, b)| **b > 0)
                    .map(|(t, b)| AssetView {
                        token_id: t.clone(),
                        balance: U128(*b),
                        shares: U128(*b),
                        apr: bps_to_decimal(self.assets.get(t).map(|a| a.apy_bps).unwrap_or(0)),
                    })
                    .collect()
            })
            .unwrap_or_default();
        supplied.sort_by(|a, b| a.token_id.cmp(&b.token_id));
        Some(AccountDetailedView {
            account_id,
            supplied,
            collateral: vec![],
            borrowed: vec![],
            farms: vec![],
            has_non_farmed_assets: false,
            booster_staking: None,
        })
    }

    #[payable]
    pub fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        let amount = env::attached_deposit().as_yoctonear();
        let account_id = account_id.unwrap_or_else(env::predecessor_account_id);
        if let Some(cur) = self.storage.get(&account_id).copied() {
            if registration_only.unwrap_or(false) && amount > 0 {
                Promise::new(env::predecessor_account_id())
                    .transfer(NearToken::from_yoctonear(amount))
                    .detach();
            } else {
                self.storage.insert(account_id.clone(), cur + amount);
            }
        } else {
            require!(
                amount >= MIN_STORAGE_BALANCE,
                "The attached deposit is less than the mimimum storage balance"
            );
            let keep = if registration_only.unwrap_or(false) {
                let refund = amount - MIN_STORAGE_BALANCE;
                if refund > 0 {
                    Promise::new(env::predecessor_account_id())
                        .transfer(NearToken::from_yoctonear(refund))
                        .detach();
                }
                MIN_STORAGE_BALANCE
            } else {
                amount
            };
            self.storage.insert(account_id.clone(), keep);
        }
        self.storage_balance_of(account_id).unwrap()
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.storage.get(&account_id).map(|b| StorageBalance {
            total: NearToken::from_yoctonear(*b),
            available: NearToken::from_yoctonear(0),
        })
    }

    pub fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        StorageBalanceBounds { min: NearToken::from_yoctonear(MIN_STORAGE_BALANCE), max: None }
    }

    /// Supply. `msg` must be empty (Burrow also accepts `{"Execute":{"actions":[]}}`).
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let token_id = env::predecessor_account_id();
        require!(self.assets.contains_key(&token_id), "Asset not found");
        require!(
            msg.is_empty() || msg.replace(' ', "") == "{\"Execute\":{\"actions\":[]}}",
            "Can't parse TokenReceiverMsg"
        );
        require!(self.storage.get(&sender_id).is_some(), "Account is not registered");
        let inner = amount.0 * self.mult();
        self.assets.get_mut(&token_id).unwrap().supplied += inner;
        let mut acc = self.accounts.get(&sender_id).cloned().unwrap_or_default();
        *acc.entry(token_id).or_insert(0) += inner;
        self.accounts.insert(sender_id, acc);
        PromiseOrValue::Value(U128(0))
    }

    #[payable]
    pub fn execute(&mut self, actions: Vec<Action>) {
        require!(
            env::attached_deposit() == NearToken::from_yoctonear(1),
            "Requires attached deposit of exactly 1 yoctoNEAR"
        );
        let account_id = env::predecessor_account_id();
        require!(self.storage.get(&account_id).is_some(), "Account is not registered");
        for action in actions {
            match action {
                Action::Withdraw(a) => {
                    let mut acc = self.accounts.get(&account_id).cloned().unwrap_or_default();
                    let bal = *acc.get(&a.token_id).unwrap_or(&0);
                    let want = a.amount.or(a.max_amount).map(|x| x.0).unwrap_or(bal).min(bal);
                    // Round down to whole token units, like Burrow's ft_amount conversion.
                    let ft_amount = want / self.mult();
                    let inner = ft_amount * self.mult();
                    require!(inner > 0, "Zero amount");
                    let asset = self.assets.get_mut(&a.token_id).expect("Asset not found");
                    require!(
                        asset.supplied.saturating_sub(asset.borrowed) >= inner,
                        "Not enough available liquidity"
                    );
                    asset.supplied -= inner;
                    acc.insert(a.token_id.clone(), bal - inner);
                    self.accounts.insert(account_id.clone(), acc);
                    Promise::new(a.token_id.clone())
                        .function_call(
                            "ft_transfer",
                            serde_json::to_vec(&serde_json::json!({
                                "receiver_id": account_id, "amount": U128(ft_amount)
                            }))
                            .unwrap(),
                            NearToken::from_yoctonear(1),
                            Gas::from_tgas(10),
                        )
                        .then(Promise::new(env::current_account_id()).function_call(
                            "after_ft_transfer",
                            serde_json::to_vec(&serde_json::json!({
                                "account_id": account_id, "token_id": a.token_id, "amount": U128(inner)
                            }))
                            .unwrap(),
                            NearToken::from_yoctonear(0),
                            Gas::from_tgas(10),
                        ))
                        .detach();
                }
            }
        }
    }

    #[private]
    pub fn after_ft_transfer(&mut self, account_id: AccountId, token_id: AccountId, amount: U128) -> bool {
        let ok = near_sdk::is_promise_success();
        if !ok {
            if let Some(a) = self.assets.get_mut(&token_id) {
                a.supplied += amount.0;
            }
            let mut acc = self.accounts.get(&account_id).cloned().unwrap_or_default();
            *acc.entry(token_id).or_insert(0) += amount.0;
            self.accounts.insert(account_id, acc);
        }
        ok
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apr_format() {
        assert_eq!(bps_to_decimal(500), "0.0500");
        assert_eq!(bps_to_decimal(13_840), "1.3840");
    }

    #[test]
    fn action_json_shape() {
        let a: Vec<Action> = serde_json::from_str(
            r#"[{"Withdraw":{"token_id":"usdc.test.near","max_amount":"5"}}]"#,
        )
        .unwrap();
        match &a[0] {
            Action::Withdraw(x) => assert_eq!(x.max_amount.unwrap().0, 5),
        }
    }
}
