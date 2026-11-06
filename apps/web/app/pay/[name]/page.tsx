import type { Metadata } from "next";
import { Suspense } from "react";
import { nameInfo } from "@/server/public";
import { PayScreen, type NameInfo } from "./PayScreen";

export const metadata: Metadata = { title: "Pay", description: "Pay this Oiko name from almost anywhere." };

/** Looks the name up on the server so the recipient is in the first HTML (fast first paint); falls back to the client. */
async function lookup(name: string): Promise<NameInfo | null> {
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 2500));
  return Promise.race([nameInfo(name).then((i) => ("error" in i ? null : i)).catch(() => null), timeout]);
}

export default async function Page({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const initial = await lookup(name);
  return <Suspense fallback={null}><PayScreen initial={initial} /></Suspense>;
}
