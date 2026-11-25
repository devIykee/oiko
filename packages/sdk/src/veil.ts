// Veil: private labels for a public ledger.
//
// Everything a NEAR contract stores is public. The vault has to see amounts, pots, locks and
// payees to enforce them, but it never needs to know that a pot is called "Divorce lawyer" or that
// a bill is "Therapy". Veil encrypts those labels in the browser (or in the agent's own process)
// before they reach the chain, and decrypts them after they come back. The contract, the RPC node,
// the Oiko server and anyone reading the explorer see only an opaque token.
//
// The deployed vault has no upgrade method and limits a pot or bill name to 40 characters
// (counted as Unicode scalar values). An authenticated ciphertext in base64 does not fit in 40
// characters, so Veil writes 15 bits per character using 32,768 code points from three CJK and
// Hangul blocks. A padded, authenticated name is 38 characters: it fits the existing contract,
// with no new code hash and no migration.
//
// Token:     "🔒" + base32768(nonce[12] | ChaCha20-Poly1305(pad(text)) | tag[16])
// Padding:   [u16 big-endian byte length][utf-8 text][zeros] to a fixed bucket (40, 168 or 488 bytes),
//            so every pot name has the same length on chain whatever it says.
// AAD:       "oiko-veil/v1:" + vault id, so a token copied into another account does not open.
// View key:  HKDF-SHA256(owner seed, salt "oiko/veil/v1", info "view:" + identity account), 32 bytes.
//            The owner key is a passkey PRF output or the browser key, so every device that can sign
//            in as the owner can derive the same view key; the Oiko server never sees it.
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { b64decode, b64urlEncode, fromUtf8, utf8 } from "./encoding";
import { seedFromSecretKey } from "./keys";

export const VEIL_MARK = "\u{1F512}"; // 🔒
export const VIEW_KEY_PREFIX = "oikoview1:";
const NONCE = 12;
const TAG = 16;
/** Padded plaintext sizes (bytes, including the 2-byte length). */
export const VEIL_BUCKETS = [40, 168, 488] as const;

// ---------- base32768 over three contiguous, assigned, NFC-stable blocks ----------
// 0..6591      -> U+3400.. (CJK Extension A, 6592 code points)
// 6592..27583  -> U+4E00.. (CJK Unified Ideographs, 20992 code points)
// 27584..32767 -> U+AC00.. (Hangul Syllables, first 5184 of 11172)
const R1 = 6592, R2 = R1 + 20992;
const toCp = (v: number) => (v < R1 ? 0x3400 + v : v < R2 ? 0x4e00 + (v - R1) : 0xac00 + (v - R2));
function fromCp(cp: number): number {
  if (cp >= 0x3400 && cp < 0x3400 + R1) return cp - 0x3400;
  if (cp >= 0x4e00 && cp < 0x4e00 + 20992) return cp - 0x4e00 + R1;
  if (cp >= 0xac00 && cp < 0xac00 + (32768 - R2)) return cp - 0xac00 + R2;
  return -1;
}
const BODY_CLASS = "\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uAC00-\\uC03F";

export function encode32k(bytes: Uint8Array): string {
  let out = "", acc = 0, bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b; bits += 8;
    while (bits >= 15) { bits -= 15; out += String.fromCodePoint(toCp((acc >> bits) & 0x7fff)); }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += String.fromCodePoint(toCp((acc << (15 - bits)) & 0x7fff));
  return out;
}
/** Decodes `chars` characters to exactly `len` bytes; null on any character outside the alphabet. */
export function decode32k(s: string, len: number): Uint8Array | null {
  const out = new Uint8Array(len);
  let acc = 0, bits = 0, n = 0;
  for (const ch of s) {
    const v = fromCp(ch.codePointAt(0)!);
    if (v < 0) return null;
    acc = (acc << 15) | v; bits += 15;
    while (bits >= 8 && n < len) { bits -= 8; out[n++] = (acc >> bits) & 0xff; }
    acc &= (1 << bits) - 1;
  }
  return n === len ? out : null;
}

const charsFor = (bytes: number) => Math.ceil((bytes * 8) / 15);
/** Length of a sealed token (in characters, marker included) for each bucket. */
export const VEIL_TOKEN_CHARS = VEIL_BUCKETS.map((b) => 1 + charsFor(NONCE + b + TAG));
const BUCKET_BY_CHARS = new Map(VEIL_BUCKETS.map((b, i) => [VEIL_TOKEN_CHARS[i]! - 1, b]));
/** Matches every sealed token inside any text (tokens are self-delimiting: fixed lengths, private alphabet). */
export const VEIL_TOKEN_RE = new RegExp(
  `${VEIL_MARK}[${BODY_CLASS}]{${VEIL_TOKEN_CHARS[0]! - 1}}(?:[${BODY_CLASS}]{${VEIL_TOKEN_CHARS[1]! - VEIL_TOKEN_CHARS[0]!}}(?:[${BODY_CLASS}]{${VEIL_TOKEN_CHARS[2]! - VEIL_TOKEN_CHARS[1]!}})?)?`,
  "gu",
);

