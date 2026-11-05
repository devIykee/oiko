import type { ReactNode } from "react";
import { Footer } from "@/components/marketing/Footer";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import "./marketing.css";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mk oi-sky min-h-dvh overflow-x-clip bg-surface">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-pill focus:px-4 focus:py-2 focus:text-pill-ink">Skip to content</a>
      <SiteHeader />
      <main id="main">{children}</main>
      <Footer />
    </div>
  );
}
