import { connection } from "next/server";
import { ApiError } from "@/server/errors";
import { clientIp, handle } from "@/server/http";
import { checkLimits } from "@/server/ratelimit";
import { listReceipts } from "@/server/receipts";

// GET /api/receipts?vault=vault.<name>.<root>: what payers sent and the fee for recent incoming payments.
export async function GET(req: Request) {
  await connection();
  return handle(async () => {
    if (!checkLimits("intents", clientIp(req), null)) throw new ApiError("E_RATE_LIMIT", 429);
    const vault = new URL(req.url).searchParams.get("vault") ?? "";
    if (!/^vault\.[a-z0-9_.-]{2,100}$/.test(vault)) throw new ApiError("E_BAD_REQUEST", 400, "Pass ?vault=vault.<name>.<root>.");
    return { receipts: await listReceipts(vault) };
  });
}
