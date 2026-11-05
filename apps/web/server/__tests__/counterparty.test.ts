import { beforeEach, describe, expect, it } from "vitest";
import { act as actions, b64encode, gatewayAuthHeader, keyPairFromSeed, signTransactionBytes, type Activity, type AgentView, type NearRpc } from "@oiko/sdk";
import { createTransaction, encodeTransaction, PublicKey } from "near-api-js";
import { agentDecision, checkCounterparty, EMPTY_CODE_HASH, nearBlocksClient, type CounterpartyDeps, type NearBlocksApi } from "../counterparty";
import { agentReport } from "../counterpartyHttp";
import { ApiError } from "../errors";
import { enforceCounterparty, payReceiverOfSignedTx, prepare, type AuthedAgent, type GatewayDeps } from "../gateway";
import { resetLimitsForTests } from "../ratelimit";
import { MemoryStore } from "../store";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const VAULT = "vault.ada.oiko.testnet";
const OLD = NOW - 400 * DAY;

type Acct = { code_hash?: string; created?: number | null; txns?: number; deployedAt?: number | null };
let accounts: Record<string, Acct>;
let activity: Activity[];
let store: MemoryStore;
let nbDown: boolean;
let rpcDown: boolean;

const nb: NearBlocksApi = {
  async createdAtMs(id) { if (nbDown) throw new Error("429"); return accounts[id]?.created ?? null; },
  async txCount(id) { if (nbDown) throw new Error("429"); return accounts[id]?.txns ?? 0; },
  async lastDeployMs(id) { if (nbDown) throw new Error("429"); return accounts[id]?.deployedAt ?? null; },
};
function deps(over: Partial<CounterpartyDeps> = {}): CounterpartyDeps {
  return {
    network: "testnet", now: () => NOW,
    viewAccount: async (id) => {
      if (rpcDown) throw new Error("RPC HTTP 503");
      const a = accounts[id];
      return a ? { amount: "1", code_hash: a.code_hash ?? EMPTY_CODE_HASH, storage_usage: 100 } : null;
    },
    nearblocks: nb, vaultActivity: async () => activity, store,
    isOikoAccount: (id) => id === "usdt.oiko.testnet" || id === "oiko.testnet",
    firstTimeThreshold: 10_000_000n, blockReports: 1, ...over,
  };
}
const act = (kind: string, counterparty: string): Activity => ({ seq: 1, at: "0", kind, by: "owner", token: "usdt", amount: "1", pot_id: 0, counterparty, note: null });
const codes = (r: { reasons: Array<{ code: string }> }) => r.reasons.map((x) => x.code);

beforeEach(() => {
  accounts = {
    "landlord.testnet": { created: OLD, txns: 300 },
    "fresh.testnet": { created: NOW - 2 * DAY, txns: 40 },
    "quiet.testnet": { created: OLD, txns: 2 },
    "dex.testnet": { code_hash: "8Vt1Code", created: OLD, txns: 9000, deployedAt: OLD },
    "upgraded.testnet": { code_hash: "NewCode", created: OLD, txns: 9000, deployedAt: NOW - 1 * DAY },
  };
  activity = [];
  store = new MemoryStore();
  nbDown = false;
  rpcDown = false;
});

