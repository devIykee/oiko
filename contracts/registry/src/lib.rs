//! Oiko registry: deployed on `<root>`. Keyless after deployment, no upgrade method.
//! Creates `<name>.<root>` accounts for the relayer with the user's full-access key and the
//! app's function-call key, and funds them.

use near_sdk::json_types::{Base58CryptoHash, U128};
use near_sdk::store::{LookupMap, LookupSet, Vector};
use near_sdk::{
    env, near, AccountId, Allowance, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
    PublicKey,
};
use oiko_common::{emit, fail, J, APP_KEY_METHODS};

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

/// `^[a-z0-9_-]{2,32}$` and a valid NEAR account label (no leading/trailing/double `_`/`-`).
pub fn valid_name(name: &str) -> bool {
    (2..=32).contains(&name.len())
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
        && name.parse::<AccountId>().is_ok()
}

pub fn is_reserved(name: &str) -> bool {
    RESERVED.contains(&name)
}

#[near]
impl Registry {
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
            J::new()
                .s("name", &name)
                .s("account_id", account_id.as_str())
                .s("owner_public_key", &String::from(&owner_public_key)),
        );
        true
    }

    // ------------------------------------------------------------------------------- views
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
    // JSON-argument wrappers (args parsed with oiko_common::args; see vault for rationale)
    #[init]
    pub fn new() -> Self {
        let a = oiko_common::args::input();
        Self::new_t(a.opt("vault_code_hash").map(|x| x.str().parse::<Base58CryptoHash>().unwrap_or_else(|_| oiko_common::fail("E_BAD_ARGS", "invalid code hash"))), a.req("usdc").account(), a.req("usdt").account(), a.opt("lending").map(|x| x.account()), a.opt("ajo").map(|x| x.account()), a.opt("mpc_signer").map(|x| x.account()), a.req("relayer").account(), U128(a.req("account_funding").dec()))
    }

    #[payable]
    pub fn register_name(&mut self) -> Promise {
        let a = oiko_common::args::input();
        self.register_name_t(a.req("name").string(), a.req("owner_public_key").public_key(), a.req("app_public_key").public_key())
    }

    pub fn is_available(&self) -> bool {
        let a = oiko_common::args::input();
        self.is_available_t(a.req("name").string())
    }

    pub fn suggest(&self) -> Vec<String> {
        let a = oiko_common::args::input();
        self.suggest_t(a.req("name").string())
    }

    pub fn list_names(&self) -> Vec<NameEntry> {
        let a = oiko_common::args::input();
        self.list_names_t(a.req("from_index").u64(), a.req("limit").u32())
    }

    pub fn get_name(&self) -> Option<NameRecord> {
        let a = oiko_common::args::input();
        self.get_name_t(a.req("name").string())
    }

}

/// Typed implementations behind the JSON wrappers.
impl Registry {
    #[allow(clippy::too_many_arguments)]
    pub fn new_t(
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

    pub fn register_name_t(
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
        if !valid_name(&name) || !self.fits_root(&name) {
            fail("E_BAD_NAME", "names are 2-32 characters: a-z, 0-9, _ and - (not at the start or end, not doubled)");
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
                    J::new()
                        .s("name", &name)
                        .s("owner_public_key", &String::from(&owner_public_key))
                        .u("amount", self.account_funding.0)
                        .s("payer", env::predecessor_account_id().as_str())
                        .bytes(),
                    NearToken::from_yoctonear(0),
                    GAS_CB,
                ),
            )
    }

    pub fn is_available_t(&self, name: String) -> bool {
        valid_name(&name)
            && self.fits_root(&name)
            && !is_reserved(&name)
            && !self.names.contains_key(&name)
            && !self.pending.contains(&name)
    }

    /// Three available alternatives derived from `name`.
    pub fn suggest_t(&self, name: String) -> Vec<String> {
        let mut base: String = name
            .to_ascii_lowercase()
            .chars()
            .filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == '_' || *c == '-')
            .take(26)
            .collect();
        base = base.trim_matches(|c| c == '_' || c == '-').to_string();
        while base.contains("__") || base.contains("--") || base.contains("_-") || base.contains("-_") {
            base = base.replace("__", "_").replace("--", "-").replace("_-", "-").replace("-_", "_");
        }
        if base.len() < 2 {
            base = format!("{}me", base);
        }
        let mut out = vec![];
        let mut candidates: Vec<String> = vec![];
        for suffix in ["", "_pay", "_money", "hq"] {
            candidates.push(format!("{}{}", base, suffix));
        }
        for n in 1..=200u32 {
            candidates.push(format!("{}{}", base, n));
            candidates.push(format!("{}_{}", base, n));
        }
        for c in candidates {
            if c != name && self.is_available_t(c.clone()) && !out.contains(&c) {
                out.push(c);
                if out.len() == 3 {
                    break;
                }
            }
        }
        out
    }

    /// Paged enumeration in registration order (limit capped at 100).
    pub fn list_names_t(&self, from_index: u64, limit: u32) -> Vec<NameEntry> {
        (from_index..self.list.len() as u64)
            .take(limit.min(100) as usize)
            .filter_map(|i| {
                let name = self.list.get(i as u32)?.clone();
                let r = self.names.get(&name)?.clone();
                Some(NameEntry { name, account_id: r.account_id, vault_id: r.vault_id, created_at: r.created_at })
            })
            .collect()
    }

    pub fn get_name_t(&self, name: String) -> Option<NameRecord> {
        self.names.get(&name).cloned()
    }

}

impl Registry {
    /// `vault.<name>.<root>` must be a valid account id (length limit 64).
    fn fits_root(&self, name: &str) -> bool {
        format!("vault.{}.{}", name, env::current_account_id()).parse::<AccountId>().is_ok()
    }

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
        // R-1: labels that are not valid NEAR account ids
        for bad in ["a_", "-ab", "a__b", "ab-", "a-_b"] {
            assert!(!valid_name(bad), "{bad}");
        }
    }

    #[test]
    fn suggest_and_methods() {
        let mut c = VMContextBuilder::new();
        c.current_account_id(a("oiko.test.near"));
        testing_env!(c.build());
        let r = Registry::new_t(None, a("usdc.near"), a("usdt.near"), None, None, None, a("relayer.near"), U128(10u128.pow(24)));
        let s = r.suggest_t("ada".into());
        assert_eq!(s.len(), 3);
        assert!(s.iter().all(|n| valid_name(n) && n != "ada" && !n.contains("_ng")));
        let s = r.suggest_t("__a__".into());
        assert!(s.iter().all(|n| valid_name(n)), "{s:?}");
        let m = r.config().app_key_methods;
        assert!(!m.contains(&"withdraw_large".to_string()));
        assert!(!m.contains(&"rescue_sign".to_string()));
        assert!(m.join(",").len() < 2000);
    }
}
