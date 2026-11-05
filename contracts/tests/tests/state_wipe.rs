//! The testnet redeploy procedure (scripts/redeploy-testnet.sh): deploy the state-wipe tool over
//! a live registry, remove every storage key, then deploy the registry again with a new init.

use near_workspaces::types::Gas;
use oiko_tests::*;
use serde_json::json;

#[tokio::test]
async fn wipe_then_redeploy_registry() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (_, r) = env.register("ada").await?;
    assert_ok(&r);
    let keys: Vec<String> = env
        .worker
        .view_state(env.root.id())
        .await?
        .keys()
        .map(|k| base64_encode(k))
        .collect();
    assert!(keys.len() > 1);

    env.root.deploy(&wasm("oiko_state_wipe")).await?.into_result()?;
    // only the account itself may wipe
    let r = env.relayer.call(env.root.id(), "wipe").args_json(json!({"keys": keys})).transact().await?;
    assert_fails_with(&r, "E_NOT_SELF");
    let r = env.root.call(env.root.id(), "wipe").args_json(json!({"keys": keys})).gas(Gas::from_tgas(300)).transact().await?;
    assert_ok(&r);
    assert_eq!(r.json::<u64>()?, keys.len() as u64);
    assert_eq!(env.worker.view_state(env.root.id()).await?.len(), 0);

    let reg = env.root.deploy(&wasm("oiko_registry")).await?.into_result()?;
    assert_ok(
        &reg.call("new")
            .args_json(json!({
                "vault_code_hash": "72sdtZyfMEdLh2RSqSjBAPt73PpsHCr24irGCi9yahex",
                "usdc": env.usdc.id(), "usdt": env.usdt.id(), "lending": env.lending.id(), "ajo": env.ajo.id(),
                "mpc_signer": "v1.signer-prod.testnet", "relayer": env.relayer.id(),
                "account_funding": ACCOUNT_FUNDING.as_yoctonear().to_string()
            }))
            .transact()
            .await?,
    );
    let cfg: serde_json::Value = reg.view("config").await?.json()?;
    assert_eq!(cfg["vault_code_hash"], "72sdtZyfMEdLh2RSqSjBAPt73PpsHCr24irGCi9yahex");
    let stats: serde_json::Value = reg.view("stats").await?.json()?;
    assert_eq!(stats["names"], 0);
    Ok(())
}

fn base64_encode(b: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::new();
    for c in b.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            if i <= c.len() {
                s.push(T[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                s.push('=');
            }
        }
    }
    s
}
