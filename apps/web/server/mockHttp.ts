import { ApiError } from "./errors";
import { json } from "./http";

/** The real 1Click returns { message } on errors; the mock does the same. */
export function mockErrorResponse(e: unknown): Response {
  if (e instanceof ApiError) return json({ message: e.message }, e.status);
  if (e instanceof SyntaxError) return json({ message: "Invalid JSON body" }, 400);
  console.error("[oiko] mock 1Click error", e);
  return json({ message: "Internal server error" }, 500);
}
