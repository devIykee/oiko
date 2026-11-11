import { beforeEach, describe, expect, it } from "vitest";
import { gatewayAuthHeader, keyPairFromSeed, signNep413, b64encode, utf8, type AgentView } from "@oiko/sdk";
import { authenticateAgent, authenticateOwner, checkAgentTx, remainingCaps, verifiedAgentOf, type GatewayDeps } from "../gateway";
import { MemoryStore } from "../store";
import { ApiError } from "../errors";
import { act } from "@oiko/sdk";
import { createTransaction, encodeTransaction, PublicKey } from "near-api-js";
import { signTransactionBytes } from "@oiko/sdk";

const VAULT = "vault.ada.oiko.test.near";
const agent = keyPairFromSeed(new Uint8Array(32).fill(11));
const stranger = keyPairFromSeed(new Uint8Array(32).fill(12));
const NOW = 1_800_000_000_000;

const policy = (p: Partial<AgentView> = {}): AgentView => ({
  label: "Bill payer", agent_name: "Test agent", agent_url: "https://example.com", scopes: ["read", "act"], allowed_actions: ["pay"],
  allowlist: [{ type: "near", account_id: "landlord.near" }], per_tx: "50000000", daily: "100000000", weekly: "300000000",
  expires_at: String(BigInt(NOW + 86_400_000) * 1_000_000n), public_key: agent.publicKey, spent_day: [0, "0"], spent_week: [0, "0"],
  revoked: false, created_at: "0", ...p,
});

let keys: Map<string, unknown>;
let agents: Map<string, AgentView>;
let deps: GatewayDeps;
beforeEach(() => {
  keys = new Map<string, unknown>([[`${VAULT}|${agent.publicKey}`, { FunctionCall: { receiver_id: VAULT, method_names: ["agent_execute", "agent_propose"] } }], [`ada.oiko.test.near|${agent.publicKey}`, "FullAccess"]]);
  agents = new Map([[agent.publicKey, policy()]]);
  deps = {
    now: () => NOW, store: new MemoryStore(),
    viewAccessKey: async (a, pk) => (keys.has(`${a}|${pk}`) ? { nonce: 1, permission: keys.get(`${a}|${pk}`) } : null),
    getAgent: async (_v, pk) => agents.get(pk) ?? null,
    isVaultId: (id) => id.startsWith("vault.") && id.endsWith(".oiko.test.near"),
  };
});

const req = (method: string, path: string, body = "", sk = agent.secretKey, account = VAULT, ts = NOW) =>
  ({ method, path, body, authorization: gatewayAuthHeader(sk, account, method, path, body, ts) });
async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    return (e as ApiError).code;
  }
}

describe("gateway auth", () => {
  it("accepts a valid signed request", async () => {
    const ctx = await authenticateAgent(req("GET", "/api/agent/overview"), "read", deps);
    expect(ctx.vaultId).toBe(VAULT);
    expect(ctx.publicKey).toBe(agent.publicKey);
  });
  it("rejects a replayed nonce", async () => {
    const r = req("GET", "/api/agent/overview");
    expect(await code(authenticateAgent(r, "read", deps))).toBe("OK");
    expect(await code(authenticateAgent(r, "read", deps))).toBe("E_REPLAY");
  });
  it("rejects stale and future timestamps (5 minute window)", async () => {
    expect(await code(authenticateAgent(req("GET", "/api/agent/me", "", agent.secretKey, VAULT, NOW - 301_000), "read", deps))).toBe("E_STALE");
    expect(await code(authenticateAgent(req("GET", "/api/agent/me", "", agent.secretKey, VAULT, NOW + 301_000), "read", deps))).toBe("E_STALE");
    expect(await code(authenticateAgent(req("GET", "/api/agent/me", "", agent.secretKey, VAULT, NOW - 299_000), "read", deps))).toBe("OK");
  });
  it("rejects a key that is not on the vault", async () => {
    expect(await code(authenticateAgent(req("GET", "/api/agent/me", "", stranger.secretKey), "read", deps))).toBe("E_KEY_GONE");
  });
  it("rejects a forged signature (header claims another key)", async () => {
    const r = req("GET", "/api/agent/me", "", stranger.secretKey);
    const json = JSON.parse(Buffer.from(r.authorization.slice(7), "base64").toString());
    json.publicKey = agent.publicKey;
    r.authorization = "NEP413 " + Buffer.from(JSON.stringify(json)).toString("base64");
    expect(await code(authenticateAgent(r, "read", deps))).toBe("E_AUTH");
  });
  it("rejects wrong recipient", async () => {
    const message = `GET /api/agent/me\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\n${NOW}`;
    const s = signNep413(agent.secretKey, { message, recipient: "someone-else" });
    const authorization = "NEP413 " + b64encode(utf8(JSON.stringify({ accountId: VAULT, publicKey: s.publicKey, signature: s.signature, nonce: s.nonce, message })));
    expect(await code(authenticateAgent({ method: "GET", path: "/api/agent/me", body: "", authorization }, "read", deps))).toBe("E_AUTH");
  });
  it("binds method, path and body", async () => {
    const r = req("POST", "/api/agent/prepare", '{"a":1}');
    expect(await code(authenticateAgent({ ...r, body: '{"a":2}' }, null, deps))).toBe("E_AUTH");
    expect(await code(authenticateAgent({ ...req("GET", "/api/agent/me"), path: "/api/agent/overview" }, "read", deps))).toBe("E_AUTH");
    expect(await code(authenticateAgent({ ...req("GET", "/api/agent/activity?limit=5"), path: "/api/agent/activity?limit=100" }, "read", deps))).toBe("E_AUTH");
  });
  it("rejects revoked (key deleted), revoked (flag), expired, and missing scope", async () => {
    agents.set(agent.publicKey, policy({ revoked: true }));
    expect(await code(authenticateAgent(req("GET", "/api/agent/me"), "read", deps))).toBe("E_AGENT_REVOKED");
    agents.set(agent.publicKey, policy({ expires_at: String(BigInt(NOW - 1) * 1_000_000n) }));
    expect(await code(authenticateAgent(req("GET", "/api/agent/me"), "read", deps))).toBe("E_AGENT_EXPIRED");
    agents.set(agent.publicKey, policy({ scopes: ["read"] }));
    expect(await code(authenticateAgent(req("POST", "/api/agent/prepare", "{}"), "act", deps))).toBe("E_SCOPE");
    keys.delete(`${VAULT}|${agent.publicKey}`); // revoke_agent deletes the key
    expect(await code(authenticateAgent(req("GET", "/api/agent/me"), "read", deps))).toBe("E_KEY_GONE");
  });
  it("rejects a non-vault accountId and a missing header", async () => {
    expect(await code(authenticateAgent(req("GET", "/api/agent/me", "", agent.secretKey, "ada.oiko.test.near"), "read", deps))).toBe("E_AUTH");
    expect(await code(authenticateAgent({ method: "GET", path: "/x", body: "", authorization: null }, "read", deps))).toBe("E_AUTH");
  });
  it("owner auth uses a key on the owner's name account", async () => {
    const o = await authenticateOwner(req("GET", "/api/agent/log", "", agent.secretKey, "ada.oiko.test.near"), deps);
    expect(o.accountId).toBe("ada.oiko.test.near");
    expect(await code(authenticateOwner(req("GET", "/api/agent/log", "", stranger.secretKey, "ada.oiko.test.near"), deps))).toBe("E_KEY_GONE");
  });
});

