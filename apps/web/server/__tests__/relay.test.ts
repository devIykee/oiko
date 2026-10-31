import { describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { buildDelegateAction, encodeDelegateAction, encodeSignedDelegate, KeyType, PublicKey, Signature } from "near-api-js";
import type { Action, SignedDelegate } from "near-api-js";
import { act, b58encode, b64encode, decodeSignedDelegate, keyPairFromSeed, signBytes } from "@oiko/sdk";
import { checkDelegate, type DelegatePolicy } from "../relayer";

const user = keyPairFromSeed(new Uint8Array(32).fill(21));
const code = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const codeHash = b58encode(sha256(code));
const otherHash = b58encode(new Uint8Array(32).fill(9));
const ROOT = "oiko.testnet";
const NEAR = 10n ** 24n;
const policy: DelegatePolicy = { root: ROOT, usdc: "usdc.oiko.testnet", usdt: "usdt.oiko.testnet", trustedHashes: new Set([codeHash]), maxTransfer: NEAR, currentHeight: 100 };
const newArgs = (o: Record<string, unknown> = {}) => ({ owner: "ada.oiko.testnet", usdc: "usdc.oiko.testnet", usdt: "usdt.oiko.testnet", config: {}, ...o });

function signed(actions: Action[], o: { sender?: string; receiver?: string; maxBlockHeight?: bigint; sk?: string } = {}) {
  const sender = o.sender ?? "ada.oiko.testnet";
  const da = buildDelegateAction({
    senderId: sender, receiverId: o.receiver ?? `vault.${sender}`, actions, nonce: 1n, maxBlockHeight: o.maxBlockHeight ?? 500n,
    publicKey: PublicKey.fromString(user.publicKey),
  });
  const sig = signBytes(o.sk ?? user.secretKey, sha256(encodeDelegateAction(da)));
  return decodeSignedDelegate(b64encode(encodeSignedDelegate({ delegateAction: da, signature: new Signature({ keyType: KeyType.ED25519, data: sig }) } as SignedDelegate)));
}
const good = () => [act.createAccount(), act.transfer(NEAR / 2n), act.useGlobalContract(codeHash), act.functionCall("new", newArgs(), 50n * 10n ** 12n)];
const denied = (d: ReturnType<typeof signed>) => { try { checkDelegate(d, policy); return "OK"; } catch (e) { return (e as { code: string; message: string }).message; } };

describe("relay allow-list", () => {
  it("accepts the vault-creation batch (global contract and plain deploy)", () => {
    expect(denied(signed(good()))).toBe("OK");
    expect(denied(signed([act.createAccount(), act.transfer(NEAR / 2n), act.deployContract(code), act.functionCall("new", newArgs())]))).toBe("OK");
  });
  it("rejects untrusted code and mutable account-id global contracts", () => {
    expect(denied(signed([act.createAccount(), act.useGlobalContract(otherHash), act.functionCall("new", newArgs())]))).toMatch(/trusted/);
    expect(denied(signed([act.createAccount(), act.deployContract(new Uint8Array([1, 2, 3])), act.functionCall("new", newArgs())]))).toMatch(/trusted/);
  });
  it("rejects transfers above the cap", () => {
    expect(denied(signed([act.createAccount(), act.transfer(NEAR + 1n), act.useGlobalContract(codeHash), act.functionCall("new", newArgs())]))).toMatch(/cap/);
  });
  it("rejects receivers outside the sender's vault and senders outside the root", () => {
    expect(denied(signed(good(), { receiver: "vault.bob.oiko.testnet" }))).toMatch(/receiver/);
    expect(denied(signed(good(), { sender: "ada.evil.testnet", receiver: "vault.ada.evil.testnet" }))).toMatch(/sender/);
    expect(denied(signed(good(), { sender: "x.ada.oiko.testnet" }))).toMatch(/sender/);
  });
  it("rejects other methods, deposits, wrong owner/tokens", () => {
    expect(denied(signed([act.functionCall("withdraw", {})]))).toMatch(/new/);
    expect(denied(signed([act.createAccount(), act.useGlobalContract(codeHash), act.functionCall("new", newArgs(), 10n ** 13n, 1n)]))).toMatch(/deposit/);
    expect(denied(signed([act.createAccount(), act.useGlobalContract(codeHash), act.functionCall("new", newArgs({ owner: "mallory.near" }))]))).toMatch(/owner/);
    expect(denied(signed([act.createAccount(), act.useGlobalContract(codeHash), act.functionCall("new", newArgs({ usdc: "fake.near" }))]))).toMatch(/tokens/);
  });
  it("rejects disallowed actions, wrong order, missing code, expired and bad signatures", () => {
    expect(denied(signed([act.createAccount(), act.addFullAccessKey(user.publicKey)]))).toMatch(/not allowed/);
    expect(denied(signed([act.deleteKey(user.publicKey)]))).toMatch(/not allowed/);
    expect(denied(signed([act.useGlobalContract(codeHash), act.createAccount(), act.functionCall("new", newArgs())]))).toMatch(/order/);
    expect(denied(signed([act.createAccount(), act.transfer(1n)]))).toMatch(/trusted code/);
    expect(denied(signed(good(), { maxBlockHeight: 100n }))).toMatch(/expired/);
    expect(denied(signed(good(), { sk: keyPairFromSeed(new Uint8Array(32).fill(5)).secretKey }))).toMatch(/signature/);
  });
});
