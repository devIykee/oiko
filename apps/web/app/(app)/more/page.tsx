import type { Metadata } from "next";
import { MoreScreen } from "./MoreScreen";

export const metadata: Metadata = { title: "More" };
export default function Page() {
  return <MoreScreen />;
}
