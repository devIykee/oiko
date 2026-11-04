// Mainnet proof run. HUMAN-RUN ONLY: it moves real money and asks for y/N confirmation before every mainnet transaction.
//
//   OIKO_API=http://localhost:3000 pnpm mainnet-proof [name]
//
// OIKO_API must be an Oiko server running with OIKO_NETWORK=mainnet and the real 1Click API (not the mock).
// Steps: register <name>.<root> → create the keyless account → real 1Click deposit quote (≥ 100 USDT, the live minimum)
// and wait for SUCCESS → sync → withdraw 1 USDT through a real 1Click withdraw quote → earn_on with real Rhea.
// At the end it prints a markdown table of transaction hashes to paste into the README.
// The keys it creates are saved to .oiko/mainnet-proof-<name>.json (gitignored). Keep that file: it controls the account.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { NearRpc, Signer, VaultClient, act, formatAmount, generateKeyPair, toUnits, type Token } from "../packages/sdk/src/index.ts";

const API = (process.env.OIKO_API ?? "").replace(/\/+$/, "");
const ONECLICK = (process.env.ONECLICK_BASE_URL || "https://1click.chaindefuser.com").replace(/\/+$/, "");
const ONECLICK_JWT = process.env.ONECLICK_JWT ?? "";

type Row = { step: string; hash: string; note?: string };
const rows: Row[] = [];
let explorer = "https://nearblocks.io";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const say = (s = "") => console.log(s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ask(q: string, def = ""): Promise<string> {
  const a = (await rl.question(`${q}${def ? ` [${def}]` : ""}: `)).trim();
  return a || def;
}
/** y/N before every mainnet transaction. Anything but y/yes stops the script. */
async function confirm(what: string): Promise<void> {
  say(`\n  MAINNET TRANSACTION: ${what}`);
  const a = (await rl.question("  Send it? [y/N] ")).trim().toLowerCase();
  if (a !== "y" && a !== "yes") {
    say("  Not sent. Stopping here.");
    finish(1);
  }
}
function record(step: string, hash: string | undefined, note?: string) {
  if (hash) rows.push({ step, hash, note });
}
function finish(code = 0): never {
  if (rows.length) {
    say("\n## Mainnet proof\n");
    say("| Step | Transaction | Note |");
    say("|---|---|---|");
    for (const r of rows) say(`| ${r.step} | [${r.hash.slice(0, 10)}…](${explorer}/txns/${r.hash}) | ${r.note ?? ""} |`);
  }
  rl.close();
  process.exit(code);
}

async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(API + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as any;
  if (!r.ok) throw Object.assign(new Error(j?.error?.message ?? `${path} → HTTP ${r.status}`), { code: j?.error?.code });
  return j as T;
}
/** Direct 1Click status (the Oiko proxy only returns the status; this also gives the transaction hashes). */
async function oneClickStatus(depositAddress: string, memo?: string): Promise<any> {
  const u = new URL(ONECLICK + "/v0/status");
  u.searchParams.set("depositAddress", depositAddress);
  if (memo) u.searchParams.set("depositMemo", memo);
  const r = await fetch(u, { headers: { accept: "application/json", ...(ONECLICK_JWT ? { authorization: `Bearer ${ONECLICK_JWT}` } : {}) } });
  return r.json().catch(() => ({}));
}
async function waitForSwap(label: string, depositAddress: string, memo?: string, maxMinutes = 120): Promise<string> {
  say(`  Waiting for ${label} (checks every 15 s, up to ${maxMinutes} min; Ctrl+C to stop)…`);
  let last = "";
  for (let i = 0; i < maxMinutes * 4; i++) {
    const s = await oneClickStatus(depositAddress, memo).catch(() => ({}));
    const st: string = s?.status ?? "UNKNOWN";
    if (st !== last) say(`  ${new Date().toISOString()}  ${st}`);
    last = st;
    if (["SUCCESS", "REFUNDED", "FAILED"].includes(st)) {
      const d = s.swapDetails ?? {};
      for (const h of d.nearTxHashes ?? []) record(`${label}: 1Click NEAR tx`, h);
      for (const h of d.originChainTxHashes ?? []) say(`  origin chain tx: ${h.hash} ${h.explorerUrl ?? ""}`);
      for (const h of d.destinationChainTxHashes ?? []) say(`  destination chain tx: ${h.hash} ${h.explorerUrl ?? ""}`);
      return st;
    }
    await sleep(15_000);
  }
  return last;
}

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("This script moves real money and must be run by a person in an interactive terminal.");
    process.exit(1);
  }
  if (!API) {
    console.error("Set OIKO_API to an Oiko server running with OIKO_NETWORK=mainnet (e.g. http://localhost:3000).");
    process.exit(1);
  }

  say(`Oiko mainnet proof. This uses REAL USDT and REAL NEAR on NEAR mainnet.

Before you start, you (the human) must have:
  [ ] Deployed the contracts on mainnet under your root account (OIKO_ROOT_ACCOUNT):
        - vault code published as a global contract by hash (about 46.5 NEAR of storage, burned once)
        - registry on <root> with that vault_code_hash, usdc/usdt = mainnet tokens, lending = contract.main.burrow.near,
          relayer = your relayer account, account_funding (1.5 NEAR suggested)
        - optional: ajo.<root> for ROSCA savings (not used here)
  [ ] Funded the relayer account (it pays account_funding + gas) and set RELAYER_ACCOUNT_ID / RELAYER_PRIVATE_KEY
  [ ] Started the Oiko server with OIKO_NETWORK=mainnet, OIKO_ROOT_ACCOUNT, OIKO_VAULT_CODE_HASH, ONECLICK_BASE_URL unset
      (real 1Click), optionally ONECLICK_JWT, and DATABASE_URL
  [ ] At least 100 USDT on another chain that you control, plus a refund address on that chain
  [ ] An address that can receive about 1 USDT on another chain (the withdrawal destination)
Every transaction below asks for y/N first. Nothing is sent without your "y".
`);
  const go = await ask('Type MAINNET to continue');
  if (go !== "MAINNET") finish(1);

  const cfg = await api<any>("/api/config");
  explorer = cfg.explorer || explorer;
  say(`\nServer: network=${cfg.network} root=${cfg.root} 1Click=${cfg.oneClick} relayer=${cfg.relayer}`);
  say(`Contracts: registry=${cfg.contracts.registry} usdc=${cfg.contracts.usdc} usdt=${cfg.contracts.usdt} lending=${cfg.contracts.lending}`);
  say(`Vault code hash: ${cfg.vaultCodeHash}`);
  if (cfg.network !== "mainnet") { say("The server is not in mainnet mode. Stopping."); finish(1); }
  if (cfg.oneClick !== "1click") { say("The server is using the 1Click mock. Unset ONECLICK_BASE_URL. Stopping."); finish(1); }
  if (!cfg.vaultCodeHash || !cfg.relayer) { say("vaultCodeHash or relayer missing in /api/config. Stopping."); finish(1); }

  const rpc = new NearRpc(cfg.nodeUrl);
  const regCfg = await rpc.view<any>(cfg.contracts.registry, "config").catch(() => null);
  if (!regCfg) { say(`No registry at ${cfg.contracts.registry}. Deploy it first. Stopping.`); finish(1); }
  if (regCfg.vault_code_hash !== cfg.vaultCodeHash) say(`  Warning: registry vault_code_hash ${regCfg.vault_code_hash} differs from the server's ${cfg.vaultCodeHash}.`);
  if (regCfg.relayer !== cfg.relayer) { say(`Registry relayer is ${regCfg.relayer}, server relayer is ${cfg.relayer}. Stopping.`); finish(1); }
  say(`Registry OK: account_funding ${regCfg.account_funding} yocto, relayer ${regCfg.relayer}`);

  // ---------------------------------------------------------------- keys (saved before anything is sent)
  const name = (process.argv[2] ?? (await ask("Name to register (2-32 chars: a-z 0-9, - or _ between them)"))).toLowerCase();
  const accountId = `${name}.${cfg.root}`, vaultId = `vault.${accountId}`;
  const keyDir = fileURLToPath(new URL("../.oiko/", import.meta.url)); // repo-root .oiko/ (gitignored)
  mkdirSync(keyDir, { recursive: true });
  const keyFile = `${keyDir}mainnet-proof-${name}.json`;
  let keys: { owner: { publicKey: string; secretKey: string }; app: { publicKey: string; secretKey: string } };
  if (existsSync(keyFile)) {
    keys = JSON.parse(readFileSync(keyFile, "utf8"));
    say(`Using saved keys from ${keyFile}`);
  } else {
    keys = { owner: generateKeyPair(), app: generateKeyPair() };
    writeFileSync(keyFile, JSON.stringify({ accountId, vaultId, ...keys }, null, 2), { mode: 0o600 });
    say(`New keys saved to ${keyFile} (mode 600). Back this file up: the owner key is the only full-access key to ${accountId}.`);
  }
  const owner = new Signer(rpc, accountId, keys.owner.secretKey);
  const app = new Signer(rpc, accountId, keys.app.secretKey);
  const vault = new VaultClient(rpc, vaultId, app);

  // ---------------------------------------------------------------- 1. register
  say(`\n1. Register ${accountId}`);
  if (await rpc.accountExists(accountId)) {
    say("   Already exists; skipping registration.");
  } else {
    await confirm(`relayer ${cfg.relayer} calls ${cfg.contracts.registry}.register_name("${name}") with ${regCfg.account_funding} yoctoNEAR`);
    const r = await api<{ txHash: string }>("/api/register", { name, ownerPublicKey: keys.owner.publicKey, appPublicKey: keys.app.publicKey });
    record("Register name", r.txHash, accountId);
    say(`   tx ${r.txHash}`);
    for (let i = 0; i < 10 && !(await rpc.accountExists(accountId)); i++) await sleep(2000);
  }

  // ---------------------------------------------------------------- 2. create the keyless account
  say(`\n2. Create ${vaultId} (no access keys)`);
  if (await rpc.accountExists(vaultId)) {
    say("   Already exists; skipping.");
  } else {
    const config = {
      max_utilization_bps: 9200, large_withdrawal_threshold: toUnits("1000"), lending: cfg.contracts.lending,
      ajo: cfg.contracts.ajo, mpc_signer: cfg.contracts.mpcSigner, agent_allowance: (10n ** 24n / 4n).toString(),
    };
    await confirm(`${accountId} creates ${vaultId}: transfer ${cfg.vaultFunding} yoctoNEAR, use code ${cfg.vaultCodeHash}, call new() (relayed by ${cfg.relayer})`);
    const sd = await owner.signDelegate(vaultId, [
      act.createAccount(), act.transfer(BigInt(cfg.vaultFunding)), act.useGlobalContract(cfg.vaultCodeHash),
      act.functionCall("new", { owner: accountId, usdc: cfg.contracts.usdc, usdt: cfg.contracts.usdt, config }, 150n * 10n ** 12n),
    ]);
    const r = await api<{ txHash: string; outcome: { ok: boolean } }>("/api/relay", { signedDelegate: sd });
    record("Create keyless account", r.txHash, vaultId);
    say(`   tx ${r.txHash} ok=${r.outcome.ok}`);
    await sleep(3000);
  }
  const vkeys = await rpc.viewAccessKeyList(vaultId);
  say(`   ${vaultId} access keys: ${vkeys.length}`);
  if (vkeys.length !== 0) say("   Warning: expected 0 keys.");

  // Savings pot for Earn (Spend cannot earn).
  let ov = await vault.overview();
  let savings = ov.pots.find((p) => p.kind === "autosave");
  if (!savings) {
    await confirm(`app key calls ${vaultId}.create_pot("Savings", kind autosave)`);
    const r = await vault.createPot({ name: "Savings", icon: "savings", color: "mint", kind: "autosave" });
    record("Create Savings pot", r.txHash);
    if (!r.ok) { say(`   Failed: ${r.errorCode} ${r.errorMessage ?? ""}`); finish(1); }
    ov = await vault.overview();
    savings = ov.pots.find((p) => p.kind === "autosave")!;
  }

  // ---------------------------------------------------------------- 3. real 1Click deposit
  say("\n3. Pay the account through a real 1Click deposit quote");
  const toks = (await api<any>("/api/intents/tokens")).groups as Array<{ label: string; chain: string; symbol: string; assetId: string; decimals: number }>;
  const choices = toks.filter((t) => t.chain !== "near");
  choices.forEach((t, i) => say(`   ${i + 1}. ${t.label}`));
  const pick = choices[Number(await ask("Pay from which (number)", "1")) - 1];
  if (!pick) finish(1);
  const human = await ask(`How much ${pick.symbol}? (live minimum is 100)`, "100");
  const refundTo = await ask(`Refund address on ${pick.label.replace(/^.* on /, "")} (yours)`);
  let dep: any;
  try {
    dep = await api("/api/intents/deposit-address", { name, originAsset: pick.assetId, amount: toUnits(human, pick.decimals), refundTo });
  } catch (e) {
    say(`   Quote refused: ${(e as Error).message}`);
    finish(1);
  }
  say(`   Send exactly ${formatAmount(dep.amountIn, { decimals: pick.decimals })} ${pick.symbol} to:`);
  say(`     ${dep.depositAddress}${dep.depositMemo ? `   memo ${dep.depositMemo}` : ""}`);
  say(`   You receive about ${formatAmount(dep.amountOut)} ${dep.destinationToken.toUpperCase()} (fee ${formatAmount(dep.fee)}), deadline ${dep.deadline}`);
  say("   This transfer is made by you, from your own wallet on that chain. The script only watches.");
  await ask("Press Enter after you have sent it");
  const st = await waitForSwap("Deposit", dep.depositAddress, dep.depositMemo);
  if (st !== "SUCCESS") { say(`   Deposit ended as ${st}.`); finish(1); }

  // ---------------------------------------------------------------- 4. sync
  say("\n4. Sync (credit the payment and run the plan)");
  await confirm(`app key calls ${vaultId}.sync()`);
  const s = await vault.sync();
  record("Sync", s.txHash);
  await sleep(4000);
  ov = await vault.overview();
  say(`   Totals: ${formatAmount(ov.totals.usdc)} USDC, ${formatAmount(ov.totals.usdt)} USDT; Spend ${formatAmount(ov.flex.usdt)} USDT`);
  const token: Token = BigInt(ov.flex.usdt) >= BigInt(ov.flex.usdc) ? "usdt" : "usdc";

  // ---------------------------------------------------------------- 5. withdraw 1 USDT via real 1Click
  say(`\n5. Withdraw from Spend to another chain through a real 1Click withdraw quote (${token.toUpperCase()})`);
  const dests = toks.filter((t) => t.chain !== "near");
  dests.forEach((t, i) => say(`   ${i + 1}. ${t.label}`));
  const dest = dests[Number(await ask("Send to which (number)", "1")) - 1];
  if (!dest) finish(1);
  const destAddr = await ask(`Destination address on ${dest.label.replace(/^.* on /, "")}`);
  let amountHuman = await ask(`Amount of ${token.toUpperCase()}`, "1");
  let wq: any;
  for (;;) {
    try {
      wq = await api("/api/intents/withdraw-quote", { vaultId, potId: 0, token, amount: toUnits(amountHuman), destinationAsset: dest.assetId, destinationAddress: destAddr });
      break;
    } catch (e) {
      say(`   Quote refused: ${(e as Error).message}`);
      amountHuman = await ask("Try another amount (empty to stop)");
      if (!amountHuman) finish(1);
    }
  }
  say(`   Quote: send ${formatAmount(wq.amountIn)} ${token.toUpperCase()} to ${wq.depositAddress}${wq.depositMemo ? ` memo ${wq.depositMemo}` : ""}, receive about ${formatAmount(wq.amountOut, { decimals: dest.decimals })} ${dest.symbol}, fee ${formatAmount(wq.fee)}`);
  const doWithdraw = async () => {
    await confirm(`app key calls ${vaultId}.withdraw(pot 0, ${token}, ${wq.amountIn}, to ${wq.depositAddress}${wq.depositMemo ? `, memo ${wq.depositMemo}` : ""})`);
    const r = await vault.withdraw(0, token, wq.amountIn, wq.depositAddress, wq.depositMemo);
    record("Withdraw via 1Click", r.txHash, `${formatAmount(wq.amountIn)} ${token.toUpperCase()}`);
    return r;
  };
  let w = await doWithdraw();
  const transferFailed = (r: typeof w) => !r.ok || r.value === false || r.logs.some((l) => l.includes("E_TRANSFER_FAILED"));
  if (transferFailed(w)) {
    say(`   The transfer did not go through (${w.errorCode ?? "E_TRANSFER_FAILED"}); the money went back to Spend.`);
    say("   The 1Click deposit address may need token storage on NEAR.");
    const tokenId = token === "usdt" ? cfg.contracts.usdt : cfg.contracts.usdc;
    await confirm(`owner key calls ${tokenId}.storage_deposit({account_id: ${wq.depositAddress}, registration_only: true}) with 0.00125 NEAR`);
    const sdp = await owner.call(tokenId, "storage_deposit", { account_id: wq.depositAddress, registration_only: true }, { deposit: (125n * 10n ** 19n).toString(), gas: (30n * 10n ** 12n).toString() });
    record("Storage deposit for 1Click address", sdp.txHash);
    w = await doWithdraw();
    if (transferFailed(w)) { say(`   Still failed: ${w.errorCode ?? ""} ${w.errorMessage ?? ""}`); finish(1); }
  }
  const wst = await waitForSwap("Withdraw", wq.depositAddress, wq.depositMemo, 60);
  say(`   Withdraw ended as ${wst}.`);

  // ---------------------------------------------------------------- 6. earn_on with real Rhea
  say("\n6. Earn on Rhea (move to Savings, then supply)");
  ov = await vault.overview();
  const spendNow = BigInt(ov.flex[token]);
  const earnHuman = await ask(`How much ${token.toUpperCase()} to move to Savings and supply (Spend has ${formatAmount(spendNow.toString())})`, "1");
  const earnUnits = toUnits(earnHuman);
  if (BigInt(earnUnits) > spendNow) { say("   Not enough in Spend."); finish(1); }
  await confirm(`app key calls ${vaultId}.move_funds(0 → ${savings.id}, ${token}, ${earnUnits})`);
  const mv = await vault.moveFunds(0, savings.id, token, earnUnits);
  record("Move Spend → Savings", mv.txHash);
  if (!mv.ok) { say(`   Failed: ${mv.errorCode}`); finish(1); }
  await confirm(`app key calls ${vaultId}.earn_on(${savings.id}, ${token}, ${earnUnits}) → ${cfg.contracts.lending} (refused above 92% utilization)`);
  const e = await vault.earnOn(savings.id, token, earnUnits);
  record("Earn on (Rhea)", e.txHash, e.value === false ? "refused by the utilization guard" : undefined);
  say(e.ok && e.value !== false ? "   Supplied." : `   Not supplied: ${e.errorCode ?? (e.logs.find((l) => l.includes("E_")) ?? "refused")}`);
  say(`   To take it back later: earn_off(${savings.id}, ${token}, amount) with the app key.`);

  say("\nDone. Paste the table below into the README.");
  finish(0);
}

main().catch((e) => {
  console.error(`\nStopped: ${(e as Error).message}`);
  finish(1);
});
