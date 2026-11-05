//! Shared helpers for Oiko contracts: NEP-297 events, the `Token` enum, `Balances`,
//! and a civil-date helper used for monthly statistics.

use near_sdk::json_types::U128;
use near_sdk::near;

pub mod args;

pub const EVENT_STANDARD: &str = "oiko";
pub const EVENT_VERSION: &str = "1.0.0";

/// Minimal JSON object writer used for events and cross-contract arguments. It keeps
/// `serde_json::Value` (and its map/float machinery) out of the contracts' wasm.
pub struct J {
    s: String,
    first: bool,
}

impl Default for J {
    fn default() -> Self {
        Self::new()
    }
}

/// Appends `v` as a JSON string literal.
pub fn json_str(out: &mut String, v: &str) {
    out.push('"');
    for c in v.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                const H: &[u8; 16] = b"0123456789abcdef";
                out.push_str("\\u00");
                out.push(H[(c as usize) >> 4] as char);
                out.push(H[(c as usize) & 15] as char);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

impl J {
    pub fn new() -> Self {
        J { s: String::from("{"), first: true }
    }
    fn key(&mut self, k: &str) {
        if !self.first {
            self.s.push(',');
        }
        self.first = false;
        self.s.push('"');
        self.s.push_str(k);
        self.s.push_str("\":");
    }
    /// string value
    pub fn s(mut self, k: &str, v: &str) -> Self {
        self.key(k);
        json_str(&mut self.s, v);
        self
    }
    /// optional string value (`null` when None)
    pub fn os(self, k: &str, v: Option<&str>) -> Self {
        match v {
            Some(v) => self.s(k, v),
            None => self.raw(k, "null"),
        }
    }
    /// plain JSON number
    pub fn n(mut self, k: &str, v: u64) -> Self {
        self.key(k);
        self.s.push_str(&v.to_string());
        self
    }
    /// optional JSON number
    pub fn on(self, k: &str, v: Option<u64>) -> Self {
        match v {
            Some(v) => self.n(k, v),
            None => self.raw(k, "null"),
        }
    }
    /// decimal string (`U128` / `U64` JSON encoding)
    pub fn u(mut self, k: &str, v: u128) -> Self {
        self.key(k);
        self.s.push('"');
        self.s.push_str(&v.to_string());
        self.s.push('"');
        self
    }
    /// optional decimal string
    pub fn ou(self, k: &str, v: Option<u128>) -> Self {
        match v {
            Some(v) => self.u(k, v),
            None => self.raw(k, "null"),
        }
    }
    pub fn b(self, k: &str, v: bool) -> Self {
        self.raw(k, if v { "true" } else { "false" })
    }
    /// raw JSON value (already encoded)
    pub fn raw(mut self, k: &str, v: &str) -> Self {
        self.key(k);
        self.s.push_str(v);
        self
    }
    pub fn end(mut self) -> String {
        self.s.push('}');
        self.s
    }
    pub fn bytes(self) -> Vec<u8> {
        self.end().into_bytes()
    }
}

/// Formats a NEP-297 log line. `data` is one JSON object.
pub fn event_line(event: &str, data: &str) -> String {
    let mut l = String::with_capacity(64 + data.len());
    l.push_str("EVENT_JSON:{\"standard\":\"");
    l.push_str(EVENT_STANDARD);
    l.push_str("\",\"version\":\"");
    l.push_str(EVENT_VERSION);
    l.push_str("\",\"event\":");
    json_str(&mut l, event);
    l.push_str(",\"data\":[");
    l.push_str(data);
    l.push_str("]}");
    l
}

/// Emits a NEP-297 event: `EVENT_JSON:{"standard":"oiko","version":"1.0.0","event":..,"data":[data]}`.
pub fn emit(event: &str, data: J) {
    near_sdk::env::log_str(&event_line(event, &data.end()));
}

/// Builds a stable error string `CODE: message`.
pub fn err(code: &str, msg: impl AsRef<str>) -> String {
    format!("{}: {}", code, msg.as_ref())
}

/// Panics with a stable error code.
pub fn fail(code: &str, msg: impl AsRef<str>) -> ! {
    near_sdk::env::panic_str(&err(code, msg))
}

/// `require!` with a stable error code.
#[macro_export]
macro_rules! ensure {
    ($cond:expr, $code:expr, $($arg:tt)+) => {
        if !$cond {
            $crate::fail($code, format!($($arg)+));
        }
    };
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Token {
    Usdc,
    Usdt,
}

impl Token {
    pub const ALL: [Token; 2] = [Token::Usdc, Token::Usdt];
    pub fn idx(self) -> usize {
        match self {
            Token::Usdc => 0,
            Token::Usdt => 1,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Token::Usdc => "usdc",
            Token::Usdt => "usdt",
        }
    }
}

/// `{ "usdc": U128, "usdt": U128 }`
#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Balances {
    pub usdc: U128,
    pub usdt: U128,
}

impl Balances {
    pub fn get(&self, t: Token) -> u128 {
        match t {
            Token::Usdc => self.usdc.0,
            Token::Usdt => self.usdt.0,
        }
    }
    pub fn set(&mut self, t: Token, v: u128) {
        match t {
            Token::Usdc => self.usdc = U128(v),
            Token::Usdt => self.usdt = U128(v),
        }
    }
    /// Checked add; returns Err on overflow.
    pub fn add(&mut self, t: Token, v: u128) -> Result<(), String> {
        let n = self
            .get(t)
            .checked_add(v)
            .ok_or_else(|| err("E_OVERFLOW", "balance overflow"))?;
        self.set(t, n);
        Ok(())
    }
    /// Checked sub; returns `E_INSUFFICIENT` on underflow.
    pub fn sub(&mut self, t: Token, v: u128) -> Result<(), String> {
        let have = self.get(t);
        let n = have.checked_sub(v).ok_or_else(|| {
            err(
                "E_INSUFFICIENT",
                format!("need {} {} but only {} available", v, t.as_str(), have),
            )
        })?;
        self.set(t, n);
        Ok(())
    }
    pub fn sum(&self) -> u128 {
        self.usdc.0.saturating_add(self.usdt.0)
    }
    pub fn is_zero(&self) -> bool {
        self.usdc.0 == 0 && self.usdt.0 == 0
    }
}

pub const NS_PER_DAY: u64 = 86_400_000_000_000;
pub const NS_PER_WEEK: u64 = 7 * NS_PER_DAY;

/// Converts days since 1970-01-01 to (year, month 1..=12, day 1..=31).
/// Howard Hinnant's `civil_from_days` algorithm (proleptic Gregorian calendar).
pub fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Inverse of `civil_from_days` (used only in tests).
pub fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u64;
    let mp = if m > 2 { m - 3 } else { m + 9 } as u64;
    let doy = (153 * mp + 2) / 5 + d as u64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe as i64 - 719_468
}

