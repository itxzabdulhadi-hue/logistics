import { NextRequest } from "next/server";
import type Stripe from "stripe";
import { ApiError } from "@/lib/api";
import { logger } from "@/lib/logger";
import { processStripeWebhook, verifyStripeWebhook } from "@/services/billing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing Stripe-Signature", { status: 400 });

  let event: Stripe.Event;
  try {
    event = verifyStripeWebhook(await request.text(), signature);
  } catch (error) {
    if (error instanceof ApiError && error.status === 503) {
      return new Response("Stripe webhook is not configured", { status: 503 });
    }
    logger.warn("billing.webhook.signature_invalid", { error });
    return new Response("Invalid Stripe webhook signature", { status: 400 });
  }

  try {
    await processStripeWebhook(event);
    return Response.json({ received: true });
  } catch (error) {
    logger.error("billing.webhook.processing_failed", { eventId: event.id, eventType: event.type, error });
    return new Response("Webhook processing failed; Stripe may retry this event", { status: 500 });
  }
}
