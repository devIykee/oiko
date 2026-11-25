//! VM-level unit tests (near-sdk unit-testing). Pure-logic and property tests live in core.rs.
use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

const T0: u64 = 1_793_361_600_000_000_000; // 2026-10-30T12:00:00Z

fn a(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(pred: &str, ts: u64) -> VMContextBuilder {
    let mut c = VMContextBuilder::new();
    c.current_account_id(a("vault.ada.oiko.test.near"))
        .predecessor_account_id(a(pred))
        .signer_account_id(a(pred))
        .block_timestamp(ts)
        .account_balance(NearToken::from_near(5))
        .prepaid_gas(Gas::from_tgas(300));
    c
}

fn cfg() -> Config {
    Config {
        max_utilization_bps: 9200,
        large_withdrawal_threshold: U128(1_000_000_000),
        lending: Some(a("lending.oiko.test.near")),
        ajo: Some(a("ajo.oiko.test.near")),
        mpc_signer: Some(a("v1.signer-prod.testnet")),
        agent_allowance: U128(250_000_000_000_000_000_000_000),
    }
}

fn setup() -> Vault {
    testing_env!(ctx("ada.oiko.test.near", T0).build());
    Vault::new_t(a("ada.oiko.test.near"), a("usdc.oiko.test.near"), a("usdt.oiko.test.near"), cfg())
}

fn panics<F: FnOnce()>(f: F) -> String {
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f));
    match r {
        Ok(_) => String::new(),
        Err(e) => e
            .downcast_ref::<String>()
            .cloned()
            .or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string()))
            .unwrap_or_default(),
    }
}

fn credit_via_sync(v: &mut Vault, t: Token, real: u128) -> u128 {
    testing_env!(ctx("vault.ada.oiko.test.near", T0).build());
    let e = v.ledger.epoch[t.idx()];
    let q = v.ledger.earn_seq[t.idx()];
    v.on_balance(t, e, q, None, false, Ok(U128(real))).0
}

#[test]
fn init_creates_flex_and_checks_account() {
    let v = setup();
    assert_eq!(v.get_overview().pots.len(), 1);
    assert_eq!(v.get_overview().pots[0].kind, PotKind::Flex);
    assert_eq!(v.version(), "1.0.0");
    testing_env!(ctx("bob.oiko.test.near", T0).build());
    let e = panics(|| {
        Vault::new_t(a("ada.oiko.test.near"), a("usdc.oiko.test.near"), a("usdt.oiko.test.near"), cfg());
    });
    assert!(e.contains("E_BAD_INIT"), "{e}");
}

#[test]
fn owner_only_and_sync_idempotent() {
    let mut v = setup();
    testing_env!(ctx("ada.oiko.test.near", T0).build());
    let save = v.create_pot_t("Savings".into(), "".into(), "".into(), PotKind::Autosave, None, None);
    v.set_splits_t(vec![SplitRule { pot_id: save, mode: SplitMode::Percent, value: U128(2500) }]);
    testing_env!(ctx("eve.near", T0).build());
    assert!(panics(|| {
        v.create_pot_t("x".into(), "".into(), "".into(), PotKind::Goal, None, None);
    })
    .contains("E_NOT_OWNER"));
    assert_eq!(credit_via_sync(&mut v, Token::Usdt, 100_000_000), 100_000_000);
    assert_eq!(credit_via_sync(&mut v, Token::Usdt, 100_000_000), 0);
    assert_eq!(v.get_pot_t(save).unwrap().balances.usdt.0, 25_000_000);
    assert_eq!(v.get_pot_t(0).unwrap().balances.usdt.0, 75_000_000);
    let stats = v.get_month_stats_t(202610, 202611);
    assert_eq!(stats[0].in_.usdt.0, 100_000_000);
    assert_eq!(stats[0].saved.usdt.0, 25_000_000);
    assert_eq!(stats[1].month, 202611);
    let act = v.get_activity_t(None, 10);
    assert!(act.iter().any(|x| x.kind == "deposit_received"));
    assert!(act.iter().any(|x| x.kind == "split_applied" && x.pot_id == Some(save)));
}

#[test]
fn withdraw_threshold_and_lock() {
    let mut v = setup();
    credit_via_sync(&mut v, Token::Usdc, 5_000_000_000);
    testing_env!(ctx("ada.oiko.test.near", T0).build());
    let e = panics(|| {
        let _ = v.withdraw_t(0, Token::Usdc, U128(2_000_000_000), a("bob.near"), None);
    });
    assert!(e.contains("E_LARGE"), "{e}");
    let rainy = v.create_pot_t("Rainy".into(), "".into(), "".into(), PotKind::Locked, None, None);
    v.move_funds_t(0, rainy, Token::Usdc, U128(10));
    v.lock_t(rainy, U64(T0 + 60_000_000_000));
    assert!(panics(|| {
        let _ = v.withdraw_t(rainy, Token::Usdc, U128(1), a("bob.near"), None);
    })
    .contains("E_LOCKED"));
    assert!(panics(|| v.move_funds_t(rainy, 0, Token::Usdc, U128(1))).contains("E_LOCKED"));
    testing_env!(ctx("ada.oiko.test.near", T0 + 61_000_000_000).build());
    v.move_funds_t(rainy, 0, Token::Usdc, U128(10));
}

