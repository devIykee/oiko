import type { Metadata } from "next";
import { StartScreen } from "./StartScreen";

export const metadata: Metadata = { title: "Get your name" };
export default function Page() {
  return <StartScreen />;
}