describe("counterparty verdict rules", () => {
  it("allows an old, active account the vault has paid before", async () => {
    activity = [act("withdrawn", "landlord.testnet")];
    const r = await checkCounterparty({ agentVault: VAULT, receiver: "landlord.testnet", amount: "50000000" }, deps());
    expect(r.verdict).toBe("allow");
    expect(codes(r)).toContain("PRIOR_PAYMENTS");
    expect(r.score).toBe(0);
    expect(r.sources).toContain("rpc:query view_account");
  });
  it("counts prior payments from the gateway access log too", async () => {
    await store.logAccess({ vaultId: VAULT, publicKey: "ed25519:x", method: "POST", path: "/api/agent/submit", status: 200, code: null, tool: "submit", txHash: "h", receiver: "landlord.testnet" });
    const r = await checkCounterparty({ agentVault: VAULT, receiver: "landlord.testnet", amount: "50000000" }, deps());
    expect(r.verdict).toBe("allow");
  });
  it("warns on a first-time receiver above the threshold, not below it", async () => {
    expect(codes(await checkCounterparty({ agentVault: VAULT, receiver: "landlord.testnet", amount: "50000000" }, deps()))).toContain("FIRST_TIME_RECEIVER");
    const small = await checkCounterparty({ agentVault: VAULT, receiver: "landlord.testnet", amount: "5000000" }, deps());
    expect(small.verdict).toBe("allow");
    expect(codes(small)).toContain("FIRST_TIME_RECEIVER_SMALL");
  });
  it("blocks an account that doesn't exist; warns on an unused implicit account", async () => {
    const r = await checkCounterparty({ receiver: "nobody-here.testnet" }, deps());
    expect(r.verdict).toBe("block");
    expect(codes(r)).toContain("ACCOUNT_NOT_FOUND");
    const imp = await checkCounterparty({ receiver: "a".repeat(64) }, deps());
    expect(imp.verdict).toBe("warn");
    expect(codes(imp)).toEqual(["IMPLICIT_UNUSED"]);
  });
  it("warns on an invalid account id and on paying the vault itself", async () => {
    expect((await checkCounterparty({ receiver: "Not An Account!" }, deps())).reasons[0]!.code).toBe("INVALID_ACCOUNT_ID");
    accounts[VAULT] = { created: OLD, txns: 100 };
    expect(codes(await checkCounterparty({ agentVault: VAULT, receiver: VAULT }, deps()))).toContain("SELF_PAYMENT");
  });
  it("allows Oiko's own contracts outright", async () => {
    const r = await checkCounterparty({ agentVault: VAULT, receiver: "usdt.oiko.testnet", amount: "999000000" }, deps());
    expect(r).toMatchObject({ verdict: "allow" });
    expect(codes(r)).toEqual(["OIKO_CONTRACT"]);
  });
  it("warns on a brand-new account, notes a young one", async () => {
    expect(codes(await checkCounterparty({ receiver: "fresh.testnet" }, deps()))).toContain("NEW_ACCOUNT");
    accounts["fresh.testnet"]!.created = NOW - 20 * DAY;
    const r = await checkCounterparty({ receiver: "fresh.testnet" }, deps());
    expect(r.verdict).toBe("allow");
    expect(codes(r)).toContain("YOUNG_ACCOUNT");
  });
  it("warns on low activity", async () => {
    const r = await checkCounterparty({ receiver: "quiet.testnet" }, deps());
    expect(r.verdict).toBe("warn");
    expect(codes(r)).toEqual(["LOW_ACTIVITY", "ACCOUNT_AGE"]);
  });
  it("degrades to warn when NearBlocks or RPC are unavailable; info on networks without NearBlocks", async () => {
    nbDown = true;
    expect(codes(await checkCounterparty({ receiver: "landlord.testnet" }, deps()))).toContain("HISTORY_UNKNOWN");
    nbDown = false;
    rpcDown = true;
    const r = await checkCounterparty({ receiver: "landlord.testnet" }, deps());
    expect(r.verdict).toBe("warn");
    expect(codes(r)).toContain("RPC_UNAVAILABLE");
    rpcDown = false;
    const local = await checkCounterparty({ receiver: "landlord.testnet" }, deps({ nearblocks: null, network: "local" }));
    expect(local.verdict).toBe("allow");
    expect(codes(local)).toContain("HISTORY_NOT_AVAILABLE");
  });
  it("flags contracts and recent code changes (NearBlocks deployments, then the cached code hash)", async () => {
    const dex = await checkCounterparty({ receiver: "dex.testnet" }, deps());
    expect(dex.verdict).toBe("allow");
    expect(codes(dex)).toContain("IS_CONTRACT");
    expect(codes(await checkCounterparty({ receiver: "upgraded.testnet" }, deps()))).toContain("CODE_CHANGED_RECENTLY");
    // Without NearBlocks: first sighting caches the hash; a later different hash warns.
    const noNb = deps({ nearblocks: null });
    expect((await checkCounterparty({ receiver: "dex.testnet" }, noNb)).verdict).toBe("allow");
    accounts["dex.testnet"]!.code_hash = "SwappedCode";
    const changed = await checkCounterparty({ receiver: "dex.testnet" }, noNb);
    expect(changed.verdict).toBe("warn");
    expect(changed.reasons.find((x) => x.code === "CODE_CHANGED_RECENTLY")!.evidence).toContain("SwappedCode");
  });
  it("blocks on the seed list and on a verified report; threshold is configurable", async () => {
    const seed = await checkCounterparty({ receiver: "urgent-refund-desk.testnet" }, deps());
    expect(seed.verdict).toBe("block");
    expect(seed.reasons[0]).toMatchObject({ code: "REPORTED", severity: "block" });
    expect(seed.reasons[0]!.evidence).toBeTruthy();
    await store.addReport({ receiver: "landlord.testnet", reason: "Asked for payment to unlock a refund", evidence: "email text", reporter: "agent:ed25519:x", reporterVault: "vault.bob.oiko.testnet", verified: true });
    expect((await checkCounterparty({ receiver: "landlord.testnet" }, deps())).verdict).toBe("block");
    const two = await checkCounterparty({ receiver: "landlord.testnet" }, deps({ blockReports: 2 }));
    expect(two.verdict).toBe("warn");
    expect(codes(two)).toContain("REPORTED_ONCE");
  });
});

