import type { Metadata } from "next";
import { RoscaListScreen } from "./RoscaScreens";

export const metadata: Metadata = { title: "ROSCA savings" };
export default function Page() {
  return <RoscaListScreen />;
}