const EXACT_RE = new RegExp(`^(?:${VEIL_TOKEN_RE.source})$`, "u");
const ANY_RE = new RegExp(VEIL_TOKEN_RE.source, "u");
export const isSealed = (s: unknown): s is string => typeof s === "string" && s.startsWith(VEIL_MARK) && EXACT_RE.test(s);
export const containsSealed = (s: string) => s.includes(VEIL_MARK) && ANY_RE.test(s);

/** Character count the way the contract counts it (Unicode scalar values). */
export const scalarLength = (s: string) => [...s].length;

// ---------- keys ----------

export function deriveViewKey(ownerSecretKey: string, identityAccountId: string): Uint8Array {
  return hkdf(sha256, seedFromSecretKey(ownerSecretKey), utf8("oiko/veil/v1"), utf8(`view:${identityAccountId}`), 32);
}
export const encodeViewKey = (k: Uint8Array) => VIEW_KEY_PREFIX + b64urlEncode(k);
export function decodeViewKey(s: string): Uint8Array {
  const t = s.trim();
  if (!t.startsWith(VIEW_KEY_PREFIX)) throw new Error("E_VEIL_KEY: not an Oiko view key");
  const k = b64decode(t.slice(VIEW_KEY_PREFIX.length));
  if (k.length !== 32) throw new Error("E_VEIL_KEY: damaged view key");
  return k;
}
/** Short public fingerprint of a view key, safe to show ("which key is this?"); not the key. */
export const viewKeyFingerprint = (k: Uint8Array) => b64urlEncode(sha256(new Uint8Array([...utf8("oiko-veil-fp"), ...k]))).slice(0, 10);

const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

// ---------- seal / open ----------

export class VeilError extends Error {
  constructor(public readonly code: "E_VEIL_TOO_LONG" | "E_VEIL_KEY", message: string) { super(`${code}: ${message}`); }
}

export class Veil {
  private readonly aad: Uint8Array;
  constructor(private readonly key: Uint8Array, public readonly vaultId: string) {
    if (key.length !== 32) throw new VeilError("E_VEIL_KEY", "a view key is 32 bytes");
    this.aad = utf8(`oiko-veil/v1:${vaultId}`);
  }
  static fromOwnerKey(ownerSecretKey: string, identityAccountId: string, vaultId = `vault.${identityAccountId}`): Veil {
    return new Veil(deriveViewKey(ownerSecretKey, identityAccountId), vaultId);
  }
  static fromViewKey(viewKey: string, vaultId: string): Veil { return new Veil(decodeViewKey(viewKey), vaultId); }
  exportViewKey(): string { return encodeViewKey(this.key); }
  fingerprint(): string { return viewKeyFingerprint(this.key); }

  /**
   * Seals `text` into a token of at most `maxChars` characters (the contract's limit for that field).
   * Uses the smallest bucket that holds the text; throws E_VEIL_TOO_LONG if none fits within maxChars.
   */
  seal(text: string, maxChars = 40): string {
    if (isSealed(text)) return text; // idempotent: never double-seal
    const body = utf8(text);
    const bi = VEIL_BUCKETS.findIndex((b, i) => body.length + 2 <= b && VEIL_TOKEN_CHARS[i]! <= maxChars);
    if (bi < 0) throw new VeilError("E_VEIL_TOO_LONG", `too long to keep private in ${maxChars} characters`);
    const pt = new Uint8Array(VEIL_BUCKETS[bi]!);
    pt[0] = body.length >> 8; pt[1] = body.length & 0xff; pt.set(body, 2);
    const nonce = randomBytes(NONCE);
    const ct = chacha20poly1305(this.key, nonce, this.aad).encrypt(pt);
    const raw = new Uint8Array(NONCE + ct.length);
    raw.set(nonce, 0); raw.set(ct, NONCE);
    return VEIL_MARK + encode32k(raw);
  }

  /** The longest text (utf-8 bytes) that fits a field of `maxChars` characters. */
  static capacity(maxChars = 40): number {
    let best = 0;
    VEIL_BUCKETS.forEach((b, i) => { if (VEIL_TOKEN_CHARS[i]! <= maxChars) best = b - 2; });
    return best;
  }

