import { connection } from "next/server";
import { agentManifest } from "@/server/discovery";
import { json } from "@/server/http";

export async function GET() {
  await connection();
  return json(agentManifest(), 200, { "access-control-allow-origin": "*" });
}
