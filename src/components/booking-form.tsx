"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Alert, Button, Card, CardHeader, Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { calculateQuote, EXTRA_FEES } from "@/lib/booking-rules";
import { api, errorMessage, fieldErrors } from "@/lib/client-api";
import { cn, formatMoney, toDateTimeLocal } from "@/lib/utils";

export type VehicleTypeOption = {
  id: number;
  name: string;
  description: string | null;
  maxWeightKg: number;
  maxPallets: number | null;
  baseFareCents: number;
  perKmRateCents: number;
  minimumChargeCents: number;
};

type Props = {
  vehicleTypes: VehicleTypeOption[];
  defaults: { contactName: string; contactPhone: string; paymentMethod: "card" | "account" };
};

type Coords = { lat: number; lng: number } | null;

export function BookingForm({ vehicleTypes, defaults }: Props) {
  const router = useRouter();
  const [vehicleTypeId, setVehicleTypeId] = useState<number>(vehicleTypes[0]?.id ?? 0);
  const [form, setForm] = useState({
    pickupAddress: "",
    pickupContactName: defaults.contactName,
    pickupContactPhone: defaults.contactPhone,
    pickupInstructions: "",
    dropoffAddress: "",
    dropoffContactName: "",
    dropoffContactPhone: "",
    dropoffInstructions: "",
    isAsap: true,
    scheduledAt: toDateTimeLocal(new Date(Date.now() + 3 * 60 * 60 * 1000)),
    loadDescription: "",
    weightKg: "",
    pallets: "0",
    itemCount: "",
    requiresTailgate: false,
    requiresHandUnload: false,
    paymentMethod: defaults.paymentMethod,
    customerNotes: "",
  });
  const [distanceKm, setDistanceKm] = useState<string>("");
  const [distanceSource, setDistanceSource] = useState<"geocoded" | "manual" | null>(null);
  const [coords, setCoords] = useState<{ pickup: Coords; dropoff: Coords }>({ pickup: null, dropoff: null });
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteNotice, setQuoteNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const vehicleType = vehicleTypes.find((v) => v.id === vehicleTypeId) ?? null;
  const distance = Number(distanceKm);
  const quote = useMemo(() => {
    if (!vehicleType || !distance || distance <= 0) return null;
    return calculateQuote({
      vehicleType,
      distanceKm: distance,
      requiresTailgate: form.requiresTailgate,
      requiresHandUnload: form.requiresHandUnload,
      isAsap: form.isAsap,
    });
  }, [vehicleType, distance, form.requiresTailgate, form.requiresHandUnload, form.isAsap]);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const addressesReady = form.pickupAddress.trim().length >= 5 && form.dropoffAddress.trim().length >= 5;

  async function estimateDistance() {
    setQuoteLoading(true);
    setQuoteNotice(null);
    setError(null);
    try {
      const data = await api<{
        quote: { distanceKm: number } | null;
        needsManualDistance: boolean;
        message?: string;
        pickup: Coords;
        dropoff: Coords;
      }>("/api/quote", {
        method: "POST",
        body: {
          vehicleTypeId,
          pickupAddress: form.pickupAddress,
          dropoffAddress: form.dropoffAddress,
          requiresTailgate: form.requiresTailgate,
          requiresHandUnload: form.requiresHandUnload,
          isAsap: form.isAsap,
        },
      });
      if (data.needsManualDistance || !data.quote) {
        setDistanceSource(null);
        setQuoteNotice(data.message ?? "Enter the approximate distance to price this job.");
        return;
      }
      setDistanceKm(String(data.quote.distanceKm));
      setDistanceSource("geocoded");
      setCoords({ pickup: data.pickup, dropoff: data.dropoff });
    } catch (err) {
      setQuoteNotice(errorMessage(err, "Could not estimate the distance. Enter it manually below."));
    } finally {
      setQuoteLoading(false);
    }
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    setFields({});
    try {
      const payload = {
        vehicleTypeId,
        pickupAddress: form.pickupAddress,
        pickupContactName: form.pickupContactName,
        pickupContactPhone: form.pickupContactPhone,
        pickupInstructions: form.pickupInstructions,
        pickupLat: coords.pickup?.lat ?? null,
        pickupLng: coords.pickup?.lng ?? null,
        dropoffAddress: form.dropoffAddress,
        dropoffContactName: form.dropoffContactName,
        dropoffContactPhone: form.dropoffContactPhone,
        dropoffInstructions: form.dropoffInstructions,
        dropoffLat: coords.dropoff?.lat ?? null,
        dropoffLng: coords.dropoff?.lng ?? null,
        isAsap: form.isAsap,
        scheduledAt: form.isAsap ? undefined : new Date(form.scheduledAt).toISOString(),
        loadDescription: form.loadDescription,
        weightKg: form.weightKg || undefined,
        pallets: form.pallets || 0,
        itemCount: form.itemCount || undefined,
        requiresTailgate: form.requiresTailgate,
        requiresHandUnload: form.requiresHandUnload,
        distanceKm: distance,
        paymentMethod: form.paymentMethod,
        customerNotes: form.customerNotes,
      };
      const data = await api<{ booking: { id: number } }>("/api/bookings", { method: "POST", body: payload });
      router.push(`/bookings/${data.booking.id}?created=1`);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setFields(fieldErrors(err));
      setSubmitting(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  const minSchedule = toDateTimeLocal(new Date());

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="grid gap-6 lg:grid-cols-[1fr_360px]"
    >
      <div className="space-y-6">
        {error && (
          <Alert tone="error" title="We couldn't create this booking">
            {error}
            {Object.keys(fields).length > 0 && (
              <ul className="mt-1 list-disc pl-5">
                {Object.entries(fields).map(([k, v]) => (
                  <li key={k}>
                    <span className="font-medium">{k}</span>: {v}
                  </li>
                ))}
              </ul>
            )}
          </Alert>
        )}

        {/* 1. Vehicle */}
        <Card>
          <CardHeader title="1. Choose a vehicle" description="Pick the smallest class that fits your load — you can always change it before confirming." />
          <div className="grid gap-3 p-5 sm:grid-cols-2">
            {vehicleTypes.map((vt) => {
              const selected = vt.id === vehicleTypeId;
              return (
                <button
                  type="button"
                  key={vt.id}
                  onClick={() => setVehicleTypeId(vt.id)}
                  className={cn(
                    "rounded-xl border p-4 text-left transition",
                    selected
                      ? "border-orange-500 bg-orange-50 ring-2 ring-orange-500/30"
                      : "border-slate-200 bg-white hover:border-slate-300",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-slate-900">{vt.name}</span>
                    <span className="text-xs font-semibold text-slate-600">
                      from {formatMoney(vt.minimumChargeCents || vt.baseFareCents)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-500">{vt.description}</p>
                  <p className="mt-2 text-xs text-slate-600">
                    Up to <b>{vt.maxWeightKg.toLocaleString()} kg</b>
                    {vt.maxPallets ? (
                      <>
                        {" "}
                        · <b>{vt.maxPallets}</b> pallets
                      </>
                    ) : null}{" "}
                    · {formatMoney(vt.perKmRateCents)}/km
                  </p>
                </button>
              );
            })}
          </div>
          {fields.vehicleTypeId && <p className="px-5 pb-4 text-xs font-medium text-red-600">{fields.vehicleTypeId}</p>}
        </Card>

        {/* 2. Route */}
        <Card>
          <CardHeader title="2. Pickup & delivery" description="Full street addresses give the most accurate price." />
          <div className="grid gap-6 p-5 md:grid-cols-2">
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Pickup
              </div>
              <Field label="Pickup address" error={fields.pickupAddress} required>
                <Input
                  value={form.pickupAddress}
                  onChange={(e) => {
                    set("pickupAddress", e.target.value);
                    setDistanceSource(null);
                  }}
                  placeholder="12 Bourke Road, Alexandria NSW 2015"
                  required
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Contact name" error={fields.pickupContactName}>
                  <Input value={form.pickupContactName} onChange={(e) => set("pickupContactName", e.target.value)} />
                </Field>
                <Field label="Contact phone" error={fields.pickupContactPhone}>
                  <Input value={form.pickupContactPhone} onChange={(e) => set("pickupContactPhone", e.target.value)} />
                </Field>
              </div>
              <Field label="Pickup instructions" error={fields.pickupInstructions}>
                <Textarea
                  value={form.pickupInstructions}
                  onChange={(e) => set("pickupInstructions", e.target.value)}
                  placeholder="Loading dock, access codes, parking…"
                />
              </Field>
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <span className="h-2.5 w-2.5 rounded-full bg-orange-500" /> Delivery
              </div>
              <Field label="Delivery address" error={fields.dropoffAddress} required>
                <Input
                  value={form.dropoffAddress}
                  onChange={(e) => {
                    set("dropoffAddress", e.target.value);
                    setDistanceSource(null);
                  }}
                  placeholder="88 George Street, Parramatta NSW 2150"
                  required
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Contact name" error={fields.dropoffContactName}>
                  <Input value={form.dropoffContactName} onChange={(e) => set("dropoffContactName", e.target.value)} />
                </Field>
                <Field label="Contact phone" error={fields.dropoffContactPhone}>
                  <Input value={form.dropoffContactPhone} onChange={(e) => set("dropoffContactPhone", e.target.value)} />
                </Field>
              </div>
              <Field label="Delivery instructions" error={fields.dropoffInstructions}>
                <Textarea
                  value={form.dropoffInstructions}
                  onChange={(e) => set("dropoffInstructions", e.target.value)}
                  placeholder="Dock booking times, height limits, who to call…"
                />
              </Field>
            </div>
          </div>
          <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-4">
            <div className="flex flex-wrap items-end gap-3">
              <Button type="button" variant="dark" onClick={estimateDistance} disabled={!addressesReady} loading={quoteLoading}>
                {distanceSource === "geocoded" ? "Re-estimate distance" : "Estimate distance & price"}
              </Button>
              <span className="text-xs text-slate-500">or</span>
              <Field label="Trip distance (km)" error={fields.distanceKm} className="w-44">
                <Input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={distanceKm}
                  onChange={(e) => {
                    setDistanceKm(e.target.value);
                    setDistanceSource("manual");
                  }}
                  placeholder="e.g. 18.5"
                />
              </Field>
              {distanceSource === "geocoded" && (
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                  Distance estimated from addresses
                </span>
              )}
            </div>
            {quoteNotice && (
              <Alert tone="warning" className="mt-3">
                {quoteNotice}
              </Alert>
            )}
          </div>
        </Card>

        {/* 3. Schedule */}
        <Card>
          <CardHeader title="3. When do you need the truck?" />
          <div className="grid gap-3 p-5 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => set("isAsap", true)}
              className={cn(
                "rounded-xl border p-4 text-left",
                form.isAsap ? "border-orange-500 bg-orange-50 ring-2 ring-orange-500/30" : "border-slate-200 hover:border-slate-300",
              )}
            >
              <span className="font-semibold text-slate-900">ASAP</span>
              <p className="mt-1 text-xs text-slate-500">
                Next available truck, typically within the hour. Includes a {Math.round(EXTRA_FEES.asapSurchargeRate * 100)}% priority surcharge.
              </p>
            </button>
            <button
              type="button"
              onClick={() => set("isAsap", false)}
              className={cn(
                "rounded-xl border p-4 text-left",
                !form.isAsap ? "border-orange-500 bg-orange-50 ring-2 ring-orange-500/30" : "border-slate-200 hover:border-slate-300",
              )}
            >
              <span className="font-semibold text-slate-900">Schedule</span>
              <p className="mt-1 text-xs text-slate-500">Pick a date and time for pickup. Best price.</p>
            </button>
          </div>
          {!form.isAsap && (
            <div className="px-5 pb-5">
              <Field label="Pickup date & time" error={fields.scheduledAt} required className="max-w-xs">
                <Input
                  type="datetime-local"
                  min={minSchedule}
                  value={form.scheduledAt}
                  onChange={(e) => set("scheduledAt", e.target.value)}
                  required
                />
              </Field>
            </div>
          )}
        </Card>

        {/* 4. Load */}
        <Card>
          <CardHeader title="4. What are we moving?" />
          <div className="space-y-4 p-5">
            <Field label="Load description" error={fields.loadDescription} required>
              <Textarea
                value={form.loadDescription}
                onChange={(e) => set("loadDescription", e.target.value)}
                placeholder="e.g. 4 pallets of flooring and a reception desk (wrapped)"
                required
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Total weight (kg)" error={fields.weightKg} hint={vehicleType ? `Max ${vehicleType.maxWeightKg.toLocaleString()} kg` : undefined}>
                <Input type="number" min={0} value={form.weightKg} onChange={(e) => set("weightKg", e.target.value)} />
              </Field>
              <Field label="Pallets" error={fields.pallets} hint={vehicleType?.maxPallets ? `Max ${vehicleType.maxPallets}` : undefined}>
                <Input type="number" min={0} value={form.pallets} onChange={(e) => set("pallets", e.target.value)} />
              </Field>
              <Field label="Loose items" error={fields.itemCount}>
                <Input type="number" min={0} value={form.itemCount} onChange={(e) => set("itemCount", e.target.value)} />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Checkbox
                label={`Tailgate lifter (+${formatMoney(EXTRA_FEES.tailgateCents)})`}
                description="No forklift or dock at either end"
                checked={form.requiresTailgate}
                onChange={(e) => set("requiresTailgate", e.target.checked)}
              />
              <Checkbox
                label={`Hand unload (+${formatMoney(EXTRA_FEES.handUnloadCents)})`}
                description="Driver carries items to the door"
                checked={form.requiresHandUnload}
                onChange={(e) => set("requiresHandUnload", e.target.checked)}
              />
            </div>
          </div>
        </Card>

        {/* 5. Payment */}
        <Card>
          <CardHeader title="5. Payment & notes" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Payment method" error={fields.paymentMethod}>
              <Select value={form.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value as "card" | "account")}>
                <option value="card">Card (charged on completion)</option>
                <option value="account">On account (invoiced)</option>
              </Select>
            </Field>
            <Field label="Notes for dispatch" error={fields.customerNotes} className="sm:col-span-2">
              <Textarea
                value={form.customerNotes}
                onChange={(e) => set("customerNotes", e.target.value)}
                placeholder="Anything else our dispatchers should know"
              />
            </Field>
          </div>
        </Card>
      </div>

      {/* Summary */}
      <aside className="lg:sticky lg:top-8 lg:self-start">
        <Card className="overflow-hidden">
          <div className="bg-slate-900 px-5 py-4 text-white">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Your quote</p>
            <p className="mt-1 text-3xl font-bold">{quote ? formatMoney(quote.totalCents) : "—"}</p>
            <p className="text-xs text-slate-400">{quote ? "inc. GST · fixed price" : "Add a distance to see your price"}</p>
          </div>
          <div className="space-y-3 p-5 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Vehicle</span>
              <span className="font-medium text-slate-900">{vehicleType?.name ?? "—"}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Distance</span>
              <span className="font-medium text-slate-900">{quote ? `${quote.distanceKm.toFixed(1)} km` : "—"}</span>
            </div>
            {quote && (
              <>
                <hr className="border-slate-100" />
                <Row label="Base fare" value={formatMoney(quote.baseFareCents)} />
                <Row label={`Distance (${quote.distanceKm.toFixed(1)} km × ${formatMoney(vehicleType!.perKmRateCents)})`} value={formatMoney(quote.distanceCents)} />
                {quote.minimumApplied && (
                  <Row label="Minimum charge applied" value={formatMoney(quote.coreCents)} muted />
                )}
                {quote.extras.map((x) => (
                  <Row key={x.label} label={x.label} value={formatMoney(x.cents)} />
                ))}
                <hr className="border-slate-100" />
                <Row label="Subtotal" value={formatMoney(quote.subtotalCents)} />
                <Row label="GST (10%)" value={formatMoney(quote.gstCents)} />
                <div className="flex justify-between text-base font-bold text-slate-900">
                  <span>Total</span>
                  <span>{formatMoney(quote.totalCents)}</span>
                </div>
              </>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={!quote} loading={submitting}>
              Confirm booking
            </Button>
            <p className="text-center text-xs text-slate-500">
              No charge until the job is complete. Free cancellation until a driver is on the way.
            </p>
          </div>
        </Card>
      </aside>
    </form>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3", muted ? "text-xs text-slate-500" : "text-slate-600")}>
      <span>{label}</span>
      <span className={cn(!muted && "font-medium text-slate-900")}>{value}</span>
    </div>
  );
}
