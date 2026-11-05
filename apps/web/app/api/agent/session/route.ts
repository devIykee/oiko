import { connection } from "next/server";
import { createSession, revokeSession } from "@/server/agentSession";
import { ApiError } from "@/server/errors";
import { clientIp, handle, readText } from "@/server/http";
import { checkLimits } from "@/server/ratelimit";

// POST: the agent signs this request (NEP-413 Authorization header) and gets a bearer token for hosted MCP.
// Body (optional): { "ttl_hours": 1..24 }. DELETE with Authorization: Bearer <token> ends the session.
export async function POST(req: Request) {
  await connection();
  return handle(async () => {
    if (!checkLimits("gateway", clientIp(req), null)) throw new ApiError("E_RATE_LIMIT", 429);
    const url = new URL(req.url);
    const body = await readText(req, 2048);
    let ttl: number | undefined;
    try { const h = (JSON.parse(body || "{}") as { ttl_hours?: unknown }).ttl_hours; if (typeof h === "number") ttl = h * 3_600_000; } catch { throw new ApiError("E_BAD_REQUEST", 400, "The body must be JSON."); }
    return createSession({ method: "POST", path: url.pathname + url.search, body, authorization: req.headers.get("authorization") }, ttl);
  });
}
export async function DELETE(req: Request) {
  await connection();
  return handle(async () => revokeSession(req.headers.get("authorization")));
}
