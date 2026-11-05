"use client";
// Hosted agent (Grok, ChatGPT, Claude.ai): the browser signs ONE request with the brand-new agent key it just made
// (POST /api/agent/session) and shows a short-lived MCP link. The key itself never leaves this page.
import { Button, CopyField, Note, useToast } from "@oiko/ui";
import { gatewayAuthHeader } from "@oiko/sdk";
import { useState } from "react";
import { isFixtureMode } from "@/lib/fixtures/mode";
import { useT } from "@/lib/i18n";
import { downloadText } from "./download";

interface Session { token: string; expires_at: string }

export function HostedAgentLink({ secretKey, vault, origin }: { secretKey: string; vault: string; origin: string }) {
  const t = useT();
  const toast = useToast();
  const [s, setS] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const create = async () => {
    setBusy(true); setErr(null);
    try {
      if (isFixtureMode()) { setS({ token: "oikos1.fixture.token", expires_at: new Date(Date.now() + 86_400_000).toISOString() }); return; }
      const path = "/api/agent/session", body = JSON.stringify({ ttl_hours: 24 });
      const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json", authorization: gatewayAuthHeader(secretKey, vault, "POST", path, body) }, body });
      const j = (await r.json().catch(() => ({}))) as Session & { error?: { message?: string } };
      if (!r.ok || !j.token) throw new Error(j.error?.message ?? t("agents.hostedFailed"));
      setS(j);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  if (!s) {
    return (
      <div className="oi-stack-sm" data-testid="hosted-agent">
        <div className="oi-label">{t("agents.hostedTitle")}</div>
        <p className="oi-small oi-muted" style={{ margin: 0 }}>{t("agents.hostedBody")}</p>
        <Button variant="secondary" loading={busy} onClick={create} data-testid="hosted-create">{t("agents.hostedCreate")}</Button>
        {err && <p role="alert" className="oi-error-text" style={{ margin: 0 }}>{err}</p>}
      </div>
    );
  }
  const url = `${origin}/api/mcp/t/${s.token}`;
  const cfg = JSON.stringify({ mcpServers: { oiko: { url: `${origin}/api/mcp`, headers: { Authorization: `Bearer ${s.token}` } } } }, null, 2);
  const until = new Date(s.expires_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  const copied = () => toast.show({ message: t("common.copied"), tone: "success" });
  return (
    <div className="oi-stack-sm" data-testid="hosted-agent">
      <div className="oi-label">{t("agents.hostedTitle")}</div>
      <CopyField label={t("agents.hostedUrl")} value={url} display={`${origin.replace(/^https?:\/\//, "")}/api/mcp/t/${s.token.slice(0, 14)}…`} copyLabel={t("common.copy")} copiedLabel={t("common.copied")} onCopied={copied} testId="hosted-url" />
      <CopyField label={t("agents.hostedConfig")} value={cfg} display={t("agents.hostedConfigDisplay")} mono={false} copyLabel={t("common.copy")} copiedLabel={t("common.copied")} onCopied={copied} />
      <Note tone="info" title={t("agents.hostedUntil", { date: until })}>{t("agents.hostedLimits")}</Note>
      <Button variant="ghost" size="sm" onClick={() => downloadText("oiko-hosted-agent.txt", `${t("agents.hostedUrl")}\n${url}\n\n${t("agents.hostedConfig")}\n${cfg}\n\n${t("agents.hostedUntil", { date: until })}\n${t("agents.hostedLimits")}\n`)}>{t("common.downloadTxt")}</Button>
    </div>
  );
}
