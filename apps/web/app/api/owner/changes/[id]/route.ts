import { connection } from "next/server";
import { ownerDecideChange } from "@/server/ownerHttp";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await ctx.params;
  return ownerDecideChange(req, id);
}
