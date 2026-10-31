// Passkey login: WebAuthn PRF extension -> 32 bytes -> ed25519 owner key. No server secret.
// The credential's user.id is the Oiko name, so a sign-in on a new device knows which account it is.
import { keyPairFromSeed } from "@oiko/sdk";
import { sha256 } from "@noble/hashes/sha2.js";

const SALT = new TextEncoder().encode("oiko/owner-key/v1");
const DOMAIN = new TextEncoder().encode("oiko-ed25519-seed");

export class PasskeyError extends Error {
  constructor(public readonly code: "unsupported" | "prf-unsupported" | "cancelled" | "failed", message: string) {
    super(message);
  }
}

export function passkeySupported(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials && window.isSecureContext;
}

function seedFrom(prf: ArrayBuffer): Uint8Array {
  const out = new Uint8Array(prf);
  const buf = new Uint8Array(DOMAIN.length + out.length);
  buf.set(DOMAIN, 0);
  buf.set(out, DOMAIN.length);
  return sha256(buf);
}

type PrfResults = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };

async function assertPrf(allow?: ArrayBuffer): Promise<{ seed: Uint8Array; userHandle: string | null; credentialId: string }> {
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: window.location.hostname,
        userVerification: "required",
        allowCredentials: allow ? [{ type: "public-key", id: allow }] : [],
        extensions: { prf: { eval: { first: SALT } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch (e) {
    throw new PasskeyError((e as Error).name === "NotAllowedError" ? "cancelled" : "failed", (e as Error).message);
  }
  if (!cred) throw new PasskeyError("cancelled", "no credential");
  const ext = cred.getClientExtensionResults() as PrfResults;
  const first = ext.prf?.results?.first;
  if (!first) throw new PasskeyError("prf-unsupported", "This passkey can't derive a key on this device.");
  const resp = cred.response as AuthenticatorAssertionResponse;
  const userHandle = resp.userHandle ? new TextDecoder().decode(resp.userHandle) : null;
  return { seed: seedFrom(first), userHandle, credentialId: b64url(cred.rawId) };
}

const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)).buffer;

/** Creates a passkey for `name` and returns the derived owner key pair. */
export async function createPasskey(name: string, displayName: string): Promise<{ publicKey: string; secretKey: string; credentialId: string }> {
  if (!passkeySupported()) throw new PasskeyError("unsupported", "Passkeys aren't available in this browser.");
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: "Oiko", id: window.location.hostname },
        user: { id: new TextEncoder().encode(name), name, displayName },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        extensions: { prf: { eval: { first: SALT } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch (e) {
    throw new PasskeyError((e as Error).name === "NotAllowedError" ? "cancelled" : "failed", (e as Error).message);
  }
  if (!cred) throw new PasskeyError("cancelled", "no credential");
  const ext = cred.getClientExtensionResults() as PrfResults;
  if (ext.prf?.enabled === false) throw new PasskeyError("prf-unsupported", "This passkey can't derive a key on this device.");
  let seed: Uint8Array;
  if (ext.prf?.results?.first) seed = seedFrom(ext.prf.results.first);
  else seed = (await assertPrf(cred.rawId)).seed; // some authenticators only return PRF on get()
  const kp = keyPairFromSeed(seed);
  return { ...kp, credentialId: b64url(cred.rawId) };
}

/** Signs in with any Oiko passkey on this device; returns the name it belongs to and the owner key. */
export async function signInWithPasskey(credentialId?: string): Promise<{ name: string | null; publicKey: string; secretKey: string; credentialId: string }> {
  if (!passkeySupported()) throw new PasskeyError("unsupported", "Passkeys aren't available in this browser.");
  const r = await assertPrf(credentialId ? fromB64url(credentialId) : undefined);
  return { name: r.userHandle, ...keyPairFromSeed(r.seed), credentialId: r.credentialId };
}
