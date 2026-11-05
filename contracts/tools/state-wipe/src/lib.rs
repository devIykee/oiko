//! TESTNET MAINTENANCE TOOL — not part of Oiko. Deploy over a contract account, call `wipe` with
//! every storage key (from RPC `view_state`), then deploy the real contract with its init call.
//!
//! `wipe({"keys": [<base64 key>, ...]})` removes the given keys. Only the account itself
//! (a transaction signed with its own key) may call it. There is no state and no other method.
//! Raw exports (no `#[near]` state handling) so it works whatever borsh layout is stored.

#[allow(unused_imports)]
use near_sdk::env;
use near_sdk::json_types::Base64VecU8;
use near_sdk::serde::Deserialize;

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
#[allow(dead_code)]
struct Args {
    keys: Vec<Base64VecU8>,
}

#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub extern "C" fn wipe() {
    env::setup_panic_hook();
    if env::predecessor_account_id() != env::current_account_id() {
        env::panic_str("E_NOT_SELF: only the account itself can wipe its state");
    }
    let input = env::input().unwrap_or_default();
    let a: Args = near_sdk::serde_json::from_slice(&input)
        .unwrap_or_else(|_| env::panic_str("E_BAD_ARGS: expected {\"keys\": [base64, ...]}"));
    let mut removed: u64 = 0;
    for k in a.keys {
        if env::storage_remove(&k.0) {
            removed += 1;
        }
    }
    env::value_return(removed.to_string().as_bytes());
}

/// Number of bytes of storage the account uses (helps confirm the wipe).
#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub extern "C" fn used_bytes() {
    env::value_return(env::storage_usage().to_string().as_bytes());
}
