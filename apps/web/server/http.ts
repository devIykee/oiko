// Web-standard Request/Response helpers shared by route handlers (no Next imports).
import { z } from "zod";
import { ApiError, errorBody } from "./errors";

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}
export function errorResponse(e: unknown): Response {
  const { status, body } = errorBody(e);
  return json(body, status);
}
/** Runs a handler and turns thrown errors into `{ error: { code, message } }`. */
export async function handle(fn: () => Promise<Response | unknown>): Promise<Response> {
  try {
    const r = await fn();
    return r instanceof Response ? r : json(r);
  } catch (e) {
    return errorResponse(e);
  }
}
export function clientIp(req: Request): string {
  const h = req.headers;
  // Prefer headers the hosting edge sets itself (Vercel overwrites these; a caller can't choose them). The
  // forwarded-for chain is only a fallback for other hosts (security review S-1).
  return (h.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown").slice(0, 64);
}
export async function readText(req: Request, max = 64 * 1024): Promise<string> {
  const t = await req.text();
  if (t.length > max) throw new ApiError("E_BAD_REQUEST", 413, "The request body is too large.");
  return t;
}
export function parseBody<T extends z.ZodType>(schema: T, text: string): z.infer<T> {
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError("E_BAD_REQUEST", 400, "The body must be JSON.");
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new ApiError("E_BAD_REQUEST", 400, `Something in the request isn't right: ${issue?.path.join(".") || "body"} ${issue?.message ?? ""}`.trim());
  }
  return r.data;
}
export async function readBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  return parseBody(schema, await readText(req));
}
