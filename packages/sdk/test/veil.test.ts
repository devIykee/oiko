import { describe, expect, it } from "vitest";
import { generateKeyPair } from "../src/keys";
import { VaultClient } from "../src/vault";
import type { NearRpc } from "../src/rpc";
import type { Signer } from "../src/tx";
import {
  PRIVATE_LABEL, VEIL_MARK, VEIL_TOKEN_CHARS, Veil, decode32k, decodeViewKey, deriveViewKey, encode32k, isSealed, maskDeep,
  openBox, scalarLength, sealBox, newBoxKey, unwrapBoxKey, wrapBoxKey, encodeBoxKey, decodeBoxKey,
} from "../src/veil";

const owner = generateKeyPair();
const veil = Veil.fromOwnerKey(owner.secretKey, "ada.oiko.testnet");

describe("base32768", () => {
  it("round-trips every length and stays in the alphabet", () => {
    for (let n = 0; n < 80; n++) {
      const b = crypto.getRandomValues(new Uint8Array(n));
      const s = encode32k(b);
      expect(scalarLength(s)).toBe(Math.ceil((n * 8) / 15));
      expect(decode32k(s, n)).toEqual(b);
      for (const ch of s) expect(ch.normalize("NFC")).toBe(ch); // survives Unicode normalisation
    }
  });
  it("covers all 32768 values", () => {
    const seen = new Set<string>();
    for (let v = 0; v < 32768; v++) {
      const b = new Uint8Array([(v >> 7) & 0xff, (v << 1) & 0xff]); // 15 bits, then 1 padding bit
      const ch = encode32k(b)[0]!;
      seen.add(ch);
    }
    expect(seen.size).toBe(32768);
  });
});

describe("Veil", () => {
  it("a sealed pot name fits the deployed contract's 40-character limit, whatever the name", () => {
    expect(VEIL_TOKEN_CHARS[0]).toBe(38);
    for (const name of ["a", "Rent", "Divorce lawyer", "École privée 👶", "x".repeat(38)]) {
      const t = veil.seal(name, 40);
      expect(scalarLength(t)).toBe(38); // same length for every name: length hides nothing
      expect(t.startsWith(VEIL_MARK)).toBe(true);
      expect(isSealed(t)).toBe(true);
      expect(t).not.toContain(name);
      expect(veil.open(t)).toBe(name);
    }
  });
  it("is randomised: the same name seals to different tokens", () => {
    expect(veil.seal("Rent")).not.toBe(veil.seal("Rent"));
  });
  it("refuses text that cannot fit, instead of truncating it", () => {
    expect(() => veil.seal("x".repeat(39), 40)).toThrow(/E_VEIL_TOO_LONG/);
    expect(Veil.capacity(40)).toBe(38);
  });
  it("long fields use a bigger bucket and still fit the contract limit", () => {
    const reason = "Your electricity bill is due in two days and Spend is short; move 40 from Savings.".repeat(3);
    const t = veil.seal(reason, 280);
    expect(scalarLength(t)).toBeLessThanOrEqual(280);
    expect(veil.open(t)).toBe(reason);
  });
  it("is deterministic per owner key and account, and different across accounts", () => {
    const again = Veil.fromOwnerKey(owner.secretKey, "ada.oiko.testnet");
    expect(again.exportViewKey()).toBe(veil.exportViewKey());
    expect(deriveViewKey(owner.secretKey, "bob.oiko.testnet")).not.toEqual(decodeViewKey(veil.exportViewKey()));
  });
  it("a view key exported to an agent opens the same tokens", () => {
    const agent = Veil.fromViewKey(veil.exportViewKey(), "vault.ada.oiko.testnet");
    expect(agent.open(veil.seal("Therapy"))).toBe("Therapy");
    expect(agent.fingerprint()).toBe(veil.fingerprint());
  });
  it("tokens do not open with another key, in another vault, or after tampering", () => {
    const t = veil.seal("Therapy");
    const other = Veil.fromOwnerKey(generateKeyPair().secretKey, "ada.oiko.testnet");
    expect(other.tryOpen(t)).toBeNull();
    expect(other.open(t)).toBe(PRIVATE_LABEL);
    const elsewhere = new Veil(decodeViewKey(veil.exportViewKey()), "vault.eve.oiko.testnet");
    expect(elsewhere.tryOpen(t)).toBeNull(); // bound to the vault id
    const chars = [...t];
    chars[10] = chars[10] === "一" ? "丁" : "一";
    expect(veil.tryOpen(chars.join(""))).toBeNull();
  });
  it("plain text passes through unchanged (older pots keep working)", () => {
    expect(veil.open("Spend")).toBe("Spend");
    expect(isSealed("Spend")).toBe(false);
    expect(veil.seal(veil.seal("Rent"))).toMatch(new RegExp(`^${VEIL_MARK}`)); // never double-sealed
    const once = veil.seal("Rent");
    expect(veil.seal(once)).toBe(once);
  });
  it("opens tokens inside server sentences and deep JSON", () => {
    const a = veil.seal("Rent"), b = veil.seal("Holiday");
    expect(veil.openText(`${a} is due tomorrow; move 20 from ${b}.`)).toBe("Rent is due tomorrow; move 20 from Holiday.");
    const deep = veil.openDeep({ pots: [{ id: 1, name: a, n: 3 }], note: `paid ${b}`, nil: null });
    expect(deep).toEqual({ pots: [{ id: 1, name: "Rent", n: 3 }], note: "paid Holiday", nil: null });
  });
  it("masks tokens for readers without the key", () => {
    expect(maskDeep({ name: veil.seal("Rent"), s: "Spend" })).toEqual({ name: PRIVATE_LABEL, s: "Spend" });
  });
});

