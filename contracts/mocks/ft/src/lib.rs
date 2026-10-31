//! Test-only NEP-141 / NEP-145 / NEP-148 token with 6 decimals and a minter-gated `mint`.
//! Deployed as `usdc.<root>` and `usdt.<root>` on sandbox and testnet. Never deployed to mainnet.

use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, PromiseOrValue};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockFt {
    token: FungibleToken,
    name: String,
    symbol: String,
    minter: AccountId,
}

#[near]
impl MockFt {
    #[init]
    pub fn new(name: String, symbol: String, minter: AccountId) -> Self {
        Self {
            token: FungibleToken::new(b"t".to_vec()),
            name,
            symbol,
            minter,
        }
    }

    /// Mints `amount` to `account_id`. Only the `minter` may call. Registers the receiver if
    /// needed (the token contract pays that storage from its own balance).
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        require!(
            env::predecessor_account_id() == self.minter,
            "E_NOT_MINTER: only the minter can mint"
        );
        if self.token.accounts.get(&account_id).is_none() {
            self.token.internal_register_account(&account_id);
        }
        self.token.internal_deposit(&account_id, amount.0);
        near_contract_standards::fungible_token::events::FtMint {
            owner_id: &account_id,
            amount,
            memo: None,
        }
        .emit();
    }

    pub fn minter(&self) -> AccountId {
        self.minter.clone()
    }
}

#[near]
impl FungibleTokenCore for MockFt {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for MockFt {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used, burned) =
            self.token
                .internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        if burned > 0 {
            near_contract_standards::fungible_token::events::FtBurn {
                owner_id: &sender_id,
                amount: U128(burned),
                memo: None,
            }
            .emit();
        }
        used.into()
    }
}

#[near]
impl StorageManagement for MockFt {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for MockFt {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: self.name.clone(),
            symbol: self.symbol.clone(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 6,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    #[test]
    fn mint_gated() {
        let mut ctx = VMContextBuilder::new();
        testing_env!(ctx.predecessor_account_id(accounts(0)).build());
        let mut c = MockFt::new("USD Coin".into(), "USDC".into(), accounts(0));
        c.mint(accounts(1), U128(5));
        assert_eq!(c.ft_balance_of(accounts(1)).0, 5);
        testing_env!(ctx.predecessor_account_id(accounts(1)).build());
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.mint(accounts(1), U128(5))));
        assert!(r.is_err());
    }
}
