//! V-9: a vault with the maximum plan (20 split rules over 19 pots) still credits a deposit via
//! `sync` and via `ft_transfer_call` within the callback gas budgets.

use near_workspaces::types::{Gas, NearToken};
use oiko_tests::*;
use serde_json::json;

#[tokio::test]
async fn max_splits_sync_has_enough_gas() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let payer = env.new_account("payer").await?;
    env.mint(&env.usdt, payer.id(), 1_000 * USDT).await?;
    let (ada, r) = env.register("ada").await?;
    assert_ok(&r);
    env.publish_global(&env.root).await?;
    env.create_vault_global(&ada).await?;
    let mut pots = vec![];
    for i in 0..19 {
        let r = owner_call(&ada, "create_pot", json!({"name": format!("Pot {i}"), "icon": "", "color": "", "kind": "goal"})).await?;
        assert_ok(&r);
        pots.push(r.json::<u64>()?);
    }
    let mut rules = vec![];
    for (i, p) in pots.iter().enumerate() {
        rules.push(json!({"pot_id": p, "mode": "percent", "value": "400"}));
        if i == 0 {
            rules.push(json!({"pot_id": p, "mode": "fixed", "value": USDT.to_string()}));
        }
    }
    assert_eq!(rules.len(), 20);
    assert_ok(&owner_call(&ada, "set_splits", json!({"rules": rules})).await?);

    let r = payer
        .call(env.usdt.id(), "ft_transfer")
        .args_json(json!({"receiver_id": ada.vault_id, "amount": (100 * USDT).to_string()}))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?;
    assert_ok(&r);
    let r = payer.call(&ada.vault_id, "sync").gas(Gas::from_tgas(150)).transact().await?;
    assert_ok(&r);
    let split = events(&r, "split_applied");
    assert_eq!(split.len(), 1);
    assert_eq!(split[0]["allocations"].as_array().unwrap().len(), 20); // 19 pots + Spend
    let burnt: u64 = r.outcomes().iter().map(|o| o.gas_burnt.as_gas()).max().unwrap();
    println!("max receipt gas in sync with 20 rules: {} TGas", burnt / 1_000_000_000_000);

    // the ft_transfer_call path (receiver gets prepaid - 30 TGas)
    let r = payer
        .call(env.usdt.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id": ada.vault_id, "amount": (100 * USDT).to_string(), "msg": ""}))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(150))
        .transact()
        .await?;
    assert_ok(&r);
    assert_eq!(events(&r, "deposit_received")[0]["source"], "ft_on_transfer");
    let o = env.overview(&ada.vault_id).await?;
    assert_eq!(o["accounted"]["usdt"], (200 * USDT).to_string());
    let sum: u128 = o["pots"].as_array().unwrap().iter().map(|p| p["balances"]["usdt"].as_str().unwrap().parse::<u128>().unwrap()).sum();
    assert_eq!(sum, 200 * USDT);
    Ok(())
}
