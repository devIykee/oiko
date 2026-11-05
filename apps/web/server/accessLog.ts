// Agent access log, made readable: what the agent tried (tool/action, amount + ticker, payee), the outcome
// (Read / Approved / Proposed / Blocked / Refused) and the reason in plain words.
import { b64decode, decodeSignedTx, formatAmount, friendlyError, type Token } from "@oiko/sdk";

export type Outcome = "Read" | "Approved" | "Proposed" | "Blocked" | "Refused";

export interface ActionFacts { method: "agent_execute" | "agent_propose" | null; type: string | null; receiver: string | null; amount: string | null; token: Token | null }

const NONE: ActionFacts = { method: null, type: null, receiver: null, amount: null, token: null };

/** Facts from an action object (prepare / MCP input). */
export function factsOfAction(a: unknown, method: ActionFacts["method"] = null): ActionFacts {
  if (!a || typeof a !== "object") return { ...NONE, method };
  const x = a as { type?: unknown; to?: unknown; amount?: unknown; token?: unknown };
  const token = x.token === "usdc" || x.token === "usdt" ? x.token : null;
  return {
    method, type: typeof x.type === "string" ? x.type : null,
    receiver: x.type === "pay" && typeof x.to === "string" ? x.to : null,
    amount: typeof x.amount === "string" && /^\d+$/.test(x.amount) ? x.amount : null, token,
  };
}

/** Facts from a signed agent_execute / agent_propose transaction (submit). */
export function factsOfSignedTx(signedTx: string): ActionFacts {
  try {
    const t = decodeSignedTx(b64decode(signedTx)).transaction;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fc = (t.actions[0] as any)?.functionCall as { methodName: string; args: Uint8Array | number[] } | undefined;
    if (!fc || (fc.methodName !== "agent_execute" && fc.methodName !== "agent_propose")) return NONE;
    const args = JSON.parse(new TextDecoder().decode(Uint8Array.from(fc.args))) as { action?: unknown };
    return factsOfAction(args.action, fc.methodName);
  } catch {
    return NONE;
  }
}

// Policy refusals (the agent's limits or Oiko's payee check) read as "Blocked"; everything else that failed is "Refused".
const BLOCK = /^(E_COUNTERPARTY_|E_NOT_ALLOWLISTED|E_ACTION_NOT_ALLOWED|E_CAP_|E_SCOPE|E_AGENT_)/;
const READ_TOOLS = new Set(["overview", "me", "pots", "plan", "bills", "activity", "insights", "rosca", "counterparty", "invoices"]);

export function outcomeOf(row: { tool?: string | null; status: number; code?: string | null; method?: string | null; path?: string | null }): Outcome {
  if (row.status >= 400 || row.code) return row.code && BLOCK.test(row.code) ? "Blocked" : "Refused";
  if (row.tool === "prepare") return "Approved"; // passed the checks; nothing on chain yet
  if (row.method === "agent_propose" || row.tool === "propose") return "Proposed";
  if (row.method === "agent_execute" || row.tool === "act" || row.tool === "submit") return "Approved";
  if (row.tool && READ_TOOLS.has(row.tool)) return "Read";
  return row.method === "GET" || row.path?.includes("#") ? "Read" : "Approved";
}

/** "Blocked: That recipient isn't on the agent's list." */
export function reasonOf(outcome: Outcome, code?: string | null): string | null {
  if (!code) return null;
  return `${outcome}: ${friendlyError(code).title}`;
}

const TOOL_LABEL: Record<string, string> = {
  prepare: "Prepared", submit: "Sent", act: "Act", propose: "Suggest", report: "Reported a payee", mcp: "MCP request",
};
const TYPE_LABEL: Record<string, string> = { pay: "Payment", pay_bill: "Bill payment", move: "Move between pots", save: "Save" };

/** One plain line for the owner: "Payment · 25.00 USDT to metro-power-co.testnet". */
export function describeRow(r: { tool?: string | null; type?: string | null; amount?: string | null; token?: string | null; receiver?: string | null }): string {
  const what = (r.type && TYPE_LABEL[r.type]) || (r.tool && (TOOL_LABEL[r.tool] ?? `Read ${r.tool}`)) || "Request";
  const amt = r.amount ? ` · ${formatAmount(r.amount)} ${(r.token ?? "").toUpperCase()}`.trimEnd() : "";
  const to = r.receiver ? ` to ${r.receiver}` : "";
  return `${what}${amt}${to}`;
}