describe("agent decision", () => {
  const base = { receiver: "x.testnet", score: 20, checkedAt: "", sources: [] };
  const warn = (...c: string[]) => ({ ...base, verdict: "warn" as const, reasons: c.map((code) => ({ code, severity: "warn" as const, message: code })) });
  it("block refuses act and propose; warn refuses act only", () => {
    const b = { ...base, verdict: "block" as const, reasons: [{ code: "REPORTED", severity: "block" as const, message: "Reported." }] };
    expect(agentDecision(b, "act", true)).toMatchObject({ ok: false, code: "E_COUNTERPARTY_BLOCKED" });
    expect(agentDecision(b, "propose", true)).toMatchObject({ ok: false, code: "E_COUNTERPARTY_BLOCKED" });
    expect(agentDecision(warn("NEW_ACCOUNT"), "act", false)).toMatchObject({ ok: false, code: "E_COUNTERPARTY_WARN" });
    expect(agentDecision(warn("NEW_ACCOUNT"), "propose", false).ok).toBe(true);
  });
  it("allowlist exception covers low-activity warnings only", () => {
    expect(agentDecision(warn("LOW_ACTIVITY", "FIRST_TIME_RECEIVER"), "act", true).ok).toBe(true);
    expect(agentDecision(warn("LOW_ACTIVITY"), "act", false).ok).toBe(false);
    expect(agentDecision(warn("LOW_ACTIVITY", "NEW_ACCOUNT"), "act", true).ok).toBe(false);
    expect(agentDecision(warn("HISTORY_UNKNOWN"), "act", true).ok).toBe(false);
    expect(agentDecision(warn("CODE_CHANGED_RECENTLY"), "act", true).ok).toBe(false);
  });
});

