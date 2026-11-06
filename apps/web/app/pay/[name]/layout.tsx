import type { ReactNode } from "react";
import { AnonymousFrame } from "@/components/app/AnonymousFrame";

export default function Layout({ children }: { children: ReactNode }) {
  return <AnonymousFrame>{children}</AnonymousFrame>;
}
