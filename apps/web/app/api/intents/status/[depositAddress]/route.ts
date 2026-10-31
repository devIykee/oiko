import { connection } from "next/server";
import { handle } from "@/server/http";
import { intentStatus } from "@/server/intents";

export async function GET(req: Request, ctx: { params: Promise<{ depositAddress: string }> }) {
  await connection();
  const { depositAddress } = await ctx.params;
  const q = new URL(req.url).searchParams;
  return handle(() => intentStatus(decodeURIComponent(depositAddress), q.get("memo"), q.get("ticket")));
}
