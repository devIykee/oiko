import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { THEME_SCRIPT } from "@/components/marketing/theme-script";
import "./globals.css";

// Acorn (/fonts) for headlines, app UI, labels and numbers; Chillax (Fontshare, /fonts) for supporting text (founder,
// 2026-11-06; see .oi-subtext rules in globals.css). Acorn has no tabular figures, so money columns stay right-aligned
// in fixed containers instead of switching fonts.
const acorn = localFont({
  src: [
    { path: "../fonts/Acorn-Regular.woff2", weight: "400", style: "normal" },
    { path: "../fonts/Acorn-Medium.woff2", weight: "500", style: "normal" },
    { path: "../fonts/Acorn-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "../fonts/Acorn-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-acorn",
  display: "swap",
  // "Acorn Fallback" (globals.css) is Arial scaled per weight to Acorn's measured widths, so the text wraps the same
  // before and after Acorn loads (no layout shift). Next's automatic fallback uses one size for all weights and runs
  // 15-25% wider than Acorn, which re-wrapped the hero.
  adjustFontFallback: false,
  fallback: ["Acorn Fallback", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});

// Supporting text only (muted lines, leads, small print). Two weights keep the extra download to about 42 KB.
const chillax = localFont({
  src: [
    { path: "../fonts/Chillax-Regular.woff2", weight: "400", style: "normal" },
    { path: "../fonts/Chillax-Medium.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-chillax",
  display: "swap",
  adjustFontFallback: "Arial",
  fallback: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});

const DESCRIPTION =
  "Oiko: personal finance meets personal intelligence. Get paid from anywhere, plan every bit, and let your own AI agent help, on limits you set.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "Oiko: Personal finance meets personal intelligence", template: "%s · Oiko" },
  description: DESCRIPTION,
  applicationName: "Oiko",
  openGraph: {
    type: "website",
    siteName: "Oiko",
    title: "Oiko: Personal finance meets personal intelligence",
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: "Oiko", description: DESCRIPTION },
  appleWebApp: { capable: true, title: "Oiko", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4F5F7" },
    { media: "(prefers-color-scheme: dark)", color: "#0B0C0E" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${acorn.variable} ${chillax.variable}`}
    >
      <head>
        {/* Applies the saved Light/Dark/Auto choice before first paint (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {/* Night sky (dark mode only; hidden in light via CSS). Decorative, behind everything. */}
        <div className="oi-night" aria-hidden>
          <div className="oi-night__sky" />
          <div className="oi-night__tw oi-night__tw--a" />
          <div className="oi-night__tw oi-night__tw--b" />
          <div className="oi-night__shoot" />
        </div>
        {children}
      </body>
    </html>
  );
}
