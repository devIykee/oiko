import { describe, expect, it } from "vitest";
import { describeRow, factsOfAction, outcomeOf, reasonOf } from "../accessLog";
import { MemoryStore } from "../store";
import { logAccess } from "../gateway";

describe("agent access log rows", () => {
  it("reads action facts (amount + ticker + payee) from the action", () => {
    expect(factsOfAction({ type: "pay", to: "metro-power-co.testnet", amount: "25000000", token: "usdt" }, "agent_execute"))
      .toEqual({ method: "agent_execute", type: "pay", receiver: "metro-power-co.testnet", amount: "25000000", token: "usdt" });
    expect(factsOfAction({ type: "move", from_pot: 0, to_pot: 2, amount: "5000000", token: "usdc" }).receiver).toBeNull();
    expect(factsOfAction(null).type).toBeNull();
  });

  it("maps outcomes: Read / Approved / Proposed / Blocked / Refused", () => {
    expect(outcomeOf({ tool: "bills", status: 200 })).toBe("Read");
    expect(outcomeOf({ tool: "submit", status: 200, method: "agent_execute" })).toBe("Approved");
    expect(outcomeOf({ tool: "submit", status: 200, method: "agent_propose" })).toBe("Proposed");
    expect(outcomeOf({ tool: "prepare", status: 403, code: "E_NOT_ALLOWLISTED" })).toBe("Blocked");
    expect(outcomeOf({ tool: "submit", status: 422, code: "E_CAP_WEEK" })).toBe("Blocked");
    expect(outcomeOf({ tool: "prepare", status: 422, code: "E_COUNTERPARTY_BLOCKED" })).toBe("Blocked");
    expect(outcomeOf({ tool: "submit", status: 502, code: "E_RPC" })).toBe("Refused");
  });

  it("gives the reason in plain words and a one-line summary", () => {
    expect(reasonOf("Blocked", "E_NOT_ALLOWLISTED")).toBe("Blocked: That recipient isn't on the agent's list.");
    expect(reasonOf("Read", null)).toBeNull();
    expect(describeRow({ tool: "submit", type: "pay", amount: "25000000", token: "usdt", receiver: "metro-power-co.testnet" })).toBe("Payment · 25.00 USDT to metro-power-co.testnet");
    expect(describeRow({ tool: "bills" })).toBe("Read bills");
  });

  it("logAccess stores amount, token, action and outcome", async () => {
    const s = new MemoryStore();
    await logAccess({ vaultId: "vault.a.oiko.testnet", publicKey: "ed25519:k", method: "POST", path: "/api/agent/prepare", status: 403, code: "E_NOT_ALLOWLISTED", tool: "prepare",
      facts: factsOfAction({ type: "pay", to: "x.testnet", amount: "1000000", token: "usdc" }, "agent_execute") }, s);
    const [row] = await s.listAccess("vault.a.oiko.testnet", null, 10);
    expect(row).toMatchObject({ amount: "1000000", token: "usdc", actionType: "pay", outcome: "Blocked", code: "E_NOT_ALLOWLISTED" });
  });
});
