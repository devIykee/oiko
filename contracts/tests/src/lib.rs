//! Shared sandbox helpers for the Oiko integration tests.

use anyhow::{anyhow, Result};
use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{AccessKeyPermission, KeyType, NearToken, SecretKey};
use near_workspaces::{Account, AccountId, Contract, Worker};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Once;

pub const USDT: u128 = 1_000_000; // 1 USDT in base units (6 decimals)
pub const TGAS: u64 = 1_000_000_000_000;
/// account_funding passed to the registry; see docs/DECISIONS.md "Contract deviations / funding".
pub const ACCOUNT_FUNDING: NearToken = NearToken::from_millinear(1_500);
/// NEAR the name account moves into its new vault account.
pub const VAULT_FUNDING: NearToken = NearToken::from_millinear(1_000);
/// Vault funding for the DeployContract fallback: the ~464 KB of code is stored on the vault
/// account itself (~4.65 NEAR of storage staking) on top of VAULT_FUNDING.
pub const VAULT_FUNDING_DEPLOY: NearToken = NearToken::from_millinear(6_000);

static BUILD: Once = Once::new();

pub fn contracts_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

/// Builds all wasm once per test process (skip with OIKO_SKIP_BUILD=1 if res/ is fresh).
pub fn ensure_built() {
    BUILD.call_once(|| {
        let res = contracts_dir().join("res");
        let have_all = [
            "oiko_vault", "oiko_registry", "oiko_ajo", "oiko_mock_ft", "oiko_mock_lending",
        ]
        .iter()
        .all(|n| res.join(format!("{n}.wasm")).exists());
        if std::env::var("OIKO_SKIP_BUILD").is_ok() && have_all {
            return;
        }
        let script = contracts_dir().join("../scripts/build-contracts.sh");
        let st = std::process::Command::new("bash")
            .arg(script)
            .status()
            .expect("run scripts/build-contracts.sh");
        assert!(st.success(), "contract build failed");
    });
}

pub fn wasm(name: &str) -> Vec<u8> {
    ensure_built();
    std::fs::read(contracts_dir().join("res").join(format!("{name}.wasm")))
        .unwrap_or_else(|e| panic!("read {name}.wasm: {e}"))
}

pub fn events(r: &ExecutionFinalResult, name: &str) -> Vec<Value> {
    r.logs()
        .iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|v| v["standard"] == "oiko" && v["event"] == name)
        .map(|v| v["data"][0].clone())
        .collect()
}

/// Asserts the outcome failed somewhere with `code` in the error message.
pub fn assert_fails_with(r: &ExecutionFinalResult, code: &str) {
    let msg = format!("{:?}", r.failures());
    assert!(
        !r.failures().is_empty() && msg.contains(code),
        "expected failure {code}, got: {msg}\nlogs: {:?}",
        r.logs()
    );
}

pub fn assert_ok(r: &ExecutionFinalResult) {
    assert!(r.failures().is_empty(), "unexpected failure: {:?}\nlogs: {:?}", r.failures(), r.logs());
}

pub struct Env {
    pub worker: Worker<Sandbox>,
    pub root: Account,     // oiko.test.near (registry)
    pub relayer: Account,  // relayer + faucet minter + lending admin
    pub usdc: Contract,
    pub usdt: Contract,
    pub lending: Contract,
    pub ajo: Contract,
    pub registry: Contract,
    pub vault_code_hash: String,
}

pub struct User {
    pub name: String,
    pub owner: Account, // full-access key on <name>.<root>
    pub app: Account,   // app function-call key on <name>.<root>
    pub vault_id: AccountId,
}

fn b58(bytes: &[u8]) -> String {
    const A: &[u8] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let mut digits: Vec<u8> = vec![0];
    for &b in bytes {
        let mut carry = b as u32;
        for d in digits.iter_mut() {
            carry += (*d as u32) << 8;
            *d = (carry % 58) as u8;
            carry /= 58;
        }
        while carry > 0 {
            digits.push((carry % 58) as u8);
            carry /= 58;
        }
    }
    let mut s: String = bytes.iter().take_while(|b| **b == 0).map(|_| '1').collect();
    s.extend(digits.iter().rev().map(|d| A[*d as usize] as char));
    s
}

