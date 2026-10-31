import { connection } from "next/server";
import { agentLog } from "@/server/agentHttp";

export async function GET(req: Request) {
  await connection();
  return agentLog(req);
}
