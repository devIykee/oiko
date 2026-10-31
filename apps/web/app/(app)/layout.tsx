import "@oiko/ui/styles.css";
import { Suspense, type ReactNode } from "react";
import { Providers } from "@/components/app/Providers";
import { AppShell } from "@/components/app/AppShell";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <Suspense fallback={null}>
        <AppShell>{children}</AppShell>
      </Suspense>
    </Providers>
  );
}
