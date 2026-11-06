import { describe, expect, it } from "vitest";
import { MOVE_PREFIX, decryptMoveCode, encryptMoveCode } from "../moveCode";
import type { Session } from "../session";

const s: Session = {
  name: "ada", displayName: "Ada", accountId: "ada.oiko.testnet", vaultId: "vault.ada.oiko.testnet",
  appKey: "ed25519:appsecret", ownerKey: "ed25519:ownersecret", method: "browser", createdAt: 1,
};

describe("move-to-another-device code", () => {
  it("round-trips with the right passphrase and hides the keys", async () => {
    const code = await encryptMoveCode(s, "correct horse");
    expect(code.startsWith(MOVE_PREFIX)).toBe(true);
    expect(code).not.toContain("appsecret");
    const p = await decryptMoveCode(` ${code}\n`, "correct horse");
    expect(p).toMatchObject({ accountId: s.accountId, vaultId: s.vaultId, appKey: s.appKey, ownerKey: s.ownerKey, method: "browser" });
  });
  it("refuses a wrong passphrase", async () => {
    const code = await encryptMoveCode(s, "correct horse");
    await expect(decryptMoveCode(code, "wrong horse!")).rejects.toThrow(/E_BAD_PASSPHRASE/);
  });
  it("refuses damaged or foreign codes", async () => {
    const code = await encryptMoveCode(s, "correct horse");
    await expect(decryptMoveCode(code.slice(0, -6) + "AAAAAA", "correct horse")).rejects.toThrow(/E_BAD_PASSPHRASE|E_BAD_CODE/);
    await expect(decryptMoveCode("hello", "correct horse")).rejects.toThrow(/E_BAD_CODE/);
  });
  it("refuses short passphrases", async () => {
    await expect(encryptMoveCode(s, "short")).rejects.toThrow(/E_BAD_PASSPHRASE/);
  });
});
