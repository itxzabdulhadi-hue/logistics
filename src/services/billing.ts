import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import Stripe from "stripe";
import { db } from "@/db";
import {
  bookingEvents,
  bookings,
  invoices,
  payments,
  refunds,
  stripeWebhookEvents,
  users,
  vehicleTypes,
  vehicles,
  type Invoice,
  type InvoicePaymentStatus,
  type NewInvoice,
  type Payment,
  type PaymentStatus,
  type Refund,
  type RefundStatus,
} from "@/db/schema";
import { errors } from "@/lib/api";
import type { SafeUser } from "@/lib/auth";
import { formatInvoiceNumber, invoiceFinancials } from "@/lib/invoice";
import { logger } from "@/lib/logger";

let stripeInstance: Stripe | null = null;

type BillingTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type StripeRefundReason = "requested_by_customer" | "duplicate" | "fraudulent";

export function isStripeReady() {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim() && process.env.STRIPE_WEBHOOK_SECRET?.trim());
}

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw errors.unavailable("Card payments are not configured yet.");
  stripeInstance ??= new Stripe(key);
  return stripeInstance;
}

export function stripeReturnOrigin(requestOrigin: string) {
  const configured = process.env.APP_URL?.trim() || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  if (configured) {
    const url = new URL(configured);
    return url.origin;
  }
  if (process.env.NODE_ENV === "production") {
    throw errors.unavailable("Set APP_URL or VERCEL_URL before enabling checkout.");
  }
  return new URL(requestOrigin).origin;
}

function netCollected(rows: Pick<Payment, "status" | "amountCents">[]) {
  return rows.reduce((sum, payment) =>
    payment.status === "succeeded" || payment.status === "partially_refunded" || payment.status === "refunded"
      ? sum + payment.amountCents
      : sum,
  0);
}

async function invoicePaymentStatusTx(tx: BillingTransaction, invoiceId: number) {
  const [invoice] = await tx.select({ id: invoices.id, totalCents: invoices.totalCents }).from(invoices).where(eq(invoices.id, invoiceId)).for("update").limit(1);
  if (!invoice) return null;
  const paymentRows = await tx
    .select({ id: payments.id, status: payments.status, amountCents: payments.amountCents, refundedCents: payments.refundedCents })
    .from(payments)
    .where(eq(payments.invoiceId, invoiceId));
  const refundRows = paymentRows.length
    ? await tx.select({ status: refunds.status, amountCents: refunds.amountCents }).from(refunds).where(inArray(refunds.paymentId, paymentRows.map((row) => row.id)))
    : [];
  const collectedCents = netCollected(paymentRows);
  const refundedCents = refundRows.reduce((sum, refund) => sum + (refund.status === "succeeded" ? refund.amountCents : 0), 0);
  const hasPending = paymentRows.some((payment) => payment.status === "pending") || refundRows.some((refund) => refund.status === "pending");
  const hasFailed = paymentRows.some((payment) => payment.status === "failed") || refundRows.some((refund) => refund.status === "failed");

  let status: InvoicePaymentStatus;
  if (invoice.totalCents === 0 || (collectedCents >= invoice.totalCents && refundedCents === 0)) {
    status = "paid";
  } else if (collectedCents > 0 && refundedCents >= collectedCents) {
    status = "refunded";
  } else if (refundedCents > 0) {
    status = "partially_refunded";
  } else if (collectedCents > 0) {
    status = "partially_paid";
  } else if (hasPending) {
    status = "pending";
  } else if (hasFailed) {
    status = "failed";
  } else {
    status = "outstanding";
  }
  await tx.update(invoices).set({ paymentStatus: status, updatedAt: new Date() }).where(eq(invoices.id, invoiceId));
  return status;
}

async function outstandingCentsTx(tx: BillingTransaction, invoiceId: number, invoiceTotalCents: number) {
  const rows = await tx
    .select({ status: payments.status, amountCents: payments.amountCents })
    .from(payments)
    .where(eq(payments.invoiceId, invoiceId));
  return Math.max(0, invoiceTotalCents - netCollected(rows));
}

