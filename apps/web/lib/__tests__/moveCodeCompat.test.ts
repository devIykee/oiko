// Sign-in codes made before private labels (no viewKey) still work, and codes made now still open in older versions
// (the payload keeps v: 1 and only adds a field that older versions ignore).
import { describe, expect, it } from "vitest";
import { generateKeyPair } from "@oiko/sdk";
import { decryptMoveCode, encryptMoveCode } from "../moveCode";
import { viewKeyFor } from "../viewKey";
import type { Session } from "../session";

const owner = generateKeyPair(), app = generateKeyPair();
const base: Session = { name: "ada", displayName: "Ada", accountId: "ada.oiko.testnet", vaultId: "vault.ada.oiko.testnet", appKey: app.secretKey, method: "browser", ownerKey: owner.secretKey, createdAt: 0 };

describe("move-to-device codes and the view key", () => {
  it("an older code without a view key still decrypts (the app derives the key from the owner key)", async () => {
    const p = await decryptMoveCode(await encryptMoveCode(base, "passphrase-1"), "passphrase-1");
    expect(p.viewKey).toBeUndefined();
    expect(viewKeyFor(p.ownerKey!, p.accountId)).toMatch(/^oikoview1:/);
  });
  it("a new code carries the view key and stays version 1", async () => {
    const vk = viewKeyFor(owner.secretKey, base.accountId);
    const p = await decryptMoveCode(await encryptMoveCode({ ...base, viewKey: vk }, "passphrase-1"), "passphrase-1");
    expect(p.viewKey).toBe(vk);
    expect(p.appKey).toBe(app.secretKey);
  });
});
