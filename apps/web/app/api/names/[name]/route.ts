import { connection } from "next/server";
import { handle } from "@/server/http";
import { nameInfo } from "@/server/public";

export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  await connection();
  const { name } = await ctx.params;
  return handle(() => nameInfo(name));
}