/** Create one immutable invoice when a completed job is finalized; safe to call repeatedly. */
export async function ensureInvoiceForBooking(bookingId: number): Promise<Invoice | null> {
  return db.transaction(async (tx) => {
    const [booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for("update");
    if (!booking || booking.status !== "completed") return null;

    const [existing] = await tx.select().from(invoices).where(eq(invoices.bookingId, bookingId)).limit(1);
    if (existing) return existing;

    const [context] = await tx
      .select({
        customerName: users.name,
        customerEmail: users.email,
        customerCompany: users.companyName,
        vehicleTypeName: vehicleTypes.name,
        vehicleRegistration: vehicles.registration,
      })
      .from(bookings)
      .innerJoin(users, eq(users.id, bookings.customerId))
      .innerJoin(vehicleTypes, eq(vehicleTypes.id, bookings.vehicleTypeId))
      .leftJoin(vehicles, eq(vehicles.id, bookings.vehicleId))
      .where(eq(bookings.id, bookingId))
      .limit(1);
    if (!context) throw errors.notFound("Booking details were not found for this invoice");

    const now = new Date();
    const totalCents = booking.finalPriceCents ?? booking.quotedPriceCents;
    const financials = invoiceFinancials(totalCents, booking.quoteBreakdown ?? null, booking.distanceKm);
    const sequenceResult = await tx.execute(sql<{ value: string }>`select nextval('loadline_invoice_number_seq')::text as value`);
    const sequence = Number(sequenceResult.rows[0]?.value);
    if (!Number.isSafeInteger(sequence) || sequence <= 0) throw new Error("Invoice number sequence could not be read");
    const invoiceNumber = formatInvoiceNumber(now.getUTCFullYear(), sequence);
    const values: NewInvoice = {
      invoiceNumber,
      bookingId,
      customerId: booking.customerId,
      bookingReference: booking.reference,
      customerName: context.customerName,
      customerEmail: context.customerEmail,
      customerCompany: context.customerCompany,
      vehicleDescription: `${context.vehicleTypeName}${context.vehicleRegistration ? ` · ${context.vehicleRegistration}` : ""}`,
      loadDescription: booking.loadDescription,
      pickupAddress: booking.pickupAddress,
      dropoffAddress: booking.dropoffAddress,
      additionalStops: (booking.additionalStops ?? []).map((stop) => ({
        address: stop.address,
        lat: Number.isFinite(stop.lat) ? stop.lat : null,
        lng: Number.isFinite(stop.lng) ? stop.lng : null,
      })),
      charges: financials.charges,
      subtotalCents: financials.subtotalCents,
      taxLabel: "GST",
      taxRateBasisPoints: financials.taxRateBasisPoints,
      taxCents: financials.taxCents,
      totalCents: financials.totalCents,
      currency: booking.currency,
      paymentMethod: booking.paymentMethod,
      paymentStatus: financials.totalCents === 0 ? "paid" : "outstanding",
      issuedAt: now,
      dueAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const [created] = await tx.insert(invoices).values(values).onConflictDoNothing({ target: invoices.bookingId }).returning();
    if (created) return created;
    const [concurrentInvoice] = await tx.select().from(invoices).where(eq(invoices.bookingId, bookingId)).limit(1);
    return concurrentInvoice ?? null;
  });
}

export async function ensureInvoicesForCompletedBookings(limit = 500) {
  const completed = await db
    .select({ id: bookings.id })
    .from(bookings)
    .leftJoin(invoices, eq(invoices.bookingId, bookings.id))
    .where(and(eq(bookings.status, "completed"), isNull(invoices.id)))
    .orderBy(asc(bookings.completedAt), asc(bookings.id))
    .limit(limit);
  for (const booking of completed) await ensureInvoiceForBooking(booking.id);
}

export type InvoiceHistory = {
  invoice: Invoice;
  payments: Array<Payment & { refunds: Refund[] }>;
};

export async function getInvoiceForBooking(bookingId: number): Promise<InvoiceHistory | null> {
  const invoice = await ensureInvoiceForBooking(bookingId);
  if (!invoice) return null;
  const invoicePayments = await db.select().from(payments).where(eq(payments.invoiceId, invoice.id)).orderBy(desc(payments.createdAt));
  const refundRows = invoicePayments.length
    ? await db.select().from(refunds).where(inArray(refunds.paymentId, invoicePayments.map((payment) => payment.id))).orderBy(desc(refunds.createdAt))
    : [];
  return {
    invoice,
    payments: invoicePayments.map((payment) => ({
      ...payment,
      refunds: refundRows.filter((refund) => refund.paymentId === payment.id),
    })),
  };
}

async function findPaymentTx(tx: BillingTransaction, paymentId: number | null, paymentIntentId?: string | null) {
  if (paymentId != null) {
    const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("update");
    if (payment) return payment;
  }
  if (paymentIntentId) {
    const [payment] = await tx.select().from(payments).where(eq(payments.stripePaymentIntentId, paymentIntentId)).for("update");
    if (payment) return payment;
  }
  return null;
}

function parseMetadataId(value: string | null | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function stripePaymentIntentId(value: string | Stripe.PaymentIntent | null) {
  return typeof value === "string" ? value : value?.id ?? null;
}

async function markPaymentSucceededTx(
  tx: BillingTransaction,
  paymentId: number | null,
  paymentIntentId: string | null,
) {
  const payment = await findPaymentTx(tx, paymentId, paymentIntentId);
  if (!payment) return null;
  const intentId = paymentIntentId ?? payment.stripePaymentIntentId;
  const status: PaymentStatus = payment.refundedCents >= payment.amountCents
    ? "refunded"
    : payment.refundedCents > 0
      ? "partially_refunded"
      : "succeeded";
  await tx.update(payments).set({
    status,
    stripePaymentIntentId: intentId,
    failureCode: null,
    failureMessage: null,
    paidAt: payment.paidAt ?? new Date(),
    updatedAt: new Date(),
  }).where(eq(payments.id, payment.id));
  await invoicePaymentStatusTx(tx, payment.invoiceId);
  return payment.invoiceId;
}

async function markPaymentFailedTx(
  tx: BillingTransaction,
  paymentId: number | null,
  paymentIntentId: string | null,
  failureCode: string,
  failureMessage: string,
) {
  const payment = await findPaymentTx(tx, paymentId, paymentIntentId);
  if (!payment || payment.status !== "pending") return null;
  await tx.update(payments).set({ status: "failed", failureCode, failureMessage, updatedAt: new Date() }).where(eq(payments.id, payment.id));
  await invoicePaymentStatusTx(tx, payment.invoiceId);
  return payment.invoiceId;
}

async function paymentRefundTotalsTx(tx: BillingTransaction, paymentId: number) {
  const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("update");
  if (!payment) return null;
  const refundRows = await tx.select({ amountCents: refunds.amountCents }).from(refunds).where(and(eq(refunds.paymentId, paymentId), eq(refunds.status, "succeeded")));
  const refundedCents = Math.min(payment.amountCents, refundRows.reduce((sum, refund) => sum + refund.amountCents, 0));
  const status: PaymentStatus = refundedCents >= payment.amountCents
    ? "refunded"
    : refundedCents > 0
      ? "partially_refunded"
      : payment.status === "pending" || payment.status === "failed"
        ? payment.status
        : "succeeded";
  await tx.update(payments).set({ status, refundedCents, updatedAt: new Date() }).where(eq(payments.id, paymentId));
  await invoicePaymentStatusTx(tx, payment.invoiceId);
  return payment.invoiceId;
}

export async function startStripeCheckout(bookingId: number, customerId: number, returnOrigin: string) {
  if (!isStripeReady()) throw errors.unavailable("Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to enable card checkout.");
  const stripe = stripeClient();
  const invoice = await ensureInvoiceForBooking(bookingId);
  if (!invoice) throw errors.conflict("An invoice is available once the booking is completed", "INVOICE_NOT_ISSUED");
  if (invoice.customerId !== customerId) throw errors.notFound("Booking not found");

  const [booking] = await db
    .select({ status: bookings.status, paymentMethod: bookings.paymentMethod })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!booking || booking.status !== "completed") throw errors.conflict("Only completed bookings can be paid online", "BOOKING_NOT_COMPLETE");
  if (booking.paymentMethod !== "card") throw errors.conflict("This invoice is payable on account, not by card checkout", "ACCOUNT_INVOICE");
  if (["paid", "partially_refunded", "refunded"].includes(invoice.paymentStatus)) {
    throw errors.conflict("This invoice does not have an online card balance due", "INVOICE_NOT_PAYABLE");
  }

  const recentCheckouts = await db
    .select()
    .from(payments)
    .where(and(eq(payments.invoiceId, invoice.id), eq(payments.provider, "stripe"), isNotNull(payments.stripeCheckoutSessionId)))
    .orderBy(desc(payments.createdAt))
    .limit(10);
  for (const attempt of recentCheckouts) {
    if (!attempt.stripeCheckoutSessionId) continue;
    const session = await stripe.checkout.sessions.retrieve(attempt.stripeCheckoutSessionId);
    if (session.status === "open" && session.url) return { url: session.url, reused: true };
    if (session.status === "complete") {
      if (session.payment_status === "paid") {
        await db.transaction(async (tx) => {
          await markPaymentSucceededTx(tx, attempt.id, stripePaymentIntentId(session.payment_intent));
        });
        throw errors.conflict("Payment is processing. Refresh the booking shortly for the confirmed status.", "PAYMENT_PROCESSING");
      }
      if (attempt.status === "pending") {
        throw errors.conflict("Payment is processing. Refresh the booking shortly for the confirmed status.", "PAYMENT_PROCESSING");
      }
      continue;
    }
    if (attempt.status === "pending") {
      await db.transaction(async (tx) => {
        await markPaymentFailedTx(tx, attempt.id, null, "checkout_expired", "Checkout session expired before payment was completed.");
      });
    }
  }

  const payment = await db.transaction(async (tx) => {
    const [lockedInvoice] = await tx.select().from(invoices).where(eq(invoices.id, invoice.id)).for("update");
    if (!lockedInvoice) throw errors.notFound("Invoice not found");
    if (["paid", "partially_refunded", "refunded"].includes(lockedInvoice.paymentStatus)) {
      throw errors.conflict("This invoice does not have an online card balance due", "INVOICE_NOT_PAYABLE");
    }
    const [pending] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.invoiceId, invoice.id), eq(payments.provider, "stripe"), eq(payments.status, "pending")))
      .orderBy(desc(payments.createdAt))
      .limit(1);
    if (pending) {
      if (pending.stripeCheckoutSessionId) throw errors.conflict("A card checkout is already open for this invoice", "CHECKOUT_IN_PROGRESS");
      return pending;
    }
    const dueCents = await outstandingCentsTx(tx, invoice.id, lockedInvoice.totalCents);
    if (dueCents <= 0) throw errors.conflict("This invoice has no balance due", "INVOICE_NOT_PAYABLE");
    const [created] = await tx.insert(payments).values({
      invoiceId: invoice.id,
      bookingId,
      customerId,
      provider: "stripe",
      status: "pending",
      amountCents: dueCents,
      refundedCents: 0,
      currency: invoice.currency,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    await invoicePaymentStatusTx(tx, invoice.id);
    return created;
  });

  const base = new URL(returnOrigin).origin;
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      allowed_payment_method_types: ["card"],
      customer_email: invoice.customerEmail,
      client_reference_id: String(payment.id),
      line_items: [{
        quantity: 1,
        price_data: {
          currency: invoice.currency.toLowerCase(),
          unit_amount: payment.amountCents,
          product_data: {
            name: `${invoice.invoiceNumber} · ${invoice.bookingReference}`,
            description: `Freight delivery for ${invoice.pickupAddress} to ${invoice.dropoffAddress}`,
          },
        },
      }],
      metadata: { paymentId: String(payment.id), invoiceId: String(invoice.id), bookingId: String(bookingId) },
      payment_intent_data: { metadata: { paymentId: String(payment.id), invoiceId: String(invoice.id), bookingId: String(bookingId) } },
      success_url: `${base}/bookings/${bookingId}?payment=success`,
      cancel_url: `${base}/bookings/${bookingId}?payment=cancelled`,
    }, { idempotencyKey: `loadline-checkout-${payment.id}` });
  } catch (error) {
    logger.error("billing.checkout.create_failed", { paymentId: payment.id, bookingId, error });
    if (error instanceof Stripe.errors.StripeError && error.statusCode != null && error.statusCode >= 400 && error.statusCode < 500) {
      await db.transaction(async (tx) => {
        await markPaymentFailedTx(tx, payment.id, null, "checkout_creation_failed", "Stripe rejected the checkout request.");
      });
      throw errors.unavailable("Card checkout could not be started. Please contact support if this continues.");
    }
    // Preserve this attempt and its idempotency key; a retry safely retrieves/creates the same Stripe session.
    throw errors.unavailable("Checkout status could not be confirmed. Please refresh and try again; duplicate charges are prevented.");
  }

  if (!session.url) {
    await db.transaction(async (tx) => {
      await markPaymentFailedTx(tx, payment.id, null, "checkout_url_missing", "Stripe did not return a hosted checkout URL.");
    });
    throw errors.unavailable("Stripe did not return a checkout link. Please try again.");
  }
  // Persist outside the Stripe call's catch: if the database is temporarily unavailable, retrying uses the same Stripe idempotency key.
  await db.transaction(async (tx) => {
    await tx.update(payments).set({ stripeCheckoutSessionId: session.id, updatedAt: new Date() }).where(eq(payments.id, payment.id));
    await invoicePaymentStatusTx(tx, invoice.id);
  });
  return { url: session.url, reused: false };
}

