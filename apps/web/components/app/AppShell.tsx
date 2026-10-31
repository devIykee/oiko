"use client";
import { BottomTabBar, Button, EmptyState, NetworkModeBadge, Sidebar, type NavItem } from "@oiko/ui";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Logo } from "@/components/brand/Logo";
import { useConfig } from "@/lib/config";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";

export function AppShell({ children }: { children: ReactNode }) {
  const t = useT();
  const pathname = usePathname() ?? "/home";
  const { status } = useSession();
  const { config } = useConfig();
  const router = useRouter();

  useEffect(() => {
    if (status === "signed-out") router.replace("/start");
  }, [status, router]);

  const side: NavItem[] = [
    { href: "/home", label: t("nav.home"), icon: "home", testId: "nav-home" },
    { href: "/plan", label: t("nav.plan"), icon: "plan", testId: "nav-plan" },
    { href: "/bills", label: t("nav.bills"), icon: "bills", testId: "nav-bills" },
    { href: "/pots", label: t("nav.pots"), icon: "pots", match: ["/rosca"], testId: "nav-pots" },
    { href: "/insights", label: t("nav.insights"), icon: "insights", testId: "nav-insights" },
    { href: "/agents", label: t("nav.agents"), icon: "agents", testId: "nav-agents" },
    { href: "/activity", label: t("nav.activity"), icon: "activity", testId: "nav-activity" },
    { href: "/settings", label: t("nav.settings"), icon: "settings", testId: "nav-settings" },
  ];
  const tabs: NavItem[] = [
    side[0]!, side[1]!, side[3]!, side[5]!,
    { href: "/more", label: t("nav.more"), icon: "more", match: ["/bills", "/insights", "/activity", "/settings", "/invest", "/receive", "/withdraw", "/move"], testId: "tab-more" },
  ];

  return (
    <div className="oi-app oi-root">
      <a href="#main" className="oi-sr" style={{ position: "absolute" }}>{t("common.skip")}</a>
      <Sidebar
        items={side}
        pathname={pathname}
        linkAs={Link}
        label={t("nav.main")}
        brand={<Link href="/home" className="oi-sidebar__brand" aria-label="Oiko"><Logo variant="wordmark" height={26} /></Link>}
        footer={config && <NetworkModeBadge mode={config.network} labels={{ local: t("common.localMode"), testnet: t("common.testMode") }} />}
      />
      <main id="main" className="oi-shell-main">
        {status !== "signed-out" ? children : (
          <div className="oi-col" style={{ paddingTop: 64 }}>
            <EmptyState icon="person" title={t("common.signedOutTitle")} body={t("common.signedOutBody")}
              action={<Button onClick={() => router.push("/start")}>{t("common.signIn")}</Button>} />
          </div>
        )}
      </main>
      <BottomTabBar items={tabs} pathname={pathname} linkAs={Link} label={t("nav.main")} />
    </div>
  );
}
