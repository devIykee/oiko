import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { THEME_SCRIPT } from "@/components/marketing/theme-script";
import "./globals.css";

// One family everywhere (founder, 2026-11-05): licensed Acorn (/fonts) for headlines, body, app UI, labels and numbers.
// Acorn has no tabular figures, so money columns stay right-aligned in fixed containers instead of switching fonts.
const acorn = localFont({
  src: [
    { path: "../fonts/Acorn-Regular.woff2", weight: "400", style: "normal" },
    { path: "../fonts/Acorn-Medium.woff2", weight: "500", style: "normal" },
    { path: "../fonts/Acorn-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "../fonts/Acorn-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-acorn",
  display: "swap",
  // Metric-matched Arial fallback while Acorn loads, so swapping fonts does not shift layout (CLS).
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
      className={acorn.variable}
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
