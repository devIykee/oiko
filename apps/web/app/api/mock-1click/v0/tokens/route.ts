import { connection } from "next/server";
import { ApiError } from "@/server/errors";
import { isMockEnabled } from "@/server/mock1click";
import { errorResponse, json } from "@/server/http";
import { mockTokens } from "@/server/mock1click";

export async function GET() {
  await connection();
  if (!isMockEnabled()) return errorResponse(new ApiError("E_TEST_ONLY", 404));
  return json(mockTokens());
}
