"use client";
import { Badge, Button, Input, SectionTitle, SegmentedControl, Sheet, Tabs, VaultCard, Icon, cx, tileColors, type IconConcept, type TileColor } from "@oiko/ui";
import type { PotKind } from "@oiko/sdk";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { LoadError, PageSkeleton } from "@/components/app/States";
import { isLocked, potColor, potGlyph, potName } from "@/components/app/potmeta";
import { explain, useMoney } from "@/lib/actions";
import { useConfig } from "@/lib/config";
import { useOverview } from "@/lib/data";
import { fmt, fmtDate, nsToMs, parseUnits, total } from "@/lib/format";
import { useT } from "@/lib/i18n";

export function PotsTabs({ current }: { current: "pots" | "earn" | "rosca" }) {
  const t = useT();
  const { config } = useConfig();
  const items = [
    { value: "pots" as const, label: t("nav.pots"), href: "/pots", testId: "tab-pots" },
    ...(config?.features.earn !== false ? [{ value: "earn" as const, label: t("nav.earn"), href: "/pots/earn", testId: "tab-earn" }] : []),
    ...(config?.features.ajo !== false ? [{ value: "rosca" as const, label: t("rosca.tab"), href: "/rosca", testId: "tab-rosca" }] : []),
  ];
  return <Tabs label={t("nav.pots")} items={items} value={current} linkAs={Link} />;
}

export function PotsScreen() {
  const t = useT();
  const ov = useOverview();
  const [creating, setCreating] = useState(false);

  return (
    <div className="oi-col oi-page" data-testid="pots">
      <PageHeader title={t("nav.pots")} action={<Button size="sm" icon="add" onClick={() => setCreating(true)} data-testid="pot-new">{t("pots.new")}</Button>} />
      <PotsTabs current="pots" />
      {ov.error && !ov.data ? <LoadError error={ov.error} onRetry={ov.refresh} /> : !ov.data ? <PageSkeleton rows={4} /> : (
        <>
          <div className="oi-pots oi-pots--3">
            {ov.data.pots.map((p) => {
              const have = total(p.balances) + total(p.earn_supplied);
              const locked = isLocked(p);
              return (
                <VaultCard key={p.id} id={p.id} href={`/pots/${p.id}`} as={Link} testId={`pot-card-${p.id}`}
                  name={potName(p, t)} icon={potGlyph(p)} color={potColor(p)} amount={fmt(have)} ticker={t("common.usdcUsdt")}
                  badge={locked ? <Badge icon="lock">{t("common.locked")}</Badge> : p.earn ? <Badge tone="success">{t("common.earning")}</Badge> : undefined}
                  progress={p.target ? { value: Number(have), max: Number(p.target), label: t("pots.goalProgress") } : undefined}
                  meta={locked ? t("common.lockedUntil", { date: fmtDate(nsToMs(p.unlock_at)) }) : p.target ? t("pots.ofTarget", { target: fmt(p.target) }) : t(`pot.kind.${p.kind}`)} />
              );
            })}
            <button type="button" className="oi-potcard oi-potcard--add" onClick={() => setCreating(true)}>
              <Icon name="add" size={22} />
              {t("pots.new")}
            </button>
          </div>
          <SectionTitle as="h3">{t("pots.howTitle")}</SectionTitle>
          <div className="oi-card oi-small oi-muted oi-pretty" style={{ marginTop: -8 }}>{t("pots.howBody")}</div>
        </>
      )}
      <CreatePotSheet open={creating} onOpenChange={setCreating} />
    </div>
  );
}

const ICON_CHOICES: IconConcept[] = ["goal", "savings", "rainy", "travel", "car", "school", "gift", "health", "shopping", "rent", "work", "phone", "star", "bill"];

export function IconColorPicker({ icon, color, onIcon, onColor }: { icon: IconConcept; color: TileColor; onIcon: (i: IconConcept) => void; onColor: (c: TileColor) => void }) {
  const t = useT();
  return (
    <>
      <div role="radiogroup" aria-label={t("pots.icon")} style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {ICON_CHOICES.map((i) => (
          <button key={i} type="button" role="radio" aria-checked={i === icon} aria-label={i} onClick={() => onIcon(i)}
            className={cx("oi-tile oi-tile--lg")} data-tile={i === icon ? color : "stone"}
            style={{ border: 0, cursor: "pointer", outline: i === icon ? "2px solid var(--tile-deep)" : undefined, outlineOffset: 2 }}>
            <Icon name={i} size={20} />
          </button>
        ))}
      </div>
      <div role="radiogroup" aria-label={t("pots.color")} style={{ display: "flex", gap: 10 }}>
        {tileColors.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={c === color} aria-label={c} onClick={() => onColor(c)} data-tile={c}
            style={{ width: 32, height: 32, borderRadius: "50%", border: 0, background: "var(--tile-deep)", cursor: "pointer", boxShadow: c === color ? "0 0 0 3px var(--surface), 0 0 0 5px var(--tile-deep)" : undefined }} />
        ))}
      </div>
    </>
  );
}

function CreatePotSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const router = useRouter();
  const { exec } = useMoney();
  const [kind, setKind] = useState<Exclude<PotKind, "flex">>("goal");
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<IconConcept>("goal");
  const [color, setColor] = useState<TileColor>("rose");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await exec("createPot", { name: name.trim(), icon, color, kind, target: kind === "goal" ? parseUnits(target) : null });
      onOpenChange(false);
      setName(""); setTarget("");
      if (typeof r.value === "number") router.push(`/pots/${r.value}`);
    } catch (e) {
      const f = explain(e);
      setErr(`${f.title} ${f.next}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("pots.new")} closeLabel={t("common.close")} dismissible={!busy} testId="pot-create"
      footer={<Button block size="lg" loading={busy} disabled={!name.trim()} onClick={create} data-testid="pot-create-confirm">{t("pots.create")}</Button>}>
      <SegmentedControl label={t("pots.kind")} value={kind} onChange={(k) => { setKind(k); setIcon(k === "goal" ? "goal" : k === "locked" ? "rainy" : k === "bills" ? "bill" : "savings"); }}
        items={[{ value: "goal", label: t("pot.kind.goal") }, { value: "autosave", label: t("pot.kind.autosave") }, { value: "bills", label: t("pot.kind.bills") }, { value: "locked", label: t("pot.kind.locked") }]} />
      <p className="oi-small oi-muted" style={{ margin: 0 }}>{t(`pots.kindHelp.${kind}`)}</p>
      <Input label={t("common.name")} value={name} onChange={(e) => setName(e.target.value.slice(0, 32))} placeholder={t("pots.namePlaceholder")} maxLength={32} data-testid="pot-name" />
      {kind === "goal" && <Input label={t("pots.target")} value={target} onChange={(e) => setTarget(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" suffix="USDC + USDT" placeholder="800" />}
      <IconColorPicker icon={icon} color={color} onIcon={setIcon} onColor={setColor} />
      {err && <p role="alert" className="oi-error-text" style={{ margin: 0 }}>{err}</p>}
    </Sheet>
  );
}
