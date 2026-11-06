#!/usr/bin/env node
// End-to-end test for POST /api/agent/create-account
// Pure agent test: minimal dependencies (noble crypto libs only, already in the repo).
// Usage: node scripts/test-agent-signup.mjs [--api <url>]

const API = process.argv.includes("--api")
  ? process.argv[process.argv.indexOf("--api") + 1]
  : "https://oikodotnear.vercel.app";

const log = (msg, data) => console.log(`[agent-signup] ${msg}`, data !== undefined ? JSON.stringify(data, null, 2) : "");
const fail = (msg, data) => { console.error(`[FAIL] ${msg}`, data !== undefined ? data : ""); process.exit(1); };

// ─────────────────────────────────────────────────────────────────────────────
// Minimal crypto helpers (noble libs)
// ─────────────────────────────────────────────────────────────────────────────
const b58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58encode(buf) {
  let n = BigInt("0x" + Array.from(buf, b => b.toString(16).padStart(2, "0")).join(""));
  if (n === 0n) return "1";
  let s = "";
  while (n > 0n) { s = b58[Number(n % 58n)] + s; n /= 58n; }
  for (let i = 0; i < buf.length && buf[i] === 0; i++) s = "1" + s;
  return s;
}
function b64encode(buf) { return Buffer.from(buf).toString("base64"); }

async function generateKeyPair() {
  const { ed25519 } = await import("@noble/curves/ed25519.js");
  const { randomBytes } = await import("node:crypto");
  const seed = randomBytes(32);
  const pub = ed25519.getPublicKey(seed);
  return { publicKey: `ed25519:${b58encode(pub)}`, secretKey: seed };
}

async function signNep413(secretKey, { message, recipient }) {
  const { randomBytes } = await import("node:crypto");
  const nonce = randomBytes(32);
  const { sha256 } = await import("@noble/hashes/sha2.js");
  const { serialize } = await import("borsh");
  const NEP413_TAG = 2147484061;
  const tag = serialize("u32", NEP413_TAG);
  const payload = { message, nonce: Array.from(nonce), recipient, callbackUrl: null };
  const body = serialize({ struct: { message: "string", nonce: { array: { type: "u8", len: 32 } }, recipient: "string", callbackUrl: { option: "string" } } }, payload);
  const all = new Uint8Array(tag.length + body.length);
  all.set(tag, 0); all.set(body, tag.length);
  const hash = sha256(all);

  const { ed25519 } = await import("@noble/curves/ed25519.js");
  const sig = ed25519.sign(hash, secretKey);

  return { signature: b64encode(sig), nonce: b64encode(nonce) };
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers
// ─────────────────────────────────────────────────────────────────────────────
async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, body: json };
}

async function get(path) {
  const res = await fetch(`${API}${path}`);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, body: json };
}

