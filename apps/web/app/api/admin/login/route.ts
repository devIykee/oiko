import { connection } from "next/server";
import { login } from "@/server/admin";
import { ApiError } from "@/server/errors";
import { clientIp, handle, json, readText } from "@/server/http";

export async function POST(req: Request) {
  await connection();
  return handle(async () => {
    let password: unknown = null;
    try { password = (JSON.parse(await readText(req, 2048)) as { password?: unknown }).password; } catch { /* treated as wrong */ }
    const r = login(password, clientIp(req));
    if (r.ok) return json({ ok: true }, 200, { "set-cookie": r.cookie });
    if (r.status === 429) throw new ApiError("E_RATE_LIMIT", 429);
    if (r.status === 404) throw new ApiError("E_NOT_FOUND", 404);
    throw new ApiError("E_UNAUTHORIZED", 401, "That password isn't right.");
  });
}