function stripeRefundStatus(status: string | null | undefined): RefundStatus {
  if (status === "succeeded") return "succeeded";
  if (status === "failed") return "failed";
  if (status === "canceled") return "cancelled";
  return "pending";
}

async function upsertStripeRefundTx(tx: BillingTransaction, payment: Payment, refund: Stripe.Refund) {
  const localRefundId = parseMetadataId(refund.metadata?.refundRecordId);
  const current = localRefundId
    ? (await tx.select().from(refunds).where(eq(refunds.id, localRefundId)).for("update"))[0]
    : (await tx.select().from(refunds).where(eq(refunds.stripeRefundId, refund.id)).for("update"))[0];
  const status = stripeRefundStatus(refund.status);
  const update = {
    stripeRefundId: refund.id,
    amountCents: refund.amount,
    status,
    failureMessage: refund.failure_reason ?? null,
    completedAt: status === "succeeded" ? new Date() : null,
    updatedAt: new Date(),
  } as const;
  if (current) {
    await tx.update(refunds).set(update).where(eq(refunds.id, current.id));
  } else {
    await tx.insert(refunds).values({
      paymentId: payment.id,
      ...update,
      reason: refund.reason ?? null,
      recordedBy: null,
      createdAt: new Date(),
    }).onConflictDoNothing({ target: refunds.stripeRefundId });
  }
  await paymentRefundTotalsTx(tx, payment.id);
}

