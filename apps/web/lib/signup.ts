// Sign-up: name -> owner key (passkey PRF or browser key) + app key -> POST /api/register (relayer creates <name>.<root>)
// -> vault creation as a NEP-366 delegate signed by the owner key -> POST /api/relay. No seed phrase screen.
import { ONE_NEAR, Signer, act, generateKeyPair, type OikoConfig } from "@oiko/sdk";
import { api } from "./api";
import { fetchApiConfig, rpcFor, toOikoConfig, type ApiConfig } from "./config";
import { isFixtureMode } from "./fixtures/mode";
import { createPasskey } from "./passkey";
import type { LoginMethod, Session } from "./session";

export type SignupStep = "name" | "account" | "done";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check: () => Promise<boolean>, timeoutMs = 30_000, everyMs = 800) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { if (await check()) return; } catch { /* keep polling */ }
    await sleep(everyMs);
  }
  throw new Error("E_EXPIRED_TX: setup took too long");
}

/**
 * Vault creation actions (contracts.md "Vault creation"): CreateAccount -> Transfer(vault_funding) -> UseGlobalContract(code_hash)
 * -> FunctionCall new(owner, usdc, usdt, config). No AddKey. vault_funding/config can be supplied by /api/config
 * (`vaultFunding`, `vaultConfig`); otherwise these defaults are used. RECONCILE with the server's relay allow-list.
 */
export function vaultCreationActions(cfg: OikoConfig, apiCfg: ApiConfig, owner: string) {
  if (!apiCfg.vaultCodeHash) throw new Error("E_UNTRUSTED_CODE: no published account code");
  const funding = apiCfg.vaultFunding ?? (ONE_NEAR / 2n).toString();
  const config = apiCfg.vaultConfig ?? {
    max_utilization_bps: 9200,
    large_withdrawal_threshold: "1000000000", // 1,000 units (6 decimals)
    lending: cfg.contracts.lending,
    ajo: cfg.contracts.ajo,
    mpc_signer: cfg.contracts.mpcSigner,
    agent_allowance: (ONE_NEAR / 4n).toString(),
  };
  return [
    act.createAccount(),
    act.transfer(funding),
    act.useGlobalContract(apiCfg.vaultCodeHash),
    act.functionCall("new", { owner, usdc: cfg.contracts.usdc, usdt: cfg.contracts.usdt, config }, 150n * 1_000_000_000_000n),
  ];
}

export async function signUp(opts: {
  name: string;
  displayName: string;
  method: LoginMethod;
  onStep: (s: SignupStep) => void;
}): Promise<Session> {
  const { name, displayName, method, onStep } = opts;
  onStep("name");
  if (isFixtureMode()) {
    await api("/api/register", { body: { name } });
    onStep("account");
    await api("/api/relay", { body: { signedDelegate: "" } });
    onStep("done");
    return { name, displayName, accountId: `${name}.oiko.testnet`, vaultId: `vault.${name}.oiko.testnet`, appKey: "ed25519:fixture", method, createdAt: Date.now() };
  }
  const apiCfg = await fetchApiConfig();
  const cfg = toOikoConfig(apiCfg);
  const rpc = rpcFor(cfg);

  let owner: { publicKey: string; secretKey: string };
  let credentialId: string | undefined;
  if (method === "passkey") {
    const pk = await createPasskey(name, displayName);
    owner = pk;
    credentialId = pk.credentialId;
  } else {
    owner = generateKeyPair();
  }
  const app = generateKeyPair();

  const reg = await api<{ accountId: string; vaultId: string; txHash: string }>("/api/register", {
    body: { name, ownerPublicKey: owner.publicKey, appPublicKey: app.publicKey },
  });
  onStep("account");
  await waitFor(async () => !!(await rpc.viewAccessKey(reg.accountId, owner.publicKey)));

  if (!(await rpc.accountExists(reg.vaultId))) {
    const signer = new Signer(rpc, reg.accountId, owner.secretKey);
    const signedDelegate = await signer.signDelegate(reg.vaultId, vaultCreationActions(cfg, apiCfg, reg.accountId));
    await api("/api/relay", { body: { signedDelegate } });
    await waitFor(() => rpc.accountExists(reg.vaultId));
  }
  onStep("done");
  return {
    name, displayName, accountId: reg.accountId, vaultId: reg.vaultId, appKey: app.secretKey, method, credentialId,
    ownerKey: method === "passkey" ? undefined : owner.secretKey,
    createdAt: Date.now(),
  };
}
