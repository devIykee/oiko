import type { Metadata } from "next";
import { RoscaNewScreen } from "../RoscaScreens";

export const metadata: Metadata = { title: "New ROSCA" };
export default function Page() {
  return <RoscaNewScreen />;
}
