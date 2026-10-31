import type { Metadata } from "next";
import { Suspense } from "react";
import { PayScreen } from "./PayScreen";

export const metadata: Metadata = { title: "Pay", description: "Pay this Oiko name from almost anywhere." };
export default function Page() {
  return <Suspense fallback={null}><PayScreen /></Suspense>;
}
