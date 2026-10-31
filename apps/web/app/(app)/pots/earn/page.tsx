import type { Metadata } from "next";
import { EarnScreen } from "./EarnScreen";

export const metadata: Metadata = { title: "Earn" };
export default function Page() {
  return <EarnScreen />;
}
