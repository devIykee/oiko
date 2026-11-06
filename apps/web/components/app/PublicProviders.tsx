"use client";
import { MotionProvider, ToastProvider } from "@oiko/ui";
import type { ReactNode } from "react";
import { SettingsProvider } from "@/lib/settings";

/** Providers for pages that need no signed-in account (/pay): no session, so no signing code is loaded. */
export function PublicProviders({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <MotionProvider>
        <ToastProvider>{children}</ToastProvider>
      </MotionProvider>
    </SettingsProvider>
  );
}
