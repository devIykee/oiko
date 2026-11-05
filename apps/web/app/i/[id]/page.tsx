import type { Metadata } from "next";
import { Suspense } from "react";
import { InvoiceScreen } from "./InvoiceScreen";

export const metadata: Metadata = { title: "Invoice", description: "An invoice you can pay from almost anywhere.", robots: { index: false, follow: false } };
export default function Page() {
  return <Suspense fallback={null}><InvoiceScreen /></Suspense>;
}
