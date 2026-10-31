import { connection } from "next/server";
import { ApiError } from "@/server/errors";
import { isMockEnabled } from "@/server/mock1click";
import { mockErrorResponse } from "@/server/mockHttp";
import { json } from "@/server/http";
import { mockStatus } from "@/server/mock1click";

export async function GET(req: Request) {
  await connection();
  try {
    if (!isMockEnabled()) throw new ApiError("E_TEST_ONLY", 404);
    const u = new URL(req.url);
    const addr = u.searchParams.get("depositAddress");
    if (!addr) throw new ApiError("E_BAD_REQUEST", 400, "depositAddress should not be empty");
    return json(await mockStatus(addr, Date.now(), undefined, u.searchParams.get("depositMemo")));
  } catch (e) {
    return mockErrorResponse(e);
  }
}