#[test]
fn earn_guard_refuses_and_flex_earn() {
    let mut v = setup();
    credit_via_sync(&mut v, Token::Usdc, 100);
    testing_env!(ctx("ada.oiko.test.near", T0).build());
    assert!(panics(|| {
        let _ = v.earn_on_t(0, Token::Usdc, U128(1));
    })
    .contains("E_FLEX_EARN"));
    let s = v.create_pot_t("S".into(), "".into(), "".into(), PotKind::Autosave, None, None);
    v.move_funds_t(0, s, Token::Usdc, U128(50));
    testing_env!(ctx("vault.ada.oiko.test.near", T0).build());
    let asset = LAsset {
        supplied: LPool { balance: U128(1000) },
        borrowed: LPool { balance: U128(930) },
        config: LAssetConfig { extra_decimals: 12 },
    };
    v.ledger.earn_state[0] = 1;
    match v.on_earn_guard(s, Token::Usdc, 50, Ok(Some(asset)), Ok(None)) {
        PromiseOrValue::Value(b) => assert!(!b),
        _ => panic!("expected refusal"),
    }
    assert_eq!(v.get_pot_t(s).unwrap().balances.usdc.0, 50);
    assert_eq!(v.ledger.earn_state[0], 0, "refusal must release the earn lock");
}

#[test]
fn earn_is_serialized_per_token() {
    let mut v = setup();
    credit_via_sync(&mut v, Token::Usdc, 100);
    testing_env!(ctx("ada.oiko.test.near", T0).build());
    let s = v.create_pot_t("S".into(), "".into(), "".into(), PotKind::Autosave, None, None);
    v.move_funds_t(0, s, Token::Usdc, U128(50));
    let _ = v.earn_on_t(s, Token::Usdc, U128(10));
    assert!(panics(|| {
        let _ = v.earn_on_t(s, Token::Usdc, U128(10));
    })
    .contains("E_EARN_BUSY"));
    // the other token is independent
    assert_eq!(v.ledger.earn_state[1], 0);
}

#[test]
fn large_guards_for_app_key() {
    let mut v = setup();
    testing_env!(ctx("ada.oiko.test.near", T0).build());
    let pk: PublicKey = "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp".parse().unwrap();
    let policy = AgentPolicyInput {
        label: "".into(),
        agent_name: "bot".into(),
        agent_url: "".into(),
        scopes: vec![Scope::Act],
        allowed_actions: vec![AgentKind::Pay],
        allowlist: vec![],
        per_tx: U128(1),
        daily: U128(1),
        weekly: U128(2_000_000_000),
        expires_at: U64(T0 + NS_PER_DAY),
    };
    assert!(panics(|| v.add_agent_t(pk.clone(), policy.clone())).contains("E_LARGE"));
    v.add_agent_large_t(pk.clone(), policy);
    assert!(v.get_agent_t(pk).is_some());
}

#[test]
fn agent_calls_must_be_self_signed() {
    let mut v = setup();
    testing_env!(ctx("ada.oiko.test.near", T0).build());
    let e = panics(|| {
        let _ = v.agent_execute_t(AgentAction::Save { to_pot: 1, token: Token::Usdc, amount: U128(1) });
    });
    assert!(e.contains("E_NOT_SELF"), "{e}");
}

#[test]
fn rescue_validates() {
    let mut v = setup();
    testing_env!(ctx("ada.oiko.test.near", T0).build());
    assert!(panics(|| {
        let _ = v.rescue_sign_t("btc".into(), "00".repeat(32));
    })
    .contains("E_BAD_CHAIN"));
    assert!(panics(|| {
        let _ = v.rescue_sign_t("evm".into(), "zz".into());
    })
    .contains("E_BAD_PAYLOAD"));
    assert!(panics(|| {
        let _ = v.rescue_sign_t("evm".into(), "ab".repeat(32));
    })
    .contains("E_DEPOSIT"));
    assert_eq!(v.get_rescue_path_t("tron".into()), "oiko-rescue-v1/tron");
}

