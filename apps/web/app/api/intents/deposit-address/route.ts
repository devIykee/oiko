import { ApiError } from "@/server/errors";
import { clientIp, handle, readBody } from "@/server/http";
import { depositAddress } from "@/server/intents";
import { payDeps, startInvoicePayment } from "@/server/invoicesHttp";
import { checkLimits } from "@/server/ratelimit";
import { DepositAddressBody } from "@/server/schemas";

export async function POST(req: Request) {
  return handle(async () => {
    const body = await readBody(req, DepositAddressBody);
    if (!checkLimits("intents", clientIp(req), body.invoiceId ?? body.name)) throw new ApiError("E_RATE_LIMIT", 429);
    // Invoice payments: the server fixes the amount and ties the deposit to the invoice.
    if (body.invoiceId) return startInvoicePayment({ invoiceId: body.invoiceId, originAsset: body.originAsset, refundTo: body.refundTo }, payDeps());
    return depositAddress(body);
  });
}
