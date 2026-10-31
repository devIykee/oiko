import { ApiError } from "@/server/errors";
import { clientIp, handle, readBody } from "@/server/http";
import { withdrawQuote } from "@/server/intents";
import { checkLimits } from "@/server/ratelimit";
import { WithdrawQuoteBody } from "@/server/schemas";

export async function POST(req: Request) {
  return handle(async () => {
    const body = await readBody(req, WithdrawQuoteBody);
    if (!checkLimits("intents", clientIp(req), body.vaultId)) throw new ApiError("E_RATE_LIMIT", 429);
    return withdrawQuote(body);
  });
}
