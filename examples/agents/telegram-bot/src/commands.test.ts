import { describe, expect, it } from "vitest";
import { commandToTool } from "./index";

describe("telegram commands → MCP tools", () => {
  it("maps reads and actions", () => {
    expect(commandToTool("/overview")).toEqual({ name: "get_overview", arguments: {} });
    expect(commandToTool("/activity 5")).toEqual({ name: "get_activity", arguments: { limit: 5 } });
    expect(commandToTool("/pay 12.5 usdt landlord.near")).toEqual({ name: "act", arguments: { action: { type: "pay", amount: "12500000", token: "usdt", to: "landlord.near", memo: "Sent from Telegram" } } });
    expect(commandToTool("/propose 3 usdc shop.near Groceries this week")).toMatchObject({ name: "propose", arguments: { reason: "Groceries this week" } });
  });
  it("rejects bad input with plain text", () => {
    expect(commandToTool("/pay 1 eur x.near")).toEqual({ error: "Token must be usdc or usdt." });
    expect("error" in commandToTool("/hello")).toBe(true);
  });
});
