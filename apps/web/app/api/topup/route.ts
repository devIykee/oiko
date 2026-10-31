import { clientIp, handle, readBody } from "@/server/http";
import { topup } from "@/server/relayer";
import { TopupBody } from "@/server/schemas";

export async function POST(req: Request) {
  return handle(async () => topup((await readBody(req, TopupBody)).accountId, clientIp(req)));
}
