"use client";
import { Badge, Button, GroupedList, Input, ListRow, Note, SelectList, StatusTimeline, SuccessCheck } from "@oiko/ui";
import type { VaultClient } from "@oiko/sdk";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { ActionError, explain, useMoney } from "@/lib/actions";
import { useConfig } from "@/lib/config";
import { fetchName, type NameInfoResp } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { PasskeyError, passkeySupported } from "@/lib/passkey";
import { useSession, type LoginMethod } from "@/lib/session";
import { signUp, type SignupStep } from "@/lib/signup";

type Stage = "name" | "login" | "progress" | "pots" | "agent" | "code";
const NAME_RE = /^[a-z0-9_-]{2,32}$/;

export function StartScreen() {
  const t = useT();
  const router = useRouter();
  const sp = useSearchParams();
  const { status, save, passkeySignIn, codeSignIn } = useSession();
  const { config, oiko } = useConfig();
  const [stage, setStage] = useState<Stage>("name");
  const [name, setName] = useState((sp.get("name") ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32));
  const [info, setInfo] = useState<NameInfoResp | null>(null);
  const [checking, setChecking] = useState(false);
  const [method, setMethod] = useState<LoginMethod>("passkey");
  const [step, setStep] = useState<SignupStep | null>(null);
  const [err, setErr] = useState<{ title: string; next: string } | null>(null);
  const [canPasskey, setCanPasskey] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const local = config?.network === "local";
  const [code, setCode] = useState("");
  const [codePass, setCodePass] = useState("");

  // A QR from Settings → "Move to another device" opens /start#move=<code>. The fragment never reaches the server;
  // it is cleared from the address bar straight away.
  useEffect(() => {
    const m = /^#move=(.+)$/.exec(window.location.hash);
    if (!m) return;
    setCode(decodeURIComponent(m[1]));
    setStage("code");
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  useEffect(() => { const ok = passkeySupported(); setCanPasskey(ok); if (!ok) setMethod("browser"); }, []);
  useEffect(() => { if (status === "signed-in" && stage === "name") router.replace("/home"); }, [status, stage, router]);

  // Live availability (debounced).
  useEffect(() => {
    setInfo(null);
    if (!NAME_RE.test(name)) return;
    setChecking(true);
    const h = setTimeout(() => {
      fetchName(name).then((r) => setInfo(r)).catch(() => setInfo(null)).finally(() => setChecking(false));
    }, 350);
    return () => { clearTimeout(h); setChecking(false); };
  }, [name]);

  const fullName = oiko ? `${name || "ada"}.${oiko.root}` : `${name || "ada"}.oiko`;
  const valid = NAME_RE.test(name);

  const create = async () => {
    setErr(null);
    setStage("progress");
    try {
      const s = await signUp({ name, displayName: name.charAt(0).toUpperCase() + name.slice(1), method, onStep: setStep });
      save(s);
      setTimeout(() => setStage("pots"), 900);
    } catch (e) {
      if (e instanceof PasskeyError) {
        setErr(e.code === "prf-unsupported" ? { title: t("start.prfTitle"), next: t("start.prfNext") } : e.code === "cancelled" ? { title: t("start.cancelled"), next: t("start.cancelledNext") } : { title: t("start.passkeyFailed"), next: t("start.prfNext") });
      } else setErr(explain(e));
      setStage("login");
      setStep(null);
    }
  };

  const signIn = async () => {
    setSigningIn(true); setErr(null);
    try { await passkeySignIn(); router.push("/home"); }
    catch (e) { setErr(e instanceof PasskeyError ? { title: t("start.cancelled"), next: t("start.cancelledNext") } : explain(e)); }
    finally { setSigningIn(false); }
  };

  const signInCode = async () => {
    setSigningIn(true); setErr(null);
    try { await codeSignIn(code, codePass); router.push("/home"); }
    catch (e) { setErr(explain(e)); }
    finally { setSigningIn(false); }
  };

  const stepIndex = step === "name" ? 0 : step === "account" ? 1 : step === "done" ? 3 : 0;

  return (
    <div className="oi-public__col" data-testid="start">
      <header className="oi-row" style={{ minHeight: 48 }}>
        <Link href="/" aria-label="Oiko" style={{ color: "var(--ink)" }}><Logo variant="wordmark" height={24} /></Link>
        <span className="oi-spacer" />
        {config && config.network !== "mainnet" && <Badge tone="warning" icon="warning">{local ? t("common.localMode") : t("common.testMode")}</Badge>}
      </header>

      {stage === "name" && (
        <>
          <div>
            <h1 className="oi-h1" style={{ fontSize: 32 }}>{t("start.title")}</h1>
            <p className="oi-muted" style={{ margin: "8px 0 0" }}>{t("start.sub")}</p>
          </div>
          <Input label={t("start.nameLabel")} value={name} autoFocus autoComplete="off" spellCheck={false} autoCapitalize="none" data-testid="start-name"
            onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32))}
            suffix={<span className="oi-small oi-muted">.{oiko?.root ?? "oiko"}</span>}
            error={name && !valid ? t("start.nameRule") : info && !info.available ? t("start.taken", { name: fullName }) : undefined}
            success={info?.available ? t("start.available", { name: fullName }) : undefined}
            hint={checking ? t("start.checking") : t("start.nameRule")} />
          {info && !info.available && info.suggestions.length > 0 && (
            <div className="oi-chips" style={{ justifyContent: "flex-start" }} aria-label={t("start.suggestions")}>
              {info.suggestions.map((s) => <button key={s} type="button" className="oi-chip" onClick={() => setName(s)}>{s}</button>)}
            </div>
          )}
          <Button block size="lg" disabled={!info?.available} onClick={() => setStage("login")} data-testid="start-continue">{t("common.continue")}</Button>
          <div className="oi-row" style={{ justifyContent: "center", flexWrap: "wrap" }}>
            <span className="oi-small oi-muted">{t("start.haveAccount")}</span>
            <Button variant="ghost" size="sm" loading={signingIn} onClick={signIn} disabled={!canPasskey}>{t("start.signInPasskey")}</Button>
            <Button variant="ghost" size="sm" onClick={() => { setErr(null); setStage("code"); }} data-testid="start-code">{t("start.signInCode")}</Button>
          </div>
          {err && <div role="alert"><Note tone="danger" title={err.title}>{err.next}</Note></div>}
        </>
      )}

      {stage === "login" && (
        <>
          <button type="button" className="oi-btn oi-btn--ghost oi-btn--sm" style={{ alignSelf: "flex-start" }} onClick={() => setStage("name")}>← {t("common.back")}</button>
          <div>
            <h1 className="oi-h1" style={{ fontSize: 28 }}>{t("start.loginTitle", { name: fullName })}</h1>
            <p className="oi-muted" style={{ margin: "8px 0 0" }}>{t("start.loginSub")}</p>
          </div>
          <SelectList label={t("start.loginTitle", { name: fullName })} value={method} onChange={setMethod}
            options={[
              { value: "passkey" as const, title: t("start.passkey"), subtitle: canPasskey ? t("start.passkeySub") : t("start.passkeyUnavailable"), icon: "shield", color: "mint", disabled: !canPasskey, meta: t("start.recommended"), testId: "login-passkey" },
              { value: "browser" as const, title: t("start.browser"), subtitle: t("start.browserSub"), icon: "lock", color: "blue", testId: "login-browser" },
              ...(local ? [{ value: "demo" as const, title: t("start.demo"), subtitle: t("start.demoSub"), icon: "warning" as const, color: "sun" as const, testId: "login-demo" }] : []),
            ]} />
          {method === "browser" && <Note tone="warning">{t("start.browserWarn")}</Note>}
          {err && <div role="alert"><Note tone="danger" title={err.title}>{err.next}</Note></div>}
          <Button block size="lg" onClick={create} data-testid="start-create">{t("start.create")}</Button>
          <p className="oi-micro oi-muted" style={{ margin: 0, textAlign: "center" }}>{t("start.noSeed")}</p>
        </>
      )}

      {stage === "code" && (
        <>
          <button type="button" className="oi-btn oi-btn--ghost oi-btn--sm" style={{ alignSelf: "flex-start" }} onClick={() => { setErr(null); setStage("name"); }}>← {t("common.back")}</button>
          <div>
            <h1 className="oi-h1" style={{ fontSize: 28 }}>{t("start.codeTitle")}</h1>
            <p className="oi-muted" style={{ margin: "8px 0 0" }}>{t("start.codeSub")}</p>
          </div>
          <Input label={t("start.codeLabel")} value={code} placeholder={t("start.codePlaceholder")} autoComplete="off" spellCheck={false} autoCapitalize="none"
            onChange={(e) => setCode(e.target.value.trim())} data-testid="code-input" />
          <Input label={t("start.codePass")} type="password" autoComplete="current-password" value={codePass} onChange={(e) => setCodePass(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && code && codePass) void signInCode(); }} data-testid="code-pass" />
          {err && <div role="alert"><Note tone="danger" title={err.title}>{err.next}</Note></div>}
          <Button block size="lg" loading={signingIn} disabled={!code || !codePass} onClick={signInCode} data-testid="code-go">{signingIn ? t("start.codeChecking") : t("start.codeGo")}</Button>
        </>
      )}

      {stage === "progress" && (
        <div className="oi-card oi-stack" data-testid="start-progress">
          <h1 className="oi-h2">{t("start.settingUp")}</h1>
          <StatusTimeline label={t("start.settingUp")} current={stepIndex} testId="signup-status"
            liveText={step === "done" ? t("start.stepDone") : step === "account" ? t("start.stepAccount") : t("start.stepName")}
            steps={[{ key: "name", title: t("start.stepName"), sub: fullName }, { key: "account", title: t("start.stepAccount") }, { key: "done", title: t("start.stepDone") }]} />
        </div>
      )}

      {stage === "pots" && <FirstRunPots onDone={() => setStage("agent")} />}

      {stage === "agent" && (
        <div className="oi-stack" style={{ textAlign: "center", alignItems: "center", paddingTop: 24 }}>
          <SuccessCheck />
          <h1 className="oi-h1">{t("start.readyTitle")}</h1>
          <p className="oi-muted" style={{ margin: 0 }}>{t("start.readySub")}</p>
          <GroupedList label={t("start.next")} style={{ alignSelf: "stretch", textAlign: "left" }}>
            <ListRow as={Link} href="/agents" icon="agents" color="violet" title={t("start.connectAgent")} subtitle={t("start.connectAgentSub")} chevron />
            <ListRow as={Link} href="/receive" icon="payLink" color="blue" title={t("start.shareLink")} subtitle={t("start.shareLinkSub")} chevron />
          </GroupedList>
          <Button block size="lg" onClick={() => router.push("/home")} data-testid="start-home">{t("start.goHome")}</Button>
        </div>
      )}
    </div>
  );
}