pub fn code_hash(code: &[u8]) -> ([u8; 32], String) {
    use sha2::Digest;
    let h: [u8; 32] = sha2::Sha256::digest(code).into();
    (h, b58(&h))
}

impl Env {
    pub async fn new() -> Result<Env> {
        let vault_code = wasm("oiko_vault");
        let worker = near_workspaces::sandbox().await?;
        let tla = worker.root_account()?;
        let root = tla
            .create_subaccount("oiko")
            .initial_balance(NearToken::from_near(500))
            .transact()
            .await?
            .into_result()?;
        let relayer = tla
            .create_subaccount("relayer")
            .initial_balance(NearToken::from_near(200))
            .transact()
            .await?
            .into_result()?;
        let sub = |name: &str, near: u128| {
            let root = root.clone();
            let name = name.to_string();
            async move {
                root.create_subaccount(&name)
                    .initial_balance(NearToken::from_near(near))
                    .transact()
                    .await?
                    .into_result()
                    .map_err(anyhow::Error::from)
            }
        };
        let usdc = sub("usdc", 20).await?.deploy(&wasm("oiko_mock_ft")).await?.into_result()?;
        let usdt = sub("usdt", 20).await?.deploy(&wasm("oiko_mock_ft")).await?.into_result()?;
        for (c, n, s) in [(&usdc, "USD Coin", "USDC"), (&usdt, "Tether USD", "USDT")] {
            assert_ok(
                &c.call("new")
                    .args_json(json!({"name": n, "symbol": s, "minter": relayer.id()}))
                    .transact()
                    .await?,
            );
        }
        let lending = sub("lending", 20).await?.deploy(&wasm("oiko_mock_lending")).await?.into_result()?;
        assert_ok(
            &lending
                .call("new")
                .args_json(json!({"admin": relayer.id(), "tokens": [usdc.id(), usdt.id()], "extra_decimals": 12}))
                .transact()
                .await?,
        );
        // the lending contract must be registered on both tokens to send withdrawals back
        for t in [&usdc, &usdt] {
            assert_ok(
                &relayer
                    .call(t.id(), "storage_deposit")
                    .args_json(json!({"account_id": lending.id()}))
                    .deposit(NearToken::from_millinear(10))
                    .transact()
                    .await?,
            );
        }
        let ajo = sub("ajo", 20).await?.deploy(&wasm("oiko_ajo")).await?.into_result()?;
        assert_ok(
            &ajo.call("new")
                .args_json(json!({"usdc": usdc.id(), "usdt": usdt.id()}))
                .transact()
                .await?,
        );
        for t in [&usdc, &usdt] {
            assert_ok(
                &relayer
                    .call(t.id(), "storage_deposit")
                    .args_json(json!({"account_id": ajo.id()}))
                    .deposit(NearToken::from_millinear(10))
                    .transact()
                    .await?,
            );
        }
        let (_, vault_code_hash) = code_hash(&vault_code);
        let registry = root.deploy(&wasm("oiko_registry")).await?.into_result()?;
        assert_ok(
            &registry
                .call("new")
                .args_json(json!({
                    "vault_code_hash": vault_code_hash,
                    "usdc": usdc.id(), "usdt": usdt.id(), "lending": lending.id(), "ajo": ajo.id(),
                    "mpc_signer": "v1.signer-prod.testnet", "relayer": relayer.id(),
                    "account_funding": ACCOUNT_FUNDING.as_yoctonear().to_string()
                }))
                .transact()
                .await?,
        );
        Ok(Env { worker, root, relayer, usdc, usdt, lending, ajo, registry, vault_code_hash })
    }

