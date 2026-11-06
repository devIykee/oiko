"use client";
// Autopilot rules (opt-in). Saved off-chain; a connected agent with Act runs them within its limits, otherwise it
// suggests them for the owner to approve. The rules never widen what an agent may do: the account's limits still apply.
import { Button, GroupedList, ListRow, Note, Toggle, useToast } from "@oiko/ui";
import { toUnits, type Overview } from "@oiko/sdk";
import { useEffect, useState } from "react";
import { explain } from "@/lib/actions";
import { fmt, parseUnits } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useAutopilot, useSaveAutopilot, type Autopilot } from "@/lib/owner";

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
const inputStyle = { height: 40, border: "1px solid var(--line)", borderRadius: 10, padding: "0 10px", background: "transparent", color: "inherit", font: "inherit", minWidth: 0 } as const;

export function AutopilotCard({ o }: { o: Overview }) {
  const t = useT();
  const toast = useToast();
  const ap = useAutopilot();
  const save = useSaveAutopilot();
  const [d, setD] = useState<Autopilot | null>(null);
  const [above, setAbove] = useState("");
  const [floor, setFloor] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const targets = o.pots.filter((p) => p.kind !== "flex");

  useEffect(() => {
    if (!ap.data || d) return;
    setD(ap.data);
    setAbove(fmt(ap.data.sweep_spend.above).replace(/,/g, ""));
    setFloor(ap.data.spend_floor ? fmt(ap.data.spend_floor).replace(/,/g, "") : "");
  }, [ap.data, d]);

  if (!d) return null;
  const set = (p: Partial<Autopilot>) => setD({ ...d, ...p });
  const anyOn = d.top_up_bills.on || d.sweep_spend.on || d.pay_bills_on_due_day.on;

  const submit = async () => {
    setErr(null);
    let aboveUnits: string | null = null;
    try { aboveUnits = /^\d*\.?\d*$/.test(above.trim()) ? toUnits(above.trim() || "0") : null; } catch { aboveUnits = null; }
    const floorUnits = floor.trim() ? parseUnits(floor) : null;
    if (aboveUnits === null || (floor.trim() && floorUnits === null)) { setErr(t("autopilot.badAmount")); return; }
    const toPot = d.sweep_spend.to_pot ?? targets.find((p) => p.kind === "autosave")?.id ?? targets[0]?.id ?? null;
    setBusy(true);
    try {
      const next = await save({
        top_up_bills: d.top_up_bills, pay_bills_on_due_day: d.pay_bills_on_due_day,
        sweep_spend: { ...d.sweep_spend, above: aboveUnits, to_pot: toPot }, spend_floor: floorUnits,
      });
      setD(next);
      toast.show({ message: t("autopilot.saved"), tone: "success" });
    } catch (e) {
      setErr(e instanceof Error ? e.message : explain(e).title);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="autopilot" className="oi-card oi-stack-sm" data-testid="autopilot">
      <h2 id="autopilot" className="oi-h2" style={{ fontSize: 16 }}>{t("autopilot.title")}</h2>
      <p className="oi-small oi-muted oi-pretty" style={{ margin: 0 }}>{t("autopilot.intro")}</p>
      <GroupedList label={t("autopilot.title")}>
        <ListRow icon="bills" color="sun" title={t("autopilot.topUp")} subtitle={t("autopilot.topUpSub")}
          trailing={<Toggle checked={d.top_up_bills.on} onChange={(v) => set({ top_up_bills: { on: v } })} label={t("autopilot.topUp")} data-testid="autopilot-topup" />} />
        <ListRow icon="bills" color="sun" title={t("autopilot.payDue")} subtitle={t("autopilot.payDueSub")}
          trailing={<Toggle checked={d.pay_bills_on_due_day.on} onChange={(v) => set({ pay_bills_on_due_day: { on: v } })} label={t("autopilot.payDue")} data-testid="autopilot-paydue" />} />
        <ListRow icon="savings" color="mint" title={t("autopilot.sweep")} subtitle={t("autopilot.sweepSub")}
          trailing={<Toggle checked={d.sweep_spend.on} onChange={(v) => set({ sweep_spend: { ...d.sweep_spend, on: v } })} label={t("autopilot.sweep")} data-testid="autopilot-sweep" />} />
      </GroupedList>
      {d.sweep_spend.on && (
        <div className="oi-small" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
          <label style={{ display: "grid", gap: 4 }}>{t("autopilot.keep")}
            <input inputMode="decimal" value={above} onChange={(e) => setAbove(e.target.value)} style={inputStyle} data-testid="autopilot-above" />
          </label>
          <label style={{ display: "grid", gap: 4 }}>{t("autopilot.into")}
            <select value={d.sweep_spend.to_pot ?? ""} onChange={(e) => set({ sweep_spend: { ...d.sweep_spend, to_pot: Number(e.target.value) } })} style={inputStyle}>
              {targets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4 }}>{t("autopilot.on")}
            <select value={d.sweep_spend.weekday} onChange={(e) => set({ sweep_spend: { ...d.sweep_spend, weekday: Number(e.target.value) } })} style={inputStyle}>
              {WEEKDAYS.map((w) => <option key={w} value={w}>{t(`autopilot.day${w}`)}</option>)}
            </select>
          </label>
        </div>
      )}
      <label className="oi-small" style={{ display: "grid", gap: 4 }}>{t("autopilot.floor")}
        <input inputMode="decimal" placeholder={t("autopilot.floorOff")} value={floor} onChange={(e) => setFloor(e.target.value)} style={inputStyle} data-testid="autopilot-floor" />
      </label>
      {anyOn && <Note>{t("autopilot.limitsNote")}</Note>}
      {err && <p className="oi-small" role="alert" style={{ margin: 0, color: "var(--danger)" }}>{err}</p>}
      <Button variant="secondary" onClick={submit} loading={busy} data-testid="autopilot-save">{t("autopilot.save")}</Button>
    </section>
  );
}