/// `yyyymm` for a nanosecond UNIX timestamp (UTC).
pub fn yyyymm(ts_ns: u64) -> u32 {
    let (y, m, _) = civil_from_days((ts_ns / NS_PER_DAY) as i64);
    (y as u32) * 100 + m
}

/// Day of month (1..=31) for a nanosecond UNIX timestamp (UTC).
pub fn day_of_month(ts_ns: u64) -> u32 {
    civil_from_days((ts_ns / NS_PER_DAY) as i64).2
}

/// Next month after `yyyymm`.
pub fn next_month(m: u32) -> u32 {
    if m % 100 >= 12 {
        (m / 100 + 1) * 100 + 1
    } else {
        m + 1
    }
}

/// floor(amount * bps / 10_000) without overflow for any u128 amount and bps <= 10_000.
pub fn apply_bps(amount: u128, bps: u128) -> u128 {
    (amount / 10_000) * bps + (amount % 10_000) * bps / 10_000
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn known_dates() {
        assert_eq!(yyyymm(0), 197001);
        // 2026-10-30T12:00:00Z = 1793361600
        assert_eq!(yyyymm(1_793_361_600 * 1_000_000_000), 202610);
        // 2024-02-29T23:59:59Z = 1709251199
        assert_eq!(yyyymm(1_709_251_199 * 1_000_000_000), 202402);
        assert_eq!(day_of_month(1_709_251_199 * 1_000_000_000), 29);
        // 2024-03-01T00:00:00Z = 1709251200
        assert_eq!(yyyymm(1_709_251_200 * 1_000_000_000), 202403);
        // 2000-12-31T23:59:59Z = 978307199
        assert_eq!(yyyymm(978_307_199 * 1_000_000_000), 200012);
        assert_eq!(yyyymm(978_307_200 * 1_000_000_000), 200101);
        assert_eq!(next_month(202612), 202701);
        assert_eq!(next_month(202601), 202602);
    }

    #[test]
    fn event_format() {
        let l = event_line("vault_created", &J::new().s("vault_id", "v").s("owner", "o\"\n\u{1}").u("amount", 5).n("id", 7).os("x", None).end());
        assert_eq!(
            l,
            r#"EVENT_JSON:{"standard":"oiko","version":"1.0.0","event":"vault_created","data":[{"vault_id":"v","owner":"o\"\n\u0001","amount":"5","id":7,"x":null}]}"#
        );
        let v: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(&l["EVENT_JSON:".len()..]).unwrap();
        assert_eq!(v["data"][0]["owner"], "o\"\n\u{1}");
    }

    #[test]
    fn bps() {
        assert_eq!(apply_bps(100, 3000), 30);
        assert_eq!(apply_bps(u128::MAX, 10_000), u128::MAX);
        assert_eq!(apply_bps(9_999, 5_000), 4_999);
    }

    proptest! {
        #[test]
        fn civil_roundtrip(days in -100_000i64..200_000i64) {
            let (y, m, d) = civil_from_days(days);
            prop_assert!((1..=12).contains(&m));
            prop_assert!((1..=31).contains(&d));
            prop_assert_eq!(days_from_civil(y, m, d), days);
        }

        #[test]
        fn bps_matches_bigmath(a in 0u128..(u64::MAX as u128), b in 0u128..=10_000u128) {
            prop_assert_eq!(apply_bps(a, b), a * b / 10_000);
        }
    }
}

/// Methods the app's function-call key (on `<name>.<root>`, receiver `vault.<name>.<root>`) may
/// call: every owner vault method except `withdraw_large` and `rescue_sign`, plus the
/// permissionless `sync` and `run_schedules`.
pub const APP_KEY_METHODS: &[&str] = &[
    "create_pot",
    "update_pot",
    "delete_pot",
    "set_splits",
    "move_funds",
    "lock",
    "extend_lock",
    "withdraw",
    "earn_on",
    "earn_off",
    "add_agent",
    "revoke_agent",
    "approve_proposal",
    "reject_proposal",
    "add_schedule",
    "remove_schedule",
    "add_bill",
    "remove_bill",
    "pay_bill",
    "ajo_contribute",
    "ajo_post_bond",
    "ajo_join",
    "ajo_create",
    "ajo_start",
    "ajo_cancel",
    "ajo_leave",
    "ajo_remove_member",
    "ajo_set_invite",
    "sync",
    "run_schedules",
];
