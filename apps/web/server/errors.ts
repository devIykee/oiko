import { friendlyError } from "@oiko/sdk";

/** Error with a stable code; rendered as { error: { code, message } } with a plain-English message. */
export class ApiError extends Error {
  constructor(public readonly code: string, public readonly status: number = 400, message?: string, public readonly details?: Record<string, unknown>) {
    super(message ?? defaultMessage(code));
    this.name = "ApiError";
  }
}
export function defaultMessage(code: string): string {
  const f = friendlyError(code);
  return `${f.title} ${f.next}`;
}
export function errorBody(e: unknown): { status: number; body: { error: { code: string; message: string; [k: string]: unknown } } } {
  if (e instanceof ApiError) return { status: e.status, body: { error: { ...(e.details ?? {}), code: e.code, message: e.message } } };
  const msg = e instanceof Error ? e.message : String(e);
  const f = friendlyError(msg);
  const status = f.code === "E_RPC" ? 502 : 500;
  console.error(status === 500 ? "[oiko] unhandled" : "[oiko] upstream", e);
  return { status, body: { error: { code: f.code === "E_UNKNOWN" ? "E_INTERNAL" : f.code, message: `${f.title} ${f.next}` } } };
}
