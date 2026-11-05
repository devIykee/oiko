import { connection } from "next/server";
import { adminEnabled, getFraming, requireAdmin, setFraming } from "@/server/admin";
import { ApiError } from "@/server/errors";
import { handle, readText } from "@/server/http";

// GET: current framing (admin only; the public value is in /api/config). PUT { framing: "testnet" | "mainnet" }.
export async function GET(req: Request) {
  await connection();
  return handle(async () => {
    requireAdmin(req);
    return { framing: await getFraming(), enabled: adminEnabled() };
  });
}
export async function PUT(req: Request) {
  await connection();
  return handle(async () => {
    requireAdmin(req);
    let body: { framing?: unknown };
    try { body = JSON.parse(await readText(req, 1024)) as { framing?: unknown }; } catch { throw new ApiError("E_BAD_REQUEST", 400, "The body must be JSON."); }
    return { framing: await setFraming(body.framing) };
  });
}
