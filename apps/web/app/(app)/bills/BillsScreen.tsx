"use client";
import { Badge, Button, EmptyState, GroupedList, Input, ListRow, Note, SegmentedControl, SelectList, Sheet, Tile } from "@oiko/ui";
import { billStatus, toUnits, type Bill, type Overview, type Token } from "@oiko/sdk";
import Link from "next/link";
import { useState } from "react";
import { BillerPicker } from "@/components/app/BillerPicker";
import { ConfirmSheet } from "@/components/app/ConfirmSheet";
import { CounterpartyBadge } from "@/components/app/CounterpartyBadge";
import { PageHeader } from "@/components/app/PageHeader";
import { LoadError, PageSkeleton } from "@/components/app/States";
import { potById, potColor, potGlyph, potName } from "@/components/app/potmeta";
import { explain, useMoney } from "@/lib/actions";
import { fetchName, useOverview } from "@/lib/data";
import { fmt, fmtDate, fmtToken, parseUnits } from "@/lib/format";
import { useT } from "@/lib/i18n";

const tone = { upcoming: "neutral", due: "warning", paid: "success", missed: "danger" } as const;

export function BillsScreen() {
  const t = useT();
  const ov = useOverview();
  const { exec } = useMoney();
  const [paying, setPaying] = useState<Bill | null>(null);
  const [open, setOpen] = useState<Bill | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Bill | null>(null);

  if (ov.error && !ov.data) return <div className="oi-col oi-page"><LoadError error={ov.error} onRetry={ov.refresh} /></div>;
  if (!ov.data) return <div className="oi-col"><PageSkeleton rows={4} /></div>;
  const o = ov.data;
  const now = Date.now();
  const bills = [...o.bills].map((b) => ({ b, s: billStatus(b, now) })).sort((x, y) => x.s.nextDue.getTime() - y.s.nextDue.getTime());
  const due = bills.filter((x) => x.s.status === "due" || x.s.status === "missed");
  const monthly = o.bills.reduce((a, b) => a + BigInt(b.amount), 0n);
  const billsPot = o.pots.find((p) => p.kind === "bills");

  return (
    <div className="oi-col oi-page" data-testid="bills">
      <PageHeader title={t("nav.bills")} action={<Button size="sm" icon="add" onClick={() => setAdding(true)} data-testid="bill-add">{t("bills.add")}</Button>} />
      <div className="oi-summary-chips">
        <div className="oi-summary-chip"><span>{t("bills.monthly")}</span><span>{fmt(monthly)}</span></div>
        {billsPot && <div className="oi-summary-chip"><span>{t("bills.inPot", { pot: potName(billsPot, t) })}</span><span>{fmt(BigInt(billsPot.balances.usdc) + BigInt(billsPot.balances.usdt))}</span></div>}
      </div>
      {due.map(({ b, s }) => (
        <Note key={b.id} tone={s.status === "missed" ? "danger" : "warning"} title={s.status === "missed" ? t("bills.missedTitle", { name: b.name }) : t("bills.dueTitle", { name: b.name })}>
          {t("bills.dueBody", { amount: fmtToken(b.amount, b.token), date: fmtDate(s.nextDue.getTime()) })}
        </Note>
      ))}
      {bills.length === 0 ? (
        <div className="oi-card"><EmptyState icon="bills" color="sun" title={t("bills.emptyTitle")} body={t("bills.emptyBody")} action={<Button onClick={() => setAdding(true)}>{t("bills.add")}</Button>} /></div>
      ) : (
        <GroupedList label={t("nav.bills")}>
          {bills.map(({ b, s }) => (
            <ListRow key={b.id} data-testid={`bill-row-${b.id}`} onClick={() => setOpen(b)} icon="bill" color="sun" title={b.name}
              subtitle={`${t(`bills.status.${s.status}`)} · ${t("bills.due", { date: fmtDate(s.nextDue.getTime(), { day: "numeric", month: "short" }) })}`}
              amount={fmtToken(b.amount, b.token)} meta={<Badge tone={tone[s.status]}>{t(`bills.status.${s.status}`)}</Badge>} />
          ))}
        </GroupedList>
      )}
      <p className="oi-small oi-muted" style={{ margin: 0 }}>{t("bills.reminders")}</p>

      {open && (
        <Sheet open onOpenChange={(v) => !v && setOpen(null)} title={open.name} closeLabel={t("common.close")}>
          <BillDetail bill={open} o={o} />
          <Button block size="lg" disabled={billStatus(open, now).status === "paid"} onClick={() => { setPaying(open); setOpen(null); }} data-testid={`bill-pay-${open.id}`}>
            {billStatus(open, now).status === "paid" ? t("bills.paidThisMonth") : t("bills.payNow")}
          </Button>
          <Link className="oi-btn oi-btn--secondary oi-btn--block" href={`/agents?template=bill-payer&bill=${open.id}`} data-testid={`bill-agent-${open.id}`}>{t("bills.letAgent")}</Link>
          <Button block variant="ghost" onClick={() => { setRemoving(open); setOpen(null); }}>{t("bills.remove")}</Button>
        </Sheet>
      )}
      {paying && (
        <ConfirmSheet open onOpenChange={(v) => !v && setPaying(null)} title={t("bills.payTitle")} testId="bill-confirm"
          sentence={t("bills.paySentence", { amount: fmtToken(paying.amount, paying.token), name: paying.name, pot: potName(potById(o.pots, paying.pot_id)!, t), payee: paying.payee })}
          confirmLabel={t("bills.pay")} successText={t("bills.paid", { name: paying.name })} onConfirm={() => exec("payBill", paying.id)} />
      )}
      {removing && (
        <ConfirmSheet open onOpenChange={(v) => !v && setRemoving(null)} title={t("bills.remove")} variant="danger"
          sentence={t("bills.removeSentence", { name: removing.name })} confirmLabel={t("bills.remove")} successText={t("bills.removed")}
          onConfirm={() => exec("removeBill", removing.id)} />
      )}
      {adding && <AddBillSheet o={o} onClose={() => setAdding(false)} />}
    </div>
  );
}

