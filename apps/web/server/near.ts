import { NearRpc, Signer } from "@oiko/sdk";
import { serverConfig } from "./config";
import { ApiError } from "./errors";

const g = globalThis as unknown as { __oikoRpc?: NearRpc; __oikoRelayer?: Signer };

export function rpc(): NearRpc {
  return (g.__oikoRpc ??= new NearRpc(serverConfig().oiko.nodeUrl));
}
/** The relayer signer, or E_CONFIG if RELAYER_ACCOUNT_ID / RELAYER_PRIVATE_KEY are missing. */
export function relayer(): Signer {
  if (g.__oikoRelayer) return g.__oikoRelayer;
  const r = serverConfig().relayer;
  if (!r) throw new ApiError("E_CONFIG", 503, "The relayer isn't configured. Set RELAYER_ACCOUNT_ID and RELAYER_PRIVATE_KEY.");
  return (g.__oikoRelayer = new Signer(rpc(), r.accountId, r.privateKey));
}
export function setNearForTests(r?: NearRpc, s?: Signer): void {
  g.__oikoRpc = r;
  g.__oikoRelayer = s;
}
