// /api/cron: runs due schedules and settles due ROSCA rounds (ajo contract); sends bill reminders when push is configured.
import { AjoClient, billStatus, formatAmount, RegistryClient, TGAS, type Circle, type Overview } from "@oiko/sdk";
import { serverConfig } from "./config";
import { ApiError } from "./errors";
import { relayer, rpc } from "./near";
import { pushEnabled, sendPush } from "./push";
import { GAS_COST_ESTIMATE, spendBudget } from "./ratelimit";

export function checkCronAuth(req: Request): void {
  const secret = serverConfig().cronSecret;
  if (!secret) {
    if (serverConfig().network === "local") return;
    throw new ApiError("E_CONFIG", 503, "CRON_SECRET is not set.");
  }
  const h = req.headers.get("authorization") ?? "";
  const given = h.startsWith("Bearer ") ? h.slice(7) : req.headers.get("x-cron-secret") ?? "";
  if (given.length !== secret.length || !timingSafeEqual(given, secret)) throw new ApiError("E_UNAUTHORIZED", 401);
}
function timingSafeEqual(a: string, b: string): boolean {
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const g = globalThis as unknown as { __oikoReminded?: Set<string> };
const reminded = (g.__oikoReminded ??= new Set());

export interface CronReport {
  vaultsScanned: number; schedulesRun: Array<{ vaultId: string; txHash: string; ok: boolean }>; roundsSettled: Array<{ circleId: number; txHash: string; ok: boolean }>;
  reminders: number; notes: string[]; tookMs: number;
}

export function circleDue(c: Circle, nowNs: bigint): boolean {
  if (c.status !== "active" || c.start_at === null) return false;
  return nowNs >= BigInt(c.start_at) + BigInt(c.round + 1) * BigInt(c.period_ns);
}

export async function runCron(nowMs = Date.now(), maxMs = 50_000): Promise<CronReport> {
  const cfg = serverConfig();
  const r = rpc();
  const started = Date.now();
  const report: CronReport = { vaultsScanned: 0, schedulesRun: [], roundsSettled: [], reminders: 0, notes: [], tookMs: 0 };
  const nowNs = BigInt(nowMs) * 1_000_000n;
  const outOfTime = () => Date.now() - started > maxMs;
  const spend = () => spendBudget(cfg.limits.dailyBudget, GAS_COST_ESTIMATE);

  // Vaults (requires registry view list_names — requested from the contracts workstream).
  const reg = new RegistryClient(r, cfg.oiko.contracts.registry);
  const vaults: string[] = [];
  try {
    for (let from = 0; from < 100_000 && !outOfTime(); from += 100) {
      const page = await reg.listNames(from, 100);
      vaults.push(...page.map((p) => p.vault_id));
      if (page.length < 100) break;
    }
  } catch (e) {
    report.notes.push(`registry.list_names unavailable (${(e as Error).message.slice(0, 120)}); schedules not scanned`);
  }
  for (const vaultId of vaults) {
    if (outOfTime()) { report.notes.push("time budget reached"); break; }
    let ov: Overview;
    try {
      ov = await r.view<Overview>(vaultId, "get_overview");
    } catch {
      continue; // vault not created yet
    }
    report.vaultsScanned++;
    if (ov.schedules.some((s) => BigInt(s.next_run) <= nowNs)) {
      if (!spend()) { report.notes.push("daily budget reached"); break; }
      const t = await relayer().call(vaultId, "run_schedules", {}, { gas: (300n * TGAS).toString() });
      report.schedulesRun.push({ vaultId, txHash: t.txHash, ok: t.ok });
    }
    if (pushEnabled()) {
      for (const b of ov.bills) {
        const st = billStatus(b, nowMs);
        if (st.status !== "due") continue;
        const daysLeft = Math.round((st.nextDue.getTime() - Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth(), new Date(nowMs).getUTCDate())) / 86_400_000);
        if (daysLeft !== 3 && daysLeft !== 0) continue;
        const key = `${vaultId}:${b.id}:${st.nextDue.toISOString()}:${daysLeft}`;
        if (reminded.has(key)) continue;
        reminded.add(key);
        report.reminders += await sendPush(ov.owner, {
          title: daysLeft === 0 ? `${b.name} is due today` : `${b.name} is due in 3 days`,
          body: `${formatAmount(b.amount)} ${b.token.toUpperCase()} to ${b.payee}.`, url: "/bills", tag: key,
        });
      }
    }
  }

  // ROSCA rounds (ajo contract).
  const ajoId = cfg.oiko.contracts.ajo;
  if (ajoId && cfg.features.ajo) {
    const ajo = new AjoClient(r, ajoId);
    try {
      // ajo ids start at 1; get_circles returns at most 50 from `from`.
      for (let from = 1; from < 1_000_000 && !outOfTime(); ) {
        const page = await ajo.circles(from, 50);
        if (page.length) from = Math.max(...page.map((c) => c.id)) + 1;
        for (const c of page) {
          if (!circleDue(c, nowNs)) continue;
          if (!spend()) { report.notes.push("daily budget reached"); break; }
          const t = await relayer().call(ajoId, "settle_round", { circle_id: c.id }, { gas: (300n * TGAS).toString() });
          report.roundsSettled.push({ circleId: c.id, txHash: t.txHash, ok: t.ok });
        }
        if (page.length < 50) break;
      }
    } catch (e) {
      report.notes.push(`ROSCA scan failed (${(e as Error).message.slice(0, 120)})`);
    }
  }
  report.tookMs = Date.now() - started;
  return report;
}
