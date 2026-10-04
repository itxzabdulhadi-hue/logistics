import type { InvoiceHistory } from "@/services/billing";
import { CheckoutButton } from "@/components/payments/checkout-button";
import { PaymentStatusBadge } from "@/components/payments/payment-status-badge";
import { Alert, Card, CardHeader } from "@/components/ui";
import { formatDateTime, formatMoney } from "@/lib/utils";

export function InvoicePanel({
  history,
  canCheckout = false,
  stripeReady = false,
}: {
  history: InvoiceHistory;
  canCheckout?: boolean;
  stripeReady?: boolean;
}) {
  const { invoice, payments } = history;
  const collectedCents = payments.reduce((total, payment) =>
    payment.status === "succeeded" || payment.status === "partially_refunded" || payment.status === "refunded"
      ? total + payment.amountCents
      : total,
  0);
  const refundedCents = payments.reduce((total, payment) => total + payment.refunds.reduce((sum, refund) => sum + (refund.status === "succeeded" ? refund.amountCents : 0), 0), 0);
  const dueCents = Math.max(0, invoice.totalCents - collectedCents);
  const route = [invoice.pickupAddress, ...invoice.additionalStops.map((stop) => stop.address), invoice.dropoffAddress];
  const checkoutAllowed = canCheckout && ["outstanding", "failed", "partially_paid"].includes(invoice.paymentStatus);

  return (
    <Card>
      <CardHeader
        title="Invoice"
        description={`${invoice.invoiceNumber} · issued ${formatDateTime(invoice.issuedAt)}`}
        action={<PaymentStatusBadge status={invoice.paymentStatus} />}
      />
      <div className="space-y-5 p-5">
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Billed to</p>
            <p className="mt-1 font-semibold text-slate-900">{invoice.customerName}</p>
            {invoice.customerCompany && <p className="text-slate-600">{invoice.customerCompany}</p>}
            <p className="text-xs text-slate-500">{invoice.customerEmail}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Booking & vehicle</p>
            <p className="mt-1 font-semibold text-slate-900">{invoice.bookingReference}</p>
            <p className="text-slate-600">{invoice.vehicleDescription}</p>
            <p className="text-xs text-slate-500">{invoice.loadDescription}</p>
          </div>
        </div>

        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Route</p>
          <ol className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-700">
            {route.map((address, index) => (
              <li key={`${index}-${address}`} className="flex items-center gap-2">
                {index > 0 && <span aria-hidden>→</span>}
                <span>{address}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="py-2 pr-4">Charge</th><th className="py-2 text-right">Amount</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoice.charges.map((charge, index) => (
                <tr key={`${charge.description}-${index}`}>
                  <td className="py-2 pr-4 text-slate-700">{charge.description}</td>
                  <td className="py-2 text-right font-medium text-slate-900">{formatMoney(charge.amountCents, invoice.currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-slate-200">
              <tr><td className="pt-3 text-slate-600">Subtotal</td><td className="pt-3 text-right font-medium">{formatMoney(invoice.subtotalCents, invoice.currency)}</td></tr>
              <tr><td className="pt-2 text-slate-600">{invoice.taxLabel} ({(invoice.taxRateBasisPoints / 100).toFixed(2)}%)</td><td className="pt-2 text-right font-medium">{formatMoney(invoice.taxCents, invoice.currency)}</td></tr>
              <tr><td className="pt-3 text-base font-bold text-slate-900">Total</td><td className="pt-3 text-right text-base font-bold text-slate-900">{formatMoney(invoice.totalCents, invoice.currency)}</td></tr>
              <tr><td className="pt-2 text-slate-600">Payments received</td><td className="pt-2 text-right text-slate-700">{formatMoney(collectedCents, invoice.currency)}</td></tr>
              {refundedCents > 0 && <tr><td className="pt-2 text-slate-600">Refunded</td><td className="pt-2 text-right text-violet-700">−{formatMoney(refundedCents, invoice.currency)}</td></tr>}
              <tr><td className="pt-2 font-semibold text-slate-900">Balance due</td><td className="pt-2 text-right font-semibold text-slate-900">{formatMoney(dueCents, invoice.currency)}</td></tr>
            </tfoot>
          </table>
        </div>

        {canCheckout && checkoutAllowed && (
          stripeReady
            ? <CheckoutButton bookingId={invoice.bookingId} />
            : <Alert tone="warning" title="Card checkout is not configured">Please contact dispatch to arrange payment.</Alert>
        )}
        {canCheckout && invoice.paymentStatus === "pending" && (
          <Alert tone="info">A payment attempt is processing. This page will update when Stripe confirms it.</Alert>
        )}
        {invoice.paymentStatus === "refunded" && <Alert tone="info">The invoice has been fully refunded.</Alert>}
        {invoice.paymentStatus === "partially_refunded" && <Alert tone="warning">A partial refund has been issued. Contact dispatch if you have questions about the remaining balance.</Alert>}

        <div className="border-t border-slate-100 pt-4">
          <h3 className="text-sm font-semibold text-slate-900">Transaction history</h3>
          {payments.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">No payment attempts have been recorded.</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100">
              {payments.map((payment) => (
                <li key={payment.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <PaymentStatusBadge status={payment.status} />
                      <span className="text-xs text-slate-500">{payment.provider === "stripe" ? "Card" : "Manual / bank"} · {formatDateTime(payment.paidAt ?? payment.createdAt)}</span>
                    </div>
                    <span className="text-sm font-semibold text-slate-900">{formatMoney(payment.amountCents, payment.currency)}</span>
                  </div>
                  {payment.externalReference && <p className="mt-1 text-xs text-slate-500">Reference: {payment.externalReference}</p>}
                  {payment.failureMessage && <p className="mt-1 text-xs text-red-700">{payment.failureMessage}</p>}
                  {payment.refunds.map((refund) => (
                    <div key={refund.id} className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                      <div className="flex items-center gap-2"><PaymentStatusBadge status={refund.status} /><span className="text-xs text-slate-500">Refund · {formatDateTime(refund.completedAt ?? refund.createdAt)}</span></div>
                      <span className="text-xs font-semibold text-slate-700">−{formatMoney(refund.amountCents, payment.currency)}</span>
                      {refund.failureMessage && <p className="w-full text-xs text-red-700">{refund.failureMessage}</p>}
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
