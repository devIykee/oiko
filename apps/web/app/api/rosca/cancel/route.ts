import { z } from "zod";
import { clientIp, handle, readBody } from "@/server/http";
import { cancelExpiredCircle } from "@/server/relayer";

const Body = z.object({ circleId: z.number().int().positive() });

/** Permissionless cancel of a ROSCA group that is past its forming window (refunds all bonds). */
export async function POST(req: Request) {
  return handle(async () => cancelExpiredCircle((await readBody(req, Body)).circleId, clientIp(req)));
}
