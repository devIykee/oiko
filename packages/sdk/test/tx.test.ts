import { describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { buildDelegateAction, encodeDelegateAction, encodeSignedDelegate, PublicKey, Signature, KeyType, createTransaction, encodeTransaction } from "near-api-js";
import type { SignedDelegate } from "near-api-js";
import { act, b58encode, b64encode, decodeSignedDelegate, encodeActionBytes, keyPairFromSeed, signBytes, signTransactionBytes, verifySignedDelegate, decodeSignedTx, verifySignedTx } from "../src";

const kp = keyPairFromSeed(new Uint8Array(32).fill(3));
const hash32 = new Uint8Array(32).map((_, i) => i);

describe("actions", () => {
  it("UseGlobalContract(CodeHash) borsh bytes follow nearcore: variant 10, identifier 0, 32-byte hash", () => {
    const bytes = encodeActionBytes(act.useGlobalContract(b58encode(hash32)));
    expect(Array.from(bytes)).toEqual([10, 0, ...hash32]);
  });
  it("CreateAccount = [0], Transfer = [3, u128 le]", () => {
    expect(Array.from(encodeActionBytes(act.createAccount()))).toEqual([0]);
    const t = encodeActionBytes(act.transfer(258n));
    expect(Array.from(t)).toEqual([3, 2, 1, ...new Array(14).fill(0)]);
  });
  it("DeleteKey = [6, keyType 0, 32 bytes]", () => {
    const b = encodeActionBytes(act.deleteKey(kp.publicKey));
    expect(b[0]).toBe(6);
    expect(b[1]).toBe(0);
    expect(b.length).toBe(34);
  });
  it("function-call access key with allowance", () => {
    const b = encodeActionBytes(act.addFunctionCallKey(kp.publicKey, "vault.ada.oiko.testnet", ["agent_execute"], 250_000_000_000_000_000_000_000n));
    expect(b[0]).toBe(5); // AddKey
    // nonce u64 (8 bytes) then permission variant 0 = FunctionCall, Option<u128> Some = 1
    expect(b[34 + 8]).toBe(0);
    expect(b[34 + 8 + 1]).toBe(1);
  });
});

describe("NEP-366 SignedDelegate", () => {
  it("decodes, verifies and rejects a tampered signature", () => {
    const delegateAction = buildDelegateAction({
      senderId: "ada.oiko.testnet", receiverId: "vault.ada.oiko.testnet",
      actions: [act.createAccount(), act.transfer(10n ** 24n), act.useGlobalContract(hash32), act.functionCall("new", { owner: "ada.oiko.testnet" }, 50n * 10n ** 12n, 0n)],
      nonce: 5n, maxBlockHeight: 1000n, publicKey: PublicKey.fromString(kp.publicKey),
    });
    const sig = signBytes(kp.secretKey, sha256(encodeDelegateAction(delegateAction)));
    const sd = { delegateAction, signature: new Signature({ keyType: KeyType.ED25519, data: sig }) } as SignedDelegate;
    const b64 = b64encode(encodeSignedDelegate(sd));
    const d = decodeSignedDelegate(b64);
    expect(d.senderId).toBe("ada.oiko.testnet");
    expect(d.receiverId).toBe("vault.ada.oiko.testnet");
    expect(d.publicKey).toBe(kp.publicKey);
    expect(d.actions.map((a) => a.kind)).toEqual(["createAccount", "transfer", "useGlobalContract", "functionCall"]);
    expect(d.actions[2]).toEqual({ kind: "useGlobalContract", codeHash: b58encode(hash32) });
    expect(verifySignedDelegate(d)).toBe(true);
    // re-encoding the decoded delegate is byte-identical
    expect(b64encode(encodeSignedDelegate(d.raw))).toBe(b64);
    const bad = { ...d, signature: new Uint8Array(64) };
    expect(verifySignedDelegate(bad)).toBe(false);
  });
});

describe("transactions", () => {
  it("signs prepared bytes locally and the signature verifies", () => {
    const tx = createTransaction("vault.ada.oiko.testnet", PublicKey.fromString(kp.publicKey), "vault.ada.oiko.testnet", 7n, [act.functionCall("agent_execute", { action: { type: "pay_bill", bill_id: 1 } })], hash32);
    const { signedTx } = signTransactionBytes(kp.secretKey, encodeTransaction(tx));
    const stx = decodeSignedTx(signedTx);
    expect(stx.transaction.signerId).toBe("vault.ada.oiko.testnet");
    expect(verifySignedTx(stx)).toBe(true);
    const other = keyPairFromSeed(new Uint8Array(32).fill(4));
    expect(() => signTransactionBytes(other.secretKey, encodeTransaction(tx))).toThrow();
  });
});
