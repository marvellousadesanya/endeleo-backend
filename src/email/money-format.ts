// Money as a person reads it, for anything they will see: emails, notification bodies.
//
// Amounts are stored and moved as bigint minor units (kobo) and must stay that way —
// this converts to Number only at the very end, to render. Never feed the result of
// this back into a calculation.
//
// It existed three times before this file did: twice as a private method on
// WalletService and once as a module-level helper in the sponsor portal.

/** `250000000n` → `"2,500,000.00"`. No currency symbol — callers add it. */
export function majorAmount(amountMinor: bigint | number | string): string {
  return (Number(amountMinor) / 100).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** `250000000n` → `"₦2,500,000.00"`. NGN is the only currency the platform pays in today. */
export function naira(amountMinor: bigint | number | string): string {
  return `₦${majorAmount(amountMinor)}`;
}
