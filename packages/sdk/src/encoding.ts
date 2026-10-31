import { base58, base64, base64urlnopad, hex } from "@scure/base";

export const b58encode = (b: Uint8Array) => base58.encode(b);
export const b58decode = (s: string) => base58.decode(s);
export const b64encode = (b: Uint8Array) => base64.encode(b);
export function b64decode(s: string): Uint8Array {
  const t = s.trim().replace(/-/g, "+").replace(/_/g, "/");
  return base64.decode(t + "=".repeat((4 - (t.length % 4)) % 4));
}
export const b64urlEncode = (b: Uint8Array) => base64urlnopad.encode(b);
export const hexEncode = (b: Uint8Array) => hex.encode(b);
export const hexDecode = (s: string) => hex.decode(s);
export const utf8 = (s: string) => new TextEncoder().encode(s);
export const fromUtf8 = (b: Uint8Array) => new TextDecoder().decode(b);
