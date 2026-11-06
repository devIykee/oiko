// Loads what deriveEvents needs from chain + store, and delivers webhooks from cron.
import { AjoClient, type Activity, type AgentView, type Circle, type NearRpc, type Overview } from "@oiko/sdk";
import { serverConfig } from "./config";
import { autopilotKey, DEFAULT_AUTOPILOT, deriveEvents, type AutopilotSettings, type OikoEvent } from "./events";
import { authorizeAgentKey, defaultDeps as gatewayDeps, type GatewayDeps } from "./gateway";
import type { Store } from "./store";
import { deliver, WEBHOOK_PREFIX, type Poster, type Webhook } from "./webhooks";

export async function getAutopilot(s: Store, vaultId: string): Promise<AutopilotSettings> {
  const v = await s.getSetting<Partial<AutopilotSettings>>(autopilotKey(vaultId));
  return { ...DEFAULT_AUTOPILOT, ...(v ?? {}), sweep_spend: { ...DEFAULT_AUTOPILOT.sweep_spend, ...(v?.sweep_spend ?? {}) } };
}

export async function loadEvents(vaultId: string, policy: AgentView | null, r: NearRpc, s: Store, nowMs: number, ov?: Overview): Promise<OikoEvent[]> {
  const cfg = serverConfig();
  const overview = ov ?? await r.view<Overview>(vaultId, "get_overview");
  const ajo = cfg.oiko.contracts.ajo && cfg.features.ajo ? new AjoClient(r, cfg.oiko.contracts.ajo) : null;
  const [activity, invoices, circles, autopilot] = await Promise.all([
    r.view<Activity[]>(vaultId, "get_activity", { from_seq: null, limit: 200 }),
    s.listInvoices(overview.owner).catch(() => []),
    ajo ? ajo.circlesFor(vaultId).catch((): Circle[] => []) : Promise.resolve<Circle[]>([]),
    getAutopilot(s, vaultId),
  ]);
  return deriveEvents({ vaultId, overview, activity, invoices, circles, policy, autopilot, nowMs });
}

/** Cron: deliver new events to every live webhook. Disconnected agents' webhooks are removed. */
export async function deliverWebhooks(s: Store, r: NearRpc, nowMs: number, outOfTime: () => boolean, deps: GatewayDeps = gatewayDeps(), post?: Poster) {
  const hooks = await s.listSettings<Webhook>(WEBHOOK_PREFIX);
  let sent = 0, checked = 0;
  const notes: string[] = [];
  for (const { key, value: w } of hooks) {
    if (outOfTime()) { notes.push("webhooks: time budget reached"); break; }
    if (w.disabled) continue;
    checked++;
    let policy: AgentView;
    try {
      policy = (await authorizeAgentKey(w.vaultId, w.publicKey, "read", deps)).policy;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "E_KEY_GONE" || code === "E_AGENT_REVOKED" || code === "E_AGENT_UNKNOWN" || code === "E_AGENT_EXPIRED") await s.deleteSetting(key);
      continue;
    }
    try {
      sent += await deliver(s, w, await loadEvents(w.vaultId, policy, r, s, nowMs), nowMs, post);
    } catch (e) {
      notes.push(`webhook ${w.vaultId}: ${(e as Error).message.slice(0, 100)}`);
    }
  }
  return { checked, sent, notes };
}
