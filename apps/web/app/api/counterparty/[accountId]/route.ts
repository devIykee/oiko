import { connection } from "next/server";
import { counterpartyPublic } from "@/server/counterpartyHttp";

export async function GET(req: Request, ctx: { params: Promise<{ accountId: string }> }) {
  await connection();
  const { accountId } = await ctx.params;
  return counterpartyPublic(req, accountId);
}
