//! Tiny JSON reader for method arguments.
//!
//! Contract methods read `env::input()` with this instead of letting `#[near]` generate a serde
//! input struct per method: each generated struct monomorphizes serde_json's parser (~2-4 KB of
//! wasm per method). The JSON accepted is the same shape as before; numbers are kept as text
//! (no floats). Bad input panics with `E_BAD_ARGS`.

use crate::fail;

#[derive(Debug, Clone, PartialEq)]
pub enum Jv {
    Null,
    Bool(bool),
    /// number, kept as its source text
    Num(String),
    Str(String),
    Arr(Vec<Jv>),
    Obj(Vec<(String, Jv)>),
}

fn bad(msg: &str) -> ! {
    fail("E_BAD_ARGS", msg)
}

struct P<'a> {
    b: &'a [u8],
    i: usize,
}

impl P<'_> {
    fn ws(&mut self) {
        while self.i < self.b.len() && matches!(self.b[self.i], b' ' | b'\n' | b'\r' | b'\t') {
            self.i += 1;
        }
    }
    fn peek(&mut self) -> u8 {
        self.ws();
        *self.b.get(self.i).unwrap_or(&0)
    }
    fn eat(&mut self, c: u8) {
        if self.peek() != c {
            bad("invalid JSON");
        }
        self.i += 1;
    }
    fn lit(&mut self, s: &[u8], v: Jv) -> Jv {
        if self.b.len() < self.i + s.len() || &self.b[self.i..self.i + s.len()] != s {
            bad("invalid JSON");
        }
        self.i += s.len();
        v
    }
    fn hex4(&mut self) -> u32 {
        if self.i + 4 > self.b.len() {
            bad("invalid JSON escape");
        }
        let s = core::str::from_utf8(&self.b[self.i..self.i + 4]).unwrap_or("");
        self.i += 4;
        u32::from_str_radix(s, 16).unwrap_or_else(|_| bad("invalid JSON escape"))
    }
    fn string(&mut self) -> String {
        self.eat(b'"');
        let mut out: Vec<u8> = Vec::new();
        loop {
            let c = *self.b.get(self.i).unwrap_or_else(|| bad("unterminated string"));
            self.i += 1;
            match c {
                b'"' => break,
                b'\\' => {
                    let e = *self.b.get(self.i).unwrap_or(&0);
                    self.i += 1;
                    let ch = match e {
                        b'"' => '"',
                        b'\\' => '\\',
                        b'/' => '/',
                        b'b' => '\u{8}',
                        b'f' => '\u{c}',
                        b'n' => '\n',
                        b'r' => '\r',
                        b't' => '\t',
                        b'u' => {
                            let mut cp = self.hex4();
                            if (0xD800..0xDC00).contains(&cp) {
                                if self.b.get(self.i) != Some(&b'\\') || self.b.get(self.i + 1) != Some(&b'u') {
                                    bad("invalid surrogate");
                                }
                                self.i += 2;
                                let lo = self.hex4();
                                cp = 0x10000 + ((cp - 0xD800) << 10) + (lo.wrapping_sub(0xDC00) & 0x3FF);
                            }
                            char::from_u32(cp).unwrap_or_else(|| bad("invalid escape"))
                        }
                        _ => bad("invalid escape"),
                    };
                    let mut buf = [0u8; 4];
                    out.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
                }
                c if c < 0x20 => bad("control character in string"),
                c => out.push(c),
            }
        }
        String::from_utf8(out).unwrap_or_else(|_| bad("invalid utf-8"))
    }
    fn value(&mut self, depth: u32) -> Jv {
        if depth > 32 {
            bad("JSON nested too deeply");
        }
        match self.peek() {
            b'{' => {
                self.i += 1;
                let mut v = Vec::new();
                if self.peek() == b'}' {
                    self.i += 1;
                    return Jv::Obj(v);
                }
                loop {
                    let k = self.string();
                    self.eat(b':');
                    let x = self.value(depth + 1);
                    v.push((k, x));
                    match self.peek() {
                        b',' => self.i += 1,
                        b'}' => {
                            self.i += 1;
                            return Jv::Obj(v);
                        }
                        _ => bad("invalid JSON object"),
                    }
                }
            }
            b'[' => {
                self.i += 1;
                let mut v = Vec::new();
                if self.peek() == b']' {
                    self.i += 1;
                    return Jv::Arr(v);
                }
                loop {
                    v.push(self.value(depth + 1));
                    match self.peek() {
                        b',' => self.i += 1,
                        b']' => {
                            self.i += 1;
                            return Jv::Arr(v);
                        }
                        _ => bad("invalid JSON array"),
                    }
                }
            }
            b'"' => Jv::Str(self.string()),
            b't' => self.lit(b"true", Jv::Bool(true)),
            b'f' => self.lit(b"false", Jv::Bool(false)),
            b'n' => self.lit(b"null", Jv::Null),
            b'-' | b'0'..=b'9' => {
                let s = self.i;
                while self.i < self.b.len()
                    && matches!(self.b[self.i], b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9')
                {
                    self.i += 1;
                }
                Jv::Num(core::str::from_utf8(&self.b[s..self.i]).unwrap().to_string())
            }
            _ => bad("invalid JSON"),
        }
    }
}

