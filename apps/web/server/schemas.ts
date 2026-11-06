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
export const AgentCreateAccountBody = z.object({
  name: z.string().min(2).max(32),
  publicKey: PublicKeyZ,
  proof: z.object({
    signature: z.string().min(1),
    nonce: z.string().min(1),
    timestamp: z.number(),
  }),
});
export const RelayBody = z.object({ signedDelegate: z.string().min(16).max(200_000) });
export const TopupBody = z.object({ accountId: AccountIdZ });
export const SyncBody = z.object({ vaultId: AccountIdZ });
export const InvoiceIdZ = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{16,24}$/, "must be an invoice id");
export const DepositAddressBody = z.object({
  name: z.string().min(2).max(32), originAsset: z.string().min(3).max(200), amount: U128, refundTo: z.string().min(2).max(200),
  /** Optional: pay this invoice. The server fixes the amount (what is left to pay) and records the deposit on the invoice. */
  invoiceId: InvoiceIdZ.optional(),
});
export const WithdrawQuoteBody = z.object({
  vaultId: AccountIdZ, potId: z.number().int().nonnegative(), token: TokenZ, amount: U128,
  destinationAsset: z.string().min(3).max(200), destinationAddress: z.string().min(2).max(200),
});
export const SimulateDepositBody = z.object({
  depositAddress: z.string().min(2).max(200), memo: z.string().max(64).optional(), ticket: z.string().max(8000).optional(), invoiceId: InvoiceIdZ.optional(),
});
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

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date yyyy-mm-dd").refine((d) => !Number.isNaN(Date.parse(d + "T00:00:00Z")), "must be a real date");
export const InvoiceItemZ = z.object({
  description: z.string().trim().min(1, "describe the work").max(200),
  quantity: z.string().trim().regex(/^\d{1,9}(\.\d{1,4})?$/, "must be a number with up to 4 decimals").refine((q) => Number(q) > 0, "must be more than 0"),
  unitPrice: U128,
});
export const InvoiceBody = z.object({
  fromName: z.string().trim().min(1).max(80),
  client: z.object({ name: z.string().trim().min(1, "add the client's name").max(120), email: z.string().trim().email().max(200).nullable().optional() }),
  items: z.array(InvoiceItemZ).min(1, "add at least one line").max(50),
  token: TokenZ,
  dueDate: IsoDate,
  note: z.string().trim().max(1000).nullable().optional(),
  /** "draft" saves without sharing; "open" makes the link payable. */
  state: z.enum(["draft", "open"]).default("open"),
});
export const InvoicePatchBody = z.object({
  fromName: z.string().trim().min(1).max(80).optional(),
  client: InvoiceBody.shape.client.optional(),
  items: z.array(InvoiceItemZ).min(1).max(50).optional(),
  token: TokenZ.optional(),
  dueDate: IsoDate.optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  state: z.enum(["draft", "open", "cancelled"]).optional(),
});
