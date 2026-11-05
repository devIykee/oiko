"use client";
import { Badge, Button, EmptyState, Loading, Note, Skeleton } from "@oiko/ui";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { PayFlow, type PayStatus } from "@/components/app/PayFlow";
import { explain } from "@/lib/actions";
import { fmt, fmtDate, fmtToken } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { STATUS_TONE, usePublicInvoice, type PublicInvoice } from "@/lib/invoices";
import { invalidate } from "@/lib/query";
import "./invoice.css";

const s = {
  col: "inv-col",
  desc: "inv-desc",
  doc: "inv-doc",
  grand: "inv-grand",
  head: "inv-head",
  hideSm: "inv-hide-sm",
  k: "inv-k",
  meta: "inv-meta",
  mobileQty: "inv-mobile-qty",
  noPrint: "inv-no-print",
  note: "inv-note",
  num: "inv-num",
  parties: "inv-parties",
  pay: "inv-pay",
  sub: "inv-sub",
  table: "inv-table",
  title: "inv-title",
  toolbar: "inv-toolbar",
  totals: "inv-totals",
  txs: "inv-txs",
  v: "inv-v",
} as const;

const date = (iso: string) => fmtDate(Date.parse(iso.length === 10 ? iso + "T00:00:00Z" : iso), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" } as Intl.DateTimeFormatOptions);

export function InvoiceScreen() {
  const t = useT();
  const { id: raw } = useParams<{ id: string }>();
  const id = decodeURIComponent(raw);
  const q = usePublicInvoice(id);
  // The amount is captured when paying starts, so the flow stays put while the invoice status changes underneath it.
  const [paying, setPaying] = useState<string | null>(null);
  const onStatus = useCallback((st: PayStatus) => { if (st !== "PENDING_DEPOSIT") invalidate(`invoice:${id}`); }, [id]);

  if (q.error && !q.data) {
    const nf = (q.error as { code?: string }).code === "E_NOT_FOUND";
    return <Frame><EmptyState icon="warning" title={nf ? t("inv.doc.notFound") : t("pay.loadError")} body={nf ? t("inv.doc.notFoundBody") : explain(q.error).next} /></Frame>;
  }
  if (!q.data) {
    return <Frame><Loading label={t("common.loading")}><div className="oi-stack"><Skeleton height={40} width={200} /><Skeleton height={320} radius={24} /><Skeleton height={56} radius={16} /></div></Loading></Frame>;
  }
  const inv = q.data;
  const T = inv.token.toUpperCase();
  const display = inv.ownerName.charAt(0).toUpperCase() + inv.ownerName.slice(1);
  const partial = BigInt(inv.paid) > 0n && BigInt(inv.remaining) > 0n;

  return (
    <Frame print={<Button size="sm" variant="secondary" onClick={() => window.print()} data-testid="invoice-print">{t("inv.doc.print")}</Button>}>
      <article className={s.doc} data-testid="invoice-doc" aria-labelledby="inv-title">
        <div className={s.head}>
          <div>
            <h1 id="inv-title" className={s.title}>{t("inv.doc.title")}</h1>
            <p className={s.sub}>{inv.number}</p>
          </div>
          <Badge tone={STATUS_TONE[inv.status]} data-testid="invoice-public-status">{t(`inv.status.${inv.status}`)}</Badge>
        </div>
        <div className={s.parties}>
          <div>
            <p className={s.k}>{t("inv.doc.from")}</p>
            <p className={s.v}>{inv.fromName}</p>
            <p className={s.sub}>{inv.owner}</p>
          </div>
          <div>
            <p className={s.k}>{t("inv.doc.to")}</p>
            <p className={s.v}>{inv.client.name}</p>
          </div>
        </div>
        <div className={s.meta}>
          <div><p className={s.k}>{t("inv.doc.issued")}</p><p className={s.v}>{date(inv.issueDate)}</p></div>
          <div><p className={s.k}>{t("inv.doc.due")}</p><p className={s.v}>{date(inv.dueDate)}</p></div>
          <div className={s.hideSm}><p className={s.k}>{t("inv.doc.number")}</p><p className={s.v}>{inv.number}</p></div>
        </div>
        <table className={s.table}>
          <thead>
            <tr>
              <th scope="col">{t("inv.doc.description")}</th>
              <th scope="col" className={`${s.num} ${s.hideSm}`}>{t("inv.doc.qty")}</th>
              <th scope="col" className={`${s.num} ${s.hideSm}`}>{t("inv.doc.unit")} ({T})</th>
              <th scope="col" className={s.num}>{t("inv.doc.amount")} ({T})</th>
            </tr>
          </thead>
          <tbody>
            {inv.items.map((i, k) => (
              <tr key={k}>
                <td className={s.desc}>{i.description}<div className={s.mobileQty}>{i.quantity} × {fmt(i.unitPrice)} {T}</div></td>
                <td className={`${s.num} ${s.hideSm}`}>{i.quantity}</td>
                <td className={`${s.num} ${s.hideSm}`}>{fmt(i.unitPrice)}</td>
                <td className={s.num}>{fmt(i.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={s.totals}>
          {BigInt(inv.paid) > 0n && <div><span className="oi-muted">{t("inv.doc.paid")}</span><span>{fmtToken(inv.paid, inv.token)}</span></div>}
          {partial && <div><span className="oi-muted">{t("inv.doc.left")}</span><span>{fmtToken(inv.remaining, inv.token)}</span></div>}
          <div className={s.grand}><span>{t("inv.doc.total")}</span><span data-testid="invoice-public-total">{fmtToken(inv.total, inv.token)}</span></div>
        </div>
        {inv.note && <div><p className={s.k}>{t("inv.doc.note")}</p><p className={s.note}>{inv.note}</p></div>}
        {inv.transactions.length > 0 && (
          <div>
            <p className={s.k}>{t("inv.doc.txs")}{inv.paidAt ? ` · ${t("inv.paidOn", { date: date(inv.paidAt) })}` : ""}</p>
            <div className={s.txs} data-testid="invoice-public-txs">
              {inv.transactions.map((x) => x.url ? <a key={x.hash} href={x.url} target="_blank" rel="noopener noreferrer">{t("inv.viewTx")} · {x.hash.slice(0, 10)}…</a> : <span key={x.hash} className="oi-muted">{x.hash}</span>)}
            </div>
          </div>
        )}
      </article>

      <div className={s.noPrint}>
        <StatusNote inv={inv} display={display} partial={partial} />
      </div>

      {(inv.payable || paying) && (
        <section className={`${s.pay} ${s.noPrint}`} aria-label={t("inv.doc.pay")} data-testid="invoice-pay">
          {!paying ? (
            <Button block size="lg" onClick={() => setPaying(inv.remaining)} data-testid="invoice-pay-start">{t("inv.doc.pay")} · {fmtToken(inv.remaining, inv.token)}</Button>
          ) : (
            <div className="oi-stack">
              <h2 className="oi-h2" style={{ fontSize: 24 }}>{t("inv.doc.payTitle", { amount: fmtToken(paying, inv.token) })}</h2>
              <PayFlow name={inv.ownerName} display={display} recipient={inv.owner} fixed={{ units: paying, token: inv.token }} invoiceId={inv.id}
                onStatus={onStatus} doneTitle={t("inv.doc.doneTitle")} />
            </div>
          )}
        </section>
      )}
      <p className={`oi-micro oi-muted ${s.noPrint}`} style={{ textAlign: "center", margin: 0 }}>{t("inv.doc.footer", { account: inv.owner })}</p>
    </Frame>
  );
}

function StatusNote({ inv, display, partial }: { inv: PublicInvoice; display: string; partial: boolean }) {
  const t = useT();
  if (inv.status === "paid") return <Note tone="success" title={t("inv.doc.paidBanner")}>{inv.paidAt ? t("inv.paidOn", { date: date(inv.paidAt) }) : ""}</Note>;
  if (inv.status === "cancelled") return <Note tone="neutral">{t("inv.doc.cancelledBanner", { name: display })}</Note>;
  if (inv.inFlight) return <div aria-live="polite"><Note tone="info">{t("inv.doc.pendingBanner")}</Note></div>;
  if (partial) return <Note tone="warning">{t("inv.doc.partialBanner", { paid: fmtToken(inv.paid, inv.token), left: fmtToken(inv.remaining, inv.token) })}</Note>;
  if (inv.status === "refunded") return <Note tone="warning">{t("inv.doc.refundedBanner")}</Note>;
  if (inv.status === "overdue") return <Note tone="warning">{t("inv.doc.overdueBanner")}</Note>;
  return null;
}

function Frame({ children, print }: { children: React.ReactNode; print?: React.ReactNode }) {
  return (
    <div className={s.col} data-testid="invoice-public">
      <header className={`${s.toolbar} ${s.noPrint}`}>
        <Link href="/" aria-label="Oiko" style={{ color: "var(--ink)" }}><Logo variant="wordmark" height={22} /></Link>
        {print}
      </header>
      {children}
    </div>
  );
}