  /** Opens one token. Returns null if `s` is not a token, was sealed with another key or vault, or was changed. */
  tryOpen(s: string): string | null {
    if (!isSealed(s)) return null;
    const body = s.slice(VEIL_MARK.length);
    const bucket = BUCKET_BY_CHARS.get(scalarLength(body));
    if (!bucket) return null;
    const raw = decode32k(body, NONCE + bucket + TAG);
    if (!raw) return null;
    try {
      const pt = chacha20poly1305(this.key, raw.subarray(0, NONCE), this.aad).decrypt(raw.subarray(NONCE));
      const n = (pt[0]! << 8) | pt[1]!;
      if (n > pt.length - 2 || pt.subarray(2 + n).some((x) => x !== 0)) return null;
      return fromUtf8(pt.subarray(2, 2 + n));
    } catch {
      return null;
    }
  }
  /** Opens a token, or returns `s` unchanged when it is plain text. Tokens this key can't open become "Private". */
  open(s: string): string {
    if (!isSealed(s)) return s;
    return this.tryOpen(s) ?? PRIVATE_LABEL;
  }
  /** Opens every token inside a longer text (server sentences such as "Rent is due tomorrow" built from sealed names). */
  openText(s: string): string {
    if (!s.includes(VEIL_MARK)) return s;
    return s.replace(VEIL_TOKEN_RE, (t) => this.tryOpen(t) ?? PRIVATE_LABEL);
  }
  /** Returns a deep copy of any JSON value with every sealed token opened. */
  openDeep<T>(v: T): T { return mapStrings(v, (s) => this.openText(s)); }
}

export const PRIVATE_LABEL = "Private";
/** For readers without the view key: replaces each token with "Private" so nobody sees the raw ciphertext. */
export const maskText = (s: string) => (s.includes(VEIL_MARK) ? s.replace(VEIL_TOKEN_RE, PRIVATE_LABEL) : s);
export const maskDeep = <T>(v: T): T => mapStrings(v, maskText);

function mapStrings<T>(v: T, f: (s: string) => string): T {
  if (typeof v === "string") return f(v) as T;
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, f)) as T;
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = mapStrings(x, f);
    return o as T;
  }
  return v;
}

/** Contract limits (characters) for the fields Veil seals. */
export const VEIL_LIMITS = { potName: 40, potIcon: 40, billName: 40, proposalReason: 280 } as const;

// ---------- sealed boxes (off-chain records: invoices) ----------
// A box is a JSON value encrypted with a random 32-byte content key. The content key travels in the URL
// fragment for the payer (fragments are never sent to the server) and, wrapped with the owner's view key,
// next to the box for the owner. Format: "oikobox1:" + base64url(nonce[12] | ciphertext | tag[16]).
export const BOX_PREFIX = "oikobox1:";
export const newBoxKey = () => randomBytes(32);
export function sealBox(key: Uint8Array, value: unknown, context: string): string {
  const nonce = randomBytes(NONCE);
  const ct = chacha20poly1305(key, nonce, utf8(`oiko-box/v1:${context}`)).encrypt(utf8(JSON.stringify(value)));
  const raw = new Uint8Array(NONCE + ct.length);
  raw.set(nonce, 0); raw.set(ct, NONCE);
  return BOX_PREFIX + b64urlEncode(raw);
}
export function openBox<T = unknown>(key: Uint8Array, box: string, context: string): T | null {
  if (!box.startsWith(BOX_PREFIX)) return null;
  try {
    const raw = b64decode(box.slice(BOX_PREFIX.length));
    const pt = chacha20poly1305(key, raw.subarray(0, NONCE), utf8(`oiko-box/v1:${context}`)).decrypt(raw.subarray(NONCE));
    return JSON.parse(fromUtf8(pt)) as T;
  } catch {
    return null;
  }
}
/** Wraps a content key with the owner's view key (the wrapped key is a normal 106-character Veil token). */
export function wrapBoxKey(veil: Veil, key: Uint8Array): string { return veil.seal(b64urlEncode(key), 120); }
export function unwrapBoxKey(veil: Veil, wrapped: string): Uint8Array | null {
  const t = veil.tryOpen(wrapped);
  if (!t) return null;
  try { const k = b64decode(t); return k.length === 32 ? k : null; } catch { return null; }
}
export const encodeBoxKey = (k: Uint8Array) => b64urlEncode(k);
export function decodeBoxKey(s: string): Uint8Array | null {
  try { const k = b64decode(s); return k.length === 32 ? k : null; } catch { return null; }
}
