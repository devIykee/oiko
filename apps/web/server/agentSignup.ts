// Self-service account creation for agents. An agent generates its own ed25519 keypair, proves
// possession of the private key via a NEP-413 signature over a deterministic challenge, and the
// relayer creates both the identity account and the vault on its behalf.
//
// Flow:
//   1. Server generates a short-lived ephemeral keypair.
//   2. register_name(name, owner=ephemeral, app=agent_pk): relayer pays the deposit.
//   3. Wait for identity account to appear on-chain.
//   4. Ephemeral signer builds + signs the vault-creation NEP-366 delegate; relayer relays it.
//   5. Wait for vault to appear.
//   6. Ephemeral signer sends one tx: addFullAccessKey(agent_pk) + deleteKey(ephemeral_pk).
//   7. Net result: identity account has exactly one full-access key = the agent's own key.
//      Vault is keyless (same as browser signup).
//
// Security: proof-of-key-possession (step 0) prevents anyone registering another key as their own.
// Rate limits: tighter than browser signup (see LIMITS.agentSignup in ratelimit.ts).
// Budget: ~0.6 NEAR from the relayer daily budget per call.

import {
  act, accountIdFor, decodeSignedDelegate, generateKeyPair, normalizePublicKey, NAME_RE,
  ONE_NEAR, RegistryClient, Signer, TGAS, verifyNep413, vaultIdFor,
} from "@oiko/sdk";
import { serverConfig } from "./config";
import { ApiError } from "./errors";
import { relayer, rpc } from "./near";
import { checkLimits, GAS_COST_ESTIMATE, spendBudget } from "./ratelimit";
import { trustedHashes } from "./relayer";

/** NEP-413 recipient used in the agent-signup proof (distinct from the gateway recipient). */
export const AGENT_SIGNUP_RECIPIENT = "oiko-agent-signup";

/** Max age of the signed proof timestamp (5-minute window, same as the gateway). */
const PROOF_WINDOW_MS = 5 * 60 * 1000;

/**
 * The challenge message the agent must sign to prove it controls its claimed public key.
 * Includes the desired name so the proof cannot be replayed for a different name.
 */
export function agentSignupChallenge(name: string, timestampMs: number): string {
  return `oiko-agent-signup:${name}:${timestampMs}`;
}

export interface AgentSignupInput {
  /** Desired name (2-32 chars, lowercase letters/digits/hyphens). */
  name: string;
  /** The agent's own ed25519 public key: ed25519:<base58>. The agent keeps the secret key. */
  publicKey: string;
  /** NEP-413 proof that the agent controls the claimed public key. */
  proof: {
    /** base64 ed25519 signature over the NEP-413 payload. */
    signature: string;
    /** base64 32-byte nonce. */
    nonce: string;
    /** Unix millisecond timestamp used in the challenge message (must be within 5 minutes of now). */
    timestamp: number;
  };
}

export interface AgentSignupResult {
  name: string;
  accountId: string;
  vaultId: string;
  paymentLink: string;
  txHash: string;
  vaultTxHash: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitFor(label: string, check: () => Promise<boolean>, timeoutMs = 25_000, intervalMs = 600): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { if (await check()) return; } catch { /* keep polling */ }
    await sleep(intervalMs);
  }
  throw new ApiError("E_TIMEOUT", 502, `Timed out waiting for ${label}. The relayer may be slow; try again.`);
}

async function accountFunding(cfg: ReturnType<typeof serverConfig>): Promise<bigint> {
  try {
    const c = await new RegistryClient(rpc(), cfg.oiko.contracts.registry).config();
    const v = (c as Record<string, unknown>).account_funding;
    if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  } catch { /* fall through */ }
  if (cfg.limits.accountFunding !== null) return cfg.limits.accountFunding;
  throw new ApiError("E_CONFIG", 503, "Account funding is unknown. Set OIKO_ACCOUNT_FUNDING_NEAR or deploy the registry.");
}

function txFail(label: string, txHash: string, errorCode?: string, errorMessage?: string): never {
  console.error(`[agentSignup] ${label} failed`, txHash, errorCode, errorMessage);
  throw new ApiError(errorCode ?? "E_TX_FAILED", errorCode === "E_RPC" ? 502 : 422,
    errorMessage ?? `${label} transaction failed.`);
}

