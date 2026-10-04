import { handle, json, parseJson } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { checkoutSchema } from "@/lib/validation";
import { startStripeCheckout, stripeReturnOrigin } from "@/services/billing";

export const dynamic = "force-dynamic";

export const POST = handle(async (req) => {
  const user = await requireApiUser("bookings:read:own");
  const { bookingId } = await parseJson(req, checkoutSchema);
  const checkout = await startStripeCheckout(bookingId, user.id, stripeReturnOrigin(req.nextUrl.origin));
  return json(checkout);
});
