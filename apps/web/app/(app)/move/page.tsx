import type { Metadata } from "next";
import { MoveScreen } from "./MoveScreen";

export const metadata: Metadata = { title: "Move" };
export default function Page() {
  return <MoveScreen />;
}