async function applyStripeEventTx(tx: BillingTransaction, event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status === "paid") {
        await markPaymentSucceededTx(tx, parseMetadataId(session.metadata?.paymentId) ?? parseMetadataId(session.client_reference_id), stripePaymentIntentId(session.payment_intent));
      }
      break;
    }
    case "payment_intent.succeeded": {
      const intent = event.data.object as Stripe.PaymentIntent;
      await markPaymentSucceededTx(tx, parseMetadataId(intent.metadata?.paymentId), intent.id);
      break;
    }
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed": {
      const session = event.data.object as Stripe.Checkout.Session;
      await markPaymentFailedTx(tx, parseMetadataId(session.metadata?.paymentId) ?? parseMetadataId(session.client_reference_id), stripePaymentIntentId(session.payment_intent), "checkout_expired", "Checkout expired or its payment did not complete.");
      break;
    }
    case "payment_intent.payment_failed": {
      const intent = event.data.object as Stripe.PaymentIntent;
      await markPaymentFailedTx(tx, parseMetadataId(intent.metadata?.paymentId), intent.id, intent.last_payment_error?.code ?? "payment_failed", intent.last_payment_error?.message ?? "The payment was declined.");
      break;
    }
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const intentId = stripePaymentIntentId(charge.payment_intent);
      const payment = await findPaymentTx(tx, null, intentId);
      if (!payment) break;
      for (const refund of charge.refunds?.data ?? []) {
        await upsertStripeRefundTx(tx, payment, refund);
      }
      const refundedCents = Math.min(payment.amountCents, charge.amount_refunded);
      const status: PaymentStatus = refundedCents >= payment.amountCents ? "refunded" : refundedCents > 0 ? "partially_refunded" : payment.status;
      await tx.update(payments).set({ refundedCents, status, updatedAt: new Date() }).where(eq(payments.id, payment.id));
      await invoicePaymentStatusTx(tx, payment.invoiceId);
      break;
    }
    case "refund.created":
    case "refund.updated":
    case "refund.failed": {
      const refund = event.data.object as Stripe.Refund;
      const payment = await findPaymentTx(tx, parseMetadataId(refund.metadata?.paymentId), stripePaymentIntentId(refund.payment_intent));
      if (payment) await upsertStripeRefundTx(tx, payment, refund);
      break;
    }
  }
}

