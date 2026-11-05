// Operator admin (/admin, unlinked). One password from env ADMIN_PASSWORD; never stored or logged.
// Login: constant-time compare, per-IP rate limit, then an HttpOnly + Secure + SameSite=Strict session cookie
// signed with HMAC-SHA256. The signing secret is ADMIN_SECRET if set, else derived from ADMIN_PASSWORD and the relayer
// key (so rotating either logs everyone out). The only thing an admin can change today is the public "framing".
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "./errors";
import { allow } from "./ratelimit";
import { store, type Store } from "./store";

export const ADMIN_COOKIE = "oiko_admin";
export const SESSION_MS = 8 * 60 * 60 * 1000;
/** Failed and successful attempts both count: 5 per 15 minutes per IP. */
export const LOGIN_LIMIT = { attempts: 5, windowMs: 15 * 60 * 1000 } as const;

export interface AdminEnv { ADMIN_PASSWORD?: string; ADMIN_SECRET?: string; RELAYER_PRIVATE_KEY?: string }
const envOf = (e?: AdminEnv): AdminEnv => e ?? (process.env as AdminEnv);

export function adminEnabled(env?: AdminEnv): boolean {
  return Boolean(envOf(env).ADMIN_PASSWORD?.length);
}

function secret(env: AdminEnv): Buffer {
  const e = envOf(env);
  if (e.ADMIN_SECRET && e.ADMIN_SECRET.length >= 16) return createHash("sha256").update(`oiko-admin-secret:${e.ADMIN_SECRET}`).digest();
  if (!e.ADMIN_PASSWORD) throw new ApiError("E_NOT_FOUND", 404);
  return createHmac("sha256", "oiko-admin-session-v1").update(`${e.ADMIN_PASSWORD}\u0000${e.RELAYER_PRIVATE_KEY ?? ""}`).digest();
}

/** Constant-time password check (hash both sides first so lengths never leak). */
export function passwordMatches(input: string, env?: AdminEnv): boolean {
  const want = envOf(env).ADMIN_PASSWORD;
  if (!want) return false;
  const a = createHash("sha256").update(input, "utf8").digest();
  const b = createHash("sha256").update(want, "utf8").digest();
  return timingSafeEqual(a, b);
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signSession(now = Date.now(), env?: AdminEnv): string {
  const payload = b64u(JSON.stringify({ v: 1, exp: now + SESSION_MS }));
  const sig = b64u(createHmac("sha256", secret(envOf(env))).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifySession(token: string | null | undefined, now = Date.now(), env?: AdminEnv): boolean {
  if (!token || !adminEnabled(env)) return false;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return false;
  const want = createHmac("sha256", secret(envOf(env))).update(payload).digest();
  let got: Buffer;
  try { got = Buffer.from(sig, "base64url"); } catch { return false; }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return false;
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { v?: number; exp?: number };
    return p.v === 1 && typeof p.exp === "number" && p.exp > now;
  } catch {
    return false;
  }
}

export function readCookie(header: string | null, name = ADMIN_COOKIE): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=") || null;
  }
  return null;
}

export function sessionCookie(token: string): string {
  return `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_MS / 1000}`;
}
export function clearCookie(): string {
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export type LoginResult = { ok: true; cookie: string } | { ok: false; status: 401 | 404 | 429 };

/** Rate limit first (so guessing is slow even with the right password), then a constant-time compare. */
export function login(password: unknown, ip: string, now = Date.now(), env?: AdminEnv): LoginResult {
  if (!adminEnabled(env)) return { ok: false, status: 404 };
  if (!allow(`admin-login:ip:${ip}`, LOGIN_LIMIT.attempts, LOGIN_LIMIT.windowMs, now)) return { ok: false, status: 429 };
  if (typeof password !== "string" || password.length > 256 || !passwordMatches(password, env)) return { ok: false, status: 401 };
  return { ok: true, cookie: sessionCookie(signSession(now, env)) };
}

export function requireAdmin(req: Request, now = Date.now(), env?: AdminEnv): void {
  if (!adminEnabled(env)) throw new ApiError("E_NOT_FOUND", 404);
  if (!verifySession(readCookie(req.headers.get("cookie")), now, env)) throw new ApiError("E_UNAUTHORIZED", 401);
}

/* ---------------- Framing (presentation only) ---------------- */
// "mainnet" changes how the landing page talks (name suffix .oiko.near, no "Test mode" wording, no network label).
// It never changes the real network, contracts, API, signup, payments or explorer links: those stay on testnet.
export type Framing = "testnet" | "mainnet";
export const FRAMINGS: readonly Framing[] = ["testnet", "mainnet"];
const KEY = "framing";

export function defaultFraming(): Framing {
  return process.env.OIKO_FRAMING === "mainnet" ? "mainnet" : "testnet";
}
export async function getFraming(s: Store = store()): Promise<Framing> {
  try {
    const v = await s.getSetting<{ framing?: string }>(KEY);
    return v?.framing === "mainnet" || v?.framing === "testnet" ? v.framing : defaultFraming();
  } catch {
    return defaultFraming();
  }
}
export async function setFraming(f: unknown, s: Store = store()): Promise<Framing> {
  if (f !== "testnet" && f !== "mainnet") throw new ApiError("E_BAD_REQUEST", 400, "Framing must be testnet or mainnet.");
  await s.setSetting(KEY, { framing: f, updatedAt: new Date().toISOString() });
  return f;
}
