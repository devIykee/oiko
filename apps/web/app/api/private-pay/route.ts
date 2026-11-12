import { connection } from "next/server";
import { ApiError } from "@/server/errors";
import { clientIp, handle } from "@/server/http";
import { privatePayQuote } from "@/server/privatePay";
import { checkLimits } from "@/server/ratelimit";

// GET /api/private-pay?asset=<1Click asset id>&amount=<base units>: how much to cash out of Gloam (docs/PRIVACY.md).
export async function GET(req: Request) {
  await connection();
  return handle(async () => {
    if (!checkLimits("intents", clientIp(req), null)) throw new ApiError("E_RATE_LIMIT", 429);
    const q = new URL(req.url).searchParams;
    return privatePayQuote(q.get("asset") ?? "", q.get("amount") ?? "");
  });
}
