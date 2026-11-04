import { ApiError } from "@/server/errors";
import { isMockEnabled } from "@/server/mock1click";
import { mockErrorResponse } from "@/server/mockHttp";
import { clientIp, json, readText } from "@/server/http";
import { checkLimits } from "@/server/ratelimit";
import { mockQuote } from "@/server/mock1click";

export async function POST(req: Request) {
  try {
    if (!isMockEnabled()) throw new ApiError("E_TEST_ONLY", 404);
    // Unauthenticated and writes swap state: same per-IP limit as the intents proxy.
    if (!checkLimits("intents", clientIp(req), null)) throw new ApiError("E_RATE_LIMIT", 429);
    return json(await mockQuote(JSON.parse((await readText(req)) || "{}")));
  } catch (e) {
    return mockErrorResponse(e);
  }
}
