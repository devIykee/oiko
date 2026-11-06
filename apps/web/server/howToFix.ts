// how_to_fix: every refusal tells the agent the concrete next step, using its own policy where it helps
// ("ask the owner to raise the weekly cap to at least 60.00"). Deterministic; no AI.
import { formatAmount, friendlyError, type AgentView } from "@oiko/sdk";
import { ApiError } from "./errors";

/** An agent action, or the facts the access log decoded from one. */
export type ActionLike = { type?: string | null; to?: string | null; receiver?: string | null; amount?: string | null } | null | undefined;

const DAY_NS = 86_400_000_000_000n;
const WEEK_NS = 7n * DAY_NS;

function amountOf(a: ActionLike): bigint | null {
  return a?.amount && /^\d{1,39}$/.test(a.amount) ? BigInt(a.amount) : null;
}
const f = (u: bigint | string) => formatAmount(u.toString());

export function howToFix(code: string, policy?: AgentView | null, action?: ActionLike, nowMs = Date.now()): string {
  const amt = amountOf(action);
  const ns = BigInt(nowMs) * 1_000_000n;
  const day = Number(ns / DAY_NS), week = Number(ns / WEEK_NS);
  const usedDay = policy && policy.spent_day[0] === day ? BigInt(policy.spent_day[1]) : 0n;
  const usedWeek = policy && policy.spent_week[0] === week ? BigInt(policy.spent_week[1]) : 0n;
  const hoursTo = (endNs: bigint) => Math.max(1, Math.ceil(Number((endNs - ns) / 3_600_000_000_000n)));
  switch (code) {
    case "E_CAP_PER_TX":
    case "E_AGENT_PER_TX":
      return policy
        ? `Your per-payment cap is ${f(policy.per_tx)}. Use ${f(policy.per_tx)} or less, or use propose so the owner approves this one${amt ? `, or ask the owner to raise the per-payment cap to at least ${f(amt)}` : ""}.`
        : "Use a smaller amount, or use propose so the owner approves it.";
    case "E_CAP_DAY":
    case "E_AGENT_DAILY":
      return policy
        ? `You've used ${f(usedDay)} of your ${f(policy.daily)} daily cap. It resets in about ${hoursTo((BigInt(day) + 1n) * DAY_NS)} h (00:00 UTC). Use propose now${amt ? `, or ask the owner to raise the daily cap to at least ${f(usedDay + amt)}` : ""}.`
        : "Wait for the daily cap to reset at 00:00 UTC, or use propose.";
    case "E_CAP_WEEK":
    case "E_AGENT_WEEKLY":
      return policy
        ? `You've used ${f(usedWeek)} of your ${f(policy.weekly)} weekly cap. It resets in about ${hoursTo((BigInt(week) + 1n) * WEEK_NS)} h. Use propose now${amt ? `, or ask the owner to raise the weekly cap to at least ${f(usedWeek + amt)}` : ""}.`
        : "Wait for the weekly cap to reset, or use propose.";
    case "E_NOT_ALLOWLISTED":
    case "E_AGENT_ALLOWLIST":
    case "E_AGENT_RECIPIENT": {
      const to = action?.to ?? action?.receiver ?? "this recipient";
      return `${to} isn't on your allowlist. Use propose so the owner approves this payment, or ask the owner to add ${to} to your allowlist in Agents.`;
    }
    case "E_ACTION_NOT_ALLOWED":
    case "E_AGENT_KIND":
      return `You may only act on: ${policy?.allowed_actions.join(", ") || "nothing"}. Use propose instead, or ask the owner to allow ${action ? (action.type === "move" ? "move_between_pots" : action.type === "save" ? "save" : "pay") : "this action"} in Agents.`;
    case "E_SCOPE":
    case "E_AGENT_SCOPE":
      return `Your permissions are: ${policy?.scopes.join(", ") || "unknown"}. Ask the owner to change them in Agents, or use a tool your permissions allow (propose instead of act).`;
    case "E_AGENT_EXPIRED":
      return "Your access has expired. Stop and ask the owner to connect you again from Agents.";
    case "E_AGENT_REVOKED":
    case "E_KEY_GONE":
    case "E_AGENT_UNKNOWN":
    case "E_NO_AGENT":
      return "You are no longer connected to this account. Stop; only the owner can connect you again.";
    case "E_COUNTERPARTY_WARN":
      return "Don't act. Use propose with the same action so the owner sees the warning and decides.";
    case "E_COUNTERPARTY_BLOCKED":
      return "Don't pay this recipient and don't retry. Tell the owner what you were asked to do and why it was blocked.";
    case "E_LOCKED":
      return "That pot is locked until its unlock date (see get_pots locked_until). Pick another pot; a lock can't be shortened.";
    case "E_INSUFFICIENT":
      return "Read get_pots for current balances, then use a smaller amount or propose moving money in first.";
    case "E_TOO_MANY_PROPOSALS":
      return "You have 20 proposals waiting. Wait for the owner to approve or reject some before proposing more.";
    case "E_RATE_LIMIT":
      return "Slow down: wait a minute, then try again.";
    case "E_STALE":
      return "Your request's timestamp is too old or too far ahead. Sync your clock and sign a fresh request.";
    case "E_REPLAY":
      return "Use a new random nonce for every request.";
    case "E_CHANGE_INVALID":
      return "Read get_overview, fix the change so it fits the account as it is now, then propose it again.";
    default:
      return friendlyError(code).next;
  }
}

/** Adds how_to_fix to an ApiError's details (agent-facing responses). Other errors pass through unchanged. */
export function withHowToFix<E>(e: E, policy?: AgentView | null, action?: ActionLike): E | ApiError {
  if (!(e instanceof ApiError) || e.details?.how_to_fix) return e;
  return new ApiError(e.code, e.status, e.message, { ...(e.details ?? {}), how_to_fix: howToFix(e.code, policy, action) });
}
