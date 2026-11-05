"use client";
import { Button, CopyField, Icon, Note, QRCodeCard } from "@oiko/ui";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { TelegramGlyph, WhatsAppGlyph, XGlyph } from "@/components/icons/brands";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";

export function ReceiveScreen() {
  const t = useT();
  const { session } = useSession();
  const [origin, setOrigin] = useState("");
  const [canShare, setCanShare] = useState(false);
  useEffect(() => { setOrigin(window.location.origin); setCanShare(typeof navigator.share === "function"); }, []);
  if (!session) return null;
  const link = `${origin}/pay/${session.name}`;
  const display = `${origin.replace(/^https?:\/\//, "")}/pay/${session.name}`;
  const msg = t("receive.shareText", { link });
  const enc = encodeURIComponent(msg);

  return (
    <div className="oi-col oi-page" data-testid="receive">
      <PageHeader title={t("receive.title")} back="/home" />
      <div className="oi-card oi-stack" style={{ alignItems: "center", textAlign: "center" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 22, letterSpacing: "-0.01em" }}>{session.accountId}</div>
          <div className="oi-small oi-muted">{t("receive.sub")}</div>
        </div>
        {origin && <QRCodeCard value={link} label={t("receive.qrLabel")} size={220} caption={t("receive.qrCaption")} />}
      </div>
      <CopyField label={t("receive.yourLink")} value={link} display={display} mono={false} copyLabel={t("common.copy")} copiedLabel={t("common.copied")} testId="pay-link" />
      {canShare && <Button block size="lg" variant="accent" icon="share" onClick={() => navigator.share({ title: "Oiko", text: msg, url: link }).catch(() => undefined)} data-testid="receive-share">{t("common.share")}</Button>}
      <div className="oi-share" role="group" aria-label={t("receive.shareWith")}>
        <a className="oi-share__btn" href={`https://wa.me/?text=${enc}`} target="_blank" rel="noopener noreferrer"><WhatsAppGlyph size={24} style={{ color: "#25D366" }} />WhatsApp</a>
        <a className="oi-share__btn" href={`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(t("receive.shareShort"))}`} target="_blank" rel="noopener noreferrer"><TelegramGlyph size={24} style={{ color: "#26A5E4" }} />Telegram</a>
        <a className="oi-share__btn" href={`https://x.com/intent/post?text=${enc}`} target="_blank" rel="noopener noreferrer"><XGlyph size={22} />X</a>
      </div>
      <Note tone="info" title={t("receive.howTitle")}>{t("receive.howBody")}</Note>
      <details className="oi-card">
        <summary style={{ cursor: "pointer", fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="chevronDown" size={14} /> {t("receive.permanent")}
        </summary>
        <div className="oi-stack-sm" style={{ marginTop: 12 }}>
          <Note tone="warning">{t("receive.permanentWarn")}</Note>
          <CopyField label={t("receive.accountName")} value={session.accountId} copyLabel={t("common.copy")} copiedLabel={t("common.copied")} />
          <p className="oi-small oi-muted" style={{ margin: 0 }}>{t("receive.permanentOther")}</p>
        </div>
      </details>
    </div>
  );
}
