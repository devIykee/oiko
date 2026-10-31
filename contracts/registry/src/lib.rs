//! Oiko registry: deployed on `<root>`. Keyless after deployment, no upgrade method.
//! Creates `<name>.<root>` accounts for the relayer with the user's full-access key and the
//! app's function-call key, and funds them.

use near_sdk::json_types::{Base58CryptoHash, U128};
use near_sdk::serde_json::json;
use near_sdk::store::{LookupMap, LookupSet, Vector};
use near_sdk::{
    env, near, AccountId, Allowance, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
    PublicKey,
};
use oiko_common::{emit, fail, APP_KEY_METHODS};

pub const APP_KEY_ALLOWANCE: NearToken = NearToken::from_millinear(250); // 0.25 NEAR
const GAS_CB: Gas = Gas::from_tgas(15);

pub const RESERVED: &[&str] = &[
    "vault", "ajo", "usdc", "usdt", "lending", "relayer", "faucet", "oiko", "admin", "root",
    "system", "near", "api", "app", "www", "web", "mail", "help", "support", "team", "security",
    "trust", "docs", "status", "code", "registry", "signer", "mpc", "intents", "treasury", "test",
    "demo", "official", "staff", "billing", "pay", "payments", "wallet", "account", "accounts",
];

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct NameRecord {
    pub account_id: AccountId,
    pub vault_id: AccountId,
    pub created_at: near_sdk::json_types::U64,
}

#[near(serializers = [json])]
pub struct NameEntry {
    pub name: String,
    pub account_id: AccountId,
    pub vault_id: AccountId,
    pub created_at: near_sdk::json_types::U64,
}

#[near(serializers = [json])]
pub struct RegistryConfig {
    pub root: AccountId,
    pub vault_code_hash: Option<String>,
    pub usdc: AccountId,
    pub usdt: AccountId,
    pub lending: Option<AccountId>,
    pub ajo: Option<AccountId>,
    pub mpc_signer: Option<AccountId>,
    pub relayer: AccountId,
    pub account_funding: U128,
    pub app_key_allowance: U128,
    pub app_key_methods: Vec<String>,
}

#[near(serializers = [json])]
pub struct Stats {
    pub names: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Registry {
    vault_code_hash: Option<Base58CryptoHash>,
    usdc: AccountId,
    usdt: AccountId,
    lending: Option<AccountId>,
    ajo: Option<AccountId>,
    mpc_signer: Option<AccountId>,
    relayer: AccountId,
    account_funding: U128,
    names: LookupMap<String, NameRecord>,
    pending: LookupSet<String>,
    count: u64,
    list: Vector<String>,
}

/// `^[a-z0-9_-]{2,32}$`
pub fn valid_name(name: &str) -> bool {
    (2..=32).contains(&name.len())
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
}

pub fn is_reserved(name: &str) -> bool {
    RESERVED.contains(&name)
}

#[near]
impl Registry {
    #[init]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        vault_code_hash: Option<Base58CryptoHash>,
        usdc: AccountId,
        usdt: AccountId,
        lending: Option<AccountId>,
        ajo: Option<AccountId>,
        mpc_signer: Option<AccountId>,
        relayer: AccountId,
        account_funding: U128,
    ) -> Self {
        if account_funding.0 < APP_KEY_ALLOWANCE.as_yoctonear() {
            fail("E_BAD_CONFIG", "account_funding must cover at least the app key allowance");
        }
        Self {
            vault_code_hash,
            usdc,
            usdt,
            lending,
            ajo,
            mpc_signer,
            relayer,
            account_funding,
            names: LookupMap::new(b"n"),
            pending: LookupSet::new(b"p"),
            count: 0,
            list: Vector::new(b"l"),
        }
    }

    #[payable]
    pub fn register_name(
        &mut self,
        name: String,
        owner_public_key: PublicKey,
        app_public_key: PublicKey,
    ) -> Promise {
        if env::predecessor_account_id() != self.relayer {
            fail("E_NOT_RELAYER", "only the relayer can register names");
        }
        let deposit = env::attached_deposit().as_yoctonear();
        if deposit < self.account_funding.0 {
            fail("E_DEPOSIT", format!("attach at least {} yoctoNEAR", self.account_funding.0));
        }
        if !valid_name(&name) {
            fail("E_BAD_NAME", "names are 2-32 characters: a-z, 0-9, _ and -");
        }
        if is_reserved(&name) {
            fail("E_RESERVED", "this name is reserved");
        }
        if self.names.contains_key(&name) || self.pending.contains(&name) {
            fail("E_TAKEN", "this name is taken");
        }
        if owner_public_key == app_public_key {
            fail("E_BAD_INPUT", "owner and app keys must differ");
        }
        self.pending.insert(name.clone());
        let account_id = self.account_for(&name);
        let vault_id: AccountId = format!("vault.{}", account_id).parse().unwrap();
        let excess = deposit - self.account_funding.0;
        if excess > 0 {
            Promise::new(env::predecessor_account_id())
                .transfer(NearToken::from_yoctonear(excess))
                .detach();
        }
        Promise::new(account_id)
            .create_account()
            .transfer(NearToken::from_yoctonear(self.account_funding.0))
            .add_full_access_key(owner_public_key.clone())
            .add_access_key_allowance(
                app_public_key,
                Allowance::limited(APP_KEY_ALLOWANCE).unwrap(),
                vault_id,
                APP_KEY_METHODS.join(","),
            )
            .then(
                Promise::new(env::current_account_id()).function_call(
                    "on_register",
                    near_sdk::serde_json::to_vec(&json!({
                        "name": name, "owner_public_key": owner_public_key,
                        "amount": self.account_funding, "payer": env::predecessor_account_id()
                    }))
                    .unwrap(),
                    NearToken::from_yoctonear(0),
                    GAS_CB,
                ),
            )
    }

