import type { ReactNode } from "react";
import { PublicFrame } from "@/components/app/PublicFrame";

export default function Layout({ children }: { children: ReactNode }) {
  return <PublicFrame>{children}</PublicFrame>;
}
