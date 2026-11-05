"use client";
import { Badge, Button, CopyField, EmptyState, GroupedList, ListRow, Note, SectionTitle, Sheet, useToast } from "@oiko/ui";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ConfirmSheet } from "@/components/app/ConfirmSheet";
import { PageHeader } from "@/components/app/PageHeader";
import { LoadError, PageSkeleton } from "@/components/app/States";
import { explain } from "@/lib/actions";
import { fmt, fmtDate, fmtToken } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { downloadInvoicesCsv, invoiceUrl, setInvoiceState, STATUS_TONE, useInvoices, type OwnerInvoice } from "@/lib/invoices";
import { useSession } from "@/lib/session";

const day = (iso: string) => Date.parse(iso.length === 10 ? iso + "T00:00:00Z" : iso);
const short = (iso: string) => fmtDate(day(iso), { day: "numeric", month: "short" });

export function InvoicesScreen() {
  const t = useT();
  const toast = useToast();
  const { session } = useSession();
  const q = useInvoices();
  const params = useSearchParams();
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // /invoices?open=<id> (after creating one) opens its sheet.
  const want = params.get("open");
  useEffect(() => { if (want) setOpenId(want); }, [want]);

  if (q.error && !q.data) return <div className="oi-col oi-page"><PageHeader title={t("nav.invoices")} /><LoadError error={q.error} onRetry={q.refresh} /></div>;
  if (!q.data || !session) return <div className="oi-col"><PageSkeleton rows={5} /></div>;
  const list = q.data;
  const outstanding = list.filter((i) => ["open", "overdue", "pending", "refunded"].includes(i.status)).reduce((a, i) => a + BigInt(i.remaining), 0n);
  const received = list.reduce((a, i) => a + BigInt(i.received), 0n);
  const open = list.find((i) => i.id === openId) ?? null;

  const exportCsv = async () => {
    setExporting(true);
    try { await downloadInvoicesCsv(session); toast.show({ message: t("inv.exported"), tone: "success" }); }
    catch (e) { const f = explain(e); toast.show({ message: `${f.title} ${f.next}`, tone: "danger" }); }
    finally { setExporting(false); }
  };

  return (
    <div className="oi-col oi-page" data-testid="invoices">
      <PageHeader title={t("nav.invoices")} sub={t("inv.sub")}
        action={<Link href="/invoices/new" className="oi-btn oi-btn--sm" data-testid="invoice-new"><span className="oi-btn__label">{t("inv.new")}</span></Link>} />
      {list.length > 0 && (
        <div className="oi-summary-chips">
          <div className="oi-summary-chip"><span>{t("inv.outstanding")}</span><span data-testid="invoices-outstanding">{fmt(outstanding)} <small className="oi-muted" style={{ fontWeight: 500 }}>USDC + USDT</small></span></div>
          <div className="oi-summary-chip"><span>{t("inv.received")}</span><span>{fmt(received)} <small className="oi-muted" style={{ fontWeight: 500 }}>USDC + USDT</small></span></div>
        </div>
      )}
      {list.length === 0 ? (
        <div className="oi-card"><EmptyState icon="work" color="blue" title={t("inv.emptyTitle")} body={t("inv.emptyBody")} action={<Link className="oi-btn" href="/invoices/new">{t("inv.new")}</Link>} /></div>
      ) : (
        <GroupedList label={t("nav.invoices")}>
          {list.map((i) => (
            <ListRow key={i.id} data-testid={`invoice-row-${i.number}`} onClick={() => setOpenId(i.id)} icon="work" color={i.status === "paid" ? "mint" : i.status === "overdue" || i.status === "refunded" ? "rose" : "blue"}
              title={i.client.name}
              subtitle={`${i.number} · ${i.status === "paid" && i.paidAt ? t("inv.paidOn", { date: short(i.paidAt) }) : t("inv.due", { date: short(i.dueDate) })}`}
              amount={fmtToken(i.total, i.token)} meta={<Badge tone={STATUS_TONE[i.status]}>{t(`inv.status.${i.status}`)}</Badge>} />
          ))}
        </GroupedList>
      )}
      {list.length > 0 && (
        <GroupedList label={t("inv.export")}>
          <ListRow icon="export" color="stone" title={t("inv.export")} subtitle={exporting ? t("inv.exporting") : t("settings.exportInvoicesSub")} onClick={exportCsv} chevron data-testid="invoices-export" />
        </GroupedList>
      )}
      {open && <InvoiceSheet inv={open} onClose={() => { setOpenId(null); if (want) router.replace("/invoices"); }} />}
    </div>
  );
}

