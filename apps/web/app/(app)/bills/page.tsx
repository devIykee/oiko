import type { Metadata } from "next";
import { BillsScreen } from "./BillsScreen";

export const metadata: Metadata = { title: "Bills" };
export default function Page() {
  return <BillsScreen />;
}
