// Offline world: the real SDK wrapper + the real gateway code (apps/web/server) in-process, talking to a mocked NEAR RPC
// and a mocked NearBlocks. The mock "contract" applies the vault's agent_execute allowlist and per-payment rule
// (a port of contracts/vault/src/core.rs agent_check_and_record), so attempt 3 is a simulation — run online to hit the real contract.
import { b58encode, b64decode, b64encode, decodeSignedTx, fromUtf8, keyPairFromSeed, NearRpc, utf8, type AgentView } from "@oiko/sdk";

export const VAULT = "vault.ada.oiko.testnet";
export const BAD = "urgent-refund-desk.testnet";
export const LANDLORD = "landlord-ade.testnet";
export const AGENT = keyPairFromSeed(new Uint8Array(32).fill(7));
const DAY = 86_400_000;

export function policy(): AgentView {
  return {
    label: "Bill payer", agent_name: "Inbox assistant", agent_url: "https://example.com", scopes: ["read", "propose", "act"], allowed_actions: ["pay"],
    allowlist: [{ type: "near", account_id: LANDLORD }], per_tx: "100000000", daily: "200000000", weekly: "500000000",
    expires_at: String(BigInt(Date.now() + 30 * DAY) * 1_000_000n), public_key: AGENT.publicKey, spent_day: [0, "0"], spent_week: [0, "0"], revoked: false, created_at: "0",
  };
}

const ACCOUNTS: Record<string, { created: number; txns: number }> = {
  [VAULT]: { created: Date.now() - 200 * DAY, txns: 120 },
  [LANDLORD]: { created: Date.now() - 900 * DAY, txns: 412 },
};
let nonce = 10;
let txn = 0;

function rpcResult(id: unknown, result: unknown) { return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { status: 200 }); }
function rpcError(id: unknown, name: string, data: string) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { name: "HANDLER_ERROR", cause: { name, info: {} }, code: -32000, message: "Server error", data } }), { status: 200 });
}
const view = (v: unknown) => ({ result: Array.from(utf8(JSON.stringify(v))), logs: [], block_height: 1, block_hash: "x" });

function mockRpc(body: { id: unknown; method: string; params: Record<string, unknown> }): Response {
  const p = body.params;
  if (body.method === "block") return rpcResult(body.id, { header: { hash: b58encode(new Uint8Array(32).fill(1)), height: 100 } });
  if (body.method === "query" && p.request_type === "view_account") {
    const a = ACCOUNTS[p.account_id as string];
    if (!a) return rpcError(body.id, "UNKNOWN_ACCOUNT", `account ${p.account_id} does not exist while viewing`);
    return rpcResult(body.id, { amount: "1000000000000000000000000", locked: "0", code_hash: "11111111111111111111111111111111", storage_usage: 500, block_height: 1, block_hash: "x" });
  }
  if (body.method === "query" && p.request_type === "view_access_key") {
    if (p.account_id === VAULT && p.public_key === AGENT.publicKey) {
      return rpcResult(body.id, { nonce, permission: { FunctionCall: { allowance: "250000000000000000000000", receiver_id: VAULT, method_names: ["agent_execute", "agent_propose"] } }, block_height: 1, block_hash: "x" });
    }
    return rpcError(body.id, "UNKNOWN_ACCESS_KEY", "access key does not exist");
  }
  if (body.method === "query" && p.request_type === "call_function") {
    const m = p.method_name as string;
    if (m === "get_agent") return rpcResult(body.id, view(policy()));
    if (m === "get_activity") return rpcResult(body.id, view([{ seq: 7, at: String(BigInt(Date.now() - 30 * DAY) * 1_000_000n), kind: "withdrawn", by: "owner", token: "usdt", amount: "450000000", pot_id: 4, counterparty: LANDLORD, note: "Rent" }]));
    if (m === "get_bills") return rpcResult(body.id, view([]));
    return rpcResult(body.id, view(null));
  }
  if (body.method === "send_tx") return mockContract(body.id, p.signed_tx_base64 as string);
  return rpcError(body.id, "UNSUPPORTED", `mock RPC does not implement ${body.method}`);
}

