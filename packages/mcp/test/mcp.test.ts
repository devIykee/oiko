import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { encodeConnectionString, decodeConnectionString, keyPairFromSeed, parseGatewayAuthHeader, verifyNep413, parseGatewayMessage, sha256Hex } from "@oiko/sdk";
import { createOikoMcpServer, GatewayBackend, TOOL_NAMES, type OikoBackend } from "../src";
import { connectionFromEnv } from "../src/env";

async function connect(backend: OikoBackend) {
  const server = createOikoMcpServer(backend);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe("Oiko MCP tools", () => {
  it("exposes exactly the documented tools with descriptions", async () => {
    const client = await connect({ canSign: true, read: async () => ({}), run: async () => ({}) });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    for (const t of tools) expect((t.description ?? "").length).toBeGreaterThan(40);
    const act = tools.find((t) => t.name === "act")!;
    expect(JSON.stringify(act.inputSchema)).toContain("pay_bill");
  });
  it("routes reads and actions to the backend and reports errors as tool errors", async () => {
    const calls: unknown[] = [];
    const client = await connect({
      canSign: true,
      read: async (tool, params) => { calls.push([tool, params]); return { tool }; },
      run: async (kind, action) => { if (kind === "act") throw Object.assign(new Error("That's over the agent's per-payment limit."), { code: "E_AGENT_PER_TX" }); return { ok: true, action }; },
    });
    const r = await client.callTool({ name: "get_activity", arguments: { limit: 5 } });
    expect(calls).toEqual([["activity", { limit: "5" }]]);
    expect(JSON.parse((r.content as Array<{ text: string }>)[0]!.text)).toEqual({ tool: "activity" });
    const action = { type: "pay", token: "usdt", amount: "1000000", to: "landlord.near", memo: null };
    const bad = await client.callTool({ name: "act", arguments: { action } });
    expect(bad.isError).toBe(true);
    expect((bad.content as Array<{ text: string }>)[0]!.text).toContain("E_AGENT_PER_TX");
    const ok = await client.callTool({ name: "propose", arguments: { action, reason: "Rent is due Friday." } });
    expect(ok.isError).toBeFalsy();
    const invalid = await client.callTool({ name: "act", arguments: { action: { type: "pay", token: "eur", amount: "1", to: "x.near" } } });
    expect(invalid.isError).toBe(true);
  });
});

describe("stdio backend", () => {
  const kp = keyPairFromSeed(new Uint8Array(32).fill(31));
  const conn = { api: "https://oiko.example", vault: "vault.ada.oiko.testnet", sk: kp.secretKey };
  it("connection strings round-trip and env parsing works", () => {
    const s = encodeConnectionString(conn);
    expect(s.startsWith("oiko1:")).toBe(true);
    expect(decodeConnectionString(s)).toEqual(conn);
    expect(connectionFromEnv({ OIKO_CONNECTION: s })).toEqual(conn);
    expect(connectionFromEnv({ OIKO_AGENT_KEY: kp.secretKey, OIKO_VAULT_ID: conn.vault, OIKO_API_URL: "https://oiko.example/" })).toEqual(conn);
    expect(() => connectionFromEnv({})).toThrow(/OIKO_CONNECTION/);
  });
  it("signs each gateway request with NEP-413 over method, path+query and body", async () => {
    let seen: { url: string; auth: string } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, auth: (init.headers as Record<string, string>).authorization! };
      return new Response(JSON.stringify({ ok: 1 }), { status: 200 });
    }) as unknown as typeof fetch;
    await new GatewayBackend(conn, fetchImpl).read("activity", { limit: "3" });
    expect(seen!.url).toBe("https://oiko.example/api/agent/activity?limit=3");
    const h = parseGatewayAuthHeader(seen!.auth)!;
    expect(h.accountId).toBe(conn.vault);
    const m = parseGatewayMessage(h.message)!;
    expect(m.path).toBe("/api/agent/activity?limit=3");
    expect(m.bodyHash).toBe(sha256Hex(""));
    expect(verifyNep413({ ...h, recipient: "oiko-gateway" })).toBe(true);
  });
});
