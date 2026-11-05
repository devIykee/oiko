import { sha256 } from "@noble/hashes/sha2.js";
import { deserialize, serialize } from "borsh";
import {
  PublicKey, SCHEMA, Signature, SignedTransaction, Transaction, actions as nearActions,
  buildDelegateAction, createTransaction, encodeDelegateAction, encodeSignedDelegate, encodeTransaction, KeyType,
} from "near-api-js";
import type { Action, SignedDelegate } from "near-api-js";
import { b58decode, b58encode, b64decode, b64encode } from "./encoding";
import { publicKeyFromSecretKey, signBytes, verifyBytes } from "./keys";
import { NearRpc, parseOutcome, RpcError, type TxResult } from "./rpc";

export type { Action } from "near-api-js";
export type { TxResult } from "./rpc";

export const TGAS = 1_000_000_000_000n;
export const DEFAULT_GAS = 100n * TGAS;
export const ONE_NEAR = 10n ** 24n;

/** Action builders (thin re-exports of near-api-js so callers never import it directly). */
export const act = {
  createAccount: (): Action => nearActions.createAccount(),
  transfer: (yocto: string | bigint): Action => nearActions.transfer(BigInt(yocto)),
  functionCall: (method: string, args: object, gas: string | bigint = DEFAULT_GAS, deposit: string | bigint = 0n): Action =>
    nearActions.functionCall(method, args, BigInt(gas), BigInt(deposit)),
  addFullAccessKey: (publicKey: string): Action => nearActions.addFullAccessKey(PublicKey.fromString(publicKey)),
  addFunctionCallKey: (publicKey: string, receiverId: string, methodNames: string[], allowanceYocto?: string | bigint): Action =>
    nearActions.addFunctionCallAccessKey(PublicKey.fromString(publicKey), receiverId, methodNames, allowanceYocto === undefined ? undefined : BigInt(allowanceYocto)),
  deleteKey: (publicKey: string): Action => nearActions.deleteKey(PublicKey.fromString(publicKey)),
  deleteAccount: (beneficiaryId: string): Action => nearActions.deleteAccount(beneficiaryId),
  deployContract: (code: Uint8Array): Action => nearActions.deployContract(code),
  /** UseGlobalContract by immutable code hash (base58 string or 32 bytes). */
  useGlobalContract: (codeHash: string | Uint8Array): Action =>
    nearActions.useGlobalContract({ codeHash: typeof codeHash === "string" ? b58decode(codeHash) : codeHash }),
};

export function encodeActions(list: Action[]): Uint8Array[] {
  return list.map((a) => encodeActionBytes(a));
}
/** Borsh bytes of one action (nearcore `Action` enum layout). */
export function encodeActionBytes(a: Action): Uint8Array {
  return serialize(SCHEMA.Action, a);
}

function toSig(sig: Uint8Array): Signature {
  return new Signature({ keyType: KeyType.ED25519, data: sig });
}

export interface UnsignedTx { bytes: Uint8Array; hash: Uint8Array; tx: Transaction }

/** Signs borsh `Transaction` bytes produced by {@link Signer.buildUnsigned}; returns borsh `SignedTransaction` bytes. */
export function signTransactionBytes(secretKey: string, unsignedTx: Uint8Array): { signedTx: Uint8Array; hash: Uint8Array } {
  const tx = Transaction.decode(unsignedTx);
  if (tx.publicKey.toString() !== publicKeyFromSecretKey(secretKey)) throw new Error("This key does not match the transaction's key.");
  const hash = sha256(unsignedTx);
  const signed = new SignedTransaction({ transaction: tx, signature: toSig(signBytes(secretKey, hash)) });
  return { signedTx: encodeTransaction(signed), hash };
}

export function decodeSignedTx(bytes: Uint8Array): SignedTransaction {
  return SignedTransaction.decode(bytes);
}
export function txHashOf(tx: Transaction): string {
  return b58encode(sha256(encodeTransaction(tx)));
}
/** Verifies the ed25519 signature on a decoded signed transaction. */
export function verifySignedTx(stx: SignedTransaction): boolean {
  const hash = sha256(encodeTransaction(stx.transaction));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sig = stx.signature as any;
  const data: Uint8Array | number[] | undefined = sig.ed25519Signature?.data ?? sig.data;
  return !!data && verifyBytes(stx.transaction.publicKey.toString(), hash, Uint8Array.from(data));
}

