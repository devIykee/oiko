#!/usr/bin/env node
// End-to-end test for POST /api/agent/create-account
// Runs as an agent: generates a key, builds the proof, calls the endpoint, verifies on-chain.
// Usage: node scripts/test-agent-signup.mjs [--api <url>]
import { generateKeyPair, signNep413, NearRpc, accountIdFor, vaultIdFor, configFor } from "@oiko/sdk";

const API = process.argv.includes("--api")
  ? process.argv[process.argv.indexOf("--api") + 1]
  : "https://oikodotnear.vercel.app";

const log = (msg, data) => console.log(`[agent-signup] ${msg}`, data !== undefined ? JSON.stringify(data, null, 2) : "");
const fail = (msg, data) => { console.error(`[FAIL] ${msg}`, data !== undefined ? data : ""); process.exit(1); };

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

// ─────────────────────────────────────────────────────────────────────────────
// Step 0: Discover the endpoint exists in the machine-readable files
// ─────────────────────────────────────────────────────────────────────────────
log("=== Step 0: Discover endpoint via /.well-known/oiko-agent.json ===");
const manifest = await get("/.well-known/oiko-agent.json");
if (!manifest.ok) fail("could not fetch /.well-known/oiko-agent.json", manifest);
const createAccountEndpoint = manifest.body?.endpoints?.create_account;
if (!createAccountEndpoint) fail("create_account not in /.well-known/oiko-agent.json endpoints", manifest.body?.endpoints);
log("discovered endpoint:", createAccountEndpoint);

log("=== Step 0b: Discover via /llms.txt ===");
const llms = await fetch(`${API}/llms.txt`).then(r => r.text());
if (!llms.includes("oiko-agent-signup") || !llms.includes("create-account")) {
  fail("create-account not mentioned in /llms.txt");
}
log("llms.txt mentions create-account ✓");

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: Generate a keypair (never leaves this process)
// ─────────────────────────────────────────────────────────────────────────────
log("=== Step 1: Generate ed25519 keypair ===");
const kp = generateKeyPair();
log("publicKey:", kp.publicKey);
// secretKey printed only for test verification — a real agent would store it securely
log("secretKey: [redacted, kept in memory]");

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: Pick a name and check availability
// ─────────────────────────────────────────────────────────────────────────────
const name = `agent-${Math.random().toString(36).slice(2, 8)}`;
log("=== Step 2: Check name availability ===", { name });
const avail = await get(`/api/names/${name}`);
if (!avail.ok) fail("name availability check failed", avail);
if (!avail.body.available) fail(`name "${name}" is not available — bad luck, rerun`, avail.body);
log("name is available ✓");

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: Build the NEP-413 proof of key possession
// ─────────────────────────────────────────────────────────────────────────────
log("=== Step 3: Build proof-of-key-possession ===");
const ts = Date.now();
const message = `oiko-agent-signup:${name}:${ts}`;
const proof = signNep413(kp.secretKey, { message, recipient: "oiko-agent-signup" });
log("challenge message:", message);
log("proof.nonce:", proof.nonce);
log("proof.signature:", proof.signature.slice(0, 20) + "…");

// ─────────────────────────────────────────────────────────────────────────────
// Step 4: POST /api/agent/create-account
// ─────────────────────────────────────────────────────────────────────────────
log("=== Step 4: POST /api/agent/create-account ===");
const createRes = await post("/api/agent/create-account", {
  name,
  publicKey: kp.publicKey,
  proof: { signature: proof.signature, nonce: proof.nonce, timestamp: ts },
});
log("HTTP status:", createRes.status);
log("response:", createRes.body);

if (!createRes.ok) {
  fail(`create-account returned ${createRes.status}`, createRes.body);
}
const { accountId, vaultId, paymentLink, txHash, vaultTxHash } = createRes.body;
if (!accountId || !vaultId || !paymentLink) fail("missing fields in response", createRes.body);
log("accountId:", accountId);
log("vaultId:", vaultId);
log("paymentLink:", paymentLink);
log("txHash (register):", txHash);
log("vaultTxHash:", vaultTxHash);

// ─────────────────────────────────────────────────────────────────────────────
// Step 5: Verify on-chain
// ─────────────────────────────────────────────────────────────────────────────
log("=== Step 5: Verify accounts exist on NEAR testnet ===");
const cfg = await get("/api/config");
if (!cfg.ok) fail("could not fetch /api/config", cfg);
const nodeUrl = cfg.body.nodeUrl;
log("nodeUrl:", nodeUrl);

const rpc = new NearRpc(nodeUrl);

// Check identity account exists
const identityExists = await rpc.accountExists(accountId);
if (!identityExists) fail(`identity account ${accountId} not found on-chain`);
log(`identity account ${accountId} exists ✓`);

// Check vault exists
const vaultExists = await rpc.accountExists(vaultId);
if (!vaultExists) fail(`vault ${vaultId} not found on-chain`);
log(`vault ${vaultId} exists ✓`);

