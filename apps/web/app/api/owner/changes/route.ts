import { connection } from "next/server";
import { ownerListChanges } from "@/server/ownerHttp";

export async function GET(req: Request) {
  await connection();
  return ownerListChanges(req);
}
