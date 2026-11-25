import { connection } from "next/server";
import { requireAdmin } from "@/server/admin";
import { adminDashboard } from "@/server/adminDashboard";
import { handle } from "@/server/http";

// GET /api/admin/dashboard[?fresh=1][&sample=30]: operator summary (admin session cookie required). Cached 30 s.
export async function GET(req: Request) {
  await connection();
  return handle(async () => {
    requireAdmin(req);
    const u = new URL(req.url);
    const sample = Number(u.searchParams.get("sample") ?? 30);
    return adminDashboard({ fresh: u.searchParams.get("fresh") === "1", sample: Number.isFinite(sample) ? sample : 30 });
  });
}