/** Simulated vault.agent_execute: allowlist then per-payment cap, same order and codes as the contract. */
function mockContract(id: unknown, signed: string): Response {
  const t = decodeSignedTx(b64decode(signed)).transaction;
  nonce = Number(t.nonce);
  const hash = b58encode(utf8(`simulated-tx-${++txn}`.padEnd(32, "-")).slice(0, 32));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fc = (t.actions[0] as any).functionCall as { methodName: string; args: number[] | Uint8Array };
  const { action } = JSON.parse(fromUtf8(Uint8Array.from(fc.args))) as { action: { type: string; to?: string; amount?: string } };
  const p = policy();
  const fail = (msg: string) => rpcResult(id, {
    status: { Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: `Smart contract panicked: ${msg}` } } } } },
    transaction: { hash, signer_id: VAULT }, transaction_outcome: { id: hash, outcome: { logs: [], status: { SuccessReceiptId: "r" } } }, receipts_outcome: [],
  });
  if (fc.methodName === "agent_execute" && action.type === "pay") {
    if (!p.allowlist.some((r) => r.type === "near" && r.account_id === action.to)) return fail(`E_NOT_ALLOWLISTED: ${action.to} is not on this agent's allowlist`);
    if (BigInt(action.amount!) > BigInt(p.per_tx)) return fail(`E_CAP_PER_TX: ${action.amount} is above the per-transaction cap ${p.per_tx}`);
  }
  return rpcResult(id, {
    status: { SuccessValue: b64encode(utf8(fc.methodName === "agent_propose" ? "3" : "true")) },
    transaction: { hash, signer_id: VAULT }, transaction_outcome: { id: hash, outcome: { logs: [], status: { SuccessReceiptId: "r" } } }, receipts_outcome: [],
  });
}

function mockNearBlocks(url: URL): Response {
  const m = /^\/v1\/account\/([^/]+)(\/.*)?$/.exec(url.pathname);
  const a = m ? ACCOUNTS[decodeURIComponent(m[1]!)] : undefined;
  const rest = m?.[2] ?? "";
  if (rest === "/txns-only/count") return Response.json({ txns: [{ cost: "0", count: String(a?.txns ?? 0) }] });
  if (rest === "/contract/deployments") return Response.json({ deployments: [] });
  return Response.json({ account: [a ? { account_id: m![1], created: { transaction_hash: "x", block_timestamp: a.created * 1_000_000 } } : { block_height: "1", block_hash: "x" }] });
}

/** Installs the offline world and returns the API base URL and an RPC client for attempt 3. */
export async function installOffline(): Promise<{ api: string; rpc: NearRpc }> {
  Object.assign(process.env, {
    OIKO_NETWORK: "testnet", OIKO_NODE_URL: "http://rpc.mock", NEARBLOCKS_API_URL: "http://nearblocks.mock", RELAYER_KEY_FILE: "/nonexistent",
    OIKO_PUBLIC_URL: "http://oiko.mock",
  });
  delete process.env.DATABASE_URL;
  delete process.env.RELAYER_ACCOUNT_ID;
  delete process.env.RELAYER_PRIVATE_KEY;
  const server = "../../../../apps/web/server/";
  const cfg = await import(server + "config.ts");
  cfg.setServerConfig({ ...cfg.loadConfig(process.env), relayer: null });
  const { setStore, MemoryStore } = await import(server + "store.ts");
  setStore(new MemoryStore());
  const { agentRead, agentWrite } = await import(server + "agentHttp.ts");
  const { agentReport, counterpartyPublic } = await import(server + "counterpartyHttp.ts");
  // Gateway logs its own best-effort warnings (e.g. relayer top-up not configured); keep the demo output clean.
  const warn = console.warn;
  console.warn = (...a: unknown[]) => { if (!String(a[0]).startsWith("[oiko]")) warn(...a); };

  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    if (url.host === "rpc.mock") return mockRpc(JSON.parse(await req.text()));
    if (url.host === "nearblocks.mock") return mockNearBlocks(url);
    if (url.host === "oiko.mock") {
      const r = new Request(req, { headers: new Headers({ ...Object.fromEntries(req.headers), "x-forwarded-for": "127.0.0.1" }) });
      const path = url.pathname;
      if (path === "/api/agent/prepare") return agentWrite(r, "prepare");
      if (path === "/api/agent/submit") return agentWrite(r, "submit");
      if (path === "/api/agent/report") return agentReport(r);
      if (path.startsWith("/api/counterparty/")) return counterpartyPublic(r, path.slice("/api/counterparty/".length));
      if (path.startsWith("/api/agent/")) return agentRead(r, path.slice("/api/agent/".length));
      return new Response("not found", { status: 404 });
    }
    void real;
    throw new Error(`offline mode: refusing network access to ${url.host}`);
  }) as typeof fetch;
  return { api: "http://oiko.mock", rpc: new NearRpc("http://rpc.mock") };
}
