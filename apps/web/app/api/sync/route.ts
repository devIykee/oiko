import { clientIp, handle, readBody } from "@/server/http";
import { syncVault } from "@/server/relayer";
import { SyncBody } from "@/server/schemas";

export async function POST(req: Request) {
  return handle(async () => syncVault((await readBody(req, SyncBody)).vaultId, clientIp(req)));
}