function BillDetail({ bill, o }: { bill: Bill; o: Overview }) {
  const t = useT();
  const pot = potById(o.pots, bill.pot_id);
  const agents = o.agents.filter((a) => !a.revoked && a.allowlist.some((r) => r.type === "near" && r.account_id === bill.payee));
  return (
    <GroupedList label={bill.name}>
      <ListRow icon="bill" color="sun" title={fmtToken(bill.amount, bill.token)} subtitle={t("bills.everyMonth", { day: bill.due_day })} />
      <ListRow icon="person" color="stone" title={bill.payee} subtitle={t("bills.payee")} />
      {pot && <ListRow icon={potGlyph(pot)} color={potColor(pot)} title={potName(pot, t)} subtitle={t("bills.paidFrom")} />}
      <ListRow icon="agents" color="violet" title={agents.length ? agents.map((a) => a.agent_name).join(", ") : t("bills.noAgent")} subtitle={t("bills.agentCanPay")} />
    </GroupedList>
  );
}

function AddBillSheet({ o, onClose }: { o: Overview; onClose: () => void }) {
  const t = useT();
  const { exec } = useMoney();
  const billsPot = o.pots.find((p) => p.kind === "bills") ?? o.pots[0]!;
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [coin, setCoin] = useState<Token>("usdt");
  const [day, setDay] = useState("1");
  const [payee, setPayee] = useState("");
  const [potId, setPotId] = useState(billsPot.id);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const units = parseUnits(amount);
  const d = Number(day);
  const valid = name.trim() && units && d >= 1 && d <= 28 && payee.trim();
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      let to = payee.trim().toLowerCase();
      if (!to.includes(".") && !/^[0-9a-f]{64}$/.test(to)) {
        const n = await fetchName(to);
        if (!n.exists) throw new Error("E_NOT_FOUND");
        to = n.accountId;
      }
      await exec("addBill", { name: name.trim(), amount: units ?? toUnits("0"), token: coin, due_day: d, payee: to, pot_id: potId });
      onClose();
    } catch (e) { const f = explain(e); setErr(`${f.title} ${f.next}`); } finally { setBusy(false); }
  };
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()} title={t("bills.add")} closeLabel={t("common.close")} dismissible={!busy}
      footer={<Button block size="lg" loading={busy} disabled={!valid} onClick={save} data-testid="bill-save">{t("bills.save")}</Button>}>
      <Input label={t("bills.name")} value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} placeholder={t("bills.namePlaceholder")} />
      <SegmentedControl label={t("common.token")} value={coin} onChange={setCoin} items={[{ value: "usdt", label: "USDT" }, { value: "usdc", label: "USDC" }]} />
      <Input label={t("common.amount")} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" suffix={coin.toUpperCase()} />
      <Input label={t("bills.dueDay")} value={day} onChange={(e) => setDay(e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" hint={t("bills.dueDayHint")} error={day && (d < 1 || d > 28) ? t("bills.dueDayHint") : undefined} />
      <BillerPicker testId="bill-billers" selected={[payee.trim().toLowerCase()]} onPick={(b) => {
        setPayee(b.accountId);
        if (!name.trim()) setName(t(`billers.cat.${b.category}` as never) || b.name);
      }} />
      <Input label={t("bills.orOther")} value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="sam" autoComplete="off" spellCheck={false} hint={t("bills.payeeHint")} />
      {payee.trim() && <CounterpartyBadge accountId={payee} amount={units ?? null} debounceMs={600} testId="bill-payee-check" />}
      <div className="oi-label">{t("bills.paidFrom")}</div>
      <SelectList label={t("bills.paidFrom")} value={potId} onChange={setPotId}
        options={o.pots.map((p) => ({ value: p.id, title: potName(p, t), leading: <Tile icon={potGlyph(p)} color={potColor(p)} /> }))} />
      {err && <p role="alert" className="oi-error-text" style={{ margin: 0 }}>{err}</p>}
    </Sheet>
  );
}
