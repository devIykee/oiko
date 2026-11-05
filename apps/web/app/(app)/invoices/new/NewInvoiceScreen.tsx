"use client";
import { Button, Icon, Input, Note, SectionTitle, SegmentedControl, useToast } from "@oiko/ui";
import { fromUnits, type Token } from "@oiko/sdk";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { PageSkeleton } from "@/components/app/States";
import { explain } from "@/lib/actions";
import { fmt, parseUnits } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { lineTotal } from "@/lib/invoiceMath";
import { saveInvoice, useInvoices } from "@/lib/invoices";
import { useSession } from "@/lib/session";

interface Line { key: number; description: string; quantity: string; price: string }
const QTY_RE = /^\d{1,9}(\.\d{1,4})?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
let seq = 1;
const blank = (): Line => ({ key: seq++, description: "", quantity: "1", price: "" });

function lineUnits(l: Line): bigint | null {
  const p = parseUnits(l.price);
  if (!p || !QTY_RE.test(l.quantity.trim()) || Number(l.quantity) <= 0) return null;
  return lineTotal({ quantity: l.quantity.trim(), unitPrice: p });
}

export function NewInvoiceScreen() {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const { session } = useSession();
  const editId = useSearchParams().get("edit");
  const list = useInvoices();
  const editing = editId ? list.data?.find((i) => i.id === editId) ?? null : null;

  const [fromName, setFromName] = useState("");
  const [client, setClient] = useState("");
  const [email, setEmail] = useState("");
  const [lines, setLines] = useState<Line[]>(() => [blank()]);
  const [coin, setCoin] = useState<Token>("usdc");
  const [due, setDue] = useState(inDays(14));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"draft" | "open" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { if (session && !fromName && !editId) setFromName(session.displayName); }, [session, fromName, editId]);
  // Fill the form once when editing.
  useEffect(() => {
    if (!editing || loaded) return;
    setFromName(editing.fromName); setClient(editing.client.name); setEmail(editing.client.email ?? "");
    setLines(editing.items.map((i) => ({ key: seq++, description: i.description, quantity: i.quantity, price: fromUnits(i.unitPrice) })));
    setCoin(editing.token); setDue(editing.dueDate); setNote(editing.note ?? ""); setLoaded(true);
  }, [editing, loaded]);

  const totals = useMemo(() => lines.map(lineUnits), [lines]);
  const total = totals.reduce<bigint>((a, x) => a + (x ?? 0n), 0n);
  const emailBad = email.trim() !== "" && !EMAIL_RE.test(email.trim());
  const valid = client.trim() && fromName.trim() && lines.every((l, i) => l.description.trim() && totals[i] !== null) && total > 0n && !emailBad && /^\d{4}-\d{2}-\d{2}$/.test(due);

  if (editId && !editing) return <div className="oi-col"><PageSkeleton rows={5} /></div>;
  if (editing && !editing.editable) {
    return <div className="oi-col oi-page"><PageHeader title={t("inv.edit")} back="/invoices" /><Note tone="info">{t("inv.lockedEdit")}</Note></div>;
  }

  const set = (key: number, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const T = coin.toUpperCase();

  const submit = async (state: "draft" | "open") => {
    setTouched(true);
    if (!valid || !session) { setErr(t("inv.form.invalid")); return; }
    setBusy(state); setErr(null);
    try {
      const input = {
        fromName: fromName.trim(), client: { name: client.trim(), email: email.trim() || null },
        items: lines.map((l) => ({ description: l.description.trim(), quantity: l.quantity.trim(), unitPrice: parseUnits(l.price)! })),
        token: coin, dueDate: due, note: note.trim() || null,
        ...(editing ? (editing.state === "draft" ? { state } : {}) : { state }),
      };
      const inv = await saveInvoice(session, input, editing?.id);
      toast.show({ message: editing ? t("inv.form.saved") : t("inv.form.created"), tone: "success" });
      router.push(`/invoices?open=${encodeURIComponent(inv.id)}`);
    } catch (e) {
      const f = explain(e); setErr(`${f.title} ${f.next}`);
    } finally { setBusy(null); }
  };

  return (
    <div className="oi-col oi-page" data-testid="invoice-new-screen">
      <PageHeader title={editing ? t("inv.edit") : t("inv.new")} back="/invoices" />

      <section className="oi-card oi-stack" aria-labelledby="inv-who">
        <SectionTitle id="inv-who" as="h2">{t("inv.client")}</SectionTitle>
        <Input label={t("inv.form.clientName")} value={client} onChange={(e) => setClient(e.target.value.slice(0, 120))} placeholder={t("inv.form.clientNamePlaceholder")}
          error={touched && !client.trim() ? t("inv.form.invalid") : undefined} data-testid="invoice-client" autoComplete="organization" />
        <Input label={t("inv.form.clientEmail")} type="email" value={email} onChange={(e) => setEmail(e.target.value.slice(0, 200))} hint={t("inv.form.clientEmailHint")}
          error={emailBad ? t("inv.form.badEmail") : undefined} autoComplete="off" data-testid="invoice-email" />
        <Input label={t("inv.form.from")} value={fromName} onChange={(e) => setFromName(e.target.value.slice(0, 80))} hint={t("inv.form.fromHint")} data-testid="invoice-from" />
      </section>

      <section className="oi-card oi-stack" aria-labelledby="inv-items">
        <SectionTitle id="inv-items" as="h2">{t("inv.form.items")}</SectionTitle>
        <SegmentedControl label={t("common.token")} value={coin} onChange={setCoin} items={[{ value: "usdc", label: "USDC" }, { value: "usdt", label: "USDT" }]} />
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          {lines.map((l, i) => {
            const lt = totals[i];
            const qtyBad = touched && (!QTY_RE.test(l.quantity.trim()) || Number(l.quantity) <= 0);
            return (
              <li key={l.key} className="oi-stack-sm" style={{ borderTop: i ? "1px solid var(--line)" : undefined, paddingTop: i ? 16 : 0 }} aria-label={t("inv.form.line", { n: i + 1 })} data-testid={`invoice-line-${i}`}>
                <div className="oi-row" style={{ alignItems: "flex-end" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Input label={t("inv.form.description")} value={l.description} onChange={(e) => set(l.key, { description: e.target.value.slice(0, 200) })}
                      placeholder={t("inv.form.descriptionPlaceholder")} error={touched && !l.description.trim() ? t("inv.form.invalid") : undefined} data-testid={`invoice-desc-${i}`} />
                  </div>
                  {lines.length > 1 && (
                    <button type="button" className="oi-iconbtn oi-iconbtn--plain" style={{ marginBottom: 6 }} aria-label={t("inv.form.removeLine", { n: i + 1 })} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                      <Icon name="delete" size={18} />
                    </button>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 0.8fr) minmax(0, 1.2fr)", gap: 12 }}>
                  <Input label={t("inv.form.qty")} value={l.quantity} inputMode="decimal" onChange={(e) => set(l.key, { quantity: e.target.value.replace(/[^0-9.]/g, "").slice(0, 14) })}
                    error={qtyBad ? t("inv.form.badQty") : undefined} data-testid={`invoice-qty-${i}`} />
                  <Input label={t("inv.form.price")} value={l.price} inputMode="decimal" suffix={T} placeholder="0.00"
                    onChange={(e) => set(l.key, { price: e.target.value.replace(/,/g, ".").replace(/[^0-9.]/g, "").slice(0, 15) })} data-testid={`invoice-price-${i}`} />
                </div>
                <div className="oi-row oi-small" style={{ justifyContent: "space-between" }}>
                  <span className="oi-muted">{t("inv.form.lineTotal")}</span>
                  <span className="oi-num" style={{ fontWeight: 600 }}>{lt !== null ? `${fmt(lt)} ${T}` : "–"}</span>
                </div>
              </li>
            );
          })}
        </ol>
        {lines.length < 50 && <Button variant="secondary" icon="add" onClick={() => setLines((ls) => [...ls, blank()])} data-testid="invoice-add-line">{t("inv.form.addLine")}</Button>}
      </section>

      <section className="oi-card oi-stack" aria-label={t("inv.form.dueDate")}>
        <Input label={t("inv.form.dueDate")} type="date" value={due} min={editing ? undefined : inDays(0)} onChange={(e) => setDue(e.target.value)} data-testid="invoice-due" />
        <div className="oi-field">
          <label htmlFor="inv-note" className="oi-label">{t("inv.form.note")}</label>
          <div className="oi-input-wrap" style={{ padding: "10px 14px" }}>
            <textarea id="inv-note" className="oi-input" rows={3} style={{ height: "auto", resize: "vertical", lineHeight: 1.45 }} value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 1000))} placeholder={t("inv.form.notePlaceholder")} data-testid="invoice-note" />
          </div>
        </div>
      </section>

      <section className="oi-card oi-stack" aria-live="polite">
        <div className="oi-row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontWeight: 600 }}>{t("inv.form.total")}</span>
          <span className="oi-num" style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em" }} data-testid="invoice-total">{fmt(total)} <span style={{ fontSize: 16 }}>{T}</span></span>
        </div>
        <p className="oi-small oi-muted" style={{ margin: 0 }}>{t("inv.form.assure", { coin: T })}</p>
        {err && <p role="alert" className="oi-error-text" style={{ margin: 0 }}>{err}</p>}
        <div className="oi-stack-sm">
          {editing && editing.state !== "draft" ? (
            <Button block size="lg" loading={busy === "open"} disabled={busy !== null} onClick={() => submit("open")} data-testid="invoice-save">{t("inv.form.save")}</Button>
          ) : (
            <>
              <Button block size="lg" loading={busy === "open"} disabled={busy !== null} onClick={() => submit("open")} data-testid="invoice-create">{t("inv.form.create")}</Button>
              <Button block variant="secondary" loading={busy === "draft"} disabled={busy !== null} onClick={() => submit("draft")} data-testid="invoice-draft">{t("inv.form.saveDraft")}</Button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
