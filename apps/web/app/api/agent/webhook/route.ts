import { connection } from "next/server";
import { agentWebhook } from "@/server/agentHttp";

export async function POST(req: Request) {
  await connection();
  return agentWebhook(req);
}
