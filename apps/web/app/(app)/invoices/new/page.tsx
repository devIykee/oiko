import type { Metadata } from "next";
import { Suspense } from "react";
import { NewInvoiceScreen } from "./NewInvoiceScreen";

export const metadata: Metadata = { title: "New invoice" };
export default function Page() {
  return <Suspense fallback={null}><NewInvoiceScreen /></Suspense>;
}
