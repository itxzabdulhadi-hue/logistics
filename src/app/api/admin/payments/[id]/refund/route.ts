import { handle, json, parseId, parseJson } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { refundSchema } from "@/lib/validation";
import { recordStripeRefund } from "@/services/billing";

export const dynamic = "force-dynamic";

export const POST = handle<{ id: string }>(async (req, { params }) => {
  const admin = await requireApiUser("finance:manage");
  const paymentId = parseId((await params).id, "payment id");
  const input = await parseJson(req, refundSchema);
  const refund = await recordStripeRefund(paymentId, input.amountCents, input.reason, admin);
  return json({ refund }, { status: 201 });
});
