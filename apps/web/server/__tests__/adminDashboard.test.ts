import { describe, expect, it } from "vitest";
import { Veil, generateKeyPair, type Overview } from "@oiko/sdk";
import { serverConfig } from "../config";
import { MemoryStore } from "../store";
import { OLDER_VAULT_HASHES, adminDashboard, near, privacyOf, versionOf, type DashboardDeps } from "../adminDashboard";

const NOW = Date.parse("2026-11-25T12:00:00Z");
const DAY = 86_400_000;
const CURRENT = "72sdtZyfMEdLh2RSqSjBAPt73PpsHCr24irGCi9yahex";
const veil = Veil.fromOwnerKey(generateKeyPair().secretKey, "ada.oiko.testnet");
const pot = (id: number, name: string, kind = "goal") => ({ id, name, kind, icon: "", color: "", balances: { usdc: "0", usdt: "0" } });
const ov = (pots: ReturnType<typeof pot>[], usdt = "0", bills: Array<{ name: string }> = []) =>
  ({ pots: [pot(0, "Spend", "flex"), ...pots], bills, agents: [{ revoked: false }, { revoked: true }], totals: { usdc: "1000000", usdt } }) as unknown as Overview;

function deps(over: Partial<DashboardDeps> = {}): DashboardDeps {
  const cfg = { ...serverConfig(), network: "testnet" as const, vaultCodeHash: CURRENT, cronSecret: null, relayer: { accountId: "relayer.testnet", privateKey: "x" } };
  const names = [
    { name: "ada", vault: "vault.ada.oiko.testnet", hash: CURRENT, ov: ov([pot(1, veil.seal("Therapy"))], "2000000", [{ name: veil.seal("Rent") }]), at: NOW - DAY },
    { name: "bob", vault: "vault.bob.oiko.testnet", hash: OLDER_VAULT_HASHES[0]!, ov: ov([pot(1, "Holiday")]), at: NOW - 2 * DAY },
    { name: "cy", vault: "vault.cy.oiko.testnet", hash: CURRENT, ov: ov([]), at: NOW },
  ];
  const rpc = {
    block: async () => ({ hash: "h", height: 123 }),
    viewAccount: async (id: string) => {
      if (id === "relayer.testnet") return { amount: (3n * 10n ** 24n).toString(), locked: "0", code_hash: "", storage_usage: 0 };
      const n = names.find((x) => x.vault === id);
      return n ? { amount: "0", locked: "0", code_hash: "", storage_usage: 0, global_contract_hash: n.hash } : null;
    },
    viewAccessKeyList: async (id: string) => (id === cfg.oiko.contracts.registry ? [] : [{ public_key: "k", access_key: { nonce: 1, permission: "FullAccess" } }]),
    view: async (contract: string, method: string) => {
      if (method === "stats") return { names: names.length };
      if (method === "trusted_code_hashes") return [CURRENT, OLDER_VAULT_HASHES[0]];
      if (method === "list_names") return names.map((n) => ({ name: n.name, account_id: n.name, vault_id: n.vault, created_at: (BigInt(n.at) * 1_000_000n).toString() }));
      if (method === "get_overview") return names.find((n) => n.vault === contract)!.ov;
      throw new Error(`unexpected ${method}`);
    },
  } as unknown as DashboardDeps["rpc"];
  return { now: () => NOW, cfg, rpc, store: new MemoryStore(), budgetRemaining: () => 10n ** 24n, ...over };
}

describe("admin dashboard", () => {
  it("classifies account code and private-label adoption", () => {
    expect(versionOf(CURRENT, CURRENT)).toBe("current");
    expect(versionOf(OLDER_VAULT_HASHES[0], CURRENT)).toBe("older");
    expect(versionOf("other", CURRENT)).toBe("other");
    expect(versionOf(null, CURRENT)).toBe("missing");
    expect(privacyOf(ov([pot(1, veil.seal("A"))], "0", [{ name: veil.seal("B") }]))).toBe("on");
    expect(privacyOf(ov([pot(1, veil.seal("A"))], "0", [{ name: "Rent" }]))).toBe("partial");
    expect(privacyOf(ov([pot(1, "A")]))).toBe("off");
    expect(privacyOf(ov([]))).toBe("none");
    expect(near(1_550_000_000_000_000_000_000_000n)).toBe("1.55");
  });

  it("summarises health, accounts and counts, newest first, without any private label", async () => {
    const d = await adminDashboard({ fresh: true }, deps());
    expect(d.accounts.total).toBe(3);
    expect(d.accounts.recent.map((r) => r.name)).toEqual(["cy", "bob", "ada"]);
    expect(d.accounts.versions).toMatchObject({ current: 2, older: 1 });
    expect(d.accounts.privacy).toMatchObject({ on: 1, off: 1, none: 1 });
    expect(d.accounts.recent.find((r) => r.name === "ada")).toMatchObject({ total: "3.00", agents: 1, bills: 1 });
    expect(d.accounts.signupsByDay).toHaveLength(14);
    expect(d.accounts.signupsByDay.at(-1)).toEqual({ day: "2026-11-25", count: 1 });
    expect(JSON.stringify(d)).not.toContain("\u{1F512}"); // labels are summarised, never passed through
    const ids = Object.fromEntries(d.checks.map((c) => [c.id, c.status]));
    expect(ids).toMatchObject({ rpc: "ok", relayer: "bad", cron: "warn", older: "warn" }); // 3 NEAR < 10 NEAR floor
    expect(d.contracts.find((c) => c.role === "Registry")).toMatchObject({ keyless: true });
    expect(d.checks.some((c) => c.id.startsWith("keys:") && c.detail.includes("ajo"))).toBe(true);
    expect(d.counts).toMatchObject({ invoices: 0, changesPending: 0, sinceHours: 24 });
  });

  it("reports an unreachable RPC instead of failing", async () => {
    const base = deps();
    const rpc = { ...base.rpc, block: async () => { throw new Error("connect ECONNREFUSED"); } } as DashboardDeps["rpc"];
    const d = await adminDashboard({ fresh: true }, { ...base, rpc });
    expect(d.checks.find((c) => c.id === "rpc")).toMatchObject({ status: "bad" });
    expect(d.accounts.total).toBeNull();
  });

  it("counts private invoices and pending agent suggestions from the store", async () => {
    const s = new MemoryStore();
    await s.putInvoice({ id: "a", number: "INV-1", owner: "ada.oiko.testnet", createdAt: new Date(NOW).toISOString(), sealed: { box: "oikobox1:x", keyBox: "🔒x" } } as never);
    await s.putInvoice({ id: "b", number: "INV-2", owner: "ada.oiko.testnet", createdAt: new Date(NOW - 3 * DAY).toISOString(), sealed: null } as never);
    await s.putChange({ id: "c", vaultId: "v", publicKey: "k", status: "pending" } as never);
    const d = await adminDashboard({ fresh: true }, deps({ store: s }));
    expect(d.counts).toMatchObject({ invoices: 2, invoicesPrivate: 1, invoicesRecent: 1, changesPending: 1 });
  });
});