    #[private]
    pub fn on_register(
        &mut self,
        name: String,
        owner_public_key: PublicKey,
        amount: U128,
        payer: AccountId,
        #[callback_result] r: Result<(), PromiseError>,
    ) -> bool {
        self.pending.remove(&name);
        if r.is_err() {
            // The failed create's own transfer is refunded to this account by the protocol;
            // pass the relayer's deposit back.
            Promise::new(payer).transfer(NearToken::from_yoctonear(amount.0)).detach();
            env::log_str("E_CREATE_FAILED: account creation failed; deposit refunded");
            return false;
        }
        let account_id = self.account_for(&name);
        let rec = NameRecord {
            vault_id: format!("vault.{}", account_id).parse().unwrap(),
            account_id: account_id.clone(),
            created_at: near_sdk::json_types::U64(env::block_timestamp()),
        };
        self.names.insert(name.clone(), rec);
        self.list.push(name.clone());
        self.count += 1;
        emit(
            "name_registered",
            json!({"name": name, "account_id": account_id, "owner_public_key": owner_public_key}),
        );
        true
    }

    // ------------------------------------------------------------------------------- views
    pub fn is_available(&self, name: String) -> bool {
        valid_name(&name)
            && !is_reserved(&name)
            && !self.names.contains_key(&name)
            && !self.pending.contains(&name)
    }

    /// Three available alternatives derived from `name`.
    pub fn suggest(&self, name: String) -> Vec<String> {
        let mut base: String = name
            .to_ascii_lowercase()
            .chars()
            .filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == '_' || *c == '-')
            .take(26)
            .collect();
        if base.len() < 2 {
            base = format!("{}me", base);
        }
        let mut out = vec![];
        let mut candidates: Vec<String> = vec![];
        for suffix in ["", "_ng", "hq", "_pay", "_money"] {
            candidates.push(format!("{}{}", base, suffix));
        }
        for n in 1..=200u32 {
            candidates.push(format!("{}{}", base, n));
            candidates.push(format!("{}_{}", base, n));
        }
        for c in candidates {
            if c != name && self.is_available(c.clone()) && !out.contains(&c) {
                out.push(c);
                if out.len() == 3 {
                    break;
                }
            }
        }
        out
    }

    /// Paged enumeration in registration order (limit capped at 100).
    pub fn list_names(&self, from_index: u64, limit: u32) -> Vec<NameEntry> {
        (from_index..self.list.len() as u64)
            .take(limit.min(100) as usize)
            .filter_map(|i| {
                let name = self.list.get(i as u32)?.clone();
                let r = self.names.get(&name)?.clone();
                Some(NameEntry { name, account_id: r.account_id, vault_id: r.vault_id, created_at: r.created_at })
            })
            .collect()
    }

    pub fn get_name(&self, name: String) -> Option<NameRecord> {
        self.names.get(&name).cloned()
    }

    pub fn vault_code_hash(&self) -> Option<String> {
        self.vault_code_hash.map(|h| String::from(&h))
    }

    pub fn trusted_code_hashes(&self) -> Vec<String> {
        self.vault_code_hash.iter().map(String::from).collect()
    }

    pub fn config(&self) -> RegistryConfig {
        RegistryConfig {
            root: env::current_account_id(),
            vault_code_hash: self.vault_code_hash(),
            usdc: self.usdc.clone(),
            usdt: self.usdt.clone(),
            lending: self.lending.clone(),
            ajo: self.ajo.clone(),
            mpc_signer: self.mpc_signer.clone(),
            relayer: self.relayer.clone(),
            account_funding: self.account_funding,
            app_key_allowance: U128(APP_KEY_ALLOWANCE.as_yoctonear()),
            app_key_methods: APP_KEY_METHODS.iter().map(|s| s.to_string()).collect(),
        }
    }

    pub fn stats(&self) -> Stats {
        Stats { names: self.count }
    }

    pub fn version(&self) -> String {
        "1.0.0".into()
    }
}

impl Registry {
    fn account_for(&self, name: &str) -> AccountId {
        format!("{}.{}", name, env::current_account_id()).parse().unwrap()
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

    #[test]
    fn names() {
        assert!(valid_name("ada"));
        assert!(valid_name("a_b-9"));
        assert!(!valid_name("a"));
        assert!(!valid_name("Ada"));
        assert!(!valid_name("ada.x"));
        assert!(!valid_name(&"a".repeat(33)));
        assert!(is_reserved("vault"));
    }

    #[test]
    fn suggest_and_methods() {
        let mut c = VMContextBuilder::new();
        c.current_account_id(a("oiko.test.near"));
        testing_env!(c.build());
        let r = Registry::new(None, a("usdc.near"), a("usdt.near"), None, None, None, a("relayer.near"), U128(10u128.pow(24)));
        let s = r.suggest("ada".into());
        assert_eq!(s.len(), 3);
        assert!(s.iter().all(|n| valid_name(n) && n != "ada"));
        let m = r.config().app_key_methods;
        assert!(!m.contains(&"withdraw_large".to_string()));
        assert!(!m.contains(&"rescue_sign".to_string()));
        assert!(m.join(",").len() < 2000);
    }
}
