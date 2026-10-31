import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/app/States";
import { AgentsScreen } from "./AgentsScreen";

export const metadata: Metadata = { title: "Agents" };
export default function Page() {
  return <Suspense fallback={<div className="oi-col"><PageSkeleton rows={4} /></div>}><AgentsScreen /></Suspense>;
}
