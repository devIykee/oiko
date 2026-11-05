import { connection } from "next/server";
import { ApiError } from "@/server/errors";
import { agentRead } from "@/server/agentHttp";
import { errorResponse } from "@/server/http";

const READ_TOOLS = new Set(["me", "overview", "pots", "activity", "goals", "splits", "bills", "insights", "earn-rates", "rosca", "ajo", "counterparty"]);

export async function GET(req: Request, ctx: { params: Promise<{ tool: string }> }) {
  await connection();
  const { tool } = await ctx.params;
  if (!READ_TOOLS.has(tool)) return errorResponse(new ApiError("E_NOT_FOUND", 404));
  return agentRead(req, tool);
}
