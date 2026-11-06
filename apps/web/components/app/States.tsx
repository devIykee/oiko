"use client";
import { Button, EmptyState, Loading, Skeleton } from "@oiko/ui";
import { useT } from "@/lib/i18n";
import { explain } from "@/lib/explain";

export function LoadError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  const f = explain(error);
  return (
    <div className="oi-card">
      <EmptyState icon="warning" color="sun" title={t("common.errorTitle")} body={`${f.title} ${f.next}`}
        action={onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>{t("common.retry")}</Button>} />
    </div>
  );
}

/** Skeleton matching a page of cards; invisible for the first 300 ms. */
export function PageSkeleton({ rows = 4, balance }: { rows?: number; balance?: boolean }) {
  const t = useT();
  return (
    <Loading label={t("common.loading")}>
      <div className="oi-stack" style={{ paddingTop: 20 }}>
        {balance && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "16px 0" }}>
            <Skeleton width={120} height={14} />
            <Skeleton width={220} height={52} radius={14} />
          </div>
        )}
        <Skeleton height={28} width={160} />
        {Array.from({ length: rows }, (_, i) => <Skeleton key={i} height={64} radius={20} />)}
      </div>
    </Loading>
  );
}