    pub fn vault_config(&self) -> Value {
        json!({
            "max_utilization_bps": 9200,
            "large_withdrawal_threshold": (1_000 * USDT).to_string(),
            "lending": self.lending.id(),
            "ajo": self.ajo.id(),
            "mpc_signer": "v1.signer-prod.testnet",
            "agent_allowance": NearToken::from_millinear(500).as_yoctonear().to_string()
        })
    }

    pub async fn register(&self, name: &str) -> Result<(User, ExecutionFinalResult)> {
        let owner_sk = SecretKey::from_random(KeyType::ED25519);
        let app_sk = SecretKey::from_random(KeyType::ED25519);
        let r = self
            .relayer
            .call(self.registry.id(), "register_name")
            .args_json(json!({
                "name": name,
                "owner_public_key": owner_sk.public_key(),
                "app_public_key": app_sk.public_key()
            }))
            .deposit(ACCOUNT_FUNDING)
            .gas(near_workspaces::types::Gas::from_tgas(100))
            .transact()
            .await?;
        let id: AccountId = format!("{}.{}", name, self.registry.id()).parse()?;
        let vault_id: AccountId = format!("vault.{}", id).parse()?;
        Ok((
            User {
                name: name.into(),
                owner: Account::from_secret_key(id.clone(), owner_sk, &self.worker),
                app: Account::from_secret_key(id, app_sk, &self.worker),
                vault_id,
            },
            r,
        ))
    }

    /// Vault creation with DeployContract (fallback path).
    pub async fn create_vault_deploy(&self, u: &User) -> Result<ExecutionFinalResult> {
        let r = u
            .owner
            .batch(&u.vault_id)
            .create_account()
            .transfer(VAULT_FUNDING_DEPLOY)
            .deploy(&wasm("oiko_vault"))
            .call(
                near_workspaces::operations::Function::new("new")
                    .args_json(json!({
                        "owner": u.owner.id(), "usdc": self.usdc.id(), "usdt": self.usdt.id(),
                        "config": self.vault_config()
                    }))
                    .gas(near_workspaces::types::Gas::from_tgas(100)),
            )
            .transact()
            .await?;
        Ok(r)
    }

    /// Publishes the vault wasm as a global contract (by code hash) from `publisher`.
    pub async fn publish_global(&self, publisher: &Account) -> Result<()> {
        use near_primitives::action::{Action, DeployGlobalContractAction, GlobalContractDeployMode};
        let code = wasm("oiko_vault");
        let action = Action::DeployGlobalContract(DeployGlobalContractAction {
            code: code.into(),
            deploy_mode: GlobalContractDeployMode::CodeHash,
        });
        self.raw_tx(publisher, publisher.id(), vec![action]).await
    }

    /// Vault creation with UseGlobalContract(code_hash) — the production path.
    pub async fn create_vault_global(&self, u: &User) -> Result<()> {
        use near_primitives::action::{
            Action, CreateAccountAction, FunctionCallAction, TransferAction, UseGlobalContractAction,
        };
        use near_primitives::action::GlobalContractIdentifier;
        let (hash, _) = code_hash(&wasm("oiko_vault"));
        let args = serde_json::to_vec(&json!({
            "owner": u.owner.id(), "usdc": self.usdc.id(), "usdt": self.usdt.id(),
            "config": self.vault_config()
        }))?;
        let actions = vec![
            Action::CreateAccount(CreateAccountAction {}),
            Action::Transfer(TransferAction { deposit: VAULT_FUNDING }),
            Action::UseGlobalContract(Box::new(UseGlobalContractAction {
                contract_identifier: GlobalContractIdentifier::CodeHash(near_primitives::hash::CryptoHash(hash)),
            })),
            Action::FunctionCall(Box::new(FunctionCallAction {
                method_name: "new".into(),
                args,
                gas: near_primitives::gas::Gas::from_gas(100 * TGAS),
                deposit: near_primitives::types::Balance::ZERO,
            })),
        ];
        self.raw_tx(&u.owner, &u.vault_id, actions).await
    }

