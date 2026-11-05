import type { Metadata } from "next";
import { Suspense } from "react";
import { InvoicesScreen } from "./InvoicesScreen";

export const metadata: Metadata = { title: "Invoices" };
export default function Page() {
  return <Suspense fallback={null}><InvoicesScreen /></Suspense>;
}