async function rpcCall(nodeUrl, method, params) {
  const res = await fetch(nodeUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json.result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main test flow
// ─────────────────────────────────────────────────────────────────────────────
log("=== Step 0: Discover endpoint ===");
const manifest = await get("/.well-known/oiko-agent.json");
if (!manifest.ok) fail("could not fetch /.well-known/oiko-agent.json", manifest);
const createAccountEndpoint = manifest.body?.endpoints?.create_account;
if (!createAccountEndpoint) fail("create_account not in manifest", manifest.body?.endpoints);
log("discovered:", createAccountEndpoint);

const llms = await fetch(`${API}/llms.txt`).then(r => r.text());
if (!llms.includes("oiko-agent-signup")) fail("llms.txt missing autonomous setup");
log("llms.txt ✓");

log("=== Step 1: Generate keypair ===");
const kp = await generateKeyPair();
log("publicKey:", kp.publicKey);

log("=== Step 2: Pick name ===");
const name = `agent-${Math.random().toString(36).slice(2, 8)}`;
const avail = await get(`/api/names/${name}`);
if (!avail.ok || !avail.body.available) fail(`name "${name}" unavailable`);
log("name available:", name);

log("=== Step 3: Build proof ===");
const ts = Date.now();
const message = `oiko-agent-signup:${name}:${ts}`;
const proof = await signNep413(kp.secretKey, { message, recipient: "oiko-agent-signup" });
log("proof signed ✓");

log("=== Step 4: POST /api/agent/create-account ===");
const createRes = await post("/api/agent/create-account", {
  name,
  publicKey: kp.publicKey,
  proof: { signature: proof.signature, nonce: proof.nonce, timestamp: ts },
});
log("HTTP", createRes.status);
if (!createRes.ok) fail("create-account failed", createRes.body);

const { accountId, vaultId, paymentLink, txHash, vaultTxHash } = createRes.body;
if (!accountId || !vaultId) fail("missing fields", createRes.body);
log("accountId:", accountId);
log("vaultId:", vaultId);
log("paymentLink:", paymentLink);
log("txHash:", txHash);
log("vaultTxHash:", vaultTxHash);

log("=== Step 5: Verify on-chain ===");
const cfg = await get("/api/config");
const nodeUrl = cfg.body.nodeUrl;
log("nodeUrl:", nodeUrl);

const identityAcc = await rpcCall(nodeUrl, "query", { request_type: "view_account", finality: "final", account_id: accountId });
if (!identityAcc.amount) fail("identity account not found");
log("identity account exists ✓");

const vaultAcc = await rpcCall(nodeUrl, "query", { request_type: "view_account", finality: "final", account_id: vaultId });
if (!vaultAcc.amount) fail("vault not found");
log("vault exists ✓");

const ak = await rpcCall(nodeUrl, "query", { request_type: "view_access_key", finality: "final", account_id: accountId, public_key: kp.publicKey }).catch(() => null);
if (!ak) fail("agent key not on identity account");
const isFullAccess = ak.permission === "FullAccess";
if (!isFullAccess) fail("agent key is not full-access", ak.permission);
log("agent key is full-access ✓");

const vaultKeys = await rpcCall(nodeUrl, "query", { request_type: "view_access_key_list", finality: "final", account_id: vaultId });
const fullAccessOnVault = vaultKeys.keys.filter(k => k.access_key.permission === "FullAccess");
if (fullAccessOnVault.length > 0) fail("vault has full-access keys!", fullAccessOnVault);
log("vault is keyless ✓");

log("=== Step 6: Verify stale proof rejected ===");
const oldTs = ts - 301_000;
const name2 = `agent-${Math.random().toString(36).slice(2, 8)}`;
const oldProof = await signNep413(kp.secretKey, { message: `oiko-agent-signup:${name2}:${oldTs}`, recipient: "oiko-agent-signup" });
const staleRes = await post("/api/agent/create-account", {
  name: name2, publicKey: kp.publicKey,
  proof: { ...oldProof, timestamp: oldTs },
});
if (staleRes.ok) fail("stale proof accepted");
if (staleRes.body?.error?.code !== "E_PROOF_STALE") fail("expected E_PROOF_STALE", staleRes.body);
log("stale proof rejected ✓");

log("=== Step 7: Verify wrong-key proof rejected ===");
const impostor = await generateKeyPair();
const ts3 = Date.now();
const name3 = `agent-${Math.random().toString(36).slice(2, 8)}`;
const impostorProof = await signNep413(impostor.secretKey, { message: `oiko-agent-signup:${name3}:${ts3}`, recipient: "oiko-agent-signup" });
const wrongKeyRes = await post("/api/agent/create-account", {
  name: name3, publicKey: kp.publicKey,
  proof: { ...impostorProof, timestamp: ts3 },
});
if (wrongKeyRes.ok) fail("wrong-key proof accepted");
if (wrongKeyRes.body?.error?.code !== "E_PROOF_INVALID") fail("expected E_PROOF_INVALID", wrongKeyRes.body);
log("wrong-key proof rejected ✓");

console.log("\n✅ All checks passed!");
console.log(`   name:        ${name}`);
console.log(`   accountId:   ${accountId}`);
console.log(`   vaultId:     ${vaultId}`);
console.log(`   paymentLink: ${paymentLink}`);
console.log(`   register tx: https://testnet.nearblocks.io/txns/${txHash}`);
console.log(`   vault tx:    https://testnet.nearblocks.io/txns/${vaultTxHash}`);
console.log("\nThis account was created autonomously by an AI agent with zero human interaction.");
