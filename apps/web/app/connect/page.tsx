import type { Metadata } from "next";
import { Suspense } from "react";
import { ConnectScreen } from "./ConnectScreen";

export const metadata: Metadata = { title: "Connect an agent" };
export default function Page() {
  return <Suspense fallback={null}><ConnectScreen /></Suspense>;
}
