import { generateKeyPair, signNep413 } from "../src/index.ts";

const API = process.env.OIKO_API || "https://oikodotnear.vercel.app";
const log = (msg, data) => console.log(`[agent] ${msg}`, data !== undefined ? JSON.stringify(data, null, 2) : "");
const fail = (msg, data) => { console.error(`[FAIL] ${msg}`, data); process.exit(1); };

async function post(path, body) {
  const res = await fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, ok: res.ok, body: await res.json().catch(() => ({})) };
}
async function get(path) {
  const res = await fetch(`${API}${path}`);
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}
async function rpcCall(nodeUrl, method, params) {
  const res = await fetch(nodeUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

log("=== Autonomous Agent Signup Test ===");
const manifest = await get("/.well-known/oiko-agent.json");
if (!manifest.body?.endpoints?.create_account) fail("create_account not in manifest");
log("endpoint discovered ✓");

const kp = generateKeyPair();
log("keypair generated");

const name = `agent-${Math.random().toString(36).slice(2, 8)}`;
const avail = await get(`/api/names/${name}`);
if (!avail.body.available) fail("name unavailable");
log(`name available: ${name}`);

const ts = Date.now();
const message = `oiko-agent-signup:${name}:${ts}`;
const proof = signNep413(kp.secretKey, { message, recipient: "oiko-agent-signup" });
log("proof signed ✓");

log("POST /api/agent/create-account...");
const createRes = await post("/api/agent/create-account", {
  name, publicKey: kp.publicKey,
  proof: { signature: proof.signature, nonce: proof.nonce, timestamp: ts },
});
if (!createRes.ok) fail("create-account failed", createRes.body);
const { accountId, vaultId, paymentLink, txHash, vaultTxHash } = createRes.body;
log(`created: ${accountId}`);

const cfg = await get("/api/config");
const nodeUrl = cfg.body.nodeUrl;
const identityAcc = await rpcCall(nodeUrl, "query", { request_type: "view_account", finality: "final", account_id: accountId });
if (!identityAcc.amount) fail("identity account not found");
log("identity account exists ✓");

const vaultAcc = await rpcCall(nodeUrl, "query", { request_type: "view_account", finality: "final", account_id: vaultId });
if (!vaultAcc.amount) fail("vault not found");
log("vault exists ✓");

const ak = await rpcCall(nodeUrl, "query", { request_type: "view_access_key", finality: "final", account_id: accountId, public_key: kp.publicKey }).catch(() => null);
if (!ak || ak.permission !== "FullAccess") fail("agent key not full-access");
log("agent key is full-access ✓");

const vaultKeys = await rpcCall(nodeUrl, "query", { request_type: "view_access_key_list", finality: "final", account_id: vaultId });
const fullAccessOnVault = vaultKeys.keys.filter(k => k.access_key.permission === "FullAccess");
if (fullAccessOnVault.length > 0) fail("vault has full-access keys!");
log("vault is keyless ✓");

console.log("\n✅ SUCCESS: Autonomous agent signup works end-to-end!");
console.log(`   name:        ${name}`);
console.log(`   accountId:   ${accountId}`);
console.log(`   vaultId:     ${vaultId}`);
console.log(`   paymentLink: ${paymentLink}`);
console.log(`   tx:          https://testnet.nearblocks.io/txns/${txHash}`);
console.log(`   vault tx:    https://testnet.nearblocks.io/txns/${vaultTxHash}`);
console.log("\nThis account was created by an AI agent with ZERO human interaction.");