/** Plain-object view of a SignedDelegate decoded from borsh (used by the relayer allow-list). */
export interface DecodedDelegate {
  senderId: string; receiverId: string; nonce: bigint; maxBlockHeight: bigint; publicKey: string;
  actions: DecodedAction[]; signature: Uint8Array; raw: SignedDelegate;
}
export type DecodedAction =
  | { kind: "createAccount" }
  | { kind: "transfer"; deposit: bigint }
  | { kind: "functionCall"; methodName: string; args: Uint8Array; gas: bigint; deposit: bigint }
  | { kind: "useGlobalContract"; codeHash?: string; accountId?: string }
  | { kind: "deployContract"; code: Uint8Array }
  | { kind: "deleteKey"; publicKey: string }
  | { kind: "addKey" } | { kind: "deleteAccount" } | { kind: "stake" } | { kind: "deployGlobalContract" } | { kind: "other"; name: string };

type BorshPk = { ed25519Key?: { data: number[] | Uint8Array }; secp256k1Key?: unknown };
function pkString(pk: BorshPk): string {
  if (pk.ed25519Key) return `ed25519:${b58encode(Uint8Array.from(pk.ed25519Key.data))}`;
  return "unsupported";
}

export function decodeSignedDelegate(b64: string): DecodedDelegate {
  const bytes = b64decode(b64);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = deserialize(SCHEMA.SignedDelegate, bytes) as any;
  const da = d.delegateAction;
  const actionsOut: DecodedAction[] = (da.actions as Array<Record<string, any>>).map((a) => {
    const name = Object.keys(a)[0]!;
    const v = a[name];
    switch (name) {
      case "createAccount": return { kind: "createAccount" };
      case "transfer": return { kind: "transfer", deposit: BigInt(v.deposit) };
      case "functionCall": return { kind: "functionCall", methodName: v.methodName, args: Uint8Array.from(v.args), gas: BigInt(v.gas), deposit: BigInt(v.deposit) };
      case "useGlobalContract": {
        const id = v.contractIdentifier;
        return id.CodeHash ? { kind: "useGlobalContract", codeHash: b58encode(Uint8Array.from(id.CodeHash)) } : { kind: "useGlobalContract", accountId: id.AccountId };
      }
      case "deployContract": return { kind: "deployContract", code: Uint8Array.from(v.code) };
      case "deleteKey": return { kind: "deleteKey", publicKey: pkString(v.publicKey) };
      case "addKey": case "deleteAccount": case "stake": case "deployGlobalContract": return { kind: name } as DecodedAction;
      default: return { kind: "other", name };
    }
  });
  const sigData: Uint8Array = Uint8Array.from(d.signature.ed25519Signature?.data ?? d.signature.secp256k1Signature?.data ?? []);
  // Plain borsh-shaped objects re-encode byte-identically with near-api-js SCHEMA (SignedDelegate is type-only at runtime).
  const raw = { delegateAction: da, signature: d.signature } as SignedDelegate;
  return {
    senderId: da.senderId, receiverId: da.receiverId, nonce: BigInt(da.nonce), maxBlockHeight: BigInt(da.maxBlockHeight),
    publicKey: pkString(da.publicKey), actions: actionsOut, signature: sigData, raw,
  };
}

/** True if the delegate's signature is valid for its own public key (NEP-366 / NEP-461 prefix hash). */
export function verifySignedDelegate(d: DecodedDelegate): boolean {
  return verifyBytes(d.publicKey, sha256(encodeDelegateAction(d.raw.delegateAction)), d.signature);
}

/** Signs transactions with a secret key held by the caller (browser key, agent key, relayer key). */
export class Signer {
  readonly publicKey: string;
  private nextNonce: bigint | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(public readonly rpc: NearRpc, public readonly accountId: string, private readonly secretKey: string) {
    this.publicKey = publicKeyFromSecretKey(secretKey);
  }

