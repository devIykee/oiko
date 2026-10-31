import type { Metadata } from "next";
import { PlanScreen } from "./PlanScreen";

export const metadata: Metadata = { title: "Plan" };
export default function Page() {
  return <PlanScreen />;
}
