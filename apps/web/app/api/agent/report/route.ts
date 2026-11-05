import { agentReport } from "@/server/counterpartyHttp";

export async function POST(req: Request) {
  return agentReport(req);
}
