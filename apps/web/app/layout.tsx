import type { Metadata, Viewport } from "next";
import { Inter, Inter_Tight } from "next/font/google";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { THEME_SCRIPT } from "@/components/marketing/theme-script";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-inter-tight",
  display: "swap",
});
// Licensed Acorn display face (supplied by the team, /fonts). Used for the wordmark and website headlines only.
const acorn = localFont({
  src: [
    { path: "../fonts/Acorn-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "../fonts/Acorn-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-acorn",
  display: "swap",
  fallback: ["Inter Tight", "ui-sans-serif", "system-ui", "sans-serif"],
});

const DESCRIPTION =
  "Oiko is a personal finance app with your name on it. Get paid from anywhere, plan every bit, and let your own AI agent help, on limits you set.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "Oiko: Personal finance, with your name on it", template: "%s · Oiko" },
  description: DESCRIPTION,
  applicationName: "Oiko",
  openGraph: {
    type: "website",
    siteName: "Oiko",
    title: "Oiko: Personal finance, with your name on it",
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
      className={`${inter.variable} ${interTight.variable} ${acorn.variable}`}
    >
      <head>
        {/* Applies the saved Light/Dark/Auto choice before first paint (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
