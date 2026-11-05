import { connection } from "next/server";
import { httpExport } from "@/server/invoicesHttp";

export async function GET(req: Request) {
  await connection();
  return httpExport(req);
}
