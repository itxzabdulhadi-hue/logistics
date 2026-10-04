"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { api, errorMessage, fieldErrors } from "@/lib/client-api";
import { formatMoney } from "@/lib/utils";

export function RefundPaymentForm({ paymentId, refundableCents }: { paymentId: number; refundableCents: number }) {
  const router = useRouter();
  const [amount, setAmount] = useState((refundableCents / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldError(null);
    setSaved(false);
    try {
      await api(`/api/admin/payments/${paymentId}/refund`, {
        method: "POST",
        body: { amountCents: Math.round(Number(amount) * 100), reason: "requested_by_customer" },
      });
      setSaved(true);
      router.refresh();
    } catch (requestError) {
      setError(errorMessage(requestError, "Unable to issue the refund."));
      setFieldError(fieldErrors(requestError).amountCents ?? null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2">
      <Field label="Refund (AUD)" error={fieldError ?? undefined} className="w-32">
        <Input type="number" min="0.01" max={(refundableCents / 100).toFixed(2)} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required />
      </Field>
      <Button type="submit" size="sm" variant="danger" loading={busy} disabled={!amount || Number(amount) <= 0 || Math.round(Number(amount) * 100) > refundableCents}>
        Refund
      </Button>
      {saved && <span className="text-xs font-medium text-emerald-700">Refund submitted</span>}
      {error && <span className="w-full"><Alert tone="error">{error}</Alert></span>}
      <span className="sr-only">Maximum refundable amount {formatMoney(refundableCents)}</span>
    </form>
  );
}

export function RecordInvoicePaymentForm({
  invoiceId,
  dueCents,
}: {
  invoiceId: number;
  dueCents: number;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState((dueCents / 100).toFixed(2));
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldError(null);
    setSaved(false);
    try {
      await api(`/api/admin/invoices/${invoiceId}/payments`, {
        method: "POST",
        body: {
          amountCents: Math.round(Number(amount) * 100),
          externalReference: reference.trim() || undefined,
        },
      });
      setSaved(true);
      setReference("");
      router.refresh();
    } catch (requestError) {
      setError(errorMessage(requestError, "Unable to record the payment."));
      setFieldError(fieldErrors(requestError).amountCents ?? null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 grid gap-2 sm:grid-cols-[140px_1fr_auto] sm:items-end">
      <Field label="Received (AUD)" error={fieldError ?? undefined}>
        <Input type="number" min="0.01" max={(dueCents / 100).toFixed(2)} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required />
      </Field>
      <Field label="Bank / receipt reference">
        <Input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Optional" maxLength={120} />
      </Field>
      <Button type="submit" size="sm" variant="dark" loading={busy} disabled={!amount || Number(amount) <= 0 || Math.round(Number(amount) * 100) > dueCents}>
        Record payment
      </Button>
      {saved && <p className="text-xs font-medium text-emerald-700 sm:col-span-3">Payment recorded.</p>}
      {error && <div className="sm:col-span-3"><Alert tone="error">{error}</Alert></div>}
    </form>
  );
}
