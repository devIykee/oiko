import { sha256 } from "@noble/hashes/sha2.js";
import { serialize } from "borsh";
import { b64decode, b64encode, hexEncode, utf8 } from "./encoding";
import { publicKeyFromSecretKey, signBytes, verifyBytes } from "./keys";

/** NEP-413: sha256( borsh_u32(2^31 + 413) || borsh({message, nonce[32], recipient, callbackUrl?}) ), signed with ed25519. */
export const NEP413_TAG = 2147484061;
const PayloadSchema = {
  struct: { message: "string", nonce: { array: { type: "u8", len: 32 } }, recipient: "string", callbackUrl: { option: "string" } },
} as const;

export function nep413Hash(p: { message: string; recipient: string; nonce: Uint8Array; callbackUrl?: string }): Uint8Array {
  if (p.nonce.length !== 32) throw new Error("NEP-413 nonce must be 32 bytes");
  const tag = serialize("u32", NEP413_TAG);
  const body = serialize(PayloadSchema, { message: p.message, nonce: Array.from(p.nonce), recipient: p.recipient, callbackUrl: p.callbackUrl ?? null });
  const all = new Uint8Array(tag.length + body.length);
  all.set(tag, 0);
  all.set(body, tag.length);
  return sha256(all);
}

function randomNonce(): Uint8Array {
  const n = new Uint8Array(32);
  globalThis.crypto.getRandomValues(n);
  return n;
}

/** Signature and nonce are base64 (as wallets return them). */
export function signNep413(
  secretKey: string,
  msg: { message: string; recipient: string; nonce?: Uint8Array; callbackUrl?: string },
): { publicKey: string; signature: string; nonce: string } {
  const nonce = msg.nonce ?? randomNonce();
  const sig = signBytes(secretKey, nep413Hash({ ...msg, nonce }));
  return { publicKey: publicKeyFromSecretKey(secretKey), signature: b64encode(sig), nonce: b64encode(nonce) };
}

/** Pure signature check. It does NOT check that the key belongs to an account; callers do that with view_access_key. */
export function verifyNep413(payload: { publicKey: string; signature: string; message: string; recipient: string; nonce: string; callbackUrl?: string }): boolean {
  try {
    const nonce = b64decode(payload.nonce);
    if (nonce.length !== 32) return false;
    const sig = b64decode(payload.signature);
    if (sig.length !== 64) return false;
    return verifyBytes(payload.publicKey, nep413Hash({ message: payload.message, recipient: payload.recipient, nonce, callbackUrl: payload.callbackUrl }), sig);
  } catch {
    return false;
  }
}

export const GATEWAY_RECIPIENT = "oiko-gateway";
export const GATEWAY_WINDOW_MS = 5 * 60 * 1000;

export interface GatewayAuth { accountId: string; publicKey: string; signature: string; nonce: string; message: string }

export function sha256Hex(body: string | Uint8Array): string {
  return hexEncode(sha256(typeof body === "string" ? utf8(body) : body));
}

/** message = "<METHOD> <path>\n<sha256 hex of body>\n<unix ms>". `path` is the request path including any query string. */
export function gatewayMessage(method: string, path: string, body: string, now: number): string {
  return `${method.toUpperCase()} ${path}\n${sha256Hex(body)}\n${now}`;
}

export function gatewayAuthHeader(secretKey: string, accountId: string, method: string, path: string, body: string, now: number = Date.now()): string {
  const message = gatewayMessage(method, path, body, now);
  const s = signNep413(secretKey, { message, recipient: GATEWAY_RECIPIENT });
  const json: GatewayAuth = { accountId, publicKey: s.publicKey, signature: s.signature, nonce: s.nonce, message };
  return `NEP413 ${b64encode(utf8(JSON.stringify(json)))}`;
}

export function parseGatewayAuthHeader(header: string | null | undefined): GatewayAuth | null {
  if (!header) return null;
  const m = /^NEP413\s+([A-Za-z0-9+/=_-]+)$/.exec(header.trim());
  if (!m) return null;
  try {
    const j = JSON.parse(new TextDecoder().decode(b64decode(m[1]!))) as Record<string, unknown>;
    const keys = ["accountId", "publicKey", "signature", "nonce", "message"] as const;
    for (const k of keys) if (typeof j[k] !== "string") return null;
    return j as unknown as GatewayAuth;
  } catch {
    return null;
  }
}

export function parseGatewayMessage(message: string): { method: string; path: string; bodyHash: string; timestamp: number } | null {
  const lines = message.split("\n");
  if (lines.length !== 3) return null;
  const sp = lines[0]!.indexOf(" ");
  if (sp <= 0) return null;
  const ts = Number(lines[2]);
  if (!Number.isSafeInteger(ts) || !/^[0-9a-f]{64}$/.test(lines[1]!)) return null;
  return { method: lines[0]!.slice(0, sp), path: lines[0]!.slice(sp + 1), bodyHash: lines[1]!, timestamp: ts };
}
