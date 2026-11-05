//! Oiko local devnet: starts a NEAR sandbox, deploys every Oiko contract the way
//! scripts/deploy-testnet.sh does on testnet, writes the relayer key and env for the web app,
//! prints "oiko devnet ready" and keeps running until Ctrl-C.
//!
//!   cargo run -p oiko-tests --bin devnet --release        (from contracts/)
//!
//! Env (all optional):
//!   DEVNET_HOST        address the RPC listens on            default 127.0.0.1 (0.0.0.0 in Docker)
//!   DEVNET_PORT        RPC port                               default 3030
//!   DEVNET_PUBLIC_URL  RPC URL written to .oiko/local.env     default http://127.0.0.1:<port>
//!   OIKO_STATE_DIR     where relayer.json / local.env / ready go   default <repo>/.oiko
//!   OIKO_RES_DIR       directory with the built *.wasm        default <repo>/contracts/res (built if missing)
//!   OIKO_ROOT_NAME     root sub-account name (<name>.test.near)    default oiko
//!
//! Everything here is a throwaway local chain: the relayer key is derived from a fixed seed so a
//! restarted devnet keeps the same relayer, and nothing on it has real value.
use anyhow::{anyhow, Context, Result};
use near_primitives::action::{Action, DeployGlobalContractAction, GlobalContractDeployMode};
use near_workspaces::network::{Sandbox, ValidatorKey};
use near_workspaces::types::{KeyType, NearToken, SecretKey};
use near_workspaces::{Account, Worker};
use oiko_tests::{code_hash, contracts_dir, raw_tx};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::Instant;
use tokio::net::{TcpListener, TcpStream};

const RELAYER_SEED: &str = "oiko-local-relayer";

fn env_or(k: &str, d: &str) -> String {
    std::env::var(k).ok().filter(|v| !v.trim().is_empty()).unwrap_or_else(|| d.to_string())
}

fn ok(r: near_workspaces::result::ExecutionFinalResult, what: &str) -> Result<()> {
    if r.failures().is_empty() {
        Ok(())
    } else {
        Err(anyhow!("{what} failed: {:?}", r.failures()))
    }
}

/// Forwards TCP connections from `listen` to the sandbox's 127.0.0.1 RPC port.
async fn proxy(listen: String, upstream: String) -> Result<()> {
    let l = TcpListener::bind(&listen).await.with_context(|| format!("bind {listen} (is another devnet running?)"))?;
    tokio::spawn(async move {
        loop {
            let Ok((mut inbound, _)) = l.accept().await else { continue };
            let up = upstream.clone();
            tokio::spawn(async move {
                if let Ok(mut out) = TcpStream::connect(&up).await {
                    let _ = tokio::io::copy_bidirectional(&mut inbound, &mut out).await;
                }
            });
        }
    });
    Ok(())
}

fn ensure_wasm(res: &Path, explicit: bool) -> Result<()> {
    let names = ["oiko_vault", "oiko_registry", "oiko_ajo", "oiko_mock_ft", "oiko_mock_lending"];
    if names.iter().all(|n| res.join(format!("{n}.wasm")).exists()) {
        return Ok(());
    }
    if explicit {
        return Err(anyhow!("missing wasm in {} (run scripts/build-contracts.sh)", res.display()));
    }
    eprintln!("[devnet] building contracts (scripts/build-contracts.sh)…");
    let st = std::process::Command::new("bash").arg(contracts_dir().join("../scripts/build-contracts.sh")).status()?;
    if !st.success() {
        return Err(anyhow!("contract build failed"));
    }
    Ok(())
}

async fn sub(parent: &Account, name: &str, near: u128) -> Result<Account> {
    Ok(parent
        .create_subaccount(name)
        .initial_balance(NearToken::from_near(near))
        .transact()
        .await?
        .into_result()?)
}

