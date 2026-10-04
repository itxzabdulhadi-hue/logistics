import type { Metadata } from "next";
import Link from "next/link";
import { RefundPaymentForm, RecordInvoicePaymentForm } from "@/components/payments/finance-actions";
import { PaymentStatusBadge } from "@/components/payments/payment-status-badge";
import { Alert, Card, CardHeader, EmptyState, PageHeader, StatCard } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { formatDateTime, formatMoney } from "@/lib/utils";
import { getFinanceDashboard, isStripeReady } from "@/services/billing";

export const metadata: Metadata = { title: "Finance" };
export const dynamic = "force-dynamic";

export default async function AdminFinancePage() {
  const user = await requireRole(["admin", "dispatcher"]);
  const [finance, stripeReady] = await Promise.all([getFinanceDashboard(), Promise.resolve(isStripeReady())]);
  const canManage = user.role === "admin";

  return (
    <>
      <PageHeader
        eyebrow="Finance operations"
        title="Payments & invoices"
        description="Collected revenue, payment attempts, refunds and outstanding customer balances."
      />

      {!stripeReady && (
        <Alert tone="warning" title="Stripe checkout is not configured" className="mb-6">
          Add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to enable secure card checkout. Account invoices can still be reconciled manually by an admin.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Net revenue this month" value={formatMoney(finance.summary.revenueMonthCents)} tone="green" hint="Successful payments less refunds issued this month" />
        <StatCard label="Payments this month" value={formatMoney(finance.summary.paymentsMonthCents)} tone="blue" hint={`${finance.summary.paymentsMonthCount} successful transaction${finance.summary.paymentsMonthCount === 1 ? "" : "s"}`} />
        <StatCard label="Refunds this month" value={formatMoney(finance.summary.refundsMonthCents)} tone="amber" hint={`${finance.summary.refundsMonthCount} completed refund${finance.summary.refundsMonthCount === 1 ? "" : "s"}`} />
        <StatCard label="Outstanding" value={formatMoney(finance.summary.outstandingCents)} tone="orange" hint={`${finance.summary.outstandingInvoiceCount} invoice${finance.summary.outstandingInvoiceCount === 1 ? "" : "s"} with a balance due`} />
      </div>

      {(finance.summary.failedPaymentsCount > 0 || finance.summary.pendingPaymentsCount > 0) && (
        <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-600">
          <span>{finance.summary.failedPaymentsCount} failed payment attempt{finance.summary.failedPaymentsCount === 1 ? "" : "s"}</span>
          <span>{finance.summary.pendingPaymentsCount} payment{finance.summary.pendingPaymentsCount === 1 ? "" : "s"} processing</span>
        </div>
      )}

      <Card className="mt-6">
        <CardHeader title="Outstanding invoices" description="Balances are calculated from issued invoice totals and settled payments." />
        {finance.outstandingInvoices.length === 0 ? (
          <EmptyState title="No outstanding invoices" description="Completed bookings with an unpaid balance will appear here." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {finance.outstandingInvoices.map((invoice) => (
              <li key={invoice.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link href={`/admin/bookings/${invoice.bookingId}`} className="font-semibold text-slate-900 hover:text-orange-700">
                      {invoice.invoiceNumber} · {invoice.bookingReference}
                    </Link>
                    <p className="mt-1 text-sm text-slate-600">{invoice.customerName}{invoice.customerCompany ? ` · ${invoice.customerCompany}` : ""}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{invoice.paymentMethod === "account" ? "On account" : "Card invoice"} · Issued {formatDateTime(invoice.issuedAt)}</p>
                  </div>
                  <div className="text-right">
                    <PaymentStatusBadge status={invoice.paymentStatus} />
                    <p className="mt-1 text-lg font-bold text-slate-900">{formatMoney(invoice.dueCents, invoice.currency)} due</p>
                  </div>
                </div>
                {canManage && invoice.paymentMethod === "account" && invoice.dueCents > 0 && (
                  <RecordInvoicePaymentForm invoiceId={invoice.id} dueCents={invoice.dueCents} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-6">
        <CardHeader title="Transaction history" description="Card attempts, reconciled account payments and their refunds." />
        {finance.recentPayments.length === 0 ? (
          <EmptyState title="No transactions yet" description="Payments will appear after a completed booking is invoiced." />
        ) : (
          <div className="divide-y divide-slate-100">
            {finance.recentPayments.map((payment) => {
              const pendingRefundCents = payment.refunds.filter((refund) => refund.status === "pending").reduce((sum, refund) => sum + refund.amountCents, 0);
              const refundableCents = Math.max(0, payment.amountCents - payment.refundedCents - pendingRefundCents);
              const refundable = canManage && payment.provider === "stripe" && ["succeeded", "partially_refunded"].includes(payment.status) && refundableCents > 0;
              return (
                <div key={payment.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <PaymentStatusBadge status={payment.status} />
                        <span className="text-xs font-semibold text-slate-900">{payment.invoiceNumber} · {payment.bookingReference}</span>
                      </div>
                      <p className="mt-1 text-sm text-slate-700">{payment.customerName}{payment.customerCompany ? ` · ${payment.customerCompany}` : ""}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{payment.provider === "stripe" ? "Stripe card" : "Manual / bank"} · {formatDateTime(payment.paidAt ?? payment.createdAt)}{payment.externalReference ? ` · Ref ${payment.externalReference}` : ""}</p>
                      {payment.failureMessage && <p className="mt-1 text-xs text-red-700">{payment.failureMessage}</p>}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-slate-900">{formatMoney(payment.amountCents, payment.currency)}</p>
                      {payment.refundedCents > 0 && <p className="text-xs text-violet-700">{formatMoney(payment.refundedCents, payment.currency)} refunded</p>}
                      <Link href={`/admin/bookings/${payment.bookingId}`} className="mt-1 inline-block text-xs font-semibold text-orange-700 hover:underline">View booking →</Link>
                    </div>
                  </div>
                  {payment.refunds.length > 0 && (
                    <ul className="mt-3 space-y-2 border-l-2 border-slate-200 pl-3">
                      {payment.refunds.map((refund) => (
                        <li key={refund.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="flex items-center gap-2"><PaymentStatusBadge status={refund.status} /> Refund · {formatDateTime(refund.completedAt ?? refund.createdAt)}{refund.reason ? ` · ${refund.reason.replaceAll("_", " ")}` : ""}</span>
                          <span className="font-semibold text-slate-700">−{formatMoney(refund.amountCents, payment.currency)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {refundable && <RefundPaymentForm paymentId={payment.id} refundableCents={refundableCents} />}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}