describe("sealed boxes", () => {
  it("round-trip with the content key, bound to their context", () => {
    const k = newBoxKey();
    const box = sealBox(k, { client: "Acme", items: ["Design"] }, "inv1");
    expect(openBox(k, box, "inv1")).toEqual({ client: "Acme", items: ["Design"] });
    expect(openBox(k, box, "inv2")).toBeNull();
    expect(openBox(newBoxKey(), box, "inv1")).toBeNull();
    expect(decodeBoxKey(encodeBoxKey(k))).toEqual(k);
  });
  it("the owner recovers the content key with the view key", () => {
    const k = newBoxKey();
    const w = wrapBoxKey(veil, k);
    expect(isSealed(w)).toBe(true);
    expect(unwrapBoxKey(veil, w)).toEqual(k);
    expect(unwrapBoxKey(Veil.fromOwnerKey(generateKeyPair().secretKey, "ada.oiko.testnet"), w)).toBeNull();
  });
});

describe("VaultClient with a Veil", () => {
  function fake() {
    const calls: Array<{ method: string; args: Record<string, unknown> }> = [];
    const stored: Record<string, unknown> = {};
    const signer = {
      call: async (_r: string, method: string, args: Record<string, unknown>) => {
        calls.push({ method, args });
        if (method === "create_pot") stored.pot = { id: 1, name: args.name, icon: args.icon };
        return { ok: true, txHash: "x" };
      },
    } as unknown as Signer;
    const rpc = { view: async () => ({ pots: [stored.pot], bills: [] }) } as unknown as NearRpc;
    return { calls, signer, rpc };
  }
  it("seals labels on write and opens them on read", async () => {
    const f = fake();
    const c = new VaultClient(f.rpc, "vault.ada.oiko.testnet", f.signer, veil);
    await c.createPot({ name: "Divorce lawyer", icon: "scale", color: "#000", kind: "goal" });
    const sent = f.calls[0]!.args;
    expect(isSealed(sent.name)).toBe(true);
    expect(isSealed(sent.icon)).toBe(true);
    expect(JSON.stringify(sent)).not.toContain("Divorce");
    const ov = await c.overview();
    expect(ov.pots[0]!.name).toBe("Divorce lawyer");
    const masked = await new VaultClient(f.rpc, "vault.ada.oiko.testnet", undefined, "mask").overview();
    expect(masked.pots[0]!.name).toBe(PRIVATE_LABEL);
  });
  it("seals bill names and agent proposal reasons", async () => {
    const f = fake();
    const c = new VaultClient(f.rpc, "vault.ada.oiko.testnet", f.signer, veil);
    await c.addBill({ name: "Therapy", amount: "1", token: "usdc", due_day: 3, payee: "dr.near", pot_id: 2 });
    await c.agentPropose({ type: "pay_bill", bill_id: 0 }, "Therapy is due on the 3rd");
    expect(isSealed(f.calls[0]!.args.name)).toBe(true);
    expect(f.calls[0]!.args.payee).toBe("dr.near"); // payees stay public: the contract pays them
    expect(isSealed(f.calls[1]!.args.reason)).toBe(true);
  });
});