describe("gateway enforcement", () => {
  const agent = keyPairFromSeed(new Uint8Array(32).fill(41));
  const policy = (p: Partial<AgentView> = {}): AgentView => ({
    label: "Bills", agent_name: "Test", agent_url: "https://example.com", scopes: ["read", "propose", "act"], allowed_actions: ["pay"],
    allowlist: [{ type: "near", account_id: "quiet.testnet" }], per_tx: "100000000", daily: "100000000", weekly: "300000000",
    expires_at: String(BigInt(NOW + DAY) * 1_000_000n), public_key: agent.publicKey, spent_day: [0, "0"], spent_week: [0, "0"], revoked: false, created_at: "0", ...p,
  });
  const ctx: AuthedAgent = { kind: "agent", vaultId: VAULT, publicKey: agent.publicKey, policy: policy() };
  const r = { view: async () => [{ id: 3, name: "Rent", amount: "50000000", token: "usdt", due_day: 1, payee: "urgent-refund-desk.testnet", pot_id: 0, last_paid_month: null, created_at: "0" }] } as unknown as NearRpc;
  const check = (i: Parameters<typeof checkCounterparty>[0]) => checkCounterparty(i, deps());
  const pay = (to: string, amount = "50000000") => ({ type: "pay" as const, token: "usdt" as const, amount, to, memo: null });
  async function err(p: Promise<unknown>) {
    try { await p; return null; } catch (e) { return e as ApiError; }
  }

  it("refuses to prepare a payment to a blocked receiver (act and propose), with reasons", async () => {
    const e = await err(prepare(ctx, "act", pay("urgent-refund-desk.testnet"), undefined, r, check));
    expect(e?.code).toBe("E_COUNTERPARTY_BLOCKED");
    expect(e?.status).toBe(403);
    expect((e?.details?.counterparty as { reasons: unknown[] }).reasons.length).toBeGreaterThan(0);
    expect((await err(prepare(ctx, "propose", pay("urgent-refund-desk.testnet"), "pay it", r, check)))?.code).toBe("E_COUNTERPARTY_BLOCKED");
  });
  it("resolves pay_bill payees and checks them", async () => {
    expect((await err(prepare(ctx, "act", { type: "pay_bill", bill_id: 3 }, undefined, r, check)))?.code).toBe("E_COUNTERPARTY_BLOCKED");
  });
  it("refuses act on warn and points to propose; allows propose", async () => {
    const e = await err(prepare(ctx, "act", pay("fresh.testnet"), undefined, r, check));
    expect(e?.code).toBe("E_COUNTERPARTY_WARN");
    expect(e?.details?.next).toBe("propose");
    expect(e?.message).toMatch(/propose/);
    const ok = await enforceCounterparty(ctx, "propose", pay("fresh.testnet"), r, check);
    expect(ok?.result.verdict).toBe("warn");
  });
  it("lets act through for an allowlisted, low-activity receiver only", async () => {
    const ok = await enforceCounterparty(ctx, "act", pay("quiet.testnet"), r, check);
    expect(ok?.note).toMatch(/allowlist/);
    const off = { ...ctx, policy: policy({ allowlist: [] }) };
    expect((await err(enforceCounterparty(off, "act", pay("quiet.testnet"), r, check)))?.code).toBe("E_COUNTERPARTY_WARN");
  });
  it("extracts the pay receiver from a signed agent_execute (access-log prior-payment signal)", () => {
    const signed = (method: string, args: object) => b64encode(signTransactionBytes(agent.secretKey, encodeTransaction(createTransaction(VAULT, PublicKey.fromString(agent.publicKey), VAULT, 1n, [actions.functionCall(method, args, 1n, 0n)], new Uint8Array(32)))).signedTx);
    expect(payReceiverOfSignedTx(signed("agent_execute", { action: pay("landlord.testnet") }))).toBe("landlord.testnet");
    expect(payReceiverOfSignedTx(signed("agent_propose", { action: pay("landlord.testnet"), reason: "x" }))).toBeNull();
    expect(payReceiverOfSignedTx("garbage")).toBeNull();
  });
  it("skips the check for moves between pots", async () => {
    expect(await enforceCounterparty(ctx, "act", { type: "save", to_pot: 1, token: "usdt", amount: "1" }, r, check)).toBeNull();
  });
});

describe("POST /api/agent/report", () => {
  const agent = keyPairFromSeed(new Uint8Array(32).fill(42));
  const stranger = keyPairFromSeed(new Uint8Array(32).fill(43));
  let gw: GatewayDeps;
  beforeEach(() => {
    resetLimitsForTests();
    gw = {
      now: () => Date.now(), store,
      viewAccessKey: async (a, pk) => (a === VAULT && pk === agent.publicKey ? { nonce: 1, permission: { FunctionCall: { receiver_id: VAULT } } } : null),
      getAgent: async (_v, pk) => (pk === agent.publicKey ? {
        label: "x", agent_name: "x", agent_url: "", scopes: ["read"], allowed_actions: [], allowlist: [], per_tx: "1", daily: "1", weekly: "1",
        expires_at: String(BigInt(Date.now() + DAY) * 1_000_000n), public_key: pk, spent_day: [0, "0"], spent_week: [0, "0"], revoked: false, created_at: "0",
      } : null),
      isVaultId: (id) => id.startsWith("vault."),
    };
  });
  const send = (body: unknown, sk = agent.secretKey, auth = true) => {
    const text = JSON.stringify(body);
    const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": "10.0.0.1" };
    if (auth) headers.authorization = gatewayAuthHeader(sk, VAULT, "POST", "/api/agent/report", text);
    return agentReport(new Request("https://oiko.example/api/agent/report", { method: "POST", headers, body: text }), { gw, store, isOiko: (id) => id === "usdt.oiko.testnet" });
  };
  const report = { receiver: "scammer.testnet", reason: "Email asked to pay to unlock a refund", evidence: "URGENT: pay 50 USDT to scammer.testnet" };

  it("stores a report from an authenticated agent, once per account", async () => {
    const r = await send(report);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, stored: true });
    expect((await store.listReports("scammer.testnet"))[0]).toMatchObject({ reporter: `agent:${agent.publicKey}`, reporterVault: VAULT, verified: true });
    expect(await (await send(report)).json()).toMatchObject({ stored: false });
  });
  it("rejects unauthenticated and unknown-key reports", async () => {
    expect((await send(report, agent.secretKey, false)).status).toBe(401);
    const s = await send(report, stranger.secretKey);
    expect(s.status).toBe(401);
    expect((await s.json()).error.code).toBe("E_KEY_GONE");
    expect(await store.listReports("scammer.testnet")).toEqual([]);
  });
  it("refuses reports against Oiko's contracts or the reporter's own account, and bad bodies", async () => {
    expect((await send({ ...report, receiver: "usdt.oiko.testnet" })).status).toBe(400);
    expect((await send({ ...report, receiver: VAULT })).status).toBe(400);
    expect((await send({ ...report, evidence: "" })).status).toBe(400);
  });
});