// Check the agent's public key is on the identity account as a full-access key
const ak = await rpc.viewAccessKey(accountId, kp.publicKey);
if (!ak) fail(`agent's key is NOT on ${accountId}`, { publicKey: kp.publicKey });
const isFullAccess = ak.permission === "FullAccess" || (typeof ak.permission === "object" && JSON.stringify(ak.permission).includes("FullAccess"));
if (!isFullAccess) fail("agent's key is on the account but is NOT a full-access key", ak.permission);
log("agent's key is on identity account as full-access ✓");

// Check the vault has ZERO full-access keys (it should be keyless except for agent function-call keys added later)
const vaultKeys = await rpc.viewAccessKeyList(vaultId);
const fullAccessOnVault = vaultKeys.filter(k => k.access_key.permission === "FullAccess" || (typeof k.access_key.permission === "object" && JSON.stringify(k.access_key.permission).includes("FullAccess")));
if (fullAccessOnVault.length > 0) fail("vault has full-access keys — security invariant violated!", fullAccessOnVault);
log(`vault has ${vaultKeys.length} key(s), zero full-access ✓`);

// Check no ephemeral key is lingering (the key rotation must have worked)
const allIdentityKeys = await rpc.viewAccessKeyList(accountId);
log(`identity account has ${allIdentityKeys.length} key(s):`);
for (const k of allIdentityKeys) {
  log(`  key: ${k.public_key}, permission: ${typeof k.access_key.permission === "string" ? k.access_key.permission : JSON.stringify(k.access_key.permission)}`);
}
// Should be exactly 2: the agent's full-access key + the app function-call key (from register_name)
// (The ephemeral key was only used as owner= in register_name; the agent's key was app=.
//  Actually app= is the agent's key; the ephemeral key was owner=. We delete the ephemeral owner key
//  in step 12 and add the agent's key as full-access.)
// After key rotation: agent's full-access key + agent's app (function-call) key = 2 keys total, 1 full-access.
const agentFullAccessKeys = allIdentityKeys.filter(k => k.access_key.permission === "FullAccess" || (typeof k.access_key.permission === "object" && JSON.stringify(k.access_key.permission).includes("FullAccess")));
if (agentFullAccessKeys.length !== 1) fail(`expected exactly 1 full-access key on identity account, got ${agentFullAccessKeys.length}`, allIdentityKeys.map(k => k.public_key));
if (agentFullAccessKeys[0].public_key !== kp.publicKey) fail("the full-access key is not the agent's key!", agentFullAccessKeys[0]);
log("exactly 1 full-access key on identity account = agent's own key ✓");

// ─────────────────────────────────────────────────────────────────────────────
// Step 6: Verify proof-replay is rejected (same proof a second time)
// ─────────────────────────────────────────────────────────────────────────────
log("=== Step 6: Verify a stale proof is rejected ===");
// Timestamp was 5+ minutes ago on a second attempt — simulate by using an old timestamp
const oldTs = ts - 301_000; // 5 min + 1 s
const name2 = `agent-${Math.random().toString(36).slice(2, 8)}`;
const oldProof = signNep413(kp.secretKey, { message: `oiko-agent-signup:${name2}:${oldTs}`, recipient: "oiko-agent-signup" });
const staleRes = await post("/api/agent/create-account", {
  name: name2, publicKey: kp.publicKey,
  proof: { signature: oldProof.signature, nonce: oldProof.nonce, timestamp: oldTs },
});
if (staleRes.ok) fail("stale proof was accepted — should have been rejected");
if (staleRes.body?.error?.code !== "E_PROOF_STALE") fail("expected E_PROOF_STALE", staleRes.body);
log("stale proof correctly rejected with E_PROOF_STALE ✓");

// ─────────────────────────────────────────────────────────────────────────────
// Step 7: Verify wrong-key proof is rejected
// ─────────────────────────────────────────────────────────────────────────────
log("=== Step 7: Verify wrong-key proof is rejected ===");
const impostor = generateKeyPair();
const ts3 = Date.now();
const name3 = `agent-${Math.random().toString(36).slice(2, 8)}`;
const impostorProof = signNep413(impostor.secretKey, { message: `oiko-agent-signup:${name3}:${ts3}`, recipient: "oiko-agent-signup" });
const wrongKeyRes = await post("/api/agent/create-account", {
  name: name3, publicKey: kp.publicKey, // claiming kp's key but proof signed by impostor
  proof: { signature: impostorProof.signature, nonce: impostorProof.nonce, timestamp: ts3 },
});
if (wrongKeyRes.ok) fail("wrong-key proof was accepted — should have been rejected");
if (wrongKeyRes.body?.error?.code !== "E_PROOF_INVALID") fail("expected E_PROOF_INVALID", wrongKeyRes.body);
log("wrong-key proof correctly rejected with E_PROOF_INVALID ✓");

// ─────────────────────────────────────────────────────────────────────────────
// Done
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n✅ All checks passed!");
console.log(`   name:        ${name}`);
console.log(`   accountId:   ${accountId}`);
console.log(`   vaultId:     ${vaultId}`);
console.log(`   paymentLink: ${paymentLink}`);
console.log(`   register tx: https://testnet.nearblocks.io/txns/${txHash}`);
console.log(`   vault tx:    https://testnet.nearblocks.io/txns/${vaultTxHash}`);
console.log("\nThis account was created autonomously by an agent with no human interaction.");
