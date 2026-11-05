"use client";
import { Avatar, Badge, EmptyState, Skeleton, Loading } from "@oiko/ui";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import { PayFlow } from "@/components/app/PayFlow";
import { explain } from "@/lib/actions";
import { useConfig } from "@/lib/config";
import { useNameInfo } from "@/lib/data";
import { useT } from "@/lib/i18n";

export function PayScreen() {
  const t = useT();
  const { name: raw } = useParams<{ name: string }>();
  const name = decodeURIComponent(raw).toLowerCase();
  const info = useNameInfo(name);
  const { config } = useConfig();
  const display = name.charAt(0).toUpperCase() + name.slice(1);

  if (info.error && !info.data) return <Frame><EmptyState icon="warning" title={t("pay.loadError")} body={explain(info.error).next} /></Frame>;
  if (!info.data) return <Frame><Loading label={t("common.loading")}><div className="oi-stack" style={{ alignItems: "center" }}><Skeleton width={72} height={72} radius={36} /><Skeleton width={180} height={24} /><Skeleton height={64} radius={20} /><Skeleton height={64} radius={20} /></div></Loading></Frame>;
  if (!info.data.exists) return <Frame><EmptyState icon="person" title={t("pay.noName", { name })} body={t("pay.noNameBody")} action={<Link className="oi-btn" href={`/start?name=${encodeURIComponent(name)}`}>{t("pay.claim", { name })}</Link>} /></Frame>;

  const recipient = info.data.accountId;
  return (
    <Frame>
      <section className="oi-stack-sm" style={{ alignItems: "center", textAlign: "center" }} data-testid="pay-recipient">
        <Avatar name={display} size={72} />
        <h1 className="oi-h1" style={{ fontSize: 26 }}>{t("pay.title", { name: display })}</h1>
        <div className="oi-small oi-muted">{recipient}</div>
        <Badge tone="success" icon="shield" data-testid="pay-verified">{t("pay.verified")}</Badge>
      </section>
      <PayFlow name={name} display={display} recipient={recipient} />
      {config && <p className="oi-micro oi-muted" style={{ textAlign: "center", margin: 0 }}>{t("pay.footer")}</p>}
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="oi-public__col" data-testid="pay">
      <header className="oi-row" style={{ minHeight: 44 }}>
        <Link href="/" aria-label="Oiko" style={{ color: "var(--ink)" }}><Logo variant="wordmark" height={22} /></Link>
      </header>
      {children}
    </div>
  );
}
