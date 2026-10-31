import type { Metadata } from "next";
import { InvestScreen } from "./InvestScreen";

export const metadata: Metadata = { title: "Invest" };
export default function Page() {
  return <InvestScreen />;
}