function InvoiceSheet({ inv, onClose }: { inv: OwnerInvoice; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const { session } = useSession();
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => { setCanShare(typeof navigator.share === "function"); }, []);
  const link = invoiceUrl(inv.id);
  const T = inv.token.toUpperCase();
  const canCancel = !["paid", "cancelled"].includes(inv.status) && !inv.inFlight;
  const publish = async () => {
    if (!session) return;
    setBusy(true);
    try { await setInvoiceState(session, inv.id, "open"); toast.show({ message: t("inv.published"), tone: "success" }); }
    catch (e) { const f = explain(e); toast.show({ message: `${f.title} ${f.next}`, tone: "danger" }); }
    finally { setBusy(false); }
  };
  return (
    <>
      <Sheet open={!cancelling} onOpenChange={(v) => !v && onClose()} title={`${inv.number} · ${inv.client.name}`} closeLabel={t("common.close")} testId="invoice-sheet">
        <div className="oi-stack-sm">
          <div className="oi-row" style={{ justifyContent: "space-between" }}>
            <span className="oi-num" style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em" }}>{fmt(inv.total)} <span style={{ fontSize: 16 }}>{T}</span></span>
            <Badge tone={STATUS_TONE[inv.status]} data-testid="invoice-status">{t(`inv.status.${inv.status}`)}</Badge>
          </div>
          <p className="oi-small oi-muted" style={{ margin: 0 }}>{t(`inv.statusHelp.${inv.status}`)}</p>
          {BigInt(inv.received) > 0n && (
            <p className="oi-small" style={{ margin: 0 }}>{t("inv.receivedOf", { received: fmtToken(inv.received, inv.token), total: fmtToken(inv.total, inv.token) })} · {t("inv.fee")} {fmtToken(inv.fee, inv.token)}</p>
          )}
        </div>
        {inv.state === "draft" ? (
          <Button block size="lg" loading={busy} onClick={publish} data-testid="invoice-publish">{t("inv.publish")}</Button>
        ) : inv.status !== "cancelled" && (
          <div className="oi-stack-sm">
            <CopyField label={t("inv.link")} value={link} copyLabel={t("common.copy")} copiedLabel={t("common.copied")} testId="invoice-link" />
            <p className="oi-micro oi-muted" style={{ margin: 0 }}>{t("inv.linkHint")}</p>
            <div className="oi-row" style={{ gap: 8 }}>
              <a className="oi-btn oi-btn--secondary" style={{ flex: 1 }} href={`/i/${inv.id}`} target="_blank" rel="noopener noreferrer" data-testid="invoice-view"><span className="oi-btn__label">{t("inv.open")}</span></a>
              {canShare && <Button variant="secondary" icon="share" style={{ flex: 1 }} onClick={() => navigator.share({ title: `${inv.number}`, text: t("inv.shareText", { number: inv.number, from: inv.fromName, amount: fmtToken(inv.remaining, inv.token) }), url: link }).catch(() => undefined)}>{t("inv.share")}</Button>}
            </div>
          </div>
        )}
        <section className="oi-stack-sm" aria-labelledby="inv-pay">
          <SectionTitle id="inv-pay" as="h3">{t("inv.payments")}</SectionTitle>
          {inv.payments.filter((p) => p.status !== "PENDING_DEPOSIT" && p.status !== "FAILED").length === 0 ? <p className="oi-small oi-muted" style={{ margin: 0 }}>{t("inv.noPayments")}</p> : (
            <GroupedList label={t("inv.payments")}>
              {inv.payments.filter((p) => p.status !== "PENDING_DEPOSIT" && p.status !== "FAILED").map((p, k) => (
                <ListRow key={k} icon={p.status === "SUCCESS" ? "success" : p.status === "REFUNDED" ? "error" : "pending"} color={p.status === "SUCCESS" ? "mint" : p.status === "REFUNDED" ? "rose" : "sun"}
                  title={p.status === "SUCCESS" ? fmtToken(p.amountOut, inv.token) : p.status === "REFUNDED" ? t("pay.st.refunded") : t("pay.st.delivering")}
                  subtitle={`${t("inv.payFrom", { place: p.originLabel })} · ${fmtDate(Date.parse(p.completedAt ?? p.updatedAt), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}
                  trailing={p.transactions[0]?.url ? <a className="oi-small" href={p.transactions[0].url} target="_blank" rel="noopener noreferrer" data-testid="invoice-tx">{t("inv.viewTx")}</a> : undefined} />
              ))}
            </GroupedList>
          )}
        </section>
        {!inv.editable && inv.status !== "cancelled" && inv.status !== "paid" && <Note tone="info">{t("inv.lockedEdit")}</Note>}
        {inv.editable && <Link className="oi-btn oi-btn--secondary oi-btn--block" href={`/invoices/new?edit=${inv.id}`} data-testid="invoice-edit"><span className="oi-btn__label">{t("inv.edit")}</span></Link>}
        {canCancel && <Button block variant="ghost" onClick={() => setCancelling(true)} data-testid="invoice-cancel">{t("inv.cancel")}</Button>}
      </Sheet>
      {cancelling && session && (
        <ConfirmSheet open onOpenChange={(v) => { if (!v) setCancelling(false); }} title={t("inv.cancel")} variant="danger" testId="invoice-cancel-confirm"
          sentence={t("inv.cancelSentence", { number: inv.number, client: inv.client.name })} confirmLabel={t("inv.cancel")} successText={t("inv.cancelled")}
          onConfirm={async () => { await setInvoiceState(session, inv.id, "cancelled"); }} />
      )}
    </>
  );
}
