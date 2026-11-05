"use client";
// Counterparty check pill (allow / warn / block) with the reasons in a disclosure. Calls GET /api/counterparty/:accountId.
// Advice only: the account's on-chain allowlist and caps are the hard limit (docs/COUNTERPARTY.md).
import { Badge } from "@oiko/ui";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useConfig } from "@/lib/config";
import { useQuery } from "@/lib/query";

export interface CounterpartyCheckView {
  receiver: string; verdict: "allow" | "warn" | "block"; score: number; checkedAt: string; sources: string[];
  reasons: Array<{ code: string; severity: "info" | "warn" | "block"; message: string; evidence?: string }>;
}

const LABEL = { allow: "Looks fine", warn: "Check first", block: "Don't pay" } as const;
const TONE = { allow: "success", warn: "warning", block: "danger" } as const;
const ICON = { block: "⛔", warn: "⚠", info: "•" } as const;

/** Turns what the user typed into an account id the way the bills form does ("citypower" → "citypower.<root>"). */
function resolve(raw: string, root: string | undefined): string | null {
  const v = raw.trim().toLowerCase();
  if (v.length < 2) return null;
  if (v.includes(".") || /^[0-9a-f]{64}$/.test(v) || /^0x[0-9a-f]{40}$/.test(v)) return v;
  return root ? `${v}.${root}` : null;
}

export function CounterpartyBadge({ accountId, vault, amount, token, debounceMs = 0, testId }: {
  /** Account id, or a bare Oiko name (resolved under the root). */
  accountId: string;
  /** The owner's vault: adds "has this account paid them before". */
  vault?: string | null;
  amount?: string | null;
  token?: "usdc" | "usdt" | null;
  /** For text inputs: wait until typing stops. */
  debounceMs?: number;
  testId?: string;
}) {
  const { config } = useConfig();
  const target = resolve(accountId, config?.root);
  const [id, setId] = useState<string | null>(debounceMs ? null : target);
  useEffect(() => {
    if (!debounceMs) { setId(target); return; }
    const h = setTimeout(() => setId(target), debounceMs);
    return () => clearTimeout(h);
  }, [target, debounceMs]);
  const qs = new URLSearchParams({ ...(vault ? { vault } : {}), ...(amount ? { amount } : {}), ...(token ? { token } : {}) }).toString();
  const q = useQuery<CounterpartyCheckView>(id ? `counterparty:${id}:${qs}` : null, () => api(`/api/counterparty/${encodeURIComponent(id!)}${qs ? `?${qs}` : ""}`), { refreshMs: 300_000 });
  if (!id) return null;
  if (q.error) return <span className="oi-small oi-muted" data-testid={testId}>Couldn&apos;t check {id} right now.</span>;
  if (!q.data) return <span className="oi-small oi-muted" data-testid={testId}>Checking {id}…</span>;
  const r = q.data;
  const shown = r.reasons.filter((x) => x.severity !== "info");
  const info = r.reasons.filter((x) => x.severity === "info");
  return (
    <details className="oi-small" data-testid={testId} data-verdict={r.verdict} style={{ margin: 0 }}>
      <summary style={{ cursor: "pointer", listStyle: "none", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Badge tone={TONE[r.verdict]}>{LABEL[r.verdict]}</Badge>
        <span className="oi-muted" style={{ overflowWrap: "anywhere" }}>
          {r.receiver}{shown.length ? ` · ${shown.length} thing${shown.length === 1 ? "" : "s"} to know` : ""} · details
        </span>
      </summary>
      <ul style={{ margin: "8px 0 0", paddingLeft: 18, display: "grid", gap: 4 }}>
        {[...shown, ...info].map((x, i) => (
          <li key={`${x.code}-${i}`} style={{ listStyle: "none", marginLeft: -18 }}>
            <span aria-hidden style={{ display: "inline-block", width: 18 }}>{ICON[x.severity]}</span>
            {x.message}
            {x.evidence && <span className="oi-muted" style={{ display: "block", marginLeft: 18, overflowWrap: "anywhere" }}>{x.evidence}</span>}
          </li>
        ))}
      </ul>
      <p className="oi-muted" style={{ margin: "8px 0 0" }}>
        Advice from Oiko&apos;s counterparty check (data: NEAR RPC, NearBlocks, shared reports). Your agent limits on the account are what actually stop payments.
      </p>
    </details>
  );
}
