import { connection } from "next/server";
import { getFraming } from "@/server/admin";
import { handle } from "@/server/http";
import { publicConfig } from "@/server/public";

export async function GET() {
  await connection();
  // framing is presentation only (landing wording); network/contracts above stay the real ones.
  return handle(async () => ({ ...publicConfig(), framing: await getFraming() }));
}
