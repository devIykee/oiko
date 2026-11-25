import type { ReactNode } from "react";
import { Enter } from "@/components/Enter";

// Remounts on every navigation inside this group, so each new screen gets the fade-up (components/Enter.tsx).
export default function Template({ children }: { children: ReactNode }) {
  return <Enter>{children}</Enter>;
}
