//! Full critical path against near-sandbox: registry -> vault (global contract by code hash)
//! -> receive + sync + splits -> locks -> withdraw -> agent caps/allowlist/bill/propose/revoke
//! -> Earn utilization guard.

use near_workspaces::types::{AccessKeyPermission, Gas, KeyType, NearToken, SecretKey};
use near_workspaces::Account;
use oiko_tests::*;
use serde_json::json;

#[tokio::test]
async fn critical_path() -> anyhow::Result<()> {
    let env = Env::new().await?;

    // ---------------------------------------------------------------- registry
    let (ada, r) = env.register("ada").await?;
    assert_ok(&r);
    let ev = events(&r, "name_registered");
    assert_eq!(ev[0]["account_id"], "ada.oiko.test.near");
    let rec: serde_json::Value = env.registry.view("get_name").args_json(json!({"name": "ada"})).await?.json()?;
    assert_eq!(rec["vault_id"], "vault.ada.oiko.test.near");
    let avail: bool = env.registry.view("is_available").args_json(json!({"name": "ada"})).await?.json()?;
    assert!(!avail);
    let stats: serde_json::Value = env.registry.view("stats").await?.json()?;
    assert_eq!(stats["names"], 1);
    let list: serde_json::Value = env.registry.view("list_names").args_json(json!({"from_index": 0, "limit": 10})).await?.json()?;
    assert_eq!(list[0]["vault_id"], "vault.ada.oiko.test.near");
    // second registration of the same name fails; non-relayer cannot register
    let (_, r) = env.register("ada").await?;
    assert_fails_with(&r, "E_TAKEN");
    let r = ada
        .owner
        .call(env.registry.id(), "register_name")
        .args_json(json!({"name": "eve", "owner_public_key": ada.owner.secret_key().public_key(), "app_public_key": ada.app.secret_key().public_key()}))
        .deposit(NearToken::from_millinear(10))
        .transact()
        .await?;
    assert_fails_with(&r, "E_NOT_RELAYER");

    // name account keys: one full-access (owner), one function-call (app) scoped to the vault
    let keys = env.worker.view_access_keys(ada.owner.id()).await?;
    assert_eq!(keys.len(), 2);
    let fc = keys
        .iter()
        .find_map(|k| match &k.access_key.permission {
            AccessKeyPermission::FunctionCall(f) => Some(f.clone()),
            _ => None,
        })
        .unwrap();
    assert_eq!(fc.receiver_id, "vault.ada.oiko.test.near");
    assert!(fc.method_names.contains(&"withdraw".to_string()));
    assert!(!fc.method_names.contains(&"withdraw_large".to_string()));
    assert!(!fc.method_names.contains(&"rescue_sign".to_string()));

    // ---------------------------------------------------------------- vault via global contract
    env.publish_global(&env.root).await?;
    env.create_vault_global(&ada).await?;
    let acct = env.worker.view_account(&ada.vault_id).await?;
    assert!(
        format!("{:?}", acct.contract_state).contains("Global"),
        "vault should use the global contract: {:?}",
        acct.contract_state
    );
    let v: String = env.worker.view(&ada.vault_id, "version").await?.json()?;
    assert_eq!(v, "1.0.0");
    assert_eq!(env.worker.view_access_keys(&ada.vault_id).await?.len(), 0, "vault must be keyless");

    // ---------------------------------------------------------------- pots + splits (app key)
    let mk = |name: &str, kind: &str| json!({"name": name, "icon": "", "color": "", "kind": kind});
    let bills_pot: u64 = app_call(&ada, "create_pot", mk("Bills", "bills")).await?.json()?;
    let savings: u64 = app_call(&ada, "create_pot", mk("Savings", "autosave")).await?.json()?;
    let rainy: u64 = owner_call(&ada, "create_pot", mk("Rainy day", "locked")).await?.json()?;
    let r = app_call(
        &ada,
        "set_splits",
        json!({"rules": [
            {"pot_id": bills_pot, "mode": "percent", "value": "3000"},
            {"pot_id": savings, "mode": "percent", "value": "2000"},
            {"pot_id": rainy, "mode": "fixed", "value": (10 * USDT).to_string()}
        ]}),
    )
    .await?;
    assert_ok(&r);
    assert_fails_with(
        &owner_call(&ada, "set_splits", json!({"rules": [{"pot_id": 0, "mode": "percent", "value": "1"}]})).await?,
        "E_BAD_SPLITS",
    );

    // ---------------------------------------------------------------- receive by plain ft_transfer + sync
    let payer = env.new_account("payer").await?;
    env.mint(&env.usdt, payer.id(), 1_000 * USDT).await?;
    let r = payer
        .call(env.usdt.id(), "ft_transfer")
        .args_json(json!({"receiver_id": ada.vault_id, "amount": (100 * USDT).to_string()}))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?;
    assert_ok(&r);
    let r = owner_call(&ada, "sync", json!({})).await?;
    assert_ok(&r);
    let dep = events(&r, "deposit_received");
    assert_eq!(dep.len(), 1);
    assert_eq!(dep[0]["source"], "sync");
    assert_eq!(dep[0]["amount"], (100 * USDT).to_string());
    let o = env.overview(&ada.vault_id).await?;
    assert_eq!(pot_bal(&o, bills_pot, "usdt"), 30 * USDT);
    assert_eq!(pot_bal(&o, savings, "usdt"), 20 * USDT);
    assert_eq!(pot_bal(&o, rainy, "usdt"), 10 * USDT);
    assert_eq!(pot_bal(&o, 0, "usdt"), 40 * USDT);
    assert_eq!(o["accounted"]["usdt"], (100 * USDT).to_string());
    // second sync is a no-op (anyone may call it)
    let r = payer.call(&ada.vault_id, "sync").gas(Gas::from_tgas(100)).transact().await?;
    assert_ok(&r);
    assert!(events(&r, "deposit_received").is_empty());
    let o2 = env.overview(&ada.vault_id).await?;
    assert_eq!(o2["pots"], o["pots"]);

    // ft_transfer_call path credits immediately (within the same transaction)
    let r = payer
        .call(env.usdt.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id": ada.vault_id, "amount": (10 * USDT).to_string(), "msg": ""}))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(150))
        .transact()
        .await?;
    assert_ok(&r);
    let dep = events(&r, "deposit_received");
    assert_eq!(dep[0]["source"], "ft_on_transfer");
    assert_eq!(dep[0]["sender_id"], "payer.test.near");
    let o = env.overview(&ada.vault_id).await?;
    assert_eq!(o["accounted"]["usdt"], (110 * USDT).to_string());

    // ---------------------------------------------------------------- locks
    let unlock_at = env.now().await? + 40_000_000_000; // ~40 s
    assert_ok(&owner_call(&ada, "lock", json!({"pot_id": rainy, "unlock_at": unlock_at.to_string()})).await?);
    assert_fails_with(
        &owner_call(&ada, "lock", json!({"pot_id": rainy, "unlock_at": (unlock_at - 1).to_string()})).await?,
        "E_LOCK_SHORTEN",
    );
    assert_fails_with(
        &owner_call(&ada, "withdraw", json!({"pot_id": rainy, "token": "usdt", "amount": USDT.to_string(), "to": payer.id()})).await?,
        "E_LOCKED",
    );
    assert_fails_with(
        &owner_call(&ada, "move_funds", json!({"from_pot": rainy, "to_pot": 0, "token": "usdt", "amount": USDT.to_string()})).await?,
        "E_LOCKED",
    );
    // the login (full-access) key can't break it either
    let r = ada
        .owner
        .call(&ada.vault_id, "withdraw_large")
        .args_json(json!({"pot_id": rainy, "token": "usdt", "amount": USDT.to_string(), "to": payer.id()}))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?;
    assert_fails_with(&r, "E_LOCKED");
    env.advance(45).await?;
    assert_ok(&owner_call(&ada, "move_funds", json!({"from_pot": rainy, "to_pot": 0, "token": "usdt", "amount": USDT.to_string()})).await?);

    // the app key cannot call withdraw_large (not in its method list)
    let r = ada
        .app
        .call(&ada.vault_id, "withdraw_large")
        .args_json(json!({"pot_id": 0, "token": "usdt", "amount": "1", "to": payer.id()}))
        .gas(Gas::from_tgas(30))
        .transact()
        .await;
    assert!(r.is_err() || !r.unwrap().is_success());

    // ---------------------------------------------------------------- withdraw from flex
    let before = env.token_balance(&env.usdt, payer.id()).await?;
    let r = owner_call(&ada, "withdraw", json!({"pot_id": 0, "token": "usdt", "amount": (5 * USDT).to_string(), "to": payer.id(), "memo": "rent"})).await?;
    assert_ok(&r);
    assert_eq!(events(&r, "withdrawn").len(), 1);
    assert_eq!(env.token_balance(&env.usdt, payer.id()).await? - before, 5 * USDT);
    assert_fails_with(
        &owner_call(&ada, "withdraw", json!({"pot_id": 0, "token": "usdt", "amount": (2_000 * USDT).to_string(), "to": payer.id()})).await?,
        "E_LARGE",
    );
    // a withdrawal to an account not registered on the token fails and is restored
    let o_before = env.overview(&ada.vault_id).await?;
    let r = owner_call(&ada, "withdraw", json!({"pot_id": 0, "token": "usdt", "amount": USDT.to_string(), "to": "nobody.test.near"})).await?;
    assert!(events(&r, "withdrawn").is_empty());
    let o_after = env.overview(&ada.vault_id).await?;
    assert_eq!(pot_bal(&o_after, 0, "usdt"), pot_bal(&o_before, 0, "usdt"));
    assert_eq!(o_after["accounted"], o_before["accounted"]);

    // ---------------------------------------------------------------- agent
    let shop = env.new_account("shop").await?;
    let evil = env.new_account("evil").await?;
    env.storage_register(&env.usdt, shop.id()).await?;
    env.storage_register(&env.usdt, evil.id()).await?;
    let agent_sk = SecretKey::from_random(KeyType::ED25519);
    let agent_pk = agent_sk.public_key();
    let expires = env.now().await? + 30 * 86_400_000_000_000;
    let r = app_call(
        &ada,
        "add_agent",
        json!({"public_key": agent_pk, "policy": {
            "label": "Bill payer", "agent_name": "scripted-bot", "agent_url": "",
            "scopes": ["read", "propose", "act"], "allowed_actions": ["pay"],
            "allowlist": [{"type": "near", "account_id": shop.id()}],
            "per_tx": (5 * USDT).to_string(), "daily": (5 * USDT).to_string(), "weekly": (5 * USDT).to_string(),
            "expires_at": expires.to_string()
        }}),
    )
    .await?;
    assert_ok(&r);
    let vkeys = env.worker.view_access_keys(&ada.vault_id).await?;
    assert_eq!(vkeys.len(), 1);
    assert_eq!(env.full_access_keys(&ada.vault_id).await?, 0);
    match &vkeys[0].access_key.permission {
        AccessKeyPermission::FunctionCall(f) => {
            assert_eq!(f.receiver_id, ada.vault_id.as_str());
            assert_eq!(f.method_names, vec!["agent_execute".to_string(), "agent_propose".to_string()]);
        }
        _ => panic!("agent key must be a function-call key"),
    }
    let agent = Account::from_secret_key(ada.vault_id.clone(), agent_sk, &env.worker);
    let pay = |to: &str, amt: u128| json!({"action": {"type": "pay", "token": "usdt", "amount": amt.to_string(), "to": to, "memo": null}});
    let exec = |args: serde_json::Value| {
        let agent = agent.clone();
        let vid = ada.vault_id.clone();
        async move { agent.call(&vid, "agent_execute").args_json(args).gas(Gas::from_tgas(60)).transact().await }
    };
    let r = exec(pay(shop.id().as_str(), 3 * USDT)).await?;
    assert_ok(&r);
    let act = events(&r, "agent_action");
    assert_eq!(act[0]["remaining_day"], (2 * USDT).to_string());
    assert!(events(&r, "agent_cap_warning").is_empty());
    assert_eq!(env.token_balance(&env.usdt, shop.id()).await?, 3 * USDT);
    assert_fails_with(&exec(pay(shop.id().as_str(), 6 * USDT)).await?, "E_CAP_PER_TX");
    assert_fails_with(&exec(pay(shop.id().as_str(), 3 * USDT)).await?, "E_CAP_DAY");
    assert_fails_with(&exec(pay(evil.id().as_str(), USDT)).await?, "E_NOT_ALLOWLISTED");
    assert_fails_with(
        &exec(json!({"action": {"type": "save", "to_pot": savings, "token": "usdt", "amount": "1"}})).await?,
        "E_ACTION_NOT_ALLOWED",
    );
    // agent can't call owner methods (key restricted) and owner key can't call agent methods
    let r = agent.call(&ada.vault_id, "withdraw").args_json(json!({"pot_id": 0, "token": "usdt", "amount": "1", "to": evil.id()})).transact().await;
    assert!(r.is_err() || !r.unwrap().is_success());
    assert_fails_with(&owner_call(&ada, "agent_execute", pay(shop.id().as_str(), 1)).await?, "E_NOT_SELF");

    // bill paid by the agent (payee allowlisted) — crosses 80% of the daily cap
    let bill_id: u64 = app_call(
        &ada,
        "add_bill",
        json!({"name": "Internet", "amount": (1 * USDT).to_string(), "token": "usdt", "due_day": 5, "payee": shop.id(), "pot_id": bills_pot}),
    )
    .await?
    .json()?;
    let r = exec(json!({"action": {"type": "pay_bill", "bill_id": bill_id}})).await?;
    assert_ok(&r);
    assert_eq!(events(&r, "bill_paid")[0]["by"], format!("agent:{}", agent_pk));
    let warn = events(&r, "agent_cap_warning");
    assert_eq!(warn.len(), 2, "day and week both crossed 80%: {warn:?}");
    assert_eq!(env.token_balance(&env.usdt, shop.id()).await?, 4 * USDT);
    assert_fails_with(&owner_call(&ada, "pay_bill", json!({"id": bill_id})).await?, "E_BILL_PAID");

    // propose -> approve (owner authority: allowlist does not apply)
    let r = agent
        .call(&ada.vault_id, "agent_propose")
        .args_json(json!({"action": {"type": "pay", "token": "usdt", "amount": (4 * USDT).to_string(), "to": evil.id(), "memo": "refund"}, "reason": "customer refund"}))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    assert_ok(&r);
    let pid: u64 = r.json()?;
    let props: serde_json::Value = env.worker.view(&ada.vault_id, "get_proposals").args_json(json!({"include_closed": false})).await?.json()?;
    assert_eq!(props.as_array().unwrap().len(), 1);
    let r = owner_call(&ada, "approve_proposal", json!({"id": pid})).await?;
    assert_ok(&r);
    assert_eq!(events(&r, "withdrawn")[0]["by"], format!("proposal:{}", pid));
    assert_eq!(env.token_balance(&env.usdt, evil.id()).await?, 4 * USDT);
    assert_fails_with(&owner_call(&ada, "approve_proposal", json!({"id": pid})).await?, "E_PROPOSAL_CLOSED");
    // reject path
    let r = agent
        .call(&ada.vault_id, "agent_propose")
        .args_json(json!({"action": {"type": "pay", "token": "usdt", "amount": "1", "to": evil.id(), "memo": null}, "reason": "x"}))
        .transact()
        .await?;
    let pid2: u64 = r.json()?;
    assert_ok(&owner_call(&ada, "reject_proposal", json!({"id": pid2})).await?);

    // revoke deletes the key
    let r = owner_call(&ada, "revoke_agent", json!({"public_key": agent_pk})).await?;
    assert_ok(&r);
    assert_eq!(events(&r, "agent_revoked").len(), 1);
    assert_eq!(env.worker.view_access_keys(&ada.vault_id).await?.len(), 0);
    assert_eq!(env.full_access_keys(&ada.vault_id).await?, 0);
    assert!(exec(pay(shop.id().as_str(), 1)).await.is_err() || !exec(pay(shop.id().as_str(), 1)).await?.is_success());

    // ---------------------------------------------------------------- earn guard
    let inner = |x: u128| (x * 1_000_000_000_000u128).to_string();
    let set_state = |sup: u128, bor: u128| {
        let relayer = env.relayer.clone();
        let lending = env.lending.id().clone();
        async move {
            relayer
                .call(&lending, "set_state")
                .args_json(json!({"token_id": "usdt.oiko.test.near", "supplied": inner(sup), "borrowed": inner(bor), "apy_bps": 1384}))
                .transact()
                .await
        }
    };
    assert_ok(&set_state(1_000_000 * USDT, 930_000 * USDT).await?);
    assert_fails_with(&owner_call(&ada, "earn_on", json!({"pot_id": 0, "token": "usdt", "amount": USDT.to_string()})).await?, "E_FLEX_EARN");
    let r = owner_call(&ada, "earn_on", json!({"pot_id": savings, "token": "usdt", "amount": (10 * USDT).to_string()})).await?;
    assert_ok(&r);
    let refused = events(&r, "earn_refused");
    assert_eq!(refused[0]["utilization_bps"], 9300);
    let o = env.overview(&ada.vault_id).await?;
    assert_eq!(pot_bal(&o, savings, "usdt"), 22 * USDT);
    assert_eq!(o["earning"]["usdt"], "0");

    assert_ok(&set_state(1_000_000 * USDT, 500_000 * USDT).await?);
    let r = owner_call(&ada, "earn_on", json!({"pot_id": savings, "token": "usdt", "amount": (10 * USDT).to_string()})).await?;
    assert_ok(&r);
    assert_eq!(events(&r, "earn_supplied")[0]["utilization_bps"], 5000);
    let o = env.overview(&ada.vault_id).await?;
    assert_eq!(pot_bal(&o, savings, "usdt"), 12 * USDT);
    assert_eq!(o["earning"]["usdt"], (10 * USDT).to_string());
    let la: serde_json::Value = env.lending.view("get_account").args_json(json!({"account_id": ada.vault_id})).await?.json()?;
    assert_eq!(la["supplied"][0]["balance"], inner(10 * USDT));
    assert_eq!(env.token_balance(&env.usdt, &ada.vault_id).await?, o["accounted"]["usdt"].as_str().unwrap().parse::<u128>()?);

    let r = owner_call(&ada, "earn_off", json!({"pot_id": savings, "token": "usdt", "amount": (10 * USDT).to_string()})).await?;
    assert_ok(&r);
    // tokens come back by plain ft_transfer; the callback's balance read (or a sync) credits them
    let _ = owner_call(&ada, "sync", json!({})).await?;
    let o = env.overview(&ada.vault_id).await?;
    assert_eq!(pot_bal(&o, savings, "usdt"), 22 * USDT, "{o}");
    assert_eq!(o["earning"]["usdt"], "0");

    // ---------------------------------------------------------------- invariants / views
    let o = env.overview(&ada.vault_id).await?;
    let sum: u128 = o["pots"].as_array().unwrap().iter().map(|p| p["balances"]["usdt"].as_str().unwrap().parse::<u128>().unwrap()).sum();
    assert_eq!(o["accounted"]["usdt"].as_str().unwrap().parse::<u128>()?, sum);
    assert_eq!(env.token_balance(&env.usdt, &ada.vault_id).await?, sum);
    let act: serde_json::Value = env.worker.view(&ada.vault_id, "get_activity").args_json(json!({"from_seq": null, "limit": 50})).await?.json()?;
    assert!(act.as_array().unwrap().len() > 10);
    let month = env.worker.view(&ada.vault_id, "get_month_stats").args_json(json!({"from_month": 202001, "to_month": 202212})).await?.json::<serde_json::Value>()?;
    assert_eq!(month.as_array().unwrap().len(), 36);

    // rescue_sign needs a deposit, so the app key can't call it; the full-access key can
    // (the sandbox has no MPC signer, so only argument validation is exercised here)
    let r = ada
        .owner
        .call(&ada.vault_id, "rescue_sign")
        .args_json(json!({"chain": "doge", "payload": "00".repeat(32)}))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?;
    assert_fails_with(&r, "E_BAD_CHAIN");

    println!(
        "storage: vault {} bytes, name account {} bytes",
        env.worker.view_account(&ada.vault_id).await?.storage_usage,
        env.worker.view_account(ada.owner.id()).await?.storage_usage
    );
    println!("vault balance after test: {}", env.worker.view_account(&ada.vault_id).await?.balance);
    println!("name account balance after test: {}", env.worker.view_account(ada.owner.id()).await?.balance);
    Ok(())
}
