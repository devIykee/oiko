//! Veil (private labels, docs/PRIVACY.md) against the real vault wasm in near-sandbox: sealed 38-character tokens
//! from the SDK pass the deployed contract's JSON parser and 40-character limits, are stored and returned unchanged,
//! and are what the public record (state, events, activity) shows instead of the name.

use oiko_tests::*;
use serde_json::json;

const SEALED_NAME: &str = "🔒䵁噒많猜넖骤돤뵍雁뗅澸鑷侳襐懅铁뱛㮀늍胁鄚꽷㳲居鬆醙㔘믦瞩琖귭冚眿뤪歚癰瑀";
const SEALED_BILL: &str = "🔒㥺帼藇峂婦廠谭螣芎鞊赊劉莳誅蕰㢎飤髚鋥鉍귒搴燸綏犸㤈瀐䂫넑斛䑠꺫瘐圹犲致豀";

#[tokio::test]
async fn sealed_labels_on_the_real_vault() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let u = env.user_with_vault("ada", &env.relayer, 0).await?;

    // create_pot with the app key, raw UTF-8 JSON (what JSON.stringify sends)
    let r = app_call(&u, "create_pot", json!({"name": SEALED_NAME, "icon": SEALED_BILL, "color": "rose", "kind": "goal", "target": null, "target_date": null})).await?;
    assert_ok(&r);
    let ev = events(&r, "pot_created");
    assert_eq!(ev[0]["name"], SEALED_NAME, "the event carries the token, not a name");
    let pot_id = ev[0]["pot_id"].as_u64().unwrap();

    // update_pot with \u escapes (surrogate pair for the marker)
    let escaped: String = SEALED_BILL.encode_utf16().map(|c| format!("\\u{:04x}", c)).collect();
    let body = format!(r#"{{"pot_id":{},"name":"{}"}}"#, pot_id, escaped);
    let r = u.app.call(&u.vault_id, "update_pot").args(body.into_bytes()).gas(near_workspaces::types::Gas::from_tgas(30)).transact().await?;
    assert_ok(&r);

    // add_bill
    let r = app_call(&u, "add_bill", json!({"name": SEALED_NAME, "amount": "1000000", "token": "usdt", "due_day": 3, "payee": env.relayer.id(), "pot_id": 0})).await?;
    assert_ok(&r);

    let ov = env.overview(&u.vault_id).await?;
    assert_eq!(pot_by_id(&ov, pot_id)["name"], SEALED_BILL);
    assert_eq!(pot_by_id(&ov, pot_id)["icon"], SEALED_BILL);
    assert_eq!(ov["bills"][0]["name"], SEALED_NAME);
    let act: serde_json::Value = env.worker.view(&u.vault_id, "get_activity").args_json(json!({"from_seq": null, "limit": 20})).await?.json()?;
    assert!(act.as_array().unwrap().iter().any(|a| a["note"] == SEALED_NAME));

    // the limit still applies: Veil never needs a looser one
    let r = app_call(&u, "add_bill", json!({"name": format!("{SEALED_NAME}xyz"), "amount": "1", "token": "usdt", "due_day": 3, "payee": env.relayer.id(), "pot_id": 0})).await?;
    assert_fails_with(&r, "E_BAD_INPUT");
    Ok(())
}