export async function agentCreateAccount(input: AgentSignupInput, ip: string): Promise<AgentSignupResult> {
  const cfg = serverConfig();

  // 1. Validate name
  const name = input.name.toLowerCase().trim();
  if (!NAME_RE.test(name)) {
    throw new ApiError("E_NAME_INVALID", 400,
      `"${name}" is not a valid name. Use 2-32 lowercase letters, digits and hyphens (not at start/end).`);
  }

  // 2. Validate and normalise the claimed public key
  let agentPk: string;
  try {
    agentPk = normalizePublicKey(input.publicKey);
  } catch {
    throw new ApiError("E_BAD_REQUEST", 400, "publicKey must be an ed25519 key in the form ed25519:<base58>.");
  }

  // 3. Verify proof-of-key-possession (NEP-413)
  const { signature, nonce, timestamp } = input.proof;
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new ApiError("E_BAD_REQUEST", 400, "proof.timestamp must be a positive unix millisecond integer.");
  }
  if (Math.abs(Date.now() - timestamp) > PROOF_WINDOW_MS) {
    throw new ApiError("E_PROOF_STALE", 401,
      "The proof has expired or is too far in the future. Generate a fresh one within the 5-minute window.");
  }
  const message = agentSignupChallenge(name, timestamp);
  if (!verifyNep413({ publicKey: agentPk, signature, nonce, message, recipient: AGENT_SIGNUP_RECIPIENT })) {
    throw new ApiError("E_PROOF_INVALID", 401,
      'The NEP-413 proof-of-key-possession signature did not verify. ' +
      `Sign message="${message}" with recipient="${AGENT_SIGNUP_RECIPIENT}" using your private key.`);
  }

  // 4. Rate limit (tighter than browser signup to protect the relayer budget)
  if (!checkLimits("agentSignup", ip, name)) throw new ApiError("E_RATE_LIMIT", 429);

  // 5. Name availability
  const reg = new RegistryClient(rpc(), cfg.oiko.contracts.registry);
  if (!(await reg.isAvailable(name))) {
    throw new ApiError("E_NAME_TAKEN", 409, `"${name}" is already taken. Try a different name.`);
  }

  // 6. Budget check (identity + vault funding + gas for 3 transactions)
  const registryFunding = await accountFunding(cfg);
  if (!spendBudget(cfg.limits.dailyBudget, registryFunding + cfg.limits.vaultFunding + 3n * GAS_COST_ESTIMATE)) {
    throw new ApiError("E_BUDGET", 503, "The relayer's daily budget is exhausted. Try again tomorrow.");
  }

  // 7. Generate an ephemeral keypair (lives only for the duration of this call, ~5-10 s)
  const ephemeral = generateKeyPair();

  // 8. Register identity account: ephemeral = owner (full-access), agent's key = app (function-call)
  //    We use ephemeral as owner so we can sign the vault-creation delegate on the server.
  //    After the vault is created we rotate: add agent's key as full-access, delete ephemeral.
  const r1 = await relayer().call(
    cfg.oiko.contracts.registry, "register_name",
    { name, owner_public_key: ephemeral.publicKey, app_public_key: agentPk },
    { deposit: registryFunding.toString(), gas: (150n * TGAS).toString() },
  );
  if (!r1.ok) txFail("register_name", r1.txHash, r1.errorCode, r1.errorMessage);

  const accountId = accountIdFor(name, cfg.oiko);
  const vaultId = vaultIdFor(name, cfg.oiko);

  // 9. Wait for the identity account to appear (relayer tx must be finalised)
  await waitFor(`identity account ${accountId}`, () => rpc().accountExists(accountId));

  // 10. Sign the vault-creation delegate with the ephemeral key and relay it
  const hashes = await trustedHashes(cfg);
  if (!cfg.vaultCodeHash && hashes.size === 0) {
    throw new ApiError("E_CONFIG", 503, "No trusted vault code hash is configured. The server admin must set OIKO_VAULT_CODE_HASH.");
  }
  const codeHash = cfg.vaultCodeHash ?? [...hashes][0]!;
  const vaultFunding = cfg.limits.vaultFunding;
  const vaultConfig = {
    max_utilization_bps: 9200,
    large_withdrawal_threshold: "1000000000",
    lending: cfg.oiko.contracts.lending,
    ajo: cfg.oiko.contracts.ajo,
    mpc_signer: cfg.oiko.contracts.mpcSigner,
    agent_allowance: (ONE_NEAR / 4n).toString(),
  };
  const vaultActions = [
    act.createAccount(),
    act.transfer(vaultFunding),
    act.useGlobalContract(codeHash),
    act.functionCall(
      "new",
      { owner: accountId, usdc: cfg.oiko.contracts.usdc, usdt: cfg.oiko.contracts.usdt, config: vaultConfig },
      150n * TGAS,
    ),
  ];

  const ephSigner = new Signer(rpc(), accountId, ephemeral.secretKey);
  const signedDelegate = await ephSigner.signDelegate(vaultId, vaultActions);
  const r2 = await relayer().relayDelegate(decodeSignedDelegate(signedDelegate));
  if (!r2.ok) txFail("vault creation relay", r2.txHash, r2.errorCode, r2.errorMessage);
  const vaultTxHash = r2.txHash;

  // 11. Wait for the vault to exist
  await waitFor(`vault account ${vaultId}`, () => rpc().accountExists(vaultId));

  // 12. Key rotation: delete both keys (ephemeral owner + agent's function-call app key),
  //     then add agent's key as full-access. We must delete the agent's function-call key first
  //     because NEAR doesn't allow the same public key with two different permission types.
  const r3 = await ephSigner.signAndSend(accountId, [
    act.deleteKey(agentPk),              // remove the function-call app key
    act.deleteKey(ephemeral.publicKey),  // remove the ephemeral owner key
    act.addFullAccessKey(agentPk),       // add agent's key as full-access
  ]);
  if (!r3.ok) txFail("key rotation", r3.txHash, r3.errorCode, r3.errorMessage);

  const paymentLink = `${cfg.publicUrl}/pay/${name}`;
  return { name, accountId, vaultId, paymentLink, txHash: r1.txHash, vaultTxHash };
}
