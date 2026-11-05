// zod schemas for every HTTP body (also used to generate /openapi.json).
import { z } from "zod";

export const U128 = z.string().regex(/^\d{1,39}$/, "must be an integer string in base units");
export const TokenZ = z.enum(["usdc", "usdt"]);
export const AccountIdZ = z.string().min(2).max(64).regex(/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/, "must be a NEAR account id");
export const PublicKeyZ = z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/, "must be ed25519:<base58>");

export const AgentActionZ = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pay"), token: TokenZ, amount: U128, to: AccountIdZ, memo: z.string().max(140).nullable().default(null) }),
  z.object({ type: z.literal("pay_bill"), bill_id: z.number().int().nonnegative() }),
  z.object({ type: z.literal("move"), from_pot: z.number().int().nonnegative(), to_pot: z.number().int().nonnegative(), token: TokenZ, amount: U128 }),
  z.object({ type: z.literal("save"), to_pot: z.number().int().nonnegative(), token: TokenZ, amount: U128 }),
]);

export const RegisterBody = z.object({ name: z.string().min(2).max(32), ownerPublicKey: PublicKeyZ, appPublicKey: PublicKeyZ });
export const RelayBody = z.object({ signedDelegate: z.string().min(16).max(200_000) });
export const TopupBody = z.object({ accountId: AccountIdZ });
export const SyncBody = z.object({ vaultId: AccountIdZ });
export const DepositAddressBody = z.object({ name: z.string().min(2).max(32), originAsset: z.string().min(3).max(200), amount: U128, refundTo: z.string().min(2).max(200) });
export const WithdrawQuoteBody = z.object({
  vaultId: AccountIdZ, potId: z.number().int().nonnegative(), token: TokenZ, amount: U128,
  destinationAsset: z.string().min(3).max(200), destinationAddress: z.string().min(2).max(200),
});
export const SimulateDepositBody = z.object({ depositAddress: z.string().min(2).max(200), memo: z.string().max(64).optional(), ticket: z.string().max(8000).optional() });
export const PrepareBody = z.object({ kind: z.enum(["propose", "act"]), action: AgentActionZ, reason: z.string().max(280).optional() });
export const SubmitBody = z.object({ signedTx: z.string().min(16).max(100_000) });
export const PushSubscribeBody = z.object({
  accountId: AccountIdZ, subscription: z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) }),
});
export const ReportBody = z.object({
  receiver: AccountIdZ,
  reason: z.string().trim().min(8, "explain what happened in a sentence").max(280),
  evidence: z.string().trim().min(4, "give a URL, transaction hash or the text you received").max(1000),
});
