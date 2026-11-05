"use client";
import { Button, Input, MotionProvider, Note, SegmentedControl } from "@oiko/ui";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand/Logo";

type Framing = "testnet" | "mainnet";
type State = { kind: "loading" } | { kind: "off" } | { kind: "login" } | { kind: "in"; framing: Framing };

async function call(path: string, init?: RequestInit) {
  const r = await fetch(path, { ...init, credentials: "same-origin", headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body: body as { framing?: Framing; error?: { message?: string } } };
}

export function AdminPanel() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = async () => {
    const r = await call("/api/admin/framing");
    if (r.status === 200 && r.body.framing) setState({ kind: "in", framing: r.body.framing });
    else setState({ kind: r.status === 404 ? "off" : "login" });
  };
  useEffect(() => { void load(); }, []);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await call("/api/admin/login", { method: "POST", body: JSON.stringify({ password: pw }) });
    setBusy(false); setPw("");
    if (r.status === 200) return load();
    setErr(r.status === 429 ? "Too many tries. Wait 15 minutes and try again." : r.body.error?.message ?? "That password isn't right.");
  };
  const choose = async (f: Framing) => {
    if (state.kind !== "in") return;
    setBusy(true); setSaved(false); setErr(null);
    const r = await call("/api/admin/framing", { method: "PUT", body: JSON.stringify({ framing: f }) });
    setBusy(false);
    if (r.status === 200 && r.body.framing) { setState({ kind: "in", framing: r.body.framing }); setSaved(true); }
    else if (r.status === 401) setState({ kind: "login" });
    else setErr(r.body.error?.message ?? "Couldn't save. Try again.");
  };
  const signOut = async () => { await call("/api/admin/logout", { method: "POST" }); setState({ kind: "login" }); };

  return (
    <MotionProvider>
    <div className="oi-public oi-root">
      <main className="oi-col oi-page" style={{ maxWidth: 480, padding: "48px 16px" }}>
        <Logo variant="wordmark" height={24} />
        <h1 className="oi-h1">Admin</h1>
        {state.kind === "loading" && <p className="oi-muted">Checking…</p>}
        {state.kind === "off" && <Note tone="info">Admin is turned off on this deployment.</Note>}
        {state.kind === "login" && (
          <form className="oi-card oi-stack" onSubmit={signIn}>
            <Input label="Password" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} error={err} autoFocus />
            <Button type="submit" block size="lg" loading={busy} disabled={!pw}>Sign in</Button>
          </form>
        )}
        {state.kind === "in" && (
          <>
            <section className="oi-card oi-stack" aria-labelledby="framing-title">
              <div>
                <h2 id="framing-title" className="oi-h2">Public framing</h2>
                <p className="oi-small oi-muted" style={{ margin: "4px 0 0" }}>How the website talks about the network. Display only.</p>
              </div>
              <SegmentedControl label="Public framing" value={state.framing} onChange={(v: Framing) => void choose(v)}
                items={[{ value: "testnet", label: "Testnet" }, { value: "mainnet", label: "Mainnet" }]} />
              <Note tone="warning" title="Nothing launches on mainnet">
                Mainnet framing shows names as .oiko.near and hides test-mode wording on the website. Sign-up, payments, contracts, the API and explorer links stay on testnet.
              </Note>
              <div aria-live="polite" className="oi-small">{busy ? "Saving…" : saved ? `Saved: ${state.framing}.` : err ?? ""}</div>
            </section>
            <Button variant="secondary" onClick={signOut}>Sign out</Button>
          </>
        )}
      </main>
    </div>
    </MotionProvider>
  );
}
