import { connection } from "next/server";
import { httpCreate, httpList } from "@/server/invoicesHttp";

export async function GET(req: Request) {
  await connection();
  return httpList(req);
}
export async function POST(req: Request) {
  return httpCreate(req);
}
