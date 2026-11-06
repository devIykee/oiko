import { beforeEach, afterAll, describe, expect, it } from "vitest";
import { generateKeyPair, signNep413, verifyNep413 } from "@oiko/sdk";
import {
  AGENT_SIGNUP_RECIPIENT,
  agentSignupChallenge,
  agentCreateAccount,
  type AgentSignupInput,
} from "../agentSignup";
import { resetLimitsForTests } from "../ratelimit";

// A fake clock so the 5-minute proof window is deterministic.
const NOW = 1_800_000_000_000;
const realNow = Date.now;
beforeEach(() => { Date.now = () => NOW; resetLimitsForTests(); });
afterAll(() => { Date.now = realNow; });

function validProof(secretKey: string, name: string, timestamp = NOW) {
  const proof = signNep413(secretKey, {
    message: agentSignupChallenge(name, timestamp),
    recipient: AGENT_SIGNUP_RECIPIENT,
  });
  return { signature: proof.signature, nonce: proof.nonce, timestamp };
}

function input(over: Partial<AgentSignupInput> = {}): AgentSignupInput {
  return { name: "ada", publicKey: generateKeyPair().publicKey, proof: { signature: "", nonce: "", timestamp: NOW }, ...over } as AgentSignupInput;
}

describe("agentSignup challenge + proof", () => {
  it("builds a deterministic challenge including name and timestamp", () => {
    expect(agentSignupChallenge("ada", 123)).toBe("oiko-agent-signup:ada:123");
    expect(agentSignupChallenge("bob", 456)).not.toBe(agentSignupChallenge("ada", 456));
  });

  it("signNep413 verifies against the expected recipient", () => {
    const kp = generateKeyPair();
    const proof = signNep413(kp.secretKey, { message: agentSignupChallenge("ada", NOW), recipient: AGENT_SIGNUP_RECIPIENT });
    expect(verifyNep413({ publicKey: kp.publicKey, signature: proof.signature, nonce: proof.nonce, message: agentSignupChallenge("ada", NOW), recipient: AGENT_SIGNUP_RECIPIENT })).toBe(true);
  });
});

describe("agentSignup validation (pre-chain)", () => {
  it("rejects an invalid name", async () => {
    const r = agentCreateAccount(input({ name: "Bad Name!" }), "1.2.3.4");
    await expect(r).rejects.toMatchObject({ code: "E_NAME_INVALID" });
  });

  it("rejects a malformed public key", async () => {
    await expect(agentCreateAccount(input({ publicKey: "not-a-key" }), "1.2.3.4")).rejects.toMatchObject({ code: "E_BAD_REQUEST" });
  });

  it("rejects a missing/invalid proof timestamp", async () => {
    const kp = generateKeyPair();
    const bad = input({ publicKey: kp.publicKey, proof: { signature: "x", nonce: "y", timestamp: -1 } });
    await expect(agentCreateAccount(bad, "1.2.3.4")).rejects.toMatchObject({ code: "E_BAD_REQUEST" });
  });

  it("rejects a stale proof (outside the 5-minute window)", async () => {
    const kp = generateKeyPair();
    const old = validProof(kp.secretKey, "ada", NOW - 300_001); // 5 min + 1 ms
    await expect(agentCreateAccount(input({ publicKey: kp.publicKey, proof: old }), "1.2.3.4")).rejects.toMatchObject({ code: "E_PROOF_STALE" });
  });

  it("rejects a future proof (outside the 5-minute window)", async () => {
    const kp = generateKeyPair();
    const future = validProof(kp.secretKey, "ada", NOW + 300_001);
    await expect(agentCreateAccount(input({ publicKey: kp.publicKey, proof: future }), "1.2.3.4")).rejects.toMatchObject({ code: "E_PROOF_STALE" });
  });

  it("rejects a proof signed with the wrong key (key != claimed publicKey)", async () => {
    const agent = generateKeyPair();
    const impostor = generateKeyPair();
    const proof = validProof(impostor.secretKey, "ada"); // signed by impostor
    await expect(agentCreateAccount(input({ publicKey: agent.publicKey, proof }), "1.2.3.4")).rejects.toMatchObject({ code: "E_PROOF_INVALID" });
  });

  it("rejects a proof with a tampered message (different name)", async () => {
    const kp = generateKeyPair();
    const proof = validProof(kp.secretKey, "ada");
    await expect(agentCreateAccount(input({ name: "bob", publicKey: kp.publicKey, proof }), "1.2.3.4")).rejects.toMatchObject({ code: "E_PROOF_INVALID" });
  });

  it("rejects a proof with the wrong recipient (oiko-gateway instead of oiko-agent-signup)", async () => {
    const kp = generateKeyPair();
    const wrong = signNep413(kp.secretKey, { message: agentSignupChallenge("ada", NOW), recipient: "oiko-gateway" });
    await expect(agentCreateAccount(input({ publicKey: kp.publicKey, proof: { ...wrong, timestamp: NOW } }), "1.2.3.4")).rejects.toMatchObject({ code: "E_PROOF_INVALID" });
  });

  it("accepts a valid proof and reaches the rate limit / chain layer (then fails on chain, not proof)", async () => {
    const kp = generateKeyPair();
    const proof = validProof(kp.secretKey, "ada");
    // A valid proof passes verification; the next failure is the chain (registry) — expect any error except the proof ones.
    const err = await agentCreateAccount(input({ publicKey: kp.publicKey, proof }), "1.2.3.4").catch((e) => e);
    expect(["E_PROOF_INVALID", "E_PROOF_STALE", "E_BAD_REQUEST", "E_NAME_INVALID"]).not.toContain(err.code);
  });
});
