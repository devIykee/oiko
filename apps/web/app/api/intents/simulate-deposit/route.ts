import { ApiError } from "@/server/errors";
import { clientIp, handle, readBody } from "@/server/http";
import { simulateDeposit } from "@/server/intents";
import { attachTicket, invoiceDeps } from "@/server/invoicesHttp";
import { checkLimits, checkSharedLimits } from "@/server/ratelimit";
import { store } from "@/server/store";
import { SimulateDepositBody } from "@/server/schemas";

export async function POST(req: Request) {
  return handle(async () => {
    const body = await readBody(req, SimulateDepositBody);
    if (!checkLimits("simulate", clientIp(req), body.depositAddress) || !(await checkSharedLimits("simulate", clientIp(req), body.depositAddress, store()))) throw new ApiError("E_RATE_LIMIT", 429);
    const r = await simulateDeposit(body.depositAddress, body.memo, body.ticket);
    if (body.invoiceId) await attachTicket(body.invoiceId, body.depositAddress, body.memo ?? null, r.ticket ?? null, invoiceDeps());
    return r;
  });
}
