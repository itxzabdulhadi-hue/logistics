import type { BookingQuoteSnapshot, InvoiceCharge } from "@/db/schema";

export function invoiceFinancials(
  totalCents: number,
  quote: BookingQuoteSnapshot | null,
  distanceKm: number | null,
) {
  const taxRateBasisPoints = quote?.gstRateBasisPoints ?? 1_000;
  const subtotalCents = quote && totalCents === quote.totalCents
    ? quote.subtotalCents
    : taxRateBasisPoints > 0
      ? Math.round((totalCents * 10_000) / (10_000 + taxRateBasisPoints))
      : totalCents;
  const taxCents = totalCents - subtotalCents;
  let charges: InvoiceCharge[];

  if (!quote) {
    charges = [{ description: "Freight and delivery service", amountCents: subtotalCents }];
  } else {
    charges = [
      { description: "Vehicle base fare", amountCents: quote.baseFareCents },
      { description: `Routed distance${distanceKm == null ? "" : ` (${distanceKm.toFixed(1)} km)`}`, amountCents: quote.distanceCents },
    ];
    if (quote.minimumAdjustmentCents > 0) {
      charges.push({ description: "Minimum fare adjustment", amountCents: quote.minimumAdjustmentCents });
    }
    charges.push(...quote.extras.map((extra) => ({ description: extra.label, amountCents: extra.cents })));
    const representedSubtotal = charges.reduce((sum, charge) => sum + charge.amountCents, 0);
    const adjustment = subtotalCents - representedSubtotal;
    if (adjustment !== 0) charges.push({ description: "Final price adjustment", amountCents: adjustment });
  }

  return { charges, subtotalCents, taxRateBasisPoints, taxCents, totalCents };
}

export function formatInvoiceNumber(year: number, sequence: number) {
  return `LL-${year}-${String(sequence).padStart(6, "0")}`;
}
