"use client";
// useSession(): who is signed in on this browser and which keys it can use.
//   appKey   function-call key on <name>.<root> for every owner method except withdraw_large/rescue_sign (day-to-day money actions)
//   ownerKey full-access key; only via passkey re-auth (derived on demand, never stored) or the "this browser" key.
import { APP_KEY_METHODS, Signer, act, generateKeyPair, publicKeyFromSecretKey } from "@oiko/sdk";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { isFixtureMode } from "./fixtures/mode";
import { signInWithPasskey } from "./passkey";
import { decryptMoveCode } from "./moveCode";
import { fetchApiConfig, rpcFor, toOikoConfig } from "./config";

export type LoginMethod = "passkey" | "browser" | "demo";
export interface Session {
  name: string;
  displayName: string;
  accountId: string;
  vaultId: string;
  appKey: string;
  method: LoginMethod;
  /** Present only for "browser" and "demo" logins. */
  ownerKey?: string;
  credentialId?: string;
  createdAt: number;
}

const KEY = "oiko.session.v1";
const FIXTURE_SESSION: Session = {
  name: "ada", displayName: "Ada", accountId: "ada.oiko.testnet", vaultId: "vault.ada.oiko.testnet",
  appKey: "ed25519:fixture", method: "demo", createdAt: 0,
};

function read(): Session | null {
  if (isFixtureMode()) return FIXTURE_SESSION;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
function write(s: Session | null) {
  try {
    if (s) window.localStorage.setItem(KEY, JSON.stringify(s));
    else window.localStorage.removeItem(KEY);
  } catch { /* storage blocked: session lasts for this tab only */ }
}

interface SessionCtx {
  status: "loading" | "signed-out" | "signed-in";
  session: Session | null;
  /** Store a session after sign-up or sign-in. */
  save: (s: Session) => void;
  update: (p: Partial<Pick<Session, "displayName">>) => void;
  signOut: () => void;
  /** Sign in with an existing passkey (new device): derives the owner key and adds a fresh app key. */
  passkeySignIn: () => Promise<Session>;
  /** Sign in with a passphrase-encrypted code exported from another device (Settings → Move to another device). */
  codeSignIn: (code: string, passphrase: string) => Promise<Session>;
  /** Full-access key for rare actions (large withdrawals, recovery). Prompts for the passkey when needed. */
  getOwnerKey: () => Promise<string>;
}
const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setSession(read());
    setReady(true);
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) setSession(read()); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const save = useCallback((s: Session) => { write(s); setSession(s); }, []);
  const update = useCallback((p: Partial<Pick<Session, "displayName">>) => {
    setSession((s) => { if (!s) return s; const n = { ...s, ...p }; write(n); return n; });
  }, []);
  const signOut = useCallback(() => { write(null); setSession(null); }, []);

  const passkeySignIn = useCallback(async () => {
    const r = await signInWithPasskey();
    if (!r.name) throw new Error("E_NOT_FOUND: passkey has no Oiko name");
    const cfg = toOikoConfig(await fetchApiConfig());
    const rpc = rpcFor(cfg);
    const accountId = `${r.name}.${cfg.root}`;
    const vaultId = `vault.${accountId}`;
    const ak = await rpc.viewAccessKey(accountId, r.publicKey);
    if (!ak) throw new Error("E_NO_KEY: this passkey's key is not on the account");
    // Add a fresh app key for this device, signed by the owner key (the account pays a tiny fee from its own balance).
    const app = generateKeyPair();
    const owner = new Signer(rpc, accountId, r.secretKey);
    const res = await owner.signAndSend(accountId, [act.addFunctionCallKey(app.publicKey, vaultId, [...APP_KEY_METHODS], "250000000000000000000000")]);
    if (!res.ok) throw new Error(res.errorCode ?? "E_TX_FAILED");
    const s: Session = { name: r.name, displayName: r.name, accountId, vaultId, appKey: app.secretKey, method: "passkey", credentialId: r.credentialId, createdAt: Date.now() };
    save(s);
    return s;
  }, [save]);

  const codeSignIn = useCallback(async (code: string, passphrase: string) => {
    const p = await decryptMoveCode(code, passphrase);
    const cfg = toOikoConfig(await fetchApiConfig());
    const rpc = rpcFor(cfg);
    if (!p.accountId.endsWith(`.${cfg.root}`) || p.vaultId !== `vault.${p.accountId}`) throw new Error("E_BAD_CODE: this code is for a different version of Oiko");
    // The exported keys must still be on the account (a key removed since the export can't sign in).
    if (!(await rpc.viewAccessKey(p.accountId, publicKeyFromSecretKey(p.appKey)))) throw new Error("E_NO_KEY: this code's key was removed from the account");
    let appKey = p.appKey;
    if (p.ownerKey && (await rpc.viewAccessKey(p.accountId, publicKeyFromSecretKey(p.ownerKey)))) {
      // With the owner key, give this device its own app key (so either device can be signed out on its own).
      const app = generateKeyPair();
      const owner = new Signer(rpc, p.accountId, p.ownerKey);
      const res = await owner.signAndSend(p.accountId, [act.addFunctionCallKey(app.publicKey, p.vaultId, [...APP_KEY_METHODS], "250000000000000000000000")]).catch(() => null);
      if (res?.ok) appKey = app.secretKey;
    }
    const s: Session = { name: p.name, displayName: p.displayName || p.name, accountId: p.accountId, vaultId: p.vaultId, appKey, method: p.method, ownerKey: p.ownerKey, credentialId: p.credentialId, createdAt: Date.now() };
    save(s);
    return s;
  }, [save]);

  const getOwnerKey = useCallback(async () => {
    if (!session) throw new Error("E_NO_KEY: signed out");
    if (session.ownerKey) return session.ownerKey;
    const r = await signInWithPasskey(session.credentialId);
    return r.secretKey;
  }, [session]);

  const value = useMemo<SessionCtx>(() => ({
    status: !ready ? "loading" : session ? "signed-in" : "signed-out",
    session, save, update, signOut, passkeySignIn, codeSignIn, getOwnerKey,
  }), [ready, session, save, update, signOut, passkeySignIn, codeSignIn, getOwnerKey]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSession must be used inside <SessionProvider>");
  return c;
}

export const appPublicKey = (s: Session) => (s.appKey.startsWith("ed25519:fixture") ? s.appKey : publicKeyFromSecretKey(s.appKey));
