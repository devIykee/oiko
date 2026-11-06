import { connection } from "next/server";
import { ownerAutopilot } from "@/server/ownerHttp";

export async function GET(req: Request) {
  await connection();
  return ownerAutopilot(req);
}
export async function POST(req: Request) {
  await connection();
  return ownerAutopilot(req);
}
