import { connection } from "next/server";
import { handle } from "@/server/http";
import { publicConfig } from "@/server/public";

export async function GET() {
  await connection();
  return handle(async () => publicConfig());
}
