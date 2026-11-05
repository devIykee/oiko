"use client";
import { Button, Note, Sheet, SuccessCheck, useToast } from "@oiko/ui";
import type { TxResult } from "@oiko/sdk";
import { useEffect, useState, type ReactNode } from "react";
import { explain } from "@/lib/actions";
import { useT } from "@/lib/i18n";

/**
 * Every money action ends here: one sentence restating amount, source pot, destination and fees,
 * then Confirm (or a custom control such as HoldToConfirm). Errors say what happened and what to do next.
 */
export function ConfirmSheet({
  open, onOpenChange, title, sentence, details, confirmLabel, onConfirm, successText, variant = "black", control, testId, full, doneDetails, stayOpen,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  sentence: ReactNode;
  details?: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<TxResult | void>;
  successText: string;
  variant?: "black" | "accent" | "danger";
  /** Replace the confirm button (e.g. HoldToConfirm); call `go()` to run. */
  control?: (go: () => void, busy: boolean) => ReactNode;
  testId?: string;
  full?: boolean;
  /** Extra content on the success state (e.g. a transaction link), given the confirm result. */
  doneDetails?: (r: TxResult | void) => ReactNode;
  /** Keep the success state open instead of closing after 1.2 s. */
  stayOpen?: boolean;
}) {
  const t = useT();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ title: string; next: string } | null>(null);
  const [done, setDone] = useState(false);
  const [result, setResult] = useState<TxResult | void>(undefined);

  useEffect(() => { if (open) { setErr(null); setDone(false); setBusy(false); } }, [open]);

  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      setResult(await onConfirm());
      setDone(true);
      toast.show({ message: successText, tone: "success" });
      if (!stayOpen) setTimeout(() => onOpenChange(false), 1200);
    } catch (e) {
      setErr(explain(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} dismissible={!busy} closeLabel={t("common.close")} testId={testId} full={full}
      footer={!done && (control ? control(go, busy) : (
        <Button block size="lg" variant={variant} loading={busy} onClick={go} data-testid={testId ? `${testId}-confirm` : undefined}>{confirmLabel}</Button>
      ))}>
      {done ? (
        <div className="oi-stack" style={{ alignItems: "center", textAlign: "center", padding: "24px 0" }} role="status" aria-live="polite">
          <SuccessCheck />
          <div style={{ fontWeight: 600, fontSize: 18 }}>{successText}</div>
          {doneDetails?.(result)}
        </div>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: 18, fontWeight: 500, lineHeight: 1.4 }} className="oi-pretty" data-testid={testId ? `${testId}-sentence` : undefined}>{sentence}</p>
          {details}
          {err && (
            <div role="alert">
              <Note tone="danger" title={err.title}>{t("error.next", { next: err.next })}</Note>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
