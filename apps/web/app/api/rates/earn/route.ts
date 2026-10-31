import { connection } from "next/server";
import { handle } from "@/server/http";
import { earnRates } from "@/server/rates";

export async function GET() {
  await connection();
  return handle(() => earnRates());
}
