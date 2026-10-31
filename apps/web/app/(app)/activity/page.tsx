import type { Metadata } from "next";
import { ActivityScreen } from "./ActivityScreen";

export const metadata: Metadata = { title: "Activity" };
export default function Page() {
  return <ActivityScreen />;
}
