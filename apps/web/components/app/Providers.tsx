"use client";
import { MotionProvider, ToastProvider } from "@oiko/ui";
import type { ReactNode } from "react";
import { SessionProvider } from "@/lib/session";
import { SettingsProvider } from "@/lib/settings";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <SessionProvider>
        <MotionProvider>
          <ToastProvider>{children}</ToastProvider>
        </MotionProvider>
      </SessionProvider>
    </SettingsProvider>
  );
}
