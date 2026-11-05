"use client";
// "Choose a biller": the verified billers directory as tappable rows (monogram tiles, no logos).
import { cx } from "@oiko/ui";
import { useBillers, type VerifiedBiller } from "@/lib/data";
import { useT } from "@/lib/i18n";

const TILE: Record<string, string> = { internet: "blue", electricity: "sun", water: "mint", phone: "violet", rent: "rose", insurance: "stone", subscriptions: "violet" };
const monogram = (name: string) => name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");

export function BillerPicker({ selected, onPick, multi, testId }: { selected: string[]; onPick: (b: VerifiedBiller) => void; multi?: boolean; testId?: string }) {
  const t = useT();
  const { data } = useBillers();
  const billers = data?.billers ?? [];
  if (!billers.length) return null;
  return (
    <div className="oi-stack-sm" data-testid={testId}>
      <div className="oi-label">{t("billers.choose")}</div>
      <div className="oi-billers" role={multi ? "group" : "radiogroup"} aria-label={t("billers.choose")}>
        {billers.map((b) => {
          const on = selected.includes(b.accountId);
          return (
            <button key={b.accountId} type="button" className={cx("oi-biller", on && "oi-biller--on")} onClick={() => onPick(b)}
              role={multi ? "checkbox" : "radio"} aria-checked={on} data-testid={`biller-${b.accountId}`}>
              <span className="oi-biller__tile" data-tile={TILE[b.category] ?? "stone"} aria-hidden>{monogram(b.name)}</span>
              <span className="oi-biller__body">
                <span className="oi-biller__name">{b.name}</span>
                <span className="oi-biller__sub">{t(`billers.cat.${b.category}` as never) || b.category} · {t("billers.verified")}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="oi-micro oi-muted" style={{ margin: 0 }}>{t("billers.hint")}</p>
    </div>
  );
}
