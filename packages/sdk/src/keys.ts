import { ed25519 } from "@noble/curves/ed25519.js";
import { b58decode, b58encode } from "./encoding";

/** NEAR key strings: public "ed25519:<b58 32 bytes>", secret "ed25519:<b58 seed32||pub32>". */
export function keyPairFromSeed(seed32: Uint8Array): { publicKey: string; secretKey: string } {
  if (seed32.length !== 32) throw new Error("seed must be 32 bytes");
  const pub = ed25519.getPublicKey(seed32);
  const sk = new Uint8Array(64);
  sk.set(seed32, 0);
  sk.set(pub, 32);
  return { publicKey: `ed25519:${b58encode(pub)}`, secretKey: `ed25519:${b58encode(sk)}` };
}

export function generateKeyPair(): { publicKey: string; secretKey: string } {
  return keyPairFromSeed(ed25519.utils.randomSecretKey());
}

function strip(key: string): string {
  if (key.startsWith("ed25519:")) return key.slice(8);
  if (key.includes(":")) throw new Error("only ed25519 keys are supported");
  return key;
}

/** Returns the 32-byte seed from a NEAR secret key string (64-byte seed||pub or 32-byte seed). */
export function seedFromSecretKey(secretKey: string): Uint8Array {
  const raw = b58decode(strip(secretKey));
  if (raw.length === 64 || raw.length === 32) return raw.slice(0, 32);
  throw new Error("invalid ed25519 secret key");
}
export function publicKeyFromSecretKey(secretKey: string): string {
  return `ed25519:${b58encode(ed25519.getPublicKey(seedFromSecretKey(secretKey)))}`;
}
export function publicKeyBytes(publicKey: string): Uint8Array {
  const raw = b58decode(strip(publicKey));
  if (raw.length !== 32) throw new Error("invalid ed25519 public key");
  return raw;
}
export function normalizePublicKey(publicKey: string): string {
  return `ed25519:${b58encode(publicKeyBytes(publicKey))}`;
}
export function signBytes(secretKey: string, msg: Uint8Array): Uint8Array {
  return ed25519.sign(msg, seedFromSecretKey(secretKey));
}
export function verifyBytes(publicKey: string, msg: Uint8Array, sig: Uint8Array): boolean {
  try {
    return ed25519.verify(sig, msg, publicKeyBytes(publicKey));
  } catch {
    return false;
  }
}
