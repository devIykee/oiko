"use client";
import { Note } from "@oiko/ui";
import { useOlderVersion } from "@/lib/data";
import { useT } from "@/lib/i18n";

/** Shown on Home and Settings for accounts created on an older version of Oiko's account code. */
export function OlderVersionBanner() {
  const t = useT();
  if (!useOlderVersion()) return null;
  return (
    <div data-testid="older-version">
      <Note tone="info" title={t("older.title")}>{t("older.body")}</Note>
    </div>
  );
}