#[tokio::main]
async fn main() -> Result<()> {
    let t0 = Instant::now();
    let host = env_or("DEVNET_HOST", "127.0.0.1");
    let port: u16 = env_or("DEVNET_PORT", "3030").parse()?;
    let public_url = env_or("DEVNET_PUBLIC_URL", &format!("http://127.0.0.1:{port}"));
    let repo = contracts_dir().join("..");
    let state: PathBuf = std::env::var("OIKO_STATE_DIR").map(PathBuf::from).unwrap_or_else(|_| repo.join(".oiko"));
    let res_explicit = std::env::var("OIKO_RES_DIR").is_ok();
    let res: PathBuf = std::env::var("OIKO_RES_DIR").map(PathBuf::from).unwrap_or_else(|_| contracts_dir().join("res"));
    let root_name = env_or("OIKO_ROOT_NAME", "oiko");
    std::fs::create_dir_all(&state)?;
    let _ = std::fs::remove_file(state.join("ready"));
    ensure_wasm(&res, res_explicit)?;
    let wasm = |n: &str| std::fs::read(res.join(format!("{n}.wasm"))).with_context(|| format!("read {n}.wasm"));

    // 1. Sandbox node. min_gas_price matches NEAR testnet (5000 yocto/gas, the hosted demo's network). The sandbox default
    //    (1e9) burns the app key's fixed 0.25 NEAR allowance within a few calls: allowance is charged at the pessimistic
    //    price for all prepaid gas and is not refunded.
    let cfg = near_sandbox::SandboxConfig {
        additional_genesis: Some(json!({ "min_gas_price": "5000" })),
        ..Default::default()
    };
    let sandbox = near_sandbox::Sandbox::start_sandbox_with_config(cfg).await.map_err(|e| anyhow!("start sandbox: {e}"))?;
    let upstream = sandbox.rpc_addr.trim_start_matches("http://").to_string();
    proxy(format!("{host}:{port}"), upstream).await?;
    let worker: Worker<Sandbox> = near_workspaces::sandbox()
        .rpc_addr(&sandbox.rpc_addr)
        .validator_key(ValidatorKey::HomeDir(sandbox.home_dir.path().to_path_buf()))
        .await?;
    eprintln!("[devnet] sandbox up at {} (proxied on {host}:{port})", sandbox.rpc_addr);

    // 2. Accounts: <root>.test.near (registry), relayer.test.near, and token / lending / ROSCA contracts under the root.
    let tla = worker.root_account()?;
    let root = sub(&tla, &root_name, 300).await?;
    let relayer_sk = SecretKey::from_seed(KeyType::ED25519, RELAYER_SEED);
    let relayer = tla
        .create_subaccount("relayer")
        .keys(relayer_sk.clone())
        .initial_balance(NearToken::from_near(5_000))
        .transact()
        .await?
        .into_result()?;
    let usdc = sub(&root, "usdc", 10).await?;
    let usdt = sub(&root, "usdt", 10).await?;
    let lending = sub(&root, "lending", 10).await?;
    let ajo = sub(&root, "ajo", 10).await?;

    let ft = wasm("oiko_mock_ft")?;
    for (acc, n, s) in [(&usdc, "USD Coin (Oiko local)", "USDC"), (&usdt, "Tether USD (Oiko local)", "USDT")] {
        let c = acc.deploy(&ft).await?.into_result()?;
        ok(c.call("new").args_json(json!({"name": n, "symbol": s, "minter": relayer.id()})).transact().await?, "ft new")?;
    }
    let c = lending.deploy(&wasm("oiko_mock_lending")?).await?.into_result()?;
    ok(c.call("new").args_json(json!({"admin": relayer.id(), "tokens": [usdc.id(), usdt.id()], "extra_decimals": 12})).transact().await?, "lending new")?;
    let c = ajo.deploy(&wasm("oiko_ajo")?).await?.into_result()?;
    ok(c.call("new").args_json(json!({"usdc": usdc.id(), "usdt": usdt.id()})).transact().await?, "ajo new")?;
    // Token storage for the relayer (faucet), lending and ROSCA contracts.
    for t in [&usdc, &usdt] {
        for who in [relayer.id(), lending.id(), ajo.id()] {
            ok(relayer.call(t.id(), "storage_deposit").args_json(json!({"account_id": who})).deposit(NearToken::from_millinear(10)).transact().await?, "storage_deposit")?;
        }
    }

    // 3. Vault code as a global contract (by hash), then the registry on the root.
    let vault_code = wasm("oiko_vault")?;
    let (_, hash) = code_hash(&vault_code);
    raw_tx(&worker, &root, root.id(), vec![Action::DeployGlobalContract(DeployGlobalContractAction { code: vault_code.into(), deploy_mode: GlobalContractDeployMode::CodeHash })]).await?;
    let reg = root.deploy(&wasm("oiko_registry")?).await?.into_result()?;
    ok(reg
        .call("new")
        .args_json(json!({
            "vault_code_hash": hash, "usdc": usdc.id(), "usdt": usdt.id(), "lending": lending.id(), "ajo": ajo.id(),
            "mpc_signer": Value::Null, "relayer": relayer.id(),
            "account_funding": NearToken::from_near(1).as_yoctonear().to_string()
        }))
        .transact()
        .await?, "registry new")?;

    // 4. Files for the web app (apps/web/server/config.ts reads both in local mode).
    std::fs::write(state.join("relayer.json"), serde_json::to_string_pretty(&json!({"account_id": relayer.id(), "private_key": relayer_sk.to_string()}))?)?;
    let local_env = format!(
        "# Written by the Oiko devnet ({}). Local sandbox only.\nOIKO_NETWORK=local\nOIKO_NODE_URL={public_url}\nOIKO_ROOT_ACCOUNT={}\nOIKO_USDC={}\nOIKO_USDT={}\nOIKO_LENDING={}\nOIKO_AJO={}\nOIKO_MPC_SIGNER=none\nOIKO_VAULT_CODE_HASH={hash}\nRELAYER_ACCOUNT_ID={}\n",
        "contracts/tests/src/bin/devnet.rs", root.id(), usdc.id(), usdt.id(), lending.id(), ajo.id(), relayer.id()
    );
    std::fs::write(state.join("local.env"), local_env)?;
    std::fs::write(state.join("ready"), format!("{}\n", public_url))?;

    println!("[devnet] root {}  relayer {}  vault code {hash}", root.id(), relayer.id());
    println!("[devnet] wrote {}/relayer.json and local.env in {:.1}s", state.display(), t0.elapsed().as_secs_f32());
    println!("oiko devnet ready at {public_url}");

    // Keep the node alive (it is killed when `sandbox` drops).
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = term.recv() => {} }
    let _ = std::fs::remove_file(state.join("ready"));
    drop(sandbox);
    Ok(())
}
