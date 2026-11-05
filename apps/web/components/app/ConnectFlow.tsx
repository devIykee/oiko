"use client";
import { Button, CopyField, Input, Note, QRCodeCard, ScopeList, SegmentedControl, Sheet, Toggle, ListRow, GroupedList } from "@oiko/ui";
import { encodeConnectionString, generateKeyPair, type AgentKind, type Overview, type Scope } from "@oiko/sdk";
import { useEffect, useState } from "react";
import { explain, useMoney } from "@/lib/actions";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { consentItems, draftToPolicy, type Draft } from "./agentPolicy";
import { CounterpartyBadge } from "./CounterpartyBadge";

type Step = "setup" | "consent" | "secret";

/**
 * Connect an agent: settings -> consent in plain words -> (owner key) add_agent -> one-time connection string + QR + MCP snippet.
 * When `agentPublicKey` is given (agent-initiated /connect), the agent already holds its secret, so no string is shown.
 */
export function ConnectFlow({ open, onOpenChange, initial, overview, agentPublicKey, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; initial: Draft; overview: Overview; agentPublicKey?: string; onDone?: (publicKey: string) => void;
}) {
  const t = useT();
  const { session } = useSession();
  const { exec } = useMoney();
  const [d, setD] = useState<Draft>(initial);
  const [step, setStep] = useState<Step>("setup");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ title: string; next: string } | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  useEffect(() => { if (open) { setD(initial); setStep(agentPublicKey ? "consent" : "setup"); setSecret(null); setErr(null); } }, [open, initial, agentPublicKey]);
  useEffect(() => { setOrigin(window.location.origin); }, []);

  const policy = draftToPolicy(d);
  const act = d.scopes.includes("act");
  const capsOk = !act || (Number(d.perTx) > 0 && Number(d.perTx) <= Number(d.daily) && Number(d.daily) <= Number(d.weekly));
  const toggleScope = (s: Scope, on: boolean) => setD({ ...d, scopes: on ? [...new Set([...d.scopes, s])] : d.scopes.filter((x) => x !== s) });
  const toggleAction = (a: AgentKind, on: boolean) => setD({ ...d, actions: on ? [...new Set([...d.actions, a])] : d.actions.filter((x) => x !== a) });

  const connect = async () => {
    setBusy(true); setErr(null);
    try {
      const kp = agentPublicKey ? null : generateKeyPair();
      const pk = agentPublicKey ?? kp!.publicKey;
      await exec("addAgent", pk, policy);
      if (kp && session) setSecret(encodeConnectionString({ api: origin, vault: session.vaultId, sk: kp.secretKey }));
      setStep("secret");
      onDone?.(pk);
    } catch (e) { setErr(explain(e)); } finally { setBusy(false); }
  };

  const mcp = secret ? JSON.stringify({ mcpServers: { oiko: { command: "npx", args: ["-y", "@oiko/mcp"], env: { OIKO_CONNECTION: secret } } } }, null, 2) : "";
  const title = step === "setup" ? t("agents.setupTitle") : step === "consent" ? t("agents.consentTitle", { name: d.name || t("agents.yourAgent") }) : t("agents.connectedTitle");

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} closeLabel={t("common.close")} dismissible={!busy} testId="agent-connect"
      back={step === "consent" && !agentPublicKey ? { label: t("common.back"), onClick: () => setStep("setup") } : undefined}
      footer={
        step === "setup" ? <Button block size="lg" disabled={!d.name.trim() || !capsOk || d.scopes.length === 0} onClick={() => setStep("consent")} data-testid="agent-continue">{t("common.continue")}</Button>
        : step === "consent" ? <Button block size="lg" loading={busy} onClick={connect} data-testid="agent-allow">{t("agents.allow")}</Button>
        : <Button block size="lg" onClick={() => onOpenChange(false)}>{t("common.done")}</Button>
      }>
      {step === "setup" && (
        <>
          <Input label={t("agents.name")} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value.slice(0, 40) })} placeholder={t("agents.namePlaceholder")} />
          <GroupedList label={t("agents.permissions")}>
            <ListRow icon="show" color="blue" title={t("agents.scope.read")} subtitle={t("agents.scope.readSub")} trailing={<Toggle checked={d.scopes.includes("read")} onChange={(v) => toggleScope("read", v)} label={t("agents.scope.read")} />} />
            <ListRow icon="proposal" color="sun" title={t("agents.scope.propose")} subtitle={t("agents.scope.proposeSub")} trailing={<Toggle checked={d.scopes.includes("propose")} onChange={(v) => toggleScope("propose", v)} label={t("agents.scope.propose")} />} />
            <ListRow icon="agents" color="violet" title={t("agents.scope.act")} subtitle={t("agents.scope.actSub")} trailing={<Toggle checked={act} onChange={(v) => toggleScope("act", v)} label={t("agents.scope.act")} data-testid="agent-scope-act" />} />
          </GroupedList>
          {act && (
            <>
              <GroupedList label={t("agents.actions")}>
                <ListRow icon="send" color="stone" title={t("agents.kind.pay")} trailing={<Toggle checked={d.actions.includes("pay")} onChange={(v) => toggleAction("pay", v)} label={t("agents.kind.pay")} />} />
                <ListRow icon="move" color="stone" title={t("agents.kind.move")} trailing={<Toggle checked={d.actions.includes("move_between_pots")} onChange={(v) => toggleAction("move_between_pots", v)} label={t("agents.kind.move")} />} />
                <ListRow icon="savings" color="stone" title={t("agents.kind.save")} trailing={<Toggle checked={d.actions.includes("save")} onChange={(v) => toggleAction("save", v)} label={t("agents.kind.save")} />} />
              </GroupedList>
              {d.actions.includes("pay") && (
                <Input label={t("agents.allowlist")} value={d.allowlist.join(", ")} onChange={(e) => setD({ ...d, allowlist: e.target.value.split(/[,\s]+/).filter(Boolean) })}
                  hint={t("agents.allowlistHint")} placeholder="citypower.near, sam.oiko.near" autoComplete="off" spellCheck={false} />
              )}
              {d.actions.includes("pay") && d.allowlist.slice(0, 10).map((acct) => <CounterpartyBadge key={acct} accountId={acct} debounceMs={600} testId={`allowlist-check-${acct}`} />)}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                <Input label={t("agents.perTx")} value={d.perTx} onChange={(e) => setD({ ...d, perTx: e.target.value.replace(/[^0-9.]/g, "") })} inputMode="decimal" />
                <Input label={t("agents.daily")} value={d.daily} onChange={(e) => setD({ ...d, daily: e.target.value.replace(/[^0-9.]/g, "") })} inputMode="decimal" />
                <Input label={t("agents.weekly")} value={d.weekly} onChange={(e) => setD({ ...d, weekly: e.target.value.replace(/[^0-9.]/g, "") })} inputMode="decimal" />
              </div>
              <p className={capsOk ? "oi-hint" : "oi-error-text"} style={{ margin: 0 }}>{t("agents.capsHint")}</p>
            </>
          )}
          <SegmentedControl label={t("agents.expires")} value={String(d.days)} onChange={(v) => setD({ ...d, days: Number(v) })}
            items={[{ value: "7", label: t("agents.days", { n: 7 }) }, { value: "30", label: t("agents.days", { n: 30 }) }, { value: "90", label: t("agents.days", { n: 90 }) }]} />
        </>
      )}
      {step === "consent" && (
        <>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 17 }}>{t("agents.headline")}</p>
          <ScopeList label={t("agents.permissions")} items={consentItems(policy, t)} />
          {d.actions.includes("pay") && d.allowlist.slice(0, 10).map((acct) => <CounterpartyBadge key={acct} accountId={acct} testId={`consent-allowlist-check-${acct}`} />)}
          <p className="oi-small oi-muted" style={{ margin: 0 }}>{t("agents.expiresOn", { n: d.days })}</p>
          <Note tone="warning" title={t("agents.verifyTitle")}>{t("agents.verifyBody")}</Note>
          {err && <div role="alert"><Note tone="danger" title={err.title}>{t("error.next", { next: err.next })}</Note></div>}
        </>
      )}
      {step === "secret" && (
        secret ? (
          <>
            <Note tone="warning" title={t("agents.onceTitle")}>{t("agents.onceBody")}</Note>
            <CopyField label={t("agents.connectionString")} value={secret} display={`${secret.slice(0, 28)}…`} copyLabel={t("common.copy")} copiedLabel={t("common.copied")} testId="agent-secret" />
            <QRCodeCard value={secret} label={t("agents.connectionString")} size={200} caption={t("agents.qrCaption")} />
            <div className="oi-label">{t("agents.mcpTitle")}</div>
            <pre className="oi-code" data-testid="agent-mcp">{mcp}</pre>
            <CopyField label={t("agents.mcpTitle")} value={mcp} display={t("agents.mcpCopy")} mono={false} copyLabel={t("common.copy")} copiedLabel={t("common.copied")} />
          </>
        ) : <Note tone="success" title={t("agents.connectedTitle")}>{t("agents.connectedAgentHolds")}</Note>
      )}
    </Sheet>
  );
}
