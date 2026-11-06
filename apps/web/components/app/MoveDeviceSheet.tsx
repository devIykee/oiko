"use client";
// Settings → "Move to another device": encrypts this browser's sign-in keys with a passphrase and shows the code
// as a QR (opens /start on the other device), a copyable string and a .txt download. Nothing is sent to the server.
import { Button, CopyField, Input, Note, QRCodeCard, Sheet, useToast } from "@oiko/ui";
import { useState } from "react";
import { explain } from "@/lib/actions";
import { downloadText } from "./download";
import { useT } from "@/lib/i18n";
import { MIN_PASSPHRASE, encryptMoveCode } from "@/lib/moveCode";
import { useSession } from "@/lib/session";

export function MoveDeviceSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const t = useT();
  const toast = useToast();
  const { session } = useSession();
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!session) return null;

  const close = (v: boolean) => {
    onOpenChange(v);
    if (!v) { setPass(""); setPass2(""); setCode(null); setErr(null); }
  };
  const tooShort = pass.length > 0 && pass.length < MIN_PASSPHRASE;
  const mismatch = pass2.length > 0 && pass !== pass2;
  const make = async () => {
    setBusy(true); setErr(null);
    try { setCode(await encryptMoveCode(session, pass)); }
    catch (e) { const f = explain(e); setErr(`${f.title} ${f.next}`); }
    finally { setBusy(false); }
  };
  const download = () => {
    if (!code) return;
    const text = `${t("device.fileIntro", { account: session.accountId })}\n\n${code}\n\n${t("device.fileHow", { url: `${window.location.origin}/start` })}\n`;
    downloadText(`oiko-${session.name}-sign-in-code.txt`, text);
  };
  const link = code ? `${typeof window !== "undefined" ? window.location.origin : ""}/start#move=${code}` : "";

  return (
    <Sheet open={open} onOpenChange={close} title={t("device.title")} description={t("device.sub")} testId="move-sheet">
      {!code ? (
        <div className="oi-stack">
          <Note tone="warning">{session.ownerKey ? t("device.warnOwner") : t("device.warnApp")}</Note>
          <Input label={t("device.pass")} type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)}
            hint={t("device.passHint", { n: MIN_PASSPHRASE })} error={tooShort ? t("device.passHint", { n: MIN_PASSPHRASE }) : undefined} data-testid="move-pass" />
          <Input label={t("device.pass2")} type="password" autoComplete="new-password" value={pass2} onChange={(e) => setPass2(e.target.value)}
            error={mismatch ? t("device.mismatch") : undefined} data-testid="move-pass2" />
          {err && <div role="alert"><Note tone="danger">{err}</Note></div>}
          <Button block size="lg" loading={busy} disabled={pass.length < MIN_PASSPHRASE || pass !== pass2} onClick={make} data-testid="move-make">{t("device.make")}</Button>
        </div>
      ) : (
        <div className="oi-stack" data-testid="move-code">
          <QRCodeCard value={link} label={t("device.qr")} caption={t("device.qrCaption")} />
          <CopyField label={t("device.code")} value={code} display={`${code.slice(0, 24)}…${code.slice(-8)}`} copyLabel={t("common.copy")} copiedLabel={t("common.copied")}
            onCopied={() => toast.show({ message: t("device.copied") })} testId="move-copy" />
          <Button variant="secondary" block onClick={download} data-testid="move-download">{t("device.download")}</Button>
          <Note>{t("device.how")}</Note>
        </div>
      )}
    </Sheet>
  );
}
