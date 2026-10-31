import { ApiError } from "@/server/errors";
import { isMockEnabled } from "@/server/mock1click";
import { mockErrorResponse } from "@/server/mockHttp";
import { json, readText } from "@/server/http";
import { mockQuote } from "@/server/mock1click";

export async function POST(req: Request) {
  try {
    if (!isMockEnabled()) throw new ApiError("E_TEST_ONLY", 404);
    return json(await mockQuote(JSON.parse((await readText(req)) || "{}")));
  } catch (e) {
    return mockErrorResponse(e);
  }
}