/// Parses a JSON document. Empty input is treated as `{}`.
pub fn parse(b: &[u8]) -> Jv {
    let mut p = P { b, i: 0 };
    if p.peek() == 0 {
        return Jv::Obj(vec![]);
    }
    let v = p.value(0);
    if p.peek() != 0 {
        bad("trailing characters after JSON");
    }
    v
}

/// The method's JSON arguments (`env::input()`).
pub fn input() -> Jv {
    parse(&near_sdk::env::input().unwrap_or_default())
}

impl Jv {
    /// Field of an object; `None` when missing or `null`.
    pub fn opt(&self, k: &str) -> Option<&Jv> {
        match self {
            Jv::Obj(v) => v.iter().find(|(kk, _)| kk == k).map(|(_, x)| x).filter(|x| **x != Jv::Null),
            _ => bad("expected a JSON object"),
        }
    }
    /// Required field of an object.
    pub fn req(&self, k: &str) -> &Jv {
        self.opt(k).unwrap_or_else(|| fail("E_BAD_ARGS", format!("missing field `{}`", k)))
    }
    pub fn str(&self) -> &str {
        match self {
            Jv::Str(s) => s,
            _ => bad("expected a string"),
        }
    }
    pub fn string(&self) -> String {
        self.str().to_string()
    }
    /// JSON number as u64 (integers only).
    pub fn u64(&self) -> u64 {
        match self {
            Jv::Num(s) => s.parse().unwrap_or_else(|_| bad("expected an unsigned integer")),
            _ => bad("expected a number"),
        }
    }
    pub fn u32(&self) -> u32 {
        u32::try_from(self.u64()).unwrap_or_else(|_| bad("number too large"))
    }
    pub fn u8(&self) -> u8 {
        u8::try_from(self.u64()).unwrap_or_else(|_| bad("number too large"))
    }
    pub fn u16(&self) -> u16 {
        u16::try_from(self.u64()).unwrap_or_else(|_| bad("number too large"))
    }
    /// `U128` / `U64`: decimal string.
    pub fn dec(&self) -> u128 {
        self.str().parse().unwrap_or_else(|_| bad("expected a decimal string"))
    }
    pub fn dec64(&self) -> u64 {
        self.str().parse().unwrap_or_else(|_| bad("expected a decimal string"))
    }
    pub fn boolean(&self) -> bool {
        match self {
            Jv::Bool(b) => *b,
            _ => bad("expected a boolean"),
        }
    }
    pub fn arr(&self) -> &[Jv] {
        match self {
            Jv::Arr(v) => v,
            _ => bad("expected an array"),
        }
    }
    pub fn account(&self) -> near_sdk::AccountId {
        self.str().parse().unwrap_or_else(|_| bad("invalid account id"))
    }
    pub fn public_key(&self) -> near_sdk::PublicKey {
        self.str().parse().unwrap_or_else(|_| bad("invalid public key"))
    }
    pub fn token(&self) -> crate::Token {
        match self.str() {
            "usdc" => crate::Token::Usdc,
            "usdt" => crate::Token::Usdt,
            _ => bad("token must be usdc or usdt"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_reads() {
        let v = parse(br#" {"a":"x\"\u00e9\ud83d\ude00","n":42,"u":"1000000000000000000000000","b":true,"z":null,"l":[1,{"k":[]}]} "#);
        assert_eq!(v.req("a").str(), "x\"\u{e9}\u{1F600}");
        assert_eq!(v.req("n").u64(), 42);
        assert_eq!(v.req("u").dec(), 10u128.pow(24));
        assert!(v.req("b").boolean());
        assert!(v.opt("z").is_none());
        assert!(v.opt("missing").is_none());
        assert_eq!(v.req("l").arr().len(), 2);
        assert_eq!(parse(b""), Jv::Obj(vec![]));
    }

    #[test]
    #[should_panic(expected = "E_BAD_ARGS")]
    fn rejects_garbage() {
        parse(b"{\"a\":1,}");
    }

    #[test]
    #[should_panic(expected = "E_BAD_ARGS")]
    fn rejects_trailing() {
        parse(b"{} x");
    }
}
