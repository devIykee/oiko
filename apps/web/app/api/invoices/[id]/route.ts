import { connection } from "next/server";
import { httpGet, httpPatch } from "@/server/invoicesHttp";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await ctx.params;
  return httpGet(req, decodeURIComponent(id));
}
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return httpPatch(req, decodeURIComponent(id));
}
