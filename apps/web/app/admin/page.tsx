import type { Metadata } from "next";
import "@oiko/ui/styles.css";
import { AdminPanel } from "./AdminPanel";

// Operator page. Not linked from anywhere and never indexed.
export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } } };

export default function Page() {
  return <AdminPanel />;
}
