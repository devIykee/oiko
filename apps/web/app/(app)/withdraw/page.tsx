import type { Metadata } from "next";
import { WithdrawScreen } from "./WithdrawScreen";

export const metadata: Metadata = { title: "Withdraw" };
export default function Page() {
  return <WithdrawScreen />;
}
