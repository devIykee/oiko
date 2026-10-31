import { clientIp, handle, readBody } from "@/server/http";
import { relaySignedDelegate } from "@/server/relayer";
import { RelayBody } from "@/server/schemas";

export async function POST(req: Request) {
  return handle(async () => relaySignedDelegate((await readBody(req, RelayBody)).signedDelegate, clientIp(req)));
}