export function verifyStripeWebhook(payload: string, signature: string) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) throw errors.unavailable("Stripe webhooks are not configured yet.");
  return stripeClient().webhooks.constructEvent(payload, signature, secret);
}

export async function processStripeWebhook(event: Stripe.Event) {
  await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(stripeWebhookEvents)
      .values({ eventId: event.id, eventType: event.type, processedAt: new Date() })
      .onConflictDoNothing({ target: stripeWebhookEvents.eventId })
      .returning({ eventId: stripeWebhookEvents.eventId });
    if (!inserted) return;
    await applyStripeEventTx(tx, event);
  });
}

export async function recordStripeRefund(
  paymentId: number,
  amountCents: number | undefined,
  reason: StripeRefundReason,
  actor: SafeUser,
) {
  const stripe = stripeClient();
  const localRefund = await db.transaction(async (tx) => {
    const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("update");
    if (!payment || payment.provider !== "stripe") throw errors.notFound("Card payment not found");
    if (!["succeeded", "partially_refunded"].includes(payment.status) || !payment.stripePaymentIntentId) {
      throw errors.conflict("Only successful card payments can be refunded", "PAYMENT_NOT_REFUNDABLE");
    }
    const [pendingSum] = await tx
      .select({ amount: sql<number>`coalesce(sum(${refunds.amountCents}), 0)::int` })
      .from(refunds)
      .where(and(eq(refunds.paymentId, paymentId), eq(refunds.status, "pending")));
    const available = payment.amountCents - payment.refundedCents - Number(pendingSum.amount);
    const refundAmount = amountCents ?? available;
    if (!Number.isInteger(refundAmount) || refundAmount <= 0 || refundAmount > available) {
      throw errors.validation({ amountCents: `Refund must be between 1 and ${Math.max(available, 0)} cents` });
    }
    const [created] = await tx.insert(refunds).values({
      paymentId,
      amountCents: refundAmount,
      status: "pending",
      reason,
      recordedBy: actor.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    return { payment, refund: created };
  });

  let stripeRefund: Stripe.Refund;
  try {
    stripeRefund = await stripe.refunds.create({
      payment_intent: localRefund.payment.stripePaymentIntentId!,
      amount: localRefund.refund.amountCents,
      reason,
      metadata: {
        paymentId: String(paymentId),
        refundRecordId: String(localRefund.refund.id),
      },
    }, { idempotencyKey: `loadline-refund-${localRefund.refund.id}` });
  } catch (error) {
    logger.error("billing.refund.create_failed", { paymentId, refundId: localRefund.refund.id, error });
    if (error instanceof Stripe.errors.StripeError && error.statusCode != null && error.statusCode >= 400 && error.statusCode < 500) {
      await db.transaction(async (tx) => {
        const [current] = await tx.select().from(refunds).where(eq(refunds.id, localRefund.refund.id)).for("update");
        if (current?.status === "pending") {
          await tx.update(refunds).set({ status: "failed", failureMessage: error.message, updatedAt: new Date() }).where(eq(refunds.id, current.id));
        }
        await paymentRefundTotalsTx(tx, paymentId);
      });
      throw errors.badRequest("Stripe rejected this refund. Check the payment and try again.");
    }
    // A timeout or 5xx can be ambiguous: leave the reservation pending to prevent an accidental duplicate refund.
    throw errors.unavailable("Stripe may still be processing this refund. Check the transaction history before retrying.");
  }

  // Do not mark the refund failed if persistence fails after Stripe has accepted it; a webhook can reconcile it.
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(refunds).where(eq(refunds.id, localRefund.refund.id)).for("update");
    const responseStatus = stripeRefundStatus(stripeRefund.status);
    const status = current?.status === "succeeded" ? "succeeded" : responseStatus;
    await tx.update(refunds).set({
      stripeRefundId: stripeRefund.id,
      status,
      failureMessage: stripeRefund.failure_reason ?? null,
      completedAt: status === "succeeded" ? current?.completedAt ?? new Date() : null,
      updatedAt: new Date(),
    }).where(eq(refunds.id, localRefund.refund.id));
    await paymentRefundTotalsTx(tx, paymentId);
    const [result] = await tx.select().from(refunds).where(eq(refunds.id, localRefund.refund.id)).limit(1);
    return result;
  });
}

