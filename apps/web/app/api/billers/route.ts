import { connection } from "next/server";
import { billersFor } from "@/server/billers";
import { serverConfig } from "@/server/config";
import { handle } from "@/server/http";

// Public: the verified billers directory for this network (names, categories, account ids).
export async function GET() {
  await connection();
  return handle(async () => ({ billers: billersFor(serverConfig().network) }));
}
