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
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
    this.name = "GatewayError";
  }
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
    const json = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string } };
    if (!res.ok || json.error) {
      const code = json.error?.code ?? `HTTP_${res.status}`;
      throw new GatewayError(code, json.error?.message ?? `${friendlyError(code).title} ${friendlyError(code).next}`, res.status);
    }
    return json as T;
  }
  get<T>(path: string): Promise<T> { return this.request<T>("GET", path); }

  /** prepare → sign locally → submit. Returns the submit result; `ok: false` carries a code + plain-English error. */
  async run(kind: "propose" | "act", action: AgentAction, reason?: string): Promise<{ txHash: string; ok: boolean; error?: { code: string; message: string }; value?: unknown }> {
    const prep = await this.request<{ unsignedTx: string; hash: string }>("POST", "/api/agent/prepare", { kind, action, reason });
    const { signedTx } = signTransactionBytes(this.conn.sk, b64decode(prep.unsignedTx));
    return this.request("POST", "/api/agent/submit", { signedTx: b64encode(signedTx) });
  }
}
