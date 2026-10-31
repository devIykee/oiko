//! Three vaults run a full ajo circle; one already-paid member defaults and is covered by bond.

use oiko_tests::*;
use serde_json::{json, Value};
use sha2::Digest;

#[tokio::test]
async fn ajo_three_member_cycle_with_default() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let payer = env.new_account("payer").await?;
    env.mint(&env.usdt, payer.id(), 1_000 * USDT).await?;
    let ada = env.user_with_vault("ada", &payer, 100 * USDT).await?;
    let bola = env.user_with_vault("bola", &payer, 100 * USDT).await?;
    let chi = env.user_with_vault("chi", &payer, 100 * USDT).await?;
    for u in [&ada, &bola, &chi] {
        let o = env.overview(&u.vault_id).await?;
        assert_eq!(pot_bal(&o, 0, "usdt"), 100 * USDT);
        assert_eq!(env.worker.view_access_keys(&u.vault_id).await?.len(), 0);
    }

    let code_hash = hex(&sha2::Sha256::digest(b"join-me"));
    let period: u64 = 60_000_000_000;
    // period below the minimum is refused
    let r = owner_call(&ada, "ajo_create", json!({"name": "Friends", "token": "usdt", "amount_per_round": (10 * USDT).to_string(),
        "period_ns": "1000", "max_members": 3, "bond_amount": (10 * USDT).to_string(), "shuffle": false, "invite_code_hash": code_hash})).await?;
    assert_fails_with(&r, "E_BAD_PERIOD");
    let r = owner_call(&ada, "ajo_create", json!({"name": "Friends", "token": "usdt", "amount_per_round": (10 * USDT).to_string(),
        "period_ns": period.to_string(), "max_members": 3, "bond_amount": (10 * USDT).to_string(), "shuffle": false, "invite_code_hash": code_hash})).await?;
    assert_ok(&r);
    let id: u64 = r.json()?;
    assert_fails_with(&owner_call(&bola, "ajo_join", json!({"circle_id": id, "invite_code": "wrong"})).await?, "E_BAD_INVITE");
    assert_ok(&owner_call(&bola, "ajo_join", json!({"circle_id": id, "invite_code": "join-me"})).await?);
    assert_ok(&owner_call(&chi, "ajo_join", json!({"circle_id": id, "invite_code": "join-me"})).await?);
    // start refuses before the early collectors post bonds
    assert!(!owner_call(&ada, "ajo_start", json!({"circle_id": id})).await?.is_success());
    for u in [&ada, &bola, &chi] {
        assert_ok(&owner_call(u, "ajo_post_bond", json!({"circle_id": id, "token": "usdt", "amount": (10 * USDT).to_string()})).await?);
    }
    assert_ok(&owner_call(&ada, "ajo_start", json!({"circle_id": id})).await?);
    let c: Value = env.ajo.view("get_circle").args_json(json!({"id": id})).await?.json()?;
    assert_eq!(c["status"], "active");
    assert_eq!(c["order"], json!([ada.vault_id, bola.vault_id, chi.vault_id]));
    let start: u64 = c["start_at"].as_str().unwrap().parse()?;

    let settle = || payer.call(env.ajo.id(), "settle_round").args_json(json!({"circle_id": id})).max_gas().transact();

    // round 0: everyone pays, ada collects
    for u in [&ada, &bola, &chi] {
        assert_ok(&owner_call(u, "ajo_contribute", json!({"circle_id": id, "token": "usdt", "amount": (10 * USDT).to_string()})).await?);
    }
    assert_fails_with(&settle().await?, "E_TOO_EARLY");
    env.advance_to(start + period + 1_000_000_000).await?;
    let r = settle().await?;
    assert_ok(&r);
    // the payout reached ada's vault through ft_on_transfer in the same transaction
    assert_eq!(events(&r, "deposit_received")[0]["sender_id"], env.ajo.id().as_str());

    // round 1: ada (already paid out) defaults; her bond covers it
    for u in [&bola, &chi] {
        assert_ok(&owner_call(u, "ajo_contribute", json!({"circle_id": id, "token": "usdt", "amount": (10 * USDT).to_string()})).await?);
    }
    env.advance_to(start + 2 * period + 1_000_000_000).await?;
    assert_ok(&settle().await?);

    // round 2: everyone pays, chi collects, bonds returned
    for u in [&ada, &bola, &chi] {
        assert_ok(&owner_call(u, "ajo_contribute", json!({"circle_id": id, "token": "usdt", "amount": (10 * USDT).to_string()})).await?);
    }
    env.advance_to(start + 3 * period + 1_000_000_000).await?;
    assert_ok(&settle().await?);

    let c: Value = env.ajo.view("get_circle").args_json(json!({"id": id})).await?.json()?;
    assert_eq!(c["status"], "completed");
    assert_eq!(c["defaults"], json!([[1, ada.vault_id]]));
    assert_eq!(c["payouts"], json!([
        [0, ada.vault_id, (30 * USDT).to_string()],
        [1, bola.vault_id, (30 * USDT).to_string()],
        [2, chi.vault_id, (30 * USDT).to_string()],
    ]));
    assert_eq!(env.token_balance(&env.usdt, env.ajo.id()).await?, 0);

    // bonds came back by plain transfer; sync credits them
    for u in [&ada, &bola, &chi] {
        assert_ok(&owner_call(u, "sync", json!({})).await?);
    }
    // ada: 100 - 10 bond - 10 - 10 + 30 = 100 ; bola/chi: 100 - 10 - 30 + 30 + 10 = 100
    for u in [&ada, &bola, &chi] {
        let o = env.overview(&u.vault_id).await?;
        assert_eq!(pot_bal(&o, 0, "usdt"), 100 * USDT, "{}", u.name);
        assert_eq!(env.token_balance(&env.usdt, &u.vault_id).await?, 100 * USDT);
    }
    let mine: Value = env.ajo.view("get_circles_for").args_json(json!({"member": bola.vault_id})).await?.json()?;
    assert_eq!(mine.as_array().unwrap().len(), 1);
    Ok(())
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{:02x}", x)).collect()
}