export async function recordManualInvoicePayment(
  invoiceId: number,
  input: { amountCents: number; externalReference?: string },
  actor: SafeUser,
) {
  return db.transaction(async (tx) => {
    const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for("update");
    if (!invoice) throw errors.notFound("Invoice not found");
    const [booking] = await tx.select({ status: bookings.status, paymentMethod: bookings.paymentMethod }).from(bookings).where(eq(bookings.id, invoice.bookingId)).limit(1);
    if (!booking || booking.paymentMethod !== "account") {
      throw errors.conflict("Manual bank or account payments can only be recorded against an on-account invoice", "NOT_ACCOUNT_INVOICE");
    }
    if (["paid", "partially_refunded", "refunded"].includes(invoice.paymentStatus)) {
      throw errors.conflict("This invoice is already settled or refunded", "INVOICE_SETTLED");
    }
    const dueCents = await outstandingCentsTx(tx, invoiceId, invoice.totalCents);
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > dueCents) {
      throw errors.validation({ amountCents: `Enter a payment from 1 to ${dueCents} cents` });
    }
    const [created] = await tx.insert(payments).values({
      invoiceId,
      bookingId: invoice.bookingId,
      customerId: invoice.customerId,
      provider: "manual",
      status: "succeeded",
      amountCents: input.amountCents,
      refundedCents: 0,
      currency: invoice.currency,
      externalReference: input.externalReference?.trim() || null,
      recordedBy: actor.id,
      paidAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    await invoicePaymentStatusTx(tx, invoiceId);
    await tx.insert(bookingEvents).values({
      bookingId: invoice.bookingId,
      fromStatus: booking.status,
      toStatus: booking.status,
      actorId: actor.id,
      actorRole: actor.role,
      note: `Manual payment recorded: ${(input.amountCents / 100).toFixed(2)} ${invoice.currency}${input.externalReference ? ` · Ref ${input.externalReference.trim()}` : ""}`,
    });
    return created;
  });
}

export async function getFinanceDashboard(limit = 100) {
  await ensureInvoicesForCompletedBookings();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [paymentStats] = await db.select({
    collectedMonthCents: sql<number>`coalesce(sum(${payments.amountCents}) filter (where ${payments.status} in ('succeeded', 'partially_refunded', 'refunded') and ${payments.paidAt} >= ${monthStart}), 0)::int`,
    paymentsMonthCount: sql<number>`count(*) filter (where ${payments.status} in ('succeeded', 'partially_refunded', 'refunded') and ${payments.paidAt} >= ${monthStart})::int`,
    failedPaymentsCount: sql<number>`count(*) filter (where ${payments.status} = 'failed')::int`,
    pendingPaymentsCount: sql<number>`count(*) filter (where ${payments.status} = 'pending')::int`,
  }).from(payments);
  const [refundStats] = await db.select({
    refundedMonthCents: sql<number>`coalesce(sum(${refunds.amountCents}) filter (where ${refunds.status} = 'succeeded' and ${refunds.completedAt} >= ${monthStart}), 0)::int`,
    refundsMonthCount: sql<number>`count(*) filter (where ${refunds.status} = 'succeeded' and ${refunds.completedAt} >= ${monthStart})::int`,
  }).from(refunds);

  const invoiceBalances = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      bookingId: invoices.bookingId,
      bookingReference: invoices.bookingReference,
      customerId: invoices.customerId,
      customerName: invoices.customerName,
      customerCompany: invoices.customerCompany,
      customerEmail: invoices.customerEmail,
      totalCents: invoices.totalCents,
      currency: invoices.currency,
      paymentStatus: invoices.paymentStatus,
      issuedAt: invoices.issuedAt,
      paymentMethod: invoices.paymentMethod,
      collectedCents: sql<number>`coalesce(sum(case when ${payments.status} in ('succeeded', 'partially_refunded', 'refunded') then ${payments.amountCents} else 0 end), 0)::int`,
    })
    .from(invoices)
    .leftJoin(payments, eq(payments.invoiceId, invoices.id))
    .groupBy(invoices.id)
    .orderBy(desc(invoices.issuedAt));
  const allOutstandingInvoices = invoiceBalances
    .map((invoice) => ({ ...invoice, dueCents: Math.max(0, invoice.totalCents - invoice.collectedCents) }))
    .filter((invoice) => invoice.dueCents > 0 && !["paid", "refunded"].includes(invoice.paymentStatus));
  const outstandingInvoices = allOutstandingInvoices.slice(0, limit);
  const outstandingCents = allOutstandingInvoices.reduce((sum, invoice) => sum + invoice.dueCents, 0);

  const recentPaymentRows = await db
    .select({
      id: payments.id,
      invoiceId: payments.invoiceId,
      bookingId: payments.bookingId,
      provider: payments.provider,
      status: payments.status,
      amountCents: payments.amountCents,
      refundedCents: payments.refundedCents,
      currency: payments.currency,
      externalReference: payments.externalReference,
      failureMessage: payments.failureMessage,
      paidAt: payments.paidAt,
      createdAt: payments.createdAt,
      invoiceNumber: invoices.invoiceNumber,
      bookingReference: invoices.bookingReference,
      customerName: invoices.customerName,
      customerCompany: invoices.customerCompany,
    })
    .from(payments)
    .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .orderBy(desc(payments.createdAt))
    .limit(limit);
  const recentRefundRows = recentPaymentRows.length
    ? await db.select().from(refunds).where(inArray(refunds.paymentId, recentPaymentRows.map((payment) => payment.id))).orderBy(desc(refunds.createdAt))
    : [];
  const recentPayments = recentPaymentRows.map((payment) => ({
    ...payment,
    refunds: recentRefundRows.filter((refund) => refund.paymentId === payment.id),
  }));

  return {
    summary: {
      revenueMonthCents: Number(paymentStats.collectedMonthCents) - Number(refundStats.refundedMonthCents),
      paymentsMonthCents: Number(paymentStats.collectedMonthCents),
      paymentsMonthCount: Number(paymentStats.paymentsMonthCount),
      refundsMonthCents: Number(refundStats.refundedMonthCents),
      refundsMonthCount: Number(refundStats.refundsMonthCount),
      outstandingCents,
      outstandingInvoiceCount: allOutstandingInvoices.length,
      failedPaymentsCount: Number(paymentStats.failedPaymentsCount),
      pendingPaymentsCount: Number(paymentStats.pendingPaymentsCount),
    },
    recentPayments,
    outstandingInvoices,
  };
}
