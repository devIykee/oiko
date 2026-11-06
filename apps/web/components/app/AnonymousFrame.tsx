import "@oiko/ui/styles.css";
import { Suspense, type ReactNode } from "react";
import { PublicProviders } from "./PublicProviders";

/** Like PublicFrame, for pages that need no signed-in account (/pay): no session provider, so no key or signing code. */
export function AnonymousFrame({ children }: { children: ReactNode }) {
  return (
    <PublicProviders>
      <div className="oi-public oi-root">
        <Suspense fallback={null}>{children}</Suspense>
      </div>
    </PublicProviders>
  );
}
