import { connection } from "next/server";
import { llmsTxt } from "@/server/discovery";

export async function GET() {
  await connection();
  return new Response(llmsTxt(), { headers: { "content-type": "text/plain; charset=utf-8", "access-control-allow-origin": "*" } });
}
