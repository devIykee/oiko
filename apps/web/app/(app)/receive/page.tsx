import type { Metadata } from "next";
import { ReceiveScreen } from "./ReceiveScreen";

export const metadata: Metadata = { title: "Receive" };
export default function Page() {
  return <ReceiveScreen />;
}
