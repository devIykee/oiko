import { ApiError } from "@/server/errors";
import { clientIp, handle, readBody } from "@/server/http";
import { depositAddress } from "@/server/intents";
import { checkLimits } from "@/server/ratelimit";
import { DepositAddressBody } from "@/server/schemas";

export async function POST(req: Request) {
  return handle(async () => {
    const body = await readBody(req, DepositAddressBody);
    if (!checkLimits("intents", clientIp(req), body.name)) throw new ApiError("E_RATE_LIMIT", 429);
    return depositAddress(body);
  });
}
