"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Card, CardHeader, Field, Input } from "@/components/ui";
import type { PricingRules } from "@/lib/booking-rules";
import { api, errorMessage, fieldErrors } from "@/lib/client-api";
import { formatMoney } from "@/lib/utils";

type Props = { pricingRules: PricingRules & { updatedAt: Date | string } };
const centsToDollars = (value: string) => Math.round(Number(value || 0) * 100);
const percentToBasisPoints = (value: string) => Math.round(Number(value || 0) * 100);

export function PricingRulesForm({ pricingRules }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    setSaved(false);
    const values = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
    try {
      await api("/api/admin/pricing-rules", {
        method: "PATCH",
        body: {
          additionalStopFeeCents: centsToDollars(values.additionalStopFee),
          tailgateFeeCents: centsToDollars(values.tailgateFee),
          handUnloadFeeCents: centsToDollars(values.handUnloadFee),
          asapSurchargeBasisPoints: percentToBasisPoints(values.asapSurcharge),
          gstRateBasisPoints: percentToBasisPoints(values.gstRate),
        },
      });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setFields(fieldErrors(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Global pricing rules"
        description="These rates apply to new quotes. Vehicle base fares, per-kilometre rates and minimum charges are set under Fleet."
      />
      <form onSubmit={submit} className="space-y-6 p-5">
        {error && <Alert tone="error" title="Pricing rules were not saved">{error}</Alert>}
        {saved && <Alert tone="success" title="Pricing rules updated">New quotes will use the rates shown below.</Alert>}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Additional stop fee ($)" error={fields.additionalStopFeeCents} hint="Charged once for each stop between pickup and delivery." required>
            <Input name="additionalStopFee" type="number" min={0} step="0.01" defaultValue={(pricingRules.additionalStopFeeCents / 100).toFixed(2)} required />
          </Field>
          <Field label="Tailgate lifter ($)" error={fields.tailgateFeeCents} hint="Optional vehicle equipment service." required>
            <Input name="tailgateFee" type="number" min={0} step="0.01" defaultValue={(pricingRules.tailgateFeeCents / 100).toFixed(2)} required />
          </Field>
          <Field label="Hand unload ($)" error={fields.handUnloadFeeCents} hint="Optional delivery handling service." required>
            <Input name="handUnloadFee" type="number" min={0} step="0.01" defaultValue={(pricingRules.handUnloadFeeCents / 100).toFixed(2)} required />
          </Field>
          <Field label="ASAP surcharge (%)" error={fields.asapSurchargeBasisPoints} hint="Percentage of the core vehicle fare." required>
            <Input name="asapSurcharge" type="number" min={0} max={100} step="0.01" defaultValue={(pricingRules.asapSurchargeBasisPoints / 100).toFixed(2)} required />
          </Field>
          <Field label="GST (%)" error={fields.gstRateBasisPoints} hint="Applied to the subtotal after minimums and services." required>
            <Input name="gstRate" type="number" min={0} max={100} step="0.01" defaultValue={(pricingRules.gstRateBasisPoints / 100).toFixed(2)} required />
          </Field>
        </div>

        <div className="rounded-xl bg-slate-50 p-4 text-sm">
          <p className="font-semibold text-slate-900">Current service rates</p>
          <div className="mt-3 grid gap-2 text-slate-600 sm:grid-cols-2">
            <p>Additional stop <b className="text-slate-900">{formatMoney(pricingRules.additionalStopFeeCents)}</b></p>
            <p>Tailgate lifter <b className="text-slate-900">{formatMoney(pricingRules.tailgateFeeCents)}</b></p>
            <p>Hand unload <b className="text-slate-900">{formatMoney(pricingRules.handUnloadFeeCents)}</b></p>
            <p>ASAP / GST <b className="text-slate-900">{(pricingRules.asapSurchargeBasisPoints / 100).toFixed(2)}% / {(pricingRules.gstRateBasisPoints / 100).toFixed(2)}%</b></p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <p className="text-xs text-slate-500">Changes affect new quotes and bookings only.</p>
          <Button type="submit" loading={busy}>Save pricing rules</Button>
        </div>
      </form>
    </Card>
  );
}
