import type { Metadata } from "next";
import { PotsScreen } from "./PotsScreen";

export const metadata: Metadata = { title: "Pots" };
export default function Page() {
  return <PotsScreen />;
}
