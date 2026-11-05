import { connection } from "next/server";
import { clearCookie } from "@/server/admin";
import { json } from "@/server/http";

export async function POST() {
  await connection();
  return json({ ok: true }, 200, { "set-cookie": clearCookie() });
}
