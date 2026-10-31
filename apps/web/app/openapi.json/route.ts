import { connection } from "next/server";
import { openApiDocument } from "@/server/discovery";
import { json } from "@/server/http";

export async function GET() {
  await connection();
  return json(openApiDocument(), 200, { "access-control-allow-origin": "*" });
}