    /// Signs and sends a transaction with arbitrary actions (near-workspaces has no global-contract
    /// helpers). Fails if any receipt failed.
    pub async fn raw_tx(
        &self,
        signer: &Account,
        receiver: &AccountId,
        actions: Vec<near_primitives::action::Action>,
    ) -> Result<()> {
        raw_tx(&self.worker, signer, receiver, actions).await
    }
}

/// Signs and sends a transaction with arbitrary actions on `worker`. Fails if any receipt failed.
pub async fn raw_tx(
    worker: &Worker<Sandbox>,
    signer: &Account,
    receiver: &AccountId,
    actions: Vec<near_primitives::action::Action>,
) -> Result<()> {
    {
        use near_jsonrpc_client::{methods, JsonRpcClient};
        use near_primitives::transaction::{SignedTransaction, Transaction, TransactionV0};
        use near_primitives::types::{BlockReference, Finality};
        use near_primitives::views::{FinalExecutionStatus, QueryRequest, TxExecutionStatus};
        let client = JsonRpcClient::connect(worker.rpc_addr());
        let sk: near_crypto::SecretKey = signer.secret_key().to_string().parse()?;
        let signer_id: near_primitives::types::AccountId = signer.id().as_str().parse()?;
        let receiver_id: near_primitives::types::AccountId = receiver.as_str().parse()?;
        let pk = sk.public_key();
        let q = client
            .call(methods::query::RpcQueryRequest {
                block_reference: BlockReference::Finality(Finality::Final),
                request: QueryRequest::ViewAccessKey { account_id: signer_id.clone(), public_key: pk.clone() },
            })
            .await?;
        let nonce = match q.kind {
            near_jsonrpc_primitives::types::query::QueryResponseKind::AccessKey(ak) => ak.nonce,
            _ => return Err(anyhow!("unexpected query response")),
        };
        let block = client
            .call(methods::block::RpcBlockRequest { block_reference: BlockReference::Finality(Finality::Final) })
            .await?;
        let tx = Transaction::V0(TransactionV0 {
            signer_id: signer_id.clone(),
            public_key: pk,
            nonce: nonce + 1,
            receiver_id,
            block_hash: block.header.hash,
            actions,
        });
        let signer = near_crypto::InMemorySigner::from_secret_key(signer_id, sk);
        let sig = signer.sign(tx.get_hash_and_size().0.as_ref());
        let stx = SignedTransaction::new(sig, tx);
        let res = client
            .call(methods::send_tx::RpcSendTransactionRequest {
                signed_transaction: stx,
                wait_until: TxExecutionStatus::Final,
            })
            .await?;
        let outcome = res.final_execution_outcome.ok_or_else(|| anyhow!("no outcome"))?.into_outcome();
        if let FinalExecutionStatus::Failure(e) = &outcome.status {
            return Err(anyhow!("tx failed: {e:?}"));
        }
        for r in &outcome.receipts_outcome {
            if let near_primitives::views::ExecutionStatusView::Failure(e) = &r.outcome.status {
                return Err(anyhow!("receipt failed: {e:?}"));
            }
        }
        Ok(())
    }
}

impl Env {
    pub async fn token_balance(&self, token: &Contract, who: &AccountId) -> Result<u128> {
        let v: String = token.view("ft_balance_of").args_json(json!({"account_id": who})).await?.json()?;
        Ok(v.parse()?)
    }

    pub async fn storage_register(&self, token: &Contract, who: &AccountId) -> Result<()> {
        assert_ok(
            &self
                .relayer
                .call(token.id(), "storage_deposit")
                .args_json(json!({"account_id": who}))
                .deposit(NearToken::from_millinear(10))
                .transact()
                .await?,
        );
        Ok(())
    }

    pub async fn mint(&self, token: &Contract, to: &AccountId, amount: u128) -> Result<()> {
        assert_ok(
            &self
                .relayer
                .call(token.id(), "mint")
                .args_json(json!({"account_id": to, "amount": amount.to_string()}))
                .transact()
                .await?,
        );
        Ok(())
    }

    pub async fn new_account(&self, name: &str) -> Result<Account> {
        Ok(self
            .worker
            .root_account()?
            .create_subaccount(name)
            .initial_balance(NearToken::from_near(10))
            .transact()
            .await?
            .into_result()?)
    }

