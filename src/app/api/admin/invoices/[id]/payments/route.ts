import { handle, json, parseId, parseJson } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { recordManualPaymentSchema } from "@/lib/validation";
import { recordManualInvoicePayment } from "@/services/billing";

export const dynamic = "force-dynamic";

export const POST = handle<{ id: string }>(async (req, { params }) => {
  const admin = await requireApiUser("finance:manage");
  const invoiceId = parseId((await params).id, "invoice id");
  const input = await parseJson(req, recordManualPaymentSchema);
  const payment = await recordManualInvoicePayment(invoiceId, input, admin);
  return json({ payment }, { status: 201 });
});