describe("caps and submitted transactions", () => {
  it("computes remaining caps for the current day/week windows", () => {
    const day = Math.floor(NOW / 86_400_000), week = Math.floor(NOW / 604_800_000);
    const c = remainingCaps(policy({ spent_day: [day, "30000000"], spent_week: [week - 1, "999"] }), NOW);
    expect(c.day.remaining.units).toBe("70000000");
    expect(c.week.used.units).toBe("0");
    expect(c.day.remaining.display).toBe("70.00 USDC + USDT");
  });
  it("only accepts one agent_execute/agent_propose call by this agent on its vault", () => {
    const ctx = { kind: "agent" as const, vaultId: VAULT, publicKey: agent.publicKey, policy: policy() };
    const mk = (sk: string, signer: string, receiver: string, method: string, deposit = 0n) => {
      const pk = keyPairFromSeed(sk === agent.secretKey ? new Uint8Array(32).fill(11) : new Uint8Array(32).fill(12)).publicKey;
      const tx = createTransaction(signer, PublicKey.fromString(pk), receiver, 2n, [act.functionCall(method, {}, 10n ** 14n, deposit)], new Uint8Array(32));
      return b64encode(signTransactionBytes(sk, encodeTransaction(tx)).signedTx);
    };
    expect(checkAgentTx(ctx, mk(agent.secretKey, VAULT, VAULT, "agent_execute")).method).toBe("agent_execute");
    const c = (s: string) => { try { checkAgentTx(ctx, s); return "OK"; } catch (e) { return (e as ApiError).code; } };
    expect(c(mk(agent.secretKey, VAULT, VAULT, "withdraw"))).toBe("E_BAD_REQUEST");
    expect(c(mk(agent.secretKey, VAULT, "usdc.oiko.test.near", "agent_execute"))).toBe("E_AUTH");
    expect(c(mk(stranger.secretKey, VAULT, VAULT, "agent_execute"))).toBe("E_AUTH");
    expect(c(mk(agent.secretKey, VAULT, VAULT, "agent_propose"))).toBe("E_SCOPE"); // policy has no "propose"
  });
});

describe("access log only records proven identities (review S-3)", () => {
  async function verifiedOf(p: Promise<unknown>) {
    try { await p; return "OK"; } catch (e) { return verifiedAgentOf(e); }
  }
  it("a policy refusal after a valid signature carries the verified identity", async () => {
    agents.set(agent.publicKey, policy({ scopes: ["read"] }));
    expect(await verifiedOf(authenticateAgent(req("POST", "/api/agent/prepare"), "act", deps))).toEqual({ vaultId: VAULT, publicKey: agent.publicKey });
  });
  it("a stranger's key, a key not on that vault, or a bad signature carries no identity", async () => {
    expect(await verifiedOf(authenticateAgent(req("GET", "/api/agent/me", "", stranger.secretKey), "read", deps))).toBeNull();
    keys.delete(`${VAULT}|${agent.publicKey}`);
    expect(await verifiedOf(authenticateAgent(req("GET", "/api/agent/me"), "read", deps))).toBeNull();
    expect(await verifiedOf(authenticateAgent({ method: "GET", path: "/api/agent/me", body: "", authorization: "NEP413 garbage" }, "read", deps))).toBeNull();
  });
});
