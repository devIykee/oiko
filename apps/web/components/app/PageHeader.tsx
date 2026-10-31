"use client";
import { Icon } from "@oiko/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { useT } from "@/lib/i18n";

/** Top-level page title (tabs) or sub-page bar with a back link. */
export function PageHeader({ title, back, action, sub }: { title: ReactNode; back?: string; action?: ReactNode; sub?: ReactNode }) {
  const t = useT();
  if (back) {
    return (
      <div className="oi-topbar">
        <Link href={back} className="oi-iconbtn oi-iconbtn--plain" aria-label={t("common.back")}><Icon name="chevronLeft" size={18} /></Link>
        <h1 className="oi-topbar__title">{title}</h1>
        {action}
      </div>
    );
  }
  return (
    <div>
      <div className="oi-pagehead" style={{ paddingTop: 20 }}>
        <h1>{title}</h1>
        {action}
      </div>
      {sub && <p className="oi-muted oi-small" style={{ margin: "4px 0 0" }}>{sub}</p>}
    </div>
  );
}
