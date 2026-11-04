import { ApiError } from "@/server/errors";
import { isMockEnabled } from "@/server/mock1click";
import { mockErrorResponse } from "@/server/mockHttp";
import { clientIp, json, readText } from "@/server/http";
import { checkLimits } from "@/server/ratelimit";
import { mockSubmitDeposit } from "@/server/mock1click";

export async function POST(req: Request) {
  try {
    if (!isMockEnabled()) throw new ApiError("E_TEST_ONLY", 404);
    // Each submit can make the relayer mint and sync (gas): same limit as /api/intents/simulate-deposit.
    if (!checkLimits("simulate", clientIp(req), null)) throw new ApiError("E_RATE_LIMIT", 429);
    return json(await mockSubmitDeposit(JSON.parse((await readText(req)) || "{}")));
  } catch (e) {
    return mockErrorResponse(e);
  }
}
