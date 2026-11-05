// Client side of the agent gateway: connection strings and a signed HTTP client (used by @oiko/mcp and examples).
import { b64decode, b64encode, b64urlEncode, fromUtf8, utf8 } from "./encoding";
import { friendlyError } from "./errors";
import { publicKeyFromSecretKey } from "./keys";
import { gatewayAuthHeader } from "./nep413";
import { signTransactionBytes } from "./tx";
import type { AgentAction } from "./types";

export interface AgentConnection { api: string; vault: string; sk: string }

/** `oiko1:<base64url(json {api, vault, sk})>` — shown once, as text and QR, when the owner connects an agent. */
export function encodeConnectionString(c: AgentConnection): string {
  return `oiko1:${b64urlEncode(utf8(JSON.stringify({ api: c.api, vault: c.vault, sk: c.sk })))}`;
}
export function decodeConnectionString(s: string): AgentConnection {
  const t = s.trim();
  if (!t.startsWith("oiko1:")) throw new Error("A connection string starts with oiko1:");
  const j = JSON.parse(fromUtf8(b64decode(t.slice(6)))) as Partial<AgentConnection>;
  if (typeof j.api !== "string" || typeof j.vault !== "string" || typeof j.sk !== "string") throw new Error("Connection string is incomplete.");
  publicKeyFromSecretKey(j.sk); // validates
  return { api: j.api.replace(/\/+$/, ""), vault: j.vault, sk: j.sk };
}

export class GatewayError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number, public readonly detail?: string) {
    super(message);
    this.name = "GatewayError";
  }
}

export type CounterpartyVerdict = "allow" | "warn" | "block";
export interface CounterpartyCheck {
  receiver: string; verdict: CounterpartyVerdict; score: number; checkedAt: string; sources: string[];
  reasons: Array<{ code: string; severity: "info" | "warn" | "block"; message: string; evidence?: string }>;
  on_allowlist?: boolean;
  decision?: { act: "allowed" | "refused"; propose: "allowed" | "refused"; message: string };
}
export interface RunResult {
  txHash: string; ok: boolean; error?: { code: string; message: string; detail?: string }; value?: unknown;
  /** Present when the counterparty check ran (pay / pay_bill). */
  counterparty?: CounterpartyCheck;
  /** false when the wrapper refused before signing anything. */
  signed?: boolean;
}

/** Signs every request with NEP-413 (Authorization: NEP413 …) and signs prepared transactions locally. */
export class GatewayClient {
  readonly publicKey: string;
  constructor(public readonly conn: AgentConnection, private readonly fetchImpl: typeof fetch = (...a) => globalThis.fetch(...a)) {
    this.publicKey = publicKeyFromSecretKey(conn.sk);
  }

  async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const text = body === undefined ? "" : JSON.stringify(body);
    const auth = gatewayAuthHeader(this.conn.sk, this.conn.vault, method, path, text);
    const res = await this.fetchImpl(this.conn.api + path, {
      method,
      headers: { authorization: auth, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : text,
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: { code: string; message: string; detail?: string } };
    // A submitted transaction that the account refused is a normal result (ok: false), not a transport error.
    if (res.ok && json.ok === false) return json as T;
    if (!res.ok || json.error) {
      const code = json.error?.code ?? `HTTP_${res.status}`;
      throw new GatewayError(code, json.error?.message ?? `${friendlyError(code).title} ${friendlyError(code).next}`, res.status, json.error?.detail);
    }
    return json as T;
  }
  get<T>(path: string): Promise<T> { return this.request<T>("GET", path); }

  /** Asks Oiko about the receiver of a pay / pay_bill action (GET /api/agent/counterparty). null for moves between pots. */
  async checkCounterparty(action: AgentAction): Promise<CounterpartyCheck | null> {
    let q: string;
    if (action.type === "pay") q = `to=${encodeURIComponent(action.to)}&amount=${action.amount}&token=${action.token}`;
    else if (action.type === "pay_bill") q = `bill_id=${action.bill_id}`;
    else return null;
    return this.get<CounterpartyCheck>(`/api/agent/counterparty?${q}`);
  }

  /** Reports a receiver to the shared blocklist (POST /api/agent/report). */
  report(receiver: string, reason: string, evidence: string): Promise<{ ok: boolean; stored: boolean; note: string }> {
    return this.request("POST", "/api/agent/report", { receiver, reason, evidence });
  }

  /**
   * Counterparty check → prepare → sign locally → submit. For pay / pay_bill the wrapper refuses to sign when the
   * check says block (act and propose), or warn (act: use propose so the owner approves), or when the check can't run
   * (act only: fail closed). Returns `ok: false, signed: false` in those cases. The gateway enforces the same rules,
   * and the account's contract enforces the allowlist and caps regardless.
   */
  async run(kind: "propose" | "act", action: AgentAction, reason?: string): Promise<RunResult> {
    let counterparty: CounterpartyCheck | null = null;
    try {
      counterparty = await this.checkCounterparty(action);
    } catch (e) {
      if (kind === "act") {
        const msg = e instanceof Error ? e.message : String(e);
        return { txHash: "", ok: false, signed: false, error: { code: "E_COUNTERPARTY_UNAVAILABLE", message: `Couldn't check who this pays, so nothing was signed. Use propose to let the owner decide. (${msg})` } };
      }
    }
    if (counterparty) {
      const refused = kind === "act" ? counterparty.decision?.act === "refused" : counterparty.decision?.propose === "refused";
      if (refused || counterparty.verdict === "block") {
        const code = counterparty.verdict === "block" ? "E_COUNTERPARTY_BLOCKED" : "E_COUNTERPARTY_WARN";
        const why = counterparty.reasons.filter((r) => r.severity !== "info").map((r) => r.message).join(" ");
        const message = counterparty.decision?.message ?? (code === "E_COUNTERPARTY_BLOCKED"
          ? `Refused: ${why} Nothing was signed. Don't pay this account; tell the owner what you were asked to do.`
          : `Not paid: ${why} Nothing was signed. Use propose instead so the owner can approve it.`);
        return { txHash: "", ok: false, signed: false, counterparty, error: { code, message } };
      }
    }
    const prep = await this.request<{ unsignedTx: string; hash: string }>("POST", "/api/agent/prepare", { kind, action, reason });
    const { signedTx } = signTransactionBytes(this.conn.sk, b64decode(prep.unsignedTx));
    const r = await this.request<RunResult>("POST", "/api/agent/submit", { signedTx: b64encode(signedTx) });
    return counterparty ? { ...r, counterparty } : r;
  }
}
