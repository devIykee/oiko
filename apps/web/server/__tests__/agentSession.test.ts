import { beforeEach, describe, expect, it } from "vitest";
import { gatewayAuthHeader, keyPairFromSeed, type AgentView } from "@oiko/sdk";
import { authenticateBearer, authenticateToken, createSession, revokeSession, SESSION_MAX_MS, signSessionToken, verifySessionToken, type SessionEnv } from "../agentSession";
import type { ApiError } from "../errors";
import type { GatewayDeps } from "../gateway";
import { MemoryStore } from "../store";

const VAULT = "vault.ada.oiko.test.near";
const agent = keyPairFromSeed(new Uint8Array(32).fill(21));
const NOW = 1_800_000_000_000;
const ENV: SessionEnv = { AGENT_SESSION_SECRET: "test-only-session-secret" };

const policy = (p: Partial<AgentView> = {}): AgentView => ({
  label: "Coach", agent_name: "Grok coach", agent_url: "", scopes: ["read", "propose"], allowed_actions: ["save"], allowlist: [],
  per_tx: "0", daily: "0", weekly: "0", expires_at: String(BigInt(NOW + 30 * 86_400_000) * 1_000_000n), public_key: agent.publicKey,
  spent_day: [0, "0"], spent_week: [0, "0"], revoked: false, created_at: "0", ...p,
});

let keyOnChain: boolean;
let agentPolicy: AgentView;
let now: number;
let deps: GatewayDeps;
beforeEach(() => {
  keyOnChain = true; agentPolicy = policy(); now = NOW;
  deps = {
    now: () => now, store: new MemoryStore(),
    viewAccessKey: async (a, pk) => (keyOnChain && a === VAULT && pk === agent.publicKey ? { nonce: 1, permission: { FunctionCall: { receiver_id: VAULT, method_names: [] } } } : null),
    getAgent: async () => agentPolicy,
    isVaultId: (id) => id.startsWith("vault.") && id.endsWith(".oiko.test.near"),
  };
});
const signed = (body = "{}") => ({ method: "POST", path: "/api/agent/session", body, authorization: gatewayAuthHeader(agent.secretKey, VAULT, "POST", "/api/agent/session", body, now) });
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as ApiError).code; } };

describe("hosted agent sessions", () => {
  it("a signed request gets a bearer token scoped to the vault + key, capped at 24 h", async () => {
    const s = await createSession(signed(), 48 * 3_600_000, deps, ENV);
    expect(s.vault).toBe(VAULT);
    expect(s.public_key).toBe(agent.publicKey);
    expect(Date.parse(s.expires_at) - NOW).toBe(SESSION_MAX_MS);
    const ctx = await authenticateBearer(`Bearer ${s.token}`, "read", deps, ENV);
    expect(ctx.vaultId).toBe(VAULT);
    expect(ctx.policy.agent_name).toBe("Grok coach");
  });

  it("never outlives the agent's own expiry", async () => {
    agentPolicy = policy({ expires_at: String(BigInt(NOW + 3_600_000) * 1_000_000n) });
    const s = await createSession(signed(), undefined, deps, ENV);
    expect(Date.parse(s.expires_at)).toBe(NOW + 3_600_000);
  });

  it("needs a valid NEP-413 signature to start (no key, no session)", async () => {
    const forged = { ...signed(), authorization: gatewayAuthHeader(keyPairFromSeed(new Uint8Array(32).fill(9)).secretKey, VAULT, "POST", "/api/agent/session", "{}", now) };
    expect(await code(createSession(forged, undefined, deps, ENV))).toBe("E_KEY_GONE");
  });

  it("Disconnect (key deleted on chain) kills an existing token on the very next request", async () => {
    const s = await createSession(signed(), undefined, deps, ENV);
    expect(await code(authenticateToken(s.token, "read", deps, ENV))).toBe("OK");
    keyOnChain = false;
    expect(await code(authenticateToken(s.token, "read", deps, ENV))).toBe("E_KEY_GONE");
  });

  it("revoked agent policy, expiry and explicit session revoke all end access", async () => {
    const s = await createSession(signed(), 3_600_000, deps, ENV);
    agentPolicy = policy({ revoked: true });
    expect(await code(authenticateToken(s.token, "read", deps, ENV))).toBe("E_AGENT_REVOKED");
    agentPolicy = policy();
    now = NOW + 3_600_001;
    expect(await code(authenticateToken(s.token, "read", deps, ENV))).toBe("E_AUTH");
    now = NOW;
    expect(await revokeSession(`Bearer ${s.token}`, deps, ENV)).toEqual({ ok: true });
    expect(await code(authenticateToken(s.token, "read", deps, ENV))).toBe("E_AUTH");
  });

  it("rejects tampered, foreign-secret, overlong and malformed tokens", async () => {
    const s = await createSession(signed(), undefined, deps, ENV);
    const [p, body, sig] = s.token.split(".");
    const other = Buffer.from(JSON.stringify({ v: 1, sid: "x", vault: "vault.eve.oiko.test.near", pk: agent.publicKey, exp: NOW + 1000 })).toString("base64url");
    expect(verifySessionToken(`${p}.${other}.${sig}`, NOW, ENV)).toBeNull();
    expect(verifySessionToken(s.token, NOW, { AGENT_SESSION_SECRET: "another" })).toBeNull();
    expect(verifySessionToken(signSessionToken({ v: 1, sid: "s", vault: VAULT, pk: agent.publicKey, exp: NOW + 30 * 86_400_000 }, ENV), NOW, ENV)).toBeNull();
    for (const bad of ["", "abc", `${p}.${body}`, `x.${body}.${sig}`]) expect(verifySessionToken(bad, NOW, ENV)).toBeNull();
    expect(await code(authenticateBearer(null, "read", deps, ENV))).toBe("E_AUTH");
    expect(await code(authenticateBearer(`NEP413 ${s.token}`, "read", deps, ENV))).toBe("E_AUTH");
  });

  it("is disabled when no server secret is configured", async () => {
    expect(await code(createSession(signed(), undefined, deps, {}))).toBe("E_DISABLED");
  });
});
