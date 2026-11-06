import { connection } from "next/server";
import { agentChange } from "@/server/agentHttp";

export async function POST(req: Request) {
  await connection();
  return agentChange(req);
}
