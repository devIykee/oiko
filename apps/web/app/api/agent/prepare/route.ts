import { agentWrite } from "@/server/agentHttp";

export async function POST(req: Request) {
  return agentWrite(req, "prepare");
}
