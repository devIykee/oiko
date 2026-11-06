// "Move to another device": this browser's sign-in keys, encrypted with a passphrase the user picks.
// Everything happens in the browser (PBKDF2-SHA256 + AES-GCM via WebCrypto). Keys never go to the server.
// Format: "oikomove1:" + base64url(salt[16] | iv[12] | ciphertext).
import type { Session } from "./session";

export const MOVE_PREFIX = "oikomove1:";
const ITERATIONS = 310_000;
export const MIN_PASSPHRASE = 8;

type Payload = Pick<Session, "name" | "displayName" | "accountId" | "vaultId" | "appKey" | "method" | "ownerKey" | "credentialId">;

const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: ITERATIONS }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptMoveCode(s: Session, passphrase: string): Promise<string> {
  if (passphrase.length < MIN_PASSPHRASE) throw new Error("E_BAD_PASSPHRASE: too short");
  const p: Payload = { name: s.name, displayName: s.displayName, accountId: s.accountId, vaultId: s.vaultId, appKey: s.appKey, method: s.method, ownerKey: s.ownerKey, credentialId: s.credentialId };
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify({ v: 1, ...p }))));
  const out = new Uint8Array(salt.length + iv.length + ct.length);
  out.set(salt, 0); out.set(iv, salt.length); out.set(ct, salt.length + iv.length);
  return MOVE_PREFIX + b64u(out);
}

/** Throws "E_BAD_CODE" for a malformed code and "E_BAD_PASSPHRASE" when the passphrase is wrong. */
export async function decryptMoveCode(code: string, passphrase: string): Promise<Payload> {
  const c = code.replace(/\s+/g, "");
  if (!c.startsWith(MOVE_PREFIX)) throw new Error("E_BAD_CODE: not an Oiko sign-in code");
  let raw: Uint8Array;
  try { raw = fromB64u(c.slice(MOVE_PREFIX.length)); } catch { throw new Error("E_BAD_CODE: damaged code"); }
  if (raw.length < 16 + 12 + 17) throw new Error("E_BAD_CODE: damaged code");
  const key = await deriveKey(passphrase, raw.slice(0, 16));
  let pt: ArrayBuffer;
  try { pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(16, 28) }, key, raw.slice(28)); }
  catch { throw new Error("E_BAD_PASSPHRASE: wrong passphrase"); }
  const p = JSON.parse(new TextDecoder().decode(pt)) as Payload & { v: number };
  if (p.v !== 1 || !p.accountId || !p.vaultId || !p.appKey) throw new Error("E_BAD_CODE: unsupported code");
  return p;
}
