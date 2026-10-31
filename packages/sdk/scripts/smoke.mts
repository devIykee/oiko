// Live smoke test of the critical path against a running Oiko API (testnet or local).
// Usage: OIKO_API=http://localhost:3000 pnpm smoke   (from the repo root)
// Steps: register name -> create keyless account via relayed delegate -> pots + plan -> pay via (mock) 1Click
// -> sync credits and splits -> lock refuses -> withdraw from Spend -> agent pays twice, third refused -> revoke -> reads refused.
import {
  NearRpc, Signer, VaultClient, GatewayClient, act, generateKeyPair, toUnits,
} from "../src/index.ts";

const API = process.env.OIKO_API ?? "http://localhost:3100";
const name = process.argv[2] ?? `smoke${Date.now().toString(36).slice(-6)}`;
const log = (...a: unknown[]) => console.log(`[smoke]`, ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(API + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${JSON.stringify(j)}`);
  return j as T;
}
function check(cond: unknown, msg: string) { if (!cond) throw new Error("FAILED: " + msg); log("ok:", msg); }

const cfgApi = await api("/api/config");

const rpc = new NearRpc(cfgApi.nodeUrl);
const accountId = `${name}.${cfgApi.root}`, vaultId = `vault.${name}.${cfgApi.root}`;
const owner = generateKeyPair(), app = generateKeyPair();

log("1. register", accountId);
await api("/api/register", { name, ownerPublicKey: owner.publicKey, appPublicKey: app.publicKey });
const ownerSigner = new Signer(rpc, accountId, owner.secretKey);
const sd = await ownerSigner.signDelegate(vaultId, [
  act.createAccount(),
  act.transfer(BigInt(cfgApi.vaultFunding)),
  act.useGlobalContract(cfgApi.vaultCodeHash),
  act.functionCall("new", { owner: accountId, usdc: cfgApi.contracts.usdc, usdt: cfgApi.contracts.usdt, config: {
    max_utilization_bps: 9200, large_withdrawal_threshold: toUnits("1000"), lending: cfgApi.contracts.lending,
    ajo: cfgApi.contracts.ajo, mpc_signer: cfgApi.contracts.mpcSigner, agent_allowance: (10n ** 24n / 4n).toString() } }, 150n * 10n ** 12n),
]);
await api("/api/relay", { signedDelegate: sd });
const keys = await rpc.viewAccessKeyList(vaultId);
check(keys.length === 0, "account created with zero access keys");

const appSigner = new Signer(rpc, accountId, app.secretKey);
const vault = new VaultClient(rpc, vaultId, appSigner);
log("2. pots + plan");
const bills = await vault.createPot({ name: "Bills", icon: "doc_text_fill", color: "sun", kind: "bills" } as any);
const rainy = await vault.createPot({ name: "Rainy day", icon: "lock_fill", color: "violet", kind: "locked" } as any);
await vault.setSplits([{ pot_id: Number(bills.value ?? 1), mode: "percent", value: "4000" }, { pot_id: Number(rainy.value ?? 2), mode: "percent", value: "2000" }]);
const lockAt = BigInt(Date.now() + 10 * 60_000) * 1_000_000n;
await vault.lock(Number(rainy.value ?? 2), lockAt.toString());

log("3. pay 100 USDT from 'USDT on TRON' via the 1Click proxy");
const toks = await api("/api/intents/tokens");
const tron = toks.groups.find((g: any) => /tron/i.test(g.chain) && g.symbol === "USDT") ?? toks.groups[0];
const dep = await api("/api/intents/deposit-address", { name, originAsset: tron.assetId, amount: toUnits("100", tron.decimals), refundTo: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf" });
check(dep.depositAddress, "deposit address issued");
const sim = await api("/api/intents/simulate-deposit", { depositAddress: dep.depositAddress, ticket: dep.ticket });
let status = "";
for (let i = 0; i < 40 && status !== "SUCCESS"; i++) { await sleep(2000); status = (await api(`/api/intents/status/${encodeURIComponent(dep.depositAddress)}?ticket=${encodeURIComponent(sim.ticket ?? "")}`)).status; }
check(status === "SUCCESS", "deposit reached SUCCESS");
await api("/api/sync", { vaultId }).catch(() => {});
let ov = await vault.overview();
for (let i = 0; i < 10 && BigInt(ov.totals.usdt) === 0n; i++) { await sleep(2000); ov = await vault.overview(); }
log("totals", ov.totals, ov.pots.map((p) => `${p.name}:${p.balances.usdt}`).join(" "));
check(BigInt(ov.totals.usdt) > 0n, "payment credited");
const billsPot = ov.pots.find((p) => p.name === "Bills")!;
check(BigInt(billsPot.balances.usdt) * 10n >= BigInt(ov.totals.usdt) * 4n - 10n, "plan put ~40% into Bills");

log("4. lock refuses");
const lockedTry = await vault.withdraw(Number(rainy.value ?? 2), "usdt", toUnits("1"), "oiko-relayer.testnet").catch((e: Error) => ({ ok: false, errorCode: e.message }));
check(!lockedTry.ok && /E_LOCKED/.test(JSON.stringify(lockedTry)), "locked pot refuses withdrawal");

log("5. withdraw 1 USDT from Spend");
const w = await vault.withdraw(0, "usdt", toUnits("1"), "oiko-relayer.testnet");
if (!w.ok) console.log(w.errorCode, w.errorMessage);
check(w.ok, "withdraw from Spend");

log("6. agent with 5 USDT cap");
const agentKey = generateKeyPair();
const exp = BigInt(Date.now() + 7 * 86400_000) * 1_000_000n;
await vault.addAgent(agentKey.publicKey, { label: "Bill payer", agent_name: "Smoke agent", agent_url: "https://example.com", scopes: ["read", "propose", "act"],
  allowed_actions: ["pay", "move_between_pots", "save"], allowlist: [{ type: "near", account_id: "oiko-relayer.testnet" }],
  per_tx: toUnits("2"), daily: toUnits("5"), weekly: toUnits("5"), expires_at: exp.toString() });
const agent = new GatewayClient({ api: API, vault: vaultId, sk: agentKey.secretKey });
const me = await agent.request("GET", "/api/agent/overview");
check(me, "agent reads overview");
const pay = { type: "pay", token: "usdt", amount: toUnits("2"), to: "oiko-relayer.testnet", memo: null } as const;
{ const r1 = await agent.run("act", pay); if (!r1.ok) console.log(r1); check(r1.ok, "agent payment 1"); }
check((await agent.run("act", pay)).ok, "agent payment 2");
const third = await agent.run("act", { ...pay, amount: toUnits("2") }).catch((e) => ({ ok: false, error: { code: String(e) } }));
const p3 = await agent.run("act", pay).catch((e) => ({ ok: false, error: { code: String(e) } }));
check(!p3.ok || !third.ok, "payment over the 5 USDT cap refused");
await vault.revokeAgent(agentKey.publicKey);
check((await rpc.viewAccessKeyList(vaultId)).length === 0, "agent key deleted on revoke");
const after = await agent.request("GET", "/api/agent/overview").then(() => true).catch(() => false);
check(!after, "reads refused after revoke");
log(`ALL OK  account=${accountId}`);

// Cleanup: return the sign-in account's NEAR to the relayer so repeated smoke runs don't drain the demo budget.
// (The savings account itself has no keys by design, so its small balance stays with it.)
if (process.env.SMOKE_KEEP !== "1") {
  const beneficiary = cfgApi.relayer ?? "oiko-relayer.testnet";
  const d = await ownerSigner.signAndSend(accountId, [act.deleteAccount(beneficiary)]).catch((e: Error) => ({ ok: false, errorMessage: e.message }));
  log(d.ok ? `cleanup: ${accountId} deleted, NEAR returned to ${beneficiary}` : `cleanup skipped: ${(d as { errorMessage?: string }).errorMessage}`);
}
