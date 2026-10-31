import { clientIp, handle, readBody } from "@/server/http";
import { registerName } from "@/server/relayer";
import { RegisterBody } from "@/server/schemas";

export async function POST(req: Request) {
  return handle(async () => registerName(await readBody(req, RegisterBody), clientIp(req)));
}
