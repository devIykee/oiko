// Invoice totals with bigint (shared by the server and the invoice form). Amounts in base units (6 decimals).

/** Quantities are decimals with up to 4 fraction digits ("7.5" hours), scaled by 10^4. */
export const QTY_SCALE = 10_000n;

/** "7.5" -> 75000n (scaled by 10^4). Throws on bad input. */
export function parseQuantity(q: string): bigint {
  const m = /^(\d{1,9})(?:\.(\d{1,4}))?$/.exec(q.trim());
  if (!m) throw new Error(`Not a quantity: "${q}"`);
  return BigInt(m[1]!) * QTY_SCALE + BigInt((m[2] ?? "").padEnd(4, "0"));
}

/** Line total in base units: quantity × unit price, rounded half up to the nearest base unit. */
export function lineTotal(item: { quantity: string; unitPrice: string }): bigint {
  const q = parseQuantity(item.quantity);
  const p = BigInt(item.unitPrice);
  return (q * p + QTY_SCALE / 2n) / QTY_SCALE;
}

export function invoiceTotal(items: Array<{ quantity: string; unitPrice: string }>): bigint {
  return items.reduce((a, i) => a + lineTotal(i), 0n);
}
