"use client";
import { Button, EmptyState } from "@oiko/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MoveSheet } from "@/components/app/MoveSheet";
import { PageHeader } from "@/components/app/PageHeader";
import { PageSkeleton } from "@/components/app/States";
import { useOverview } from "@/lib/data";
import { useT } from "@/lib/i18n";

/** Standalone route for the Move sheet (deep links, keyboard users). */
export function MoveScreen() {
  const t = useT();
  const router = useRouter();
  const ov = useOverview();
  const [open, setOpen] = useState(true);
  if (!ov.data) return <div className="oi-col"><PageSkeleton rows={3} /></div>;
  return (
    <div className="oi-col oi-page">
      <PageHeader title={t("home.move")} back="/home" />
      <EmptyState icon="move" title={t("more.moveSub")} action={<Button onClick={() => setOpen(true)}>{t("home.move")}</Button>} />
      <MoveSheet open={open} onOpenChange={(v) => { setOpen(v); if (!v) router.push("/home"); }} overview={ov.data} />
    </div>
  );
}