/** First run: default pots with one tap to accept or edit. Bills 30%, Savings 20%, Rainy day 10% (locked), one named Goal 10%, Spend 30% (the rest). */
function FirstRunPots({ onDone }: { onDone: () => void }) {
  const t = useT();
  const { exec } = useMoney();
  const [goal, setGoal] = useState(t("start.goalDefault"));
  const [bills, setBills] = useState(30);
  const [savings, setSavings] = useState(20);
  const [rainy, setRainy] = useState(10);
  const [goalPct, setGoalPct] = useState(10);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ title: string; next: string } | null>(null);
  const spend = 100 - bills - savings - rainy - goalPct;
  const preview = useMemo(() => t("plan.preview", { parts: [
    t("plan.previewPart", { amount: bills, pot: t("pot.kind.bills") }), t("plan.previewPart", { amount: savings, pot: t("pot.kind.autosave") }),
    t("plan.previewPart", { amount: rainy, pot: t("start.rainy") }), t("plan.previewPart", { amount: goalPct, pot: goal || t("pot.kind.goal") }), t("plan.previewPart", { amount: spend, pot: t("pot.kind.flex") }),
  ].join(", ") }), [bills, savings, goalPct, spend, goal, t]);

  const accept = async () => {
    setBusy(true); setErr(null);
    try {
      const mk = async (p: Parameters<VaultClient["createPot"]>[0]) => {
        const r = await exec("createPot", p);
        if (typeof r.value !== "number") throw new ActionError("E_TX_FAILED", t("start.potsFailed"), t("start.potsFailedNext"));
        return r.value;
      };
      const b = await mk({ name: t("pot.kind.bills"), icon: "bill", color: "sun", kind: "bills" });
      const s = await mk({ name: t("pot.kind.autosave"), icon: "savings", color: "mint", kind: "autosave" });
      const r = await mk({ name: t("start.rainy"), icon: "rainy", color: "violet", kind: "locked" });
      const g = await mk({ name: goal.trim() || t("pot.kind.goal"), icon: "goal", color: "rose", kind: "goal" });
      await exec("setSplits", [
        { pot_id: b, mode: "percent" as const, value: String(bills * 100) },
        { pot_id: s, mode: "percent" as const, value: String(savings * 100) },
        { pot_id: r, mode: "percent" as const, value: String(rainy * 100) },
        { pot_id: g, mode: "percent" as const, value: String(goalPct * 100) },
      ].filter((r) => r.value !== "0"));
      onDone();
    } catch (e) { setErr(explain(e)); } finally { setBusy(false); }
  };

  const row = (label: string, v: number, set: (n: number) => void, icon: "bill" | "savings" | "goal" | "locked", color: "sun" | "mint" | "rose" | "violet", subtitle?: string) => (
    <ListRow icon={icon} color={color} title={label} subtitle={subtitle} trailing={editing ? (
      <input type="number" min={0} max={100} value={v} aria-label={label} className="oi-input" style={{ width: 64, height: 36, textAlign: "right", border: "1px solid var(--line)", borderRadius: 10, padding: "0 8px" }}
        onChange={(e) => set(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} />
    ) : <span className="oi-num" style={{ fontWeight: 600 }}>{v}%</span>} />
  );

  return (
    <div className="oi-stack" data-testid="first-run">
      <div>
        <h1 className="oi-h1">{t("start.potsTitle")}</h1>
        <p className="oi-muted" style={{ margin: "8px 0 0" }}>{t("start.potsSub")}</p>
      </div>
      <GroupedList label={t("start.potsTitle")}>
        <ListRow icon="spend" color="blue" title={t("pot.kind.flex")} subtitle={t("plan.spendRest")} trailing={<span className="oi-num" style={{ fontWeight: 600 }}>{spend}%</span>} />
        {row(t("pot.kind.bills"), bills, setBills, "bill", "sun")}
        {row(t("pot.kind.autosave"), savings, setSavings, "savings", "mint")}
        {row(t("start.rainy"), rainy, setRainy, "locked", "violet", t("start.rainySub"))}
        {row(goal || t("pot.kind.goal"), goalPct, setGoalPct, "goal", "rose")}
      </GroupedList>
      <Input label={t("start.goalLabel")} value={goal} onChange={(e) => setGoal(e.target.value.slice(0, 32))} hint={t("start.goalHint")} />
      <Note tone="info">{preview}</Note>
      {spend < 0 && <p className="oi-error-text" role="alert" style={{ margin: 0 }}>{t("start.over100")}</p>}
      {err && <div role="alert"><Note tone="danger" title={err.title}>{t("error.next", { next: err.next })}</Note></div>}
      <Button block size="lg" loading={busy} disabled={spend < 0} onClick={accept} data-testid="first-run-accept">{t("start.acceptPots")}</Button>
      <Button block variant="ghost" onClick={() => setEditing((v) => !v)}>{editing ? t("common.done") : t("start.editPots")}</Button>
      <Button block variant="ghost" size="sm" onClick={onDone}>{t("start.skipPots")}</Button>
    </div>
  );
}
