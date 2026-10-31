import { describe, expect, it } from "vitest";
import { KeyPairSigner } from "near-api-js";
import {
  b64decode, b64encode, hexEncode, gatewayAuthHeader, gatewayMessage, keyPairFromSeed, nep413Hash, parseGatewayAuthHeader, parseGatewayMessage,
  sha256Hex, signNep413, verifyNep413,
} from "../src";

const seed = new Uint8Array(32).map((_, i) => i + 1);
const kp = keyPairFromSeed(seed);
const nonce = new Uint8Array(32).fill(7);

describe("NEP-413", () => {
  it("round-trips sign/verify", () => {
    const s = signNep413(kp.secretKey, { message: "hello", recipient: "oiko-gateway", nonce });
    expect(s.publicKey).toBe(kp.publicKey);
    expect(verifyNep413({ ...s, message: "hello", recipient: "oiko-gateway" })).toBe(true);
  });

  it("rejects tampering (message, recipient, nonce, callbackUrl, key)", () => {
    const s = signNep413(kp.secretKey, { message: "hello", recipient: "oiko-gateway", nonce });
    expect(verifyNep413({ ...s, message: "hellO", recipient: "oiko-gateway" })).toBe(false);
    expect(verifyNep413({ ...s, message: "hello", recipient: "other" })).toBe(false);
    expect(verifyNep413({ ...s, nonce: b64encode(new Uint8Array(32)), message: "hello", recipient: "oiko-gateway" })).toBe(false);
    expect(verifyNep413({ ...s, message: "hello", recipient: "oiko-gateway", callbackUrl: "https://x" })).toBe(false);
    const other = keyPairFromSeed(new Uint8Array(32).fill(9));
    expect(verifyNep413({ ...s, publicKey: other.publicKey, message: "hello", recipient: "oiko-gateway" })).toBe(false);
    expect(verifyNep413({ ...s, signature: "AAAA", message: "hello", recipient: "oiko-gateway" })).toBe(false);
  });

  it("matches near-api-js 7 Signer.signNep413Message byte-for-byte (independent implementation)", async () => {
    const signer = KeyPairSigner.fromSecretKey(kp.secretKey as `ed25519:${string}`);
    for (const callbackUrl of [undefined, "https://oiko.app/cb"]) {
      const theirs = await signer.signNep413Message("ada.oiko.testnet", { message: "Login to Oiko", recipient: "oiko-gateway", nonce, callbackUrl });
      const ours = signNep413(kp.secretKey, { message: "Login to Oiko", recipient: "oiko-gateway", nonce, callbackUrl });
      expect(ours.signature).toBe(b64encode(theirs.signature));
      expect(theirs.publicKey.toString()).toBe(kp.publicKey);
    }
  });

  it("hash layout: u32le(2^31+413) prefix", () => {
    // Known vector computed from the NEP-413 layout: prefix bytes 9d 01 00 80.
    const h = nep413Hash({ message: "", recipient: "", nonce: new Uint8Array(32) });
    expect(h.length).toBe(32);
    const manual = new Uint8Array([0x9d, 0x01, 0x00, 0x80, 0, 0, 0, 0, ...new Uint8Array(32), 0, 0, 0, 0, 0]);
    expect(hexEncode(h)).toBe(sha256Hex(manual));
  });
});

describe("gateway auth header", () => {
  it("encodes method, path, body hash and timestamp", () => {
    const h = gatewayAuthHeader(kp.secretKey, "vault.ada.oiko.testnet", "post", "/api/agent/prepare", '{"a":1}', 1_700_000_000_000);
    const p = parseGatewayAuthHeader(h)!;
    expect(p.accountId).toBe("vault.ada.oiko.testnet");
    expect(p.message).toBe(gatewayMessage("POST", "/api/agent/prepare", '{"a":1}', 1_700_000_000_000));
    const m = parseGatewayMessage(p.message)!;
    expect(m).toEqual({ method: "POST", path: "/api/agent/prepare", bodyHash: sha256Hex('{"a":1}'), timestamp: 1_700_000_000_000 });
    expect(b64decode(p.nonce).length).toBe(32);
    expect(verifyNep413({ ...p, recipient: "oiko-gateway" })).toBe(true);
  });
  it("rejects malformed headers", () => {
    expect(parseGatewayAuthHeader("Bearer x")).toBeNull();
    expect(parseGatewayAuthHeader("NEP413 !!!")).toBeNull();
    expect(parseGatewayAuthHeader(`NEP413 ${b64encode(new TextEncoder().encode('{"accountId":1}'))}`)).toBeNull();
    expect(parseGatewayMessage("GET /x\nzz\n1")).toBeNull();
  });
});
