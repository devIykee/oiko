// Backwards compatibility for private labels (Veil, docs/PRIVACY.md).
// The server can't open sealed labels, and agents built before Veil (oiko-mcp 0.2.0, REST clients, hosted MCP) don't
// know what a "🔒…" token is. So every agent-facing response shows "Private" in place of a sealed label, unless the
// client asks for the raw tokens with `X-Oiko-Labels: sealed` (oiko-mcp ≥ 0.3 and GatewayClient send it when they hold
// the owner's view key and can open them). Plain-text labels (accounts that never turned Veil on) pass through unchanged.
import { isSealed, maskDeep } from "@oiko/sdk";

export const LABELS_HEADER = "x-oiko-labels";
export type LabelMode = "masked" | "sealed";

export function labelModeOf(req: Request): LabelMode {
  return req.headers.get(LABELS_HEADER)?.trim().toLowerCase() === "sealed" ? "sealed" : "masked";
}
/** Shapes a JSON value for a reader: raw tokens for clients that can open them, "Private" for everyone else. */
export function forReader<T>(v: T, mode: LabelMode): T {
  return mode === "sealed" ? v : maskDeep(v);
}
/** For text a person reads outside the app (push notifications): the label if it's plain, else a neutral fallback. */
export function plainLabel(label: string, fallback: string): string {
  return isSealed(label) ? fallback : label;
}
