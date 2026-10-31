import "@oiko/ui/styles.css";
import { Suspense, type ReactNode } from "react";
import { Providers } from "./Providers";

/** Layout for product pages outside the app shell (/start, /pay, /connect, /dev/ui). */
export function PublicFrame({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <div className="oi-public oi-root">
        <Suspense fallback={null}>{children}</Suspense>
      </div>
    </Providers>
  );
}
