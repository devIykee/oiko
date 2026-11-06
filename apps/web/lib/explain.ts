// Plain-English errors. Kept free of the session and signing code so public pages (/pay, /i) stay light.
import { friendlyError } from "@oiko/sdk";

export class ActionError extends Error {
  constructor(public readonly code: string, public readonly title: string, public readonly next: string, public readonly txHash?: string) {
    super(`${code}: ${title}`);
  }
}

export function explain(e: unknown): { title: string; next: string; code: string } {
  if (e instanceof ActionError) return { title: e.title, next: e.next, code: e.code };
  const msg = e instanceof Error ? `${(e as { code?: string }).code ?? ""} ${e.message}` : String(e);
  return friendlyError(msg);
}