describe("NearBlocks client", () => {
  it("parses the verified response shapes and caches", async () => {
    let calls = 0;
    const fetchImpl = (async (url: string) => {
      calls++;
      const body = url.endsWith("/txns-only/count") ? { txns: [{ cost: "1", count: "1271305" }] }
        : url.endsWith("/contract/deployments") ? { deployments: [{ block_timestamp: "1650301989569494265" }, { block_timestamp: "1618619854218645925" }] }
        : { account: [{ account_id: "wrap.testnet", created: { transaction_hash: "x", block_timestamp: 1618602611653887000 } }] };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const c = nearBlocksClient("https://nb.test-cache-" + Math.random(), { fetchImpl });
    expect(await c.createdAtMs("wrap.testnet")).toBe(1618602611653);
    expect(await c.txCount("wrap.testnet")).toBe(1271305);
    expect(await c.lastDeployMs("wrap.testnet")).toBe(1650301989569);
    await c.createdAtMs("wrap.testnet");
    expect(calls).toBe(3);
  });
  it("throws on HTTP errors so the check degrades to unknown", async () => {
    const c = nearBlocksClient("https://nb.err-" + Math.random(), { fetchImpl: (async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch });
    await expect(c.txCount("x.testnet")).rejects.toThrow(/429/);
  });
});

describe("verified billers", () => {
  it("allows a verified biller even though it is days old with little history", async () => {
    accounts["metro-power-co.testnet"] = { created: NOW - 2 * DAY, txns: 2 };
    const r = await checkCounterparty({ receiver: "metro-power-co.testnet", agentVault: VAULT, amount: "500000000" }, deps());
    expect(r.verdict).toBe("allow");
    expect(codes(r)).toContain("VERIFIED_BILLER");
    expect(codes(r)).not.toContain("NEW_ACCOUNT");
    expect(agentDecision(r, "act", false).ok).toBe(true);
  });
  it("still blocks a verified biller that has been reported", async () => {
    await store.addReport({ receiver: "brightline-fibre.testnet", reason: "Asked for payment to a new account", evidence: "screenshot", reporter: "x", reporterVault: "vault.x.oiko.testnet", verified: true });
    const r = await checkCounterparty({ receiver: "brightline-fibre.testnet", agentVault: VAULT }, deps());
    expect(r.verdict).toBe("block");
    expect(codes(r)).toEqual(expect.arrayContaining(["REPORTED", "VERIFIED_BILLER"]));
  });
  it("is network-scoped: the testnet biller id means nothing on mainnet", async () => {
    accounts["metro-power-co.testnet"] = { created: NOW - 2 * DAY, txns: 2 };
    const r = await checkCounterparty({ receiver: "metro-power-co.testnet", agentVault: VAULT }, deps({ network: "mainnet" }));
    expect(codes(r)).not.toContain("VERIFIED_BILLER");
    expect(r.verdict).toBe("warn");
  });
});
