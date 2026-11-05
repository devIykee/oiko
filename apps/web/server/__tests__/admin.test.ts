import { describe, expect, it } from "vitest";
import {
  ADMIN_COOKIE, LOGIN_LIMIT, SESSION_MS, adminEnabled, getFraming, login, passwordMatches, readCookie, requireAdmin, setFraming, signSession,
  verifySession, type AdminEnv,
} from "../admin";
import { MemoryStore } from "../store";

// Test-only values; the real password lives in env (ADMIN_PASSWORD) and is never in the repo.
const ENV: AdminEnv = { ADMIN_PASSWORD: "correct horse battery staple", RELAYER_PRIVATE_KEY: "ed25519:test-relayer-key" };
const NOW = Date.parse("2026-11-05T12:00:00Z");
let ipN = 0;
const freshIp = () => `203.0.113.${++ipN}`;
const tokenOf = (cookie: string) => readCookie(cookie.split(";")[0]!)!;

describe("admin login", () => {
  it("is off when ADMIN_PASSWORD is unset", () => {
    expect(adminEnabled({})).toBe(false);
    expect(login("anything", freshIp(), NOW, {})).toEqual({ ok: false, status: 404 });
  });

  it("rejects a wrong password, a non-string and an oversized one", () => {
    expect(passwordMatches("wrong", ENV)).toBe(false);
    expect(passwordMatches("correct horse battery staple ", ENV)).toBe(false);
    expect(login("wrong", freshIp(), NOW, ENV)).toEqual({ ok: false, status: 401 });
    expect(login(12345, freshIp(), NOW, ENV)).toEqual({ ok: false, status: 401 });
    expect(login("x".repeat(300), freshIp(), NOW, ENV)).toEqual({ ok: false, status: 401 });
  });

  it("accepts the right password and sets an HttpOnly, Secure, SameSite=Strict cookie", () => {
    const r = login(ENV.ADMIN_PASSWORD, freshIp(), NOW, ENV);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cookie.startsWith(`${ADMIN_COOKIE}=`)).toBe(true);
    for (const attr of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/", `Max-Age=${SESSION_MS / 1000}`]) expect(r.cookie).toContain(attr);
    expect(r.cookie).not.toContain(ENV.ADMIN_PASSWORD!);
    expect(verifySession(tokenOf(r.cookie), NOW, ENV)).toBe(true);
  });

  it("rate limits per IP: after the limit even the right password is refused, other IPs are unaffected", () => {
    const ip = freshIp();
    for (let i = 0; i < LOGIN_LIMIT.attempts; i++) expect(login("wrong", ip, NOW, ENV)).toEqual({ ok: false, status: 401 });
    expect(login(ENV.ADMIN_PASSWORD, ip, NOW, ENV)).toEqual({ ok: false, status: 429 });
    expect(login(ENV.ADMIN_PASSWORD, freshIp(), NOW, ENV).ok).toBe(true);
    // The bucket refills over the window.
    expect(login(ENV.ADMIN_PASSWORD, ip, NOW + LOGIN_LIMIT.windowMs, ENV).ok).toBe(true);
  });
});

describe("admin session cookie", () => {
  const token = signSession(NOW, ENV);

  it("verifies a fresh token and expires it after the session length", () => {
    expect(verifySession(token, NOW + 1000, ENV)).toBe(true);
    expect(verifySession(token, NOW + SESSION_MS + 1, ENV)).toBe(false);
  });

  it("rejects tampered payloads, forged signatures and malformed tokens", () => {
    const [payload, sig] = token.split(".") as [string, string];
    const longer = Buffer.from(JSON.stringify({ v: 1, exp: NOW + 10 * SESSION_MS })).toString("base64url");
    expect(verifySession(`${longer}.${sig}`, NOW, ENV)).toBe(false);
    expect(verifySession(`${payload}.${sig.slice(0, -2)}AA`, NOW, ENV)).toBe(false);
    expect(verifySession(`${payload}.${sig}.x`, NOW, ENV)).toBe(false);
    for (const bad of ["", "abc", ".", `${payload}.`, null, undefined]) expect(verifySession(bad, NOW, ENV)).toBe(false);
  });

  it("is invalidated when the password or the relayer key changes", () => {
    expect(verifySession(token, NOW, { ...ENV, ADMIN_PASSWORD: "rotated password" })).toBe(false);
    expect(verifySession(token, NOW, { ...ENV, RELAYER_PRIVATE_KEY: "ed25519:other" })).toBe(false);
  });

  it("uses ADMIN_SECRET when set", () => {
    const env = { ...ENV, ADMIN_SECRET: "a-long-dedicated-admin-secret" };
    const t = signSession(NOW, env);
    expect(verifySession(t, NOW, env)).toBe(true);
    expect(verifySession(t, NOW, ENV)).toBe(false);
  });

  it("requireAdmin reads the cookie header", () => {
    const req = (cookie?: string) => new Request("https://oiko.test/api/admin/framing", { headers: cookie ? { cookie } : {} });
    expect(() => requireAdmin(req(`theme=dark; ${ADMIN_COOKIE}=${token}`), NOW, ENV)).not.toThrow();
    expect(() => requireAdmin(req(), NOW, ENV)).toThrow(expect.objectContaining({ status: 401 }));
    expect(() => requireAdmin(req(`${ADMIN_COOKIE}=${token}`), NOW, {})).toThrow(expect.objectContaining({ status: 404 }));
  });
});

describe("framing", () => {
  it("defaults to testnet, persists a valid switch and rejects anything else", async () => {
    const s = new MemoryStore();
    expect(await getFraming(s)).toBe("testnet");
    expect(await setFraming("mainnet", s)).toBe("mainnet");
    expect(await getFraming(s)).toBe("mainnet");
    await expect(setFraming("devnet", s)).rejects.toMatchObject({ status: 400 });
    await expect(setFraming(undefined, s)).rejects.toMatchObject({ status: 400 });
    expect(await getFraming(s)).toBe("mainnet");
    expect(await setFraming("testnet", s)).toBe("testnet");
    expect(await getFraming(s)).toBe("testnet");
  });

  it("falls back to testnet when the stored value is garbage or the store fails", async () => {
    const s = new MemoryStore();
    await s.setSetting("framing", { framing: "moon" });
    expect(await getFraming(s)).toBe("testnet");
    const broken = Object.assign(new MemoryStore(), { getSetting: async () => { throw new Error("db down"); } });
    expect(await getFraming(broken)).toBe("testnet");
  });
});
