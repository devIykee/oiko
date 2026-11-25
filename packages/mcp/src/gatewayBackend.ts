import { GatewayClient, VEIL_LIMITS, Veil, maskDeep, type AgentConnection } from "@oiko/sdk";
import type { AgentActionInput, ConfigChangeInput, OikoBackend, ReadTool } from "./tools";

/**
 * Backend for the stdio server: talks to the Oiko HTTP gateway, signing every request and transaction locally.
 * With a view key (conn.vk), private labels are opened here, in the agent's own process, and the reasons it writes are
 * sealed before they leave it; without one they read as "Private". The gateway never sees the key.
 */
export class GatewayBackend implements OikoBackend {
  readonly canSign = true;
  readonly client: GatewayClient;
  readonly veil: Veil | null;
  constructor(conn: AgentConnection, fetchImpl?: typeof fetch) {
    this.client = new GatewayClient(conn, fetchImpl);
    this.veil = conn.vk ? Veil.fromViewKey(conn.vk, conn.vault) : null;
  }
  private open<T>(v: T): T { return this.veil ? this.veil.openDeep(v) : maskDeep(v); }
  private seal(reason: string): string { return this.veil ? this.veil.seal(reason, VEIL_LIMITS.proposalReason) : reason; }
  async read(tool: ReadTool, params: Record<string, string> = {}) {
    const q = new URLSearchParams(params).toString();
    return this.open(await this.client.get(`/api/agent/${tool}${q ? `?${q}` : ""}`));
  }
  report(receiver: string, reason: string, evidence: string) {
    return this.client.report(receiver, reason, evidence);
  }
  async proposeChange(change: ConfigChangeInput, reason: string) {
    return this.open(await this.client.request("POST", "/api/agent/change", { change, reason: this.seal(reason) }));
  }
  setWebhook(url: string | null) {
    return this.client.request("POST", "/api/agent/webhook", { url });
  }
  async run(kind: "propose" | "act", action: AgentActionInput, reason?: string) {
    // GatewayClient.run checks the counterparty first and refuses to sign on block (and on warn for act).
    const r = await this.client.run(kind, action, reason === undefined ? undefined : this.seal(reason));
    if (!r.ok) throw Object.assign(new Error(r.error?.message ?? "That didn't go through."), { code: r.error?.code ?? "E_TX_FAILED", txHash: r.txHash, how_to_fix: r.error?.how_to_fix });
    return { ok: true, txHash: r.txHash, ...(kind === "propose" ? { proposalId: r.value, note: "The owner will see this in Oiko and can approve or reject it." } : { result: r.value }) };
  }
}
