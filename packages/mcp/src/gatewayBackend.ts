import { GatewayClient, type AgentConnection } from "@oiko/sdk";
import type { AgentActionInput, OikoBackend, ReadTool } from "./tools";

/** Backend for the stdio server: talks to the Oiko HTTP gateway, signing every request and transaction locally. */
export class GatewayBackend implements OikoBackend {
  readonly canSign = true;
  readonly client: GatewayClient;
  constructor(conn: AgentConnection, fetchImpl?: typeof fetch) {
    this.client = new GatewayClient(conn, fetchImpl);
  }
  read(tool: ReadTool, params: Record<string, string> = {}) {
    const q = new URLSearchParams(params).toString();
    return this.client.get(`/api/agent/${tool}${q ? `?${q}` : ""}`);
  }
  async run(kind: "propose" | "act", action: AgentActionInput, reason?: string) {
    const r = await this.client.run(kind, action, reason);
    if (!r.ok) throw Object.assign(new Error(r.error?.message ?? "That didn't go through."), { code: r.error?.code ?? "E_TX_FAILED", txHash: r.txHash });
    return { ok: true, txHash: r.txHash, ...(kind === "propose" ? { proposalId: r.value, note: "The owner will see this in Oiko and can approve or reject it." } : { result: r.value }) };
  }
}
