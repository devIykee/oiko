// Owner endpoints for agent change proposals and autopilot. Auth: NEP-413 by a key on the owner's name account
// (the app key), the same as the access log. The owner's account is vault.<name>.
import type { Overview } from "@oiko/sdk";
import { z } from "zod";
import { getAutopilot } from "./agentEvents";
import { DecideChangeBody, decideChange, listChanges, type ChangeDeps } from "./changes";
import { ApiError } from "./errors";
import { autopilotKey, validateAutopilot, type AutopilotSettings } from "./events";
import { authenticateOwner } from "./gateway";
import { clientIp, errorResponse, json, parseBody, readText } from "./http";
import { invoiceDeps } from "./invoicesHttp";
import { gatewayRequest } from "./agentHttp";
import { rpc } from "./near";
import { checkLimits } from "./ratelimit";
import { store } from "./store";

const deps = (): ChangeDeps => ({ store: store(), now: () => Date.now(), overview: (v) => rpc().view<Overview>(v, "get_overview") });

async function owner(req: Request, text: string) {
  if (!checkLimits("gateway", clientIp(req), null)) throw new ApiError("E_RATE_LIMIT", 429);
  return authenticateOwner(gatewayRequest(req, text));
}

/** GET /api/owner/changes: every change proposal for this account, newest first, with `calls` for pending ones. */
export async function ownerListChanges(req: Request): Promise<Response> {
  try {
    const o = await owner(req, "");
    return json({ changes: await listChanges(`vault.${o.accountId}`, deps(), { withOverview: true }) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** POST /api/owner/changes/<id> {decision, txHashes}. */
export async function ownerDecideChange(req: Request, id: string): Promise<Response> {
  try {
    const text = await readText(req, 8192);
    const o = await owner(req, text);
    return json(await decideChange(o.accountId, id, parseBody(DecideChangeBody, text), deps(), invoiceDeps()));
  } catch (e) {
    return errorResponse(e);
  }
}

const AutopilotBody = z.object({
  top_up_bills: z.object({ on: z.boolean() }),
  sweep_spend: z.object({ on: z.boolean(), above: z.string().regex(/^\d{1,39}$/), to_pot: z.number().int().nonnegative().nullable(), weekday: z.number().int().min(0).max(6) }),
  pay_bills_on_due_day: z.object({ on: z.boolean() }),
  spend_floor: z.string().regex(/^\d{1,39}$/).nullable(),
});

/** GET / POST /api/owner/autopilot. */
export async function ownerAutopilot(req: Request): Promise<Response> {
  try {
    const text = req.method === "POST" ? await readText(req, 4096) : "";
    const o = await owner(req, text);
    const vaultId = `vault.${o.accountId}`;
    if (req.method !== "POST") return json({ autopilot: await getAutopilot(store(), vaultId) });
    const b = parseBody(AutopilotBody, text);
    const next: AutopilotSettings = { ...b, updatedAt: new Date().toISOString() };
    if (b.sweep_spend.on || b.spend_floor !== null) {
      const problem = validateAutopilot(next, await rpc().view<Overview>(vaultId, "get_overview"));
      if (problem) throw new ApiError("E_BAD_REQUEST", 400, problem);
    }
    await store().setSetting(autopilotKey(vaultId), next);
    return json({ autopilot: next });
  } catch (e) {
    return errorResponse(e);
  }
}