    pub async fn overview(&self, vault: &AccountId) -> Result<Value> {
        Ok(self.worker.view(vault, "get_overview").args_json(json!({})).await?.json()?)
    }

    /// Advances sandbox time by about `secs` seconds (≈0.3 s per fast-forwarded block).
    pub async fn advance(&self, secs: u64) -> Result<()> {
        let start = self.worker.view_block().await?.timestamp();
        let target = start + secs * 1_000_000_000;
        loop {
            self.worker.fast_forward(secs.max(10) * 4).await?;
            if self.worker.view_block().await?.timestamp() >= target {
                return Ok(());
            }
        }
    }

    pub async fn now(&self) -> Result<u64> {
        Ok(self.worker.view_block().await?.timestamp())
    }

    pub async fn full_access_keys(&self, id: &AccountId) -> Result<usize> {
        let keys = self.worker.view_access_keys(id).await?;
        Ok(keys
            .iter()
            .filter(|k| matches!(k.access_key.permission, AccessKeyPermission::FullAccess))
            .count())
    }
}

/// Owner-method call through the app's function-call key (no deposit allowed).
pub async fn app_call(u: &User, method: &str, args: Value) -> Result<ExecutionFinalResult> {
    Ok(u
        .app
        .call(&u.vault_id, method)
        .args_json(args)
        .gas(near_workspaces::types::Gas::from_tgas(30))
        .transact()
        .await?)
}

pub fn bal(v: &Value, pot: usize, token: &str) -> u128 {
    v["pots"][pot]["balances"][token].as_str().unwrap().parse().unwrap()
}

pub fn pot_by_id(v: &Value, id: u64) -> Value {
    v["pots"].as_array().unwrap().iter().find(|p| p["id"] == id).cloned().unwrap()
}

pub fn pot_bal(v: &Value, id: u64, token: &str) -> u128 {
    pot_by_id(v, id)["balances"][token].as_str().unwrap().parse().unwrap()
}

/// Owner-method call through the full-access login key. Used for most steps because the
/// sandbox gas price (1e9 yocto/gas) burns the app key's fixed 0.25 NEAR allowance ~10x faster
/// than mainnet/testnet do.
pub async fn owner_call(u: &User, method: &str, args: Value) -> Result<ExecutionFinalResult> {
    Ok(u
        .owner
        .call(&u.vault_id, method)
        .args_json(args)
        .gas(near_workspaces::types::Gas::from_tgas(300))
        .transact()
        .await?)
}

impl Env {
    /// Fast-forwards until the block timestamp is >= `ts` (ns).
    pub async fn advance_to(&self, ts: u64) -> Result<()> {
        loop {
            let now = self.now().await?;
            if now >= ts {
                return Ok(());
            }
            let blocks = ((ts - now) / 300_000_000).max(5) + 5;
            self.worker.fast_forward(blocks).await?;
        }
    }

    /// Registers `name`, creates its vault with DeployContract, and sends it `usdt` via
    /// ft_transfer_call from `payer`.
    pub async fn user_with_vault(&self, name: &str, payer: &Account, usdt: u128) -> Result<User> {
        let (u, r) = self.register(name).await?;
        assert_ok(&r);
        // the DeployContract fallback needs more NEAR than the registry's account_funding
        self.relayer.transfer_near(u.owner.id(), VAULT_FUNDING_DEPLOY).await?.into_result()?;
        assert_ok(&self.create_vault_deploy(&u).await?);
        if usdt > 0 {
            assert_ok(
                &payer
                    .call(self.usdt.id(), "ft_transfer_call")
                    .args_json(json!({"receiver_id": u.vault_id, "amount": usdt.to_string(), "msg": ""}))
                    .deposit(NearToken::from_yoctonear(1))
                    .gas(near_workspaces::types::Gas::from_tgas(150))
                    .transact()
                    .await?,
            );
        }
        Ok(u)
    }
}