  private async takeNonce(): Promise<bigint> {
    const ak = await this.rpc.viewAccessKey(this.accountId, this.publicKey);
    if (!ak) throw new RpcError(`E_NO_KEY: key ${this.publicKey} is not on ${this.accountId}`);
    const chain = BigInt(ak.nonce) + 1n;
    const n = this.nextNonce !== null && this.nextNonce > chain ? this.nextNonce : chain;
    this.nextNonce = n + 1n;
    return n;
  }

  /** Builds an unsigned transaction. `signerId`/`publicKey` default to this signer, but can name another account+key (agent prepare). */
  async buildUnsigned(receiverId: string, actionList: Action[], opts: { signerId?: string; publicKey?: string } = {}): Promise<UnsignedTx> {
    return buildUnsignedTx(this.rpc, opts.signerId ?? this.accountId, opts.publicKey ?? this.publicKey, receiverId, actionList);
  }

  async signAndSend(receiverId: string, actionList: Action[]): Promise<TxResult> {
    const run = async (): Promise<TxResult> => {
      const nonce = await this.takeNonce();
      const block = await this.rpc.block("final");
      const tx = createTransaction(this.accountId, PublicKey.fromString(this.publicKey), receiverId, nonce, actionList, b58decode(block.hash));
      const bytes = encodeTransaction(tx);
      const hash = sha256(bytes);
      const signed = new SignedTransaction({ transaction: tx, signature: toSig(signBytes(this.secretKey, hash)) });
      const txHash = b58encode(hash);
      try {
        const out = await this.rpc.sendTx(b64encode(encodeTransaction(signed)));
        return parseOutcome(out, txHash);
      } catch (e) {
        const msg = (e as Error).message;
        if (/InvalidNonce/i.test(msg)) this.nextNonce = null;
        const code = /\b(E_[A-Z0-9_]+)\b/.exec(msg)?.[1] ?? (/NotEnoughBalance|LackBalanceForState|NotEnoughAllowance/i.test(msg) ? "E_NO_GAS" : /InvalidNonce/.test(msg) ? "E_NONCE" : /Expired/.test(msg) ? "E_EXPIRED_TX" : "E_RPC");
        return { txHash, ok: false, errorCode: code, errorMessage: msg, logs: [] };
      }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  call(receiverId: string, method: string, args: object, opts: { gas?: string; deposit?: string } = {}): Promise<TxResult> {
    return this.signAndSend(receiverId, [act.functionCall(method, args, opts.gas ?? DEFAULT_GAS, opts.deposit ?? 0n)]);
  }

  /** NEP-366: returns base64 borsh SignedDelegate for POST /api/relay. */
  async signDelegate(receiverId: string, actionList: Action[], ttlBlocks = 200): Promise<string> {
    const ak = await this.rpc.viewAccessKey(this.accountId, this.publicKey);
    if (!ak) throw new Error(`E_NO_KEY: key ${this.publicKey} is not on ${this.accountId}`);
    const block = await this.rpc.block("final");
    const delegateAction = buildDelegateAction({
      senderId: this.accountId, receiverId, actions: actionList, nonce: BigInt(ak.nonce) + 1n,
      maxBlockHeight: BigInt(block.height + ttlBlocks), publicKey: PublicKey.fromString(this.publicKey),
    });
    const sig = signBytes(this.secretKey, sha256(encodeDelegateAction(delegateAction)));
    return b64encode(encodeSignedDelegate({ delegateAction, signature: toSig(sig) } as SignedDelegate));
  }

  /** Signs and sends an outer transaction wrapping a SignedDelegate (relayer side). */
  relayDelegate(d: DecodedDelegate): Promise<TxResult> {
    return this.signAndSend(d.senderId, [nearActions.signedDelegate({ delegateAction: d.raw.delegateAction, signature: d.raw.signature })]);
  }
}

export async function buildUnsignedTx(rpc: NearRpc, signerId: string, publicKey: string, receiverId: string, actionList: Action[]): Promise<UnsignedTx> {
  const ak = await rpc.viewAccessKey(signerId, publicKey);
  if (!ak) throw new Error(`E_NO_KEY: key ${publicKey} is not on ${signerId}`);
  const block = await rpc.block("final");
  const tx = createTransaction(signerId, PublicKey.fromString(publicKey), receiverId, BigInt(ak.nonce) + 1n, actionList, b58decode(block.hash));
  const bytes = encodeTransaction(tx);
  return { bytes, hash: sha256(bytes), tx };
}