#[test]
fn schedules_run_once_per_period() {
    let mut v = setup();
    credit_via_sync(&mut v, Token::Usdc, 100);
    testing_env!(ctx("ada.oiko.test.near", T0).build());
    let s = v.create_pot_t("S".into(), "".into(), "".into(), PotKind::Autosave, None, None);
    assert!(panics(|| {
        v.add_schedule_t(s, Token::Usdc, U128(10), U64(1_000), U64(T0));
    })
    .contains("E_BAD_PERIOD"));
    let p = 60_000_000_000;
    v.add_schedule_t(s, Token::Usdc, U128(40), U64(p), U64(T0));
    testing_env!(ctx("anyone.near", T0 + 5).build());
    assert_eq!(v.run_schedules(), 1);
    assert_eq!(v.run_schedules(), 0); // same period: no second run
    // three periods later it runs once and skips the missed periods
    testing_env!(ctx("anyone.near", T0 + 3 * p + 5).build());
    assert_eq!(v.run_schedules(), 1);
    assert_eq!(v.get_pot_t(s).unwrap().balances.usdc.0, 80);
    assert_eq!(v.get_overview().schedules[0].next_run.0, T0 + 4 * p);
    // flex too low: skipped, retried later
    testing_env!(ctx("anyone.near", T0 + 4 * p + 5).build());
    assert_eq!(v.run_schedules(), 0);
    assert_eq!(v.get_overview().schedules[0].next_run.0, T0 + 4 * p);
}

#[test]
fn bills_validate_due_day() {
    let mut v = setup();
    testing_env!(ctx("ada.oiko.test.near", T0).build());
    assert!(panics(|| {
        v.add_bill_t("Rent".into(), U128(1), Token::Usdt, 29, a("landlord.near"), 0);
    })
    .contains("E_BAD_DUE_DAY"));
    let id = v.add_bill_t("Rent".into(), U128(1), Token::Usdt, 28, a("landlord.near"), 0);
    // flex has no USDT yet
    assert!(panics(|| {
        let _ = v.pay_bill_t(id);
    })
    .contains("E_INSUFFICIENT"));
}

// Veil (packages/sdk/src/veil.ts) seals pot and bill names in the browser. These are real tokens from the SDK:
// 38 characters (one 🔒 + 37 CJK/Hangul), within the deployed vault's 40-character limit, so no contract change is needed.
const SEALED_NAME: &str = "🔒䵁噒많猜넖骤돤뵍雁뗅澸鑷侳襐懅铁뱛㮀늍胁鄚꽷㳲居鬆醙㔘믦瞩琖귭冚眿뤪歚癰瑀";
const SEALED_BILL: &str = "🔒㥺帼藇峂婦廠谭螣芎鞊赊劉莳誅蕰㢎飤髚鋥鉍귒搴燸綏犸㤈瀐䂫넑斛䑠꺫瘐圹犲致豀";

fn with_input(body: String) -> near_sdk::VMContext {
    let mut c = ctx("ada.oiko.test.near", T0).build();
    c.input = std::rc::Rc::from(body.into_bytes().into_boxed_slice());
    c
}

#[test]
fn veil_tokens_fit_and_round_trip_through_json_args() {
    assert_eq!(SEALED_NAME.chars().count(), 38);
    let mut v = setup();
    // raw UTF-8, as JSON.stringify sends it
    let body = format!(r##"{{"name":"{}","icon":"{}","color":"#000000","kind":"goal","target":null,"target_date":null}}"##, SEALED_NAME, SEALED_BILL);
    testing_env!(with_input(body));
    let id = v.create_pot();
    let p = v.get_pot_t(id).unwrap();
    assert_eq!(p.name, SEALED_NAME);
    assert_eq!(p.icon, SEALED_BILL);
    // the activity note (truncated to 40 characters) keeps the whole token
    let act = v.get_activity_t(None, 10);
    assert!(act.iter().any(|a| a.note.as_deref() == Some(SEALED_NAME)));
    // \u escapes with a surrogate pair, as some JSON encoders send it
    let escaped: String = SEALED_BILL
        .encode_utf16()
        .map(|u| format!("\\u{:04x}", u))
        .collect();
    let body = format!(r#"{{"pot_id":{},"name":"{}"}}"#, id, escaped);
    testing_env!(with_input(body));
    v.update_pot();
    assert_eq!(v.get_pot_t(id).unwrap().name, SEALED_BILL);
    // bills
    testing_env!(ctx("ada.oiko.test.near", T0).build());
    let b = v.add_bill_t(SEALED_BILL.into(), U128(1), Token::Usdt, 3, a("landlord.near"), 0);
    assert_eq!(v.get_overview().bills.iter().find(|x| x.id == b).unwrap().name, SEALED_BILL);
    // one character too many is still refused: Veil never relies on a looser limit
    let too_long = format!("{}xxx", SEALED_NAME);
    assert!(panics(|| {
        v.add_bill_t(too_long.clone(), U128(1), Token::Usdt, 3, a("landlord.near"), 0);
    })
    .contains("E_BAD_INPUT"));
}
