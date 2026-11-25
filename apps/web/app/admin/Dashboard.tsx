"use client";
// Operator dashboard: health checks, the numbers that matter, signups, account code versions, private-label adoption,
// contract keys and the newest accounts. Data: GET /api/admin/dashboard (server/adminDashboard.ts). Public chain data and
// aggregate counts only: no private labels, invoice contents or per-user agent logs.
import { Badge, Button } from "@oiko/ui";
import { useCallback, useEffect, useState } from "react";
import type { Dashboard as Data, PrivacyState, Severity, VaultVersion } from "@/server/adminDashboard";

const TONE: Record<Severity, "success" | "warning" | "danger"> = { ok: "success", warn: "warning", bad: "danger" };
const WORD: Record<Severity, string> = { ok: "OK", warn: "Check", bad: "Problem" };
const VERSION: Record<VaultVersion, string> = { current: "Current", older: "Older", other: "Unknown", missing: "Missing" };
const PRIVACY: Record<PrivacyState, string> = { on: "Private", partial: "Partly", off: "Plain", none: "No labels" };
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "–");
const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 16 };
const th: React.CSSProperties = { textAlign: "left", fontWeight: 600, color: "var(--ink-2)", padding: "8px 10px", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };

function Tile({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId?: string }) {
  return (
    <div style={card} data-testid={testId}>
      <div className="oi-small oi-muted">{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.2, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div className="oi-micro oi-muted" style={{ marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

/** Signups per day, one series: thin bars from the baseline, a tooltip on hover/focus, no legend (the title names it). */
function SignupBars({ days }: { days: Array<{ day: string; count: number }> }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((a, d) => a + d.count, 0);
  const shown = hover === null ? null : days[hover]!;
  return (
    <figure style={{ margin: 0 }}>
      <div role="img" aria-label={`Signups in the last 14 days among sampled accounts: ${days.map((d) => `${d.day} ${d.count}`).join(", ")}`}
        style={{ display: "grid", gridTemplateColumns: `repeat(${days.length}, 1fr)`, gap: 4, alignItems: "end", height: 120, borderBottom: "1px solid var(--line)", position: "relative" }}>
        {days.map((d, i) => (
          <div key={d.day} tabIndex={0} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
            style={{ height: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center", cursor: "default", outline: "none" }}>
            <div style={{ width: "60%", maxWidth: 18, minHeight: d.count ? 4 : 0, height: `${(d.count / max) * 100}%`, background: "var(--accent)", borderRadius: "4px 4px 0 0", opacity: hover === null || hover === i ? 1 : 0.45 }} />
          </div>
        ))}
      </div>
      <figcaption className="oi-micro oi-muted" style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }} aria-live="polite">
        <span>{days[0]?.day.slice(5)}</span>
        <span style={{ color: "var(--ink)" }}>{shown ? `${shown.day}: ${shown.count} signup${shown.count === 1 ? "" : "s"}` : `${total} in 14 days`}</span>
        <span>{days.at(-1)?.day.slice(5)}</span>
      </figcaption>
    </figure>
  );
}

async function fetchDashboard(fresh: boolean): Promise<{ data?: Data; err?: string }> {
  try {
    const r = await fetch(`/api/admin/dashboard${fresh ? "?fresh=1" : ""}`, { credentials: "same-origin", cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { err: (j as { error?: { message?: string } }).error?.message ?? `HTTP ${r.status}` };
    return { data: j as Data };
  } catch (e) {
    return { err: (e as Error).message };
  }
}

export function Dashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const apply = useCallback((r: { data?: Data; err?: string }) => {
    if (r.data) { setData(r.data); setErr(null); } else setErr(r.err ?? "unknown error");
    setBusy(false);
  }, []);
  const load = useCallback((fresh = false) => fetchDashboard(fresh).then(apply), [apply]);
  useEffect(() => {
    let live = true;
    const run = () => fetchDashboard(false).then((r) => { if (live) apply(r); });
    void run();
    const t = setInterval(() => void run(), 60_000);
    return () => { live = false; clearInterval(t); };
  }, [apply]);

  if (!data) return <section style={card}>{err ? <p role="alert">Couldn&rsquo;t load the dashboard: {err}</p> : <p className="oi-muted">Loading the dashboard…</p>}</section>;
  const a = data.accounts, c = data.counts;
  const labelled = a.privacy.on + a.privacy.partial + a.privacy.off;
  const problems = data.checks.filter((x) => x.status !== "ok");

  return (
    <div className="oi-stack" data-testid="admin-dashboard">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
        <div className="oi-small oi-muted">
          <Badge tone="accent">{data.network}</Badge>{" "}Updated {new Date(data.generatedAt).toLocaleTimeString()}{data.cached ? " (cached)" : ""}
        </div>
        <Button size="sm" variant="secondary" loading={busy} onClick={() => { setBusy(true); void load(true); }} data-testid="admin-refresh">Refresh</Button>
      </div>
      {err && <p role="alert" className="oi-small">Last refresh failed: {err}</p>}

      <section style={card} aria-labelledby="health-title">
        <h2 id="health-title" className="oi-h2" style={{ marginTop: 0 }}>Health {problems.length ? <Badge tone={problems.some((p) => p.status === "bad") ? "danger" : "warning"}>{problems.length} to look at</Badge> : <Badge tone="success">All good</Badge>}</h2>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }} data-testid="admin-checks">
          {data.checks.map((x) => (
            <li key={x.id} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "8px 0", borderTop: "1px solid var(--line)" }}>
              <Badge tone={TONE[x.status]}>{WORD[x.status]}</Badge>
              <div style={{ minWidth: 0 }}><strong>{x.label}</strong><div className="oi-small oi-muted" style={{ overflowWrap: "anywhere" }}>{x.detail}</div></div>
            </li>
          ))}
        </ul>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        <Tile label="Accounts" value={a.total === null ? "–" : String(a.total)} sub={`${a.sampled} newest checked below`} testId="admin-tile-accounts" />
        <Tile label="Private labels on" value={pct(a.privacy.on, labelled)} sub={`${a.privacy.on} private, ${a.privacy.partial} partly, ${a.privacy.off} plain`} testId="admin-tile-privacy" />
        <Tile label="On current account code" value={pct(a.versions.current, a.sampled)} sub={`${a.versions.older} older, ${a.versions.other + a.versions.missing} other`} />
        <Tile label="Relayer" value={data.relayer.balance === null ? "–" : `${data.relayer.balance} NEAR`} sub={`${data.relayer.budgetRemaining} of ${data.relayer.budgetLimit} NEAR budget left today`} />
        <Tile label="Held (newest accounts)" value={a.balanceSampled} sub="USDC + USDT, from the public record" />
        <Tile label="Invoices" value={String(c.invoices)} sub={`${c.invoicesPrivate} private, ${c.invoicesRecent} new in ${c.sinceHours} h`} />
        <Tile label={`Agent requests (${c.sinceHours} h)`} value={String(c.accessRecent)} sub={`${c.accessRefusedRecent} refused`} />
        <Tile label="Waiting for owners" value={String(c.changesPending)} sub={`agent suggestions; ${c.webhooks} webhooks, ${c.pushSubscriptions} push, ${c.reports} scam reports`} />
      </div>

      <section style={card} aria-labelledby="signups-title">
        <h2 id="signups-title" className="oi-h2" style={{ marginTop: 0 }}>Signups, last 14 days</h2>
        <p className="oi-micro oi-muted" style={{ marginTop: 0 }}>Among the {a.sampled} newest accounts.</p>
        <SignupBars days={a.signupsByDay} />
      </section>

      <section style={card} aria-labelledby="accounts-title">
        <h2 id="accounts-title" className="oi-h2" style={{ marginTop: 0 }}>Newest accounts</h2>
        <div style={{ overflowX: "auto" }}>
          <table className="oi-small" style={{ borderCollapse: "collapse", width: "100%" }} data-testid="admin-accounts">
            <thead><tr><th style={th}>Name</th><th style={th}>Joined</th><th style={th}>Code</th><th style={th}>Labels</th><th style={{ ...th, textAlign: "right" }}>Pots</th><th style={{ ...th, textAlign: "right" }}>Bills</th><th style={{ ...th, textAlign: "right" }}>Agents</th><th style={{ ...th, textAlign: "right" }}>Held</th></tr></thead>
            <tbody>
              {a.recent.map((r) => (
                <tr key={r.vaultId}>
                  <td style={td} title={r.vaultId}>{r.name}</td>
                  <td style={td}>{ago(r.createdAt)}</td>
                  <td style={td}><Badge tone={r.version === "current" ? "success" : r.version === "older" ? "warning" : "danger"}>{VERSION[r.version]}</Badge></td>
                  <td style={td}>{PRIVACY[r.privacy]}</td>
                  <td style={{ ...td, textAlign: "right" }}>{r.pots}</td><td style={{ ...td, textAlign: "right" }}>{r.bills}</td><td style={{ ...td, textAlign: "right" }}>{r.agents}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.total}</td>
                </tr>
              ))}
              {!a.recent.length && <tr><td style={td} colSpan={8}>No accounts yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section style={card} aria-labelledby="contracts-title">
        <h2 id="contracts-title" className="oi-h2" style={{ marginTop: 0 }}>Contracts</h2>
        <div style={{ overflowX: "auto" }}>
          <table className="oi-small" style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead><tr><th style={th}>Role</th><th style={th}>Account</th><th style={th}>Access keys</th></tr></thead>
            <tbody>
              {data.contracts.map((k) => (
                <tr key={k.accountId}>
                  <td style={td}>{k.role}</td><td style={td}>{k.accountId}</td>
                  <td style={td}>{k.keys === null ? "–" : k.keyless ? <Badge tone="success">None (locked)</Badge> : <Badge tone={k.expectKeyless ? "warning" : "neutral"}>{k.keys}{k.expectKeyless ? " (should be 0)" : data.network === "local" ? " (local sandbox)" : " (test fixture)"}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="oi-micro oi-muted" style={{ overflowWrap: "anywhere", marginBottom: 0 }}>Account code: {data.vaultCode.current ?? "not set"}{data.vaultCode.trusted.length ? ` · trusted by the registry: ${data.vaultCode.trusted.join(", ")}` : ""}</p>
        <p className="oi-micro oi-muted" style={{ margin: "4px 0 0" }}>Features: {Object.entries(data.features).map(([k, v]) => `${k} ${v ? "on" : "off"}`).join(" · ")}</p>
      </section>
    </div>
  );
}
