"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { RouteMap } from "@/components/route-map";
import { Alert, Button, Card, CardHeader, Checkbox, Field, Input, LinkButton, Select, Textarea } from "@/components/ui";
import { calculateQuote, MAX_ADDITIONAL_STOPS, type PricingRules } from "@/lib/booking-rules";
import { api, errorMessage, fieldErrors } from "@/lib/client-api";
import { cn, formatDuration, formatMoney } from "@/lib/utils";

type AddressSuggestion = { id: string; label: string; detail: string; lat: number; lng: number };
type GeoPoint = { lat: number; lng: number; label: string };
type RouteEstimate = {
  distanceKm: number;
  durationSeconds: number;
  pickup: GeoPoint;
  dropoff: GeoPoint;
  stops: GeoPoint[];
  geometry: { lat: number; lng: number }[];
  waypointOrder: number[];
  optimized: boolean;
  optimizationAttempted: boolean;
};
type AdditionalStop = { id: string; address: string };

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
  pricingRules: PricingRules;
  defaults: { contactName: string; contactPhone: string; paymentMethod: "card" | "account" };
};

type FormValues = {
  pickupAddress: string;
  pickupContactName: string;
  pickupContactPhone: string;
  pickupInstructions: string;
  dropoffAddress: string;
  dropoffContactName: string;
  dropoffContactPhone: string;
  dropoffInstructions: string;
  isAsap: boolean;
  scheduledAt: string;
  loadDescription: string;
  weightKg: string;
  pallets: string;
  itemCount: string;
  requiresTailgate: boolean;
  requiresHandUnload: boolean;
  paymentMethod: "card" | "account";
  customerNotes: string;
};

const STEPS = ["Route", "Vehicle", "Quote", "Confirm"] as const;

function newStop(): AdditionalStop {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, address: "" };
}

export function BookingForm({ vehicleTypes, pricingRules, defaults }: Props) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [vehicleTypeId, setVehicleTypeId] = useState<number>(0);
  const [form, setForm] = useState<FormValues>({
    pickupAddress: "",
    pickupContactName: defaults.contactName,
    pickupContactPhone: defaults.contactPhone,
    pickupInstructions: "",
    dropoffAddress: "",
    dropoffContactName: "",
    dropoffContactPhone: "",
    dropoffInstructions: "",
    isAsap: true,
    scheduledAt: "",
    loadDescription: "",
    weightKg: "",
    pallets: "0",
    itemCount: "",
    requiresTailgate: false,
    requiresHandUnload: false,
    paymentMethod: defaults.paymentMethod,
    customerNotes: "",
  });
  const [additionalStops, setAdditionalStops] = useState<AdditionalStop[]>([]);
  const [optimizeStops, setOptimizeStops] = useState(true);
  const [route, setRoute] = useState<RouteEstimate | null>(null);
  const routeRequestId = useRef(0);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const vehicleType = vehicleTypes.find((vehicle) => vehicle.id === vehicleTypeId) ?? null;
  const quote = useMemo(() => {
    if (!vehicleType || !route) return null;
    return calculateQuote({
      vehicleType,
      distanceKm: route.distanceKm,
      additionalStops: additionalStops.length,
      requiresTailgate: form.requiresTailgate,
      requiresHandUnload: form.requiresHandUnload,
      isAsap: form.isAsap,
      pricingRules,
    });
  }, [vehicleType, route, additionalStops.length, form.requiresTailgate, form.requiresHandUnload, form.isAsap, pricingRules]);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const addressesReady =
    form.pickupAddress.trim().length >= 5 &&
    form.dropoffAddress.trim().length >= 5 &&
    additionalStops.every((stop) => stop.address.trim().length >= 5);
  const routeStopOrder = route?.waypointOrder.length === additionalStops.length + 2
    ? route.waypointOrder.slice(1, -1).map((pointIndex) => pointIndex - 1)
    : additionalStops.map((_, index) => index);
  const plannedStops = routeStopOrder.flatMap((enteredIndex, routeIndex) => {
    const stop = additionalStops[enteredIndex];
    return stop ? [{ stop, enteredIndex, routeIndex }] : [];
  });

  const weight = Number(form.weightKg) || 0;
  const palletCount = Number(form.pallets) || 0;
  const weightOverLimit = Boolean(vehicleType && weight > vehicleType.maxWeightKg);
  const palletsOverLimit = Boolean(vehicleType?.maxPallets && palletCount > vehicleType.maxPallets);
  const loadIsValid = form.loadDescription.trim().length >= 3 && !weightOverLimit && !palletsOverLimit;
  const scheduleIsValid = form.isAsap || Boolean(form.scheduledAt);

  function clearRoute() {
    routeRequestId.current += 1;
    setRoute(null);
    setRouteLoading(false);
    setRouteError(null);
    setError(null);
    setFields({});
  }

  function moveStop(stopId: string, direction: -1 | 1) {
    setAdditionalStops((stops) => {
      const index = stops.findIndex((stop) => stop.id === stopId);
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= stops.length) return stops;
      const reordered = [...stops];
      [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]];
      return reordered;
    });
    clearRoute();
  }

  async function estimateRoute() {
    const requestId = ++routeRequestId.current;
    setRouteLoading(true);
    setRouteError(null);
    setError(null);
    setFields({});
    try {
      const data = await api<{ route: RouteEstimate }>("/api/route", {
        method: "POST",
        body: {
          pickupAddress: form.pickupAddress,
          dropoffAddress: form.dropoffAddress,
          additionalStops: additionalStops.map(({ address }) => ({ address })),
          optimizeStops,
        },
      });
      if (requestId === routeRequestId.current) setRoute(data.route);
    } catch (err) {
      if (requestId === routeRequestId.current) {
        const validationErrors = fieldErrors(err);
        setFields(validationErrors);
        setRouteError(validationErrors.route ?? errorMessage(err, "We couldn't calculate this route. Please try again."));
      }
    } finally {
      if (requestId === routeRequestId.current) setRouteLoading(false);
    }
  }

  async function createBooking() {
    if (!route || !quote) return;
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
        dropoffAddress: form.dropoffAddress,
        dropoffContactName: form.dropoffContactName,
        dropoffContactPhone: form.dropoffContactPhone,
        dropoffInstructions: form.dropoffInstructions,
        additionalStops: additionalStops.map(({ address }) => ({ address })),
        optimizeStops,
        isAsap: form.isAsap,
        scheduledAt: form.isAsap ? undefined : new Date(form.scheduledAt).toISOString(),
        loadDescription: form.loadDescription,
        weightKg: form.weightKg || undefined,
        pallets: form.pallets || 0,
        itemCount: form.itemCount || undefined,
        requiresTailgate: form.requiresTailgate,
        requiresHandUnload: form.requiresHandUnload,
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

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (step === 0) {
      if (!route) {
        setRouteError("Calculate a driving route before continuing.");
        return;
      }
      setStep(1);
    } else if (step === 1) {
      if (!vehicleType) {
        setFields({ vehicleTypeId: "Choose a vehicle class to continue." });
        return;
      }
      if (!loadIsValid) {
        setError("Check the load details and make sure they fit the selected vehicle.");
        return;
      }
      setStep(2);
    } else if (step === 2) {
      if (!quote) {
        setError("A route and vehicle are required before we can quote this job.");
        return;
      }
      if (!scheduleIsValid || (!form.isAsap && new Date(form.scheduledAt).getTime() < Date.now() - 10 * 60_000)) {
        setFields({ scheduledAt: "Choose a pickup time in the future." });
        return;
      }
      setStep(3);
    } else {
      void createBooking();
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const canContinue =
    step === 0 ? Boolean(route) :
    step === 1 ? Boolean(vehicleType && loadIsValid) :
    step === 2 ? Boolean(quote && scheduleIsValid) :
    Boolean(quote);

  const directionsUrl = route
    ? (() => {
        const url = new URL("https://www.google.com/maps/dir/");
        url.searchParams.set("api", "1");
        url.searchParams.set("origin", form.pickupAddress);
        url.searchParams.set("destination", form.dropoffAddress);
        if (plannedStops.length) {
          url.searchParams.set("waypoints", plannedStops.map(({ stop }) => stop.address).join("|"));
        }
        url.searchParams.set("travelmode", "driving");
        return url.toString();
      })()
    : null;

  return (
    <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-6">
        <nav aria-label="Booking progress" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <ol className="grid grid-cols-4 gap-2">
            {STEPS.map((label, index) => {
              const complete = index < step;
              const current = index === step;
              return (
                <li key={label} aria-current={current ? "step" : undefined} className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                      complete ? "bg-emerald-100 text-emerald-700" : current ? "bg-orange-500 text-white" : "bg-slate-100 text-slate-500",
                    )}>
                      {complete ? "✓" : index + 1}
                    </span>
                    <span className={cn("truncate text-xs font-semibold sm:text-sm", current ? "text-slate-900" : "text-slate-500")}>
                      {label}
                    </span>
                  </div>
                  <div className={cn("mt-2 h-1 rounded-full", index <= step ? "bg-orange-400" : "bg-slate-100")} />
                </li>
              );
            })}
          </ol>
        </nav>

        {error && (
          <Alert tone="error" title="Please check your booking">
            {error}
            {Object.keys(fields).length > 0 && (
              <ul className="mt-1 list-disc pl-5">
                {Object.entries(fields).map(([key, message]) => <li key={key}><b>{key}</b>: {message}</li>)}
              </ul>
            )}
          </Alert>
        )}

        {step === 0 && (
          <Card>
            <CardHeader title="1. Set your route" description="Enter the collection and delivery addresses. Add any stops in the order the truck should visit them." />
            <div className="space-y-5 p-5">
              <div className="grid gap-5 md:grid-cols-2">
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Pickup
                  </div>
                  <AddressAutocomplete
                    id="pickup-address"
                    label="Pickup address"
                    value={form.pickupAddress}
                    placeholder="12 Bourke Road, Alexandria NSW 2015"
                    required
                    error={fields.pickupAddress}
                    onChange={(value) => { set("pickupAddress", value); clearRoute(); }}
                    onSelect={(suggestion: AddressSuggestion) => { set("pickupAddress", suggestion.label); clearRoute(); }}
                  />
                </div>
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <span className="h-2.5 w-2.5 rounded-full bg-orange-500" /> Drop-off
                  </div>
                  <AddressAutocomplete
                    id="dropoff-address"
                    label="Drop-off address"
                    value={form.dropoffAddress}
                    placeholder="18 Smith Street, Parramatta NSW 2150"
                    required
                    error={fields.dropoffAddress}
                    onChange={(value) => { set("dropoffAddress", value); clearRoute(); }}
                    onSelect={(suggestion: AddressSuggestion) => { set("dropoffAddress", suggestion.label); clearRoute(); }}
                  />
                </div>
              </div>

              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Additional stops</h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatMoney(pricingRules.additionalStopFeeCents)} each · included in the route and quote
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={additionalStops.length >= MAX_ADDITIONAL_STOPS}
                    onClick={() => { setAdditionalStops((stops) => [...stops, newStop()]); clearRoute(); }}
                  >
                    + Add a stop
                  </Button>
                </div>
                <Checkbox
                  label="Automatically optimize stop order"
                  description="Reduce the driving route where possible. Pickup and final delivery stay fixed; your entered order is preserved if optimization is unavailable."
                  checked={optimizeStops}
                  onChange={(event) => { setOptimizeStops(event.target.checked); clearRoute(); }}
                />
                {additionalStops.map((stop, index) => (
                  <div key={stop.id} className="flex items-end gap-2">
                    <AddressAutocomplete
                      id={`additional-stop-${stop.id}`}
                      label={`Stop ${index + 1}`}
                      value={stop.address}
                      placeholder="Enter a stop address"
                      required
                      error={fields[`additionalStops.${index}.address`]}
                      onChange={(address) => {
                        setAdditionalStops((stops) => stops.map((item) => item.id === stop.id ? { ...item, address } : item));
                        clearRoute();
                      }}
                      onSelect={(suggestion: AddressSuggestion) => {
                        setAdditionalStops((stops) => stops.map((item) => item.id === stop.id ? { ...item, address: suggestion.label } : item));
                        clearRoute();
                      }}
                    />
                    <div className="mb-0.5 flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="px-2 text-slate-500"
                        aria-label={`Move stop ${index + 1} up`}
                        disabled={index === 0}
                        onClick={() => moveStop(stop.id, -1)}
                      >
                        ↑
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="px-2 text-slate-500"
                        aria-label={`Move stop ${index + 1} down`}
                        disabled={index === additionalStops.length - 1}
                        onClick={() => moveStop(stop.id, 1)}
                      >
                        ↓
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-slate-500"
                        aria-label={`Remove stop ${index + 1}`}
                        onClick={() => {
                          setAdditionalStops((stops) => stops.filter((item) => item.id !== stop.id));
                          clearRoute();
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ))}
                {additionalStops.length === 0 && (
                  <p className="rounded-lg border border-dashed border-slate-300 px-3 py-3 text-xs text-slate-500">
                    No extra stops. Add one or more if you have multiple collection or delivery points.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="dark" onClick={estimateRoute} disabled={!addressesReady} loading={routeLoading}>
                  {route ? "Recalculate route" : "Calculate route"}
                </Button>
                <p className="text-xs text-slate-500">Road distance and drive time are estimated from the full route.</p>
              </div>
              {routeError && <Alert tone="warning" title="Route not available">{routeError}</Alert>}
              {route && (
                <div className="space-y-4 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <RouteMetric label="Driving distance" value={`${route.distanceKm.toFixed(1)} km`} />
                    <RouteMetric label="Estimated drive" value={formatDuration(route.durationSeconds)} />
                    <RouteMetric label="Stops" value={`${route.stops.length + 2} locations`} />
                  </div>
                  <div className="rounded-lg bg-white p-3 shadow-sm ring-1 ring-emerald-900/5">
                    <p className="text-xs font-semibold text-slate-900">Planned visit order</p>
                    <ol className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                      <li className="font-medium text-emerald-700">Pickup</li>
                      {plannedStops.map(({ stop, enteredIndex, routeIndex }) => (
                        <li key={stop.id} className="flex items-center gap-2">
                          <span aria-hidden>→</span>
                          <span>
                            Stop {routeIndex + 1}{route.optimized && enteredIndex !== routeIndex ? ` (entered as ${enteredIndex + 1})` : ""}: {stop.address}
                          </span>
                        </li>
                      ))}
                      <li className="flex items-center gap-2 font-medium text-orange-700"><span aria-hidden>→</span> Final delivery</li>
                    </ol>
                    <p className="mt-2 text-[11px] text-slate-500">
                      {!optimizeStops
                        ? "Your entered stop order is preserved."
                        : route.optimized
                          ? "Intermediate stops were optimized; pickup and final delivery remain fixed."
                          : route.optimizationAttempted
                            ? "Optimization was unavailable, so your entered order is preserved."
                            : "Order unchanged; automatic optimization applies when there are at least two extra stops."}
                    </p>
                  </div>
                  <RouteMap geometry={route.geometry} waypoints={[route.pickup, ...route.stops, route.dropoff]} />
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                    <span>Indicative driving time; traffic and loading time not included.</span>
                    {directionsUrl && (
                      <a href={directionsUrl} target="_blank" rel="noreferrer" className="font-semibold text-orange-700 hover:text-orange-800">
                        Open in Google Maps ↗
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          </Card>
        )}

        {step === 1 && (
          <Card>
            <CardHeader title="2. Choose the right vehicle" description="Compare capacity and per-kilometre rates. Your route is already included in the estimate." />
            <div className="space-y-6 p-5">
              {vehicleTypes.length === 0 ? (
                <Alert tone="warning">There are no bookable vehicle classes at the moment. Please contact dispatch.</Alert>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {vehicleTypes.map((vehicle) => {
                    const selected = vehicle.id === vehicleTypeId;
                    return (
                      <button
                        type="button"
                        key={vehicle.id}
                        aria-pressed={selected}
                        onClick={() => { setVehicleTypeId(vehicle.id); setFields({}); }}
                        className={cn(
                          "rounded-xl border p-4 text-left transition",
                          selected ? "border-orange-500 bg-orange-50 ring-2 ring-orange-500/30" : "border-slate-200 bg-white hover:border-slate-300",
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-semibold text-slate-900">{vehicle.name}</span>
                          <span className="text-xs font-semibold text-slate-600">
                            from {formatMoney(vehicle.minimumChargeCents || vehicle.baseFareCents)}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs text-slate-500">{vehicle.description}</p>
                        <p className="mt-2 text-xs text-slate-600">
                          Up to <b>{vehicle.maxWeightKg.toLocaleString()} kg</b>
                          {vehicle.maxPallets ? <> · <b>{vehicle.maxPallets}</b> pallets</> : null}
                          {" "}· {formatMoney(vehicle.perKmRateCents)}/km
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
              {fields.vehicleTypeId && <p className="text-xs font-medium text-red-600">{fields.vehicleTypeId}</p>}

              <div className="border-t border-slate-100 pt-5">
                <h3 className="text-sm font-semibold text-slate-900">Tell us about the load</h3>
                <p className="mt-1 text-xs text-slate-500">We use this to make sure the selected truck has enough capacity.</p>
                <div className="mt-4 space-y-4">
                  <Field label="Load description" error={fields.loadDescription} required>
                    <Textarea value={form.loadDescription} onChange={(event) => set("loadDescription", event.target.value)} placeholder="e.g. 4 pallets of flooring and a reception desk (wrapped)" required />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="Total weight (kg)" error={fields.weightKg} hint={vehicleType ? `Max ${vehicleType.maxWeightKg.toLocaleString()} kg` : undefined}>
                      <Input type="number" min={0} value={form.weightKg} onChange={(event) => set("weightKg", event.target.value)} />
                    </Field>
                    <Field label="Pallets" error={fields.pallets} hint={vehicleType?.maxPallets ? `Max ${vehicleType.maxPallets}` : undefined}>
                      <Input type="number" min={0} value={form.pallets} onChange={(event) => set("pallets", event.target.value)} />
                    </Field>
                    <Field label="Loose items" error={fields.itemCount}>
                      <Input type="number" min={0} value={form.itemCount} onChange={(event) => set("itemCount", event.target.value)} />
                    </Field>
                  </div>
                  {(weightOverLimit || palletsOverLimit) && (
                    <Alert tone="error" title="This vehicle may be too small">
                      {weightOverLimit && <span className="block">The load exceeds this class&apos;s {vehicleType?.maxWeightKg.toLocaleString()} kg limit.</span>}
                      {palletsOverLimit && <span className="block">The load exceeds this class&apos;s {vehicleType?.maxPallets} pallet limit.</span>}
                      Choose a larger class to continue.
                    </Alert>
                  )}
                </div>
              </div>
            </div>
          </Card>
        )}

        {step === 2 && (
          <Card>
            <CardHeader title="3. Your quote & timing" description="Your price updates instantly with the selected schedule and services." />
            <div className="space-y-5 p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  aria-pressed={form.isAsap}
                  onClick={() => set("isAsap", true)}
                  className={cn("rounded-xl border p-4 text-left", form.isAsap ? "border-orange-500 bg-orange-50 ring-2 ring-orange-500/30" : "border-slate-200 hover:border-slate-300")}
                >
                  <span className="font-semibold text-slate-900">ASAP</span>
                  <p className="mt-1 text-xs text-slate-500">
                    Next available truck. Includes a {(pricingRules.asapSurchargeBasisPoints / 100).toFixed(pricingRules.asapSurchargeBasisPoints % 100 === 0 ? 0 : 2)}% priority surcharge.
                  </p>
                </button>
                <button
                  type="button"
                  aria-pressed={!form.isAsap}
                  onClick={() => set("isAsap", false)}
                  className={cn("rounded-xl border p-4 text-left", !form.isAsap ? "border-orange-500 bg-orange-50 ring-2 ring-orange-500/30" : "border-slate-200 hover:border-slate-300")}
                >
                  <span className="font-semibold text-slate-900">Schedule</span>
                  <p className="mt-1 text-xs text-slate-500">Choose a pickup time. No priority surcharge.</p>
                </button>
              </div>
              {!form.isAsap && (
                <Field label="Pickup date & time" error={fields.scheduledAt} required className="max-w-xs">
                  <Input
                    type="datetime-local"
                    value={form.scheduledAt}
                    onChange={(event) => { set("scheduledAt", event.target.value); setFields({}); }}
                    required
                  />
                </Field>
              )}
              <div className="border-t border-slate-100 pt-5">
                <h3 className="text-sm font-semibold text-slate-900">Services</h3>
                <p className="mt-1 text-xs text-slate-500">Optional equipment and handling, priced using the current tariff.</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Checkbox
                    label={`Tailgate lifter (+${formatMoney(pricingRules.tailgateFeeCents)})`}
                    description="Useful when there is no forklift or loading dock."
                    checked={form.requiresTailgate}
                    onChange={(event) => set("requiresTailgate", event.target.checked)}
                  />
                  <Checkbox
                    label={`Hand unload (+${formatMoney(pricingRules.handUnloadFeeCents)})`}
                    description="Driver carries items to the door."
                    checked={form.requiresHandUnload}
                    onChange={(event) => set("requiresHandUnload", event.target.checked)}
                  />
                </div>
              </div>
              {route && (
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Route price is based on</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">{route.distanceKm.toFixed(1)} km · {formatDuration(route.durationSeconds)} estimated drive</p>
                    </div>
                    {directionsUrl && <a href={directionsUrl} target="_blank" rel="noreferrer" className="shrink-0 text-xs font-semibold text-orange-700 hover:text-orange-800">View in Maps ↗</a>}
                  </div>
                </div>
              )}
            </div>
          </Card>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <Card>
              <CardHeader title="4. Confirm your booking" description="Add on-site contacts and instructions, then submit your job for dispatch confirmation." />
              <div className="space-y-5 p-5">
                <div className="grid gap-5 md:grid-cols-2">
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-slate-900">Pickup contact</h3>
                    <Field label="Contact name" error={fields.pickupContactName}>
                      <Input value={form.pickupContactName} onChange={(event) => set("pickupContactName", event.target.value)} />
                    </Field>
                    <Field label="Contact phone" error={fields.pickupContactPhone}>
                      <Input value={form.pickupContactPhone} onChange={(event) => set("pickupContactPhone", event.target.value)} />
                    </Field>
                    <Field label="Pickup instructions" error={fields.pickupInstructions}>
                      <Textarea value={form.pickupInstructions} onChange={(event) => set("pickupInstructions", event.target.value)} placeholder="Loading dock, access code, who to call…" />
                    </Field>
                  </div>
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-slate-900">Delivery contact</h3>
                    <Field label="Contact name" error={fields.dropoffContactName}>
                      <Input value={form.dropoffContactName} onChange={(event) => set("dropoffContactName", event.target.value)} />
                    </Field>
                    <Field label="Contact phone" error={fields.dropoffContactPhone}>
                      <Input value={form.dropoffContactPhone} onChange={(event) => set("dropoffContactPhone", event.target.value)} />
                    </Field>
                    <Field label="Delivery instructions" error={fields.dropoffInstructions}>
                      <Textarea value={form.dropoffInstructions} onChange={(event) => set("dropoffInstructions", event.target.value)} placeholder="Dock booking times, height limits, who to call…" />
                    </Field>
                  </div>
                </div>
                <div className="border-t border-slate-100 pt-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Payment method" error={fields.paymentMethod}>
                      <Select value={form.paymentMethod} onChange={(event) => set("paymentMethod", event.target.value as "card" | "account")}>
                        <option value="card">Card (charged on completion)</option>
                        <option value="account">On account (invoiced)</option>
                      </Select>
                    </Field>
                    <Field label="Notes for dispatch" error={fields.customerNotes} className="sm:col-span-2">
                      <Textarea value={form.customerNotes} onChange={(event) => set("customerNotes", event.target.value)} placeholder="Anything else our dispatchers should know" />
                    </Field>
                  </div>
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader title="Booking summary" action={directionsUrl ? <a href={directionsUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-orange-700 hover:text-orange-800">Open route in Google Maps ↗</a> : undefined} />
              <div className="space-y-4 p-5 text-sm">
                <div className="grid gap-4 sm:grid-cols-2">
                  <SummaryAddress label="Pickup" address={form.pickupAddress} />
                  {plannedStops.map(({ stop, enteredIndex }, index) => (
                    <SummaryAddress
                      key={stop.id}
                      label={`Stop ${index + 1}${route?.optimized && enteredIndex !== index ? ` · entered as ${enteredIndex + 1}` : ""}`}
                      address={stop.address}
                    />
                  ))}
                  <SummaryAddress label="Drop-off" address={form.dropoffAddress} />
                </div>
                <div className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3">
                  <Row label="Vehicle" value={vehicleType?.name ?? "—"} />
                  <Row label="Route distance" value={route ? `${route.distanceKm.toFixed(1)} km` : "—"} />
                  <Row label="Estimated drive" value={route ? formatDuration(route.durationSeconds) : "—"} />
                  <Row label="Stop order" value={route?.optimized ? "Automatically optimized" : "Entered order"} />
                  <Row label="Pickup time" value={form.isAsap ? "ASAP" : new Date(form.scheduledAt).toLocaleString("en-AU")} />
                  <Row label="Load" value={form.loadDescription || "—"} />
                  <Row label="Services" value={[form.requiresTailgate && "Tailgate lifter", form.requiresHandUnload && "Hand unload"].filter(Boolean).join(", ") || "None"} />
                </div>
              </div>
            </Card>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <Button type="button" variant="secondary" disabled={step === 0 || submitting} onClick={() => { setStep((current) => current - 1); setError(null); }}>
            ← Back
          </Button>
          <span className="text-xs text-slate-500">Step {step + 1} of {STEPS.length}</span>
          {step < STEPS.length - 1 ? (
            <Button type="submit" disabled={!canContinue || submitting}>
              Continue to {STEPS[step + 1]} <span aria-hidden>→</span>
            </Button>
          ) : (
            <Button type="submit" size="lg" loading={submitting} disabled={!quote}>
              Confirm booking{quote ? ` · ${formatMoney(quote.totalCents)}` : ""}
            </Button>
          )}
        </div>
        {step === 0 && <LinkButton href="/bookings" variant="ghost" size="sm">Cancel and return to bookings</LinkButton>}
      </div>

      <aside className="lg:sticky lg:top-8 lg:self-start">
        <Card className="overflow-hidden">
          <div className="bg-slate-900 px-5 py-4 text-white">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Live quote · AUD</p>
            <p className="mt-1 text-3xl font-bold">{quote ? formatMoney(quote.totalCents) : "—"}</p>
            <p className="text-xs text-slate-400">{quote ? "inc. GST · recalculated at booking" : "Set a route and vehicle to see your price"}</p>
          </div>
          <div className="space-y-3 p-5 text-sm">
            <Row label="Vehicle" value={vehicleType?.name ?? "Choose a class"} />
            <Row label="Road distance" value={route ? `${route.distanceKm.toFixed(1)} km` : "—"} />
            <Row label="Estimated drive" value={route ? formatDuration(route.durationSeconds) : "—"} />
            {additionalStops.length > 0 && <Row label="Additional stops" value={String(additionalStops.length)} />}
            {quote && vehicleType && (
              <>
                <hr className="border-slate-100" />
                <Row label="Base fare" value={formatMoney(quote.baseFareCents)} />
                <Row label={`Distance (${quote.distanceKm.toFixed(1)} km × ${formatMoney(vehicleType.perKmRateCents)})`} value={formatMoney(quote.distanceCents)} />
                {quote.minimumApplied && <Row label="Minimum fare adjustment" value={formatMoney(quote.minimumAdjustmentCents)} muted />}
                {quote.extras.map((extra) => <Row key={extra.label} label={extra.label} value={formatMoney(extra.cents)} />)}
                <hr className="border-slate-100" />
                <Row label="Subtotal" value={formatMoney(quote.subtotalCents)} />
                <Row label={`GST (${(quote.gstRateBasisPoints / 100).toFixed(quote.gstRateBasisPoints % 100 === 0 ? 0 : 2)}%)`} value={formatMoney(quote.gstCents)} />
                <div className="flex justify-between text-base font-bold text-slate-900">
                  <span>Total</span>
                  <span>{formatMoney(quote.totalCents)}</span>
                </div>
              </>
            )}
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
              Road mileage is routed through every stop. Traffic, tolls and loading time can change the final travel time.
            </div>
          </div>
        </Card>
      </aside>
    </form>
  );
}

function RouteMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white px-3 py-2.5 shadow-sm ring-1 ring-emerald-900/5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-bold text-slate-900">{value}</p>
    </div>
  );
}

function SummaryAddress({ label, address }: { label: string; address: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 font-medium text-slate-900">{address}</p>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3", muted ? "text-xs text-slate-500" : "text-slate-600")}>
      <span>{label}</span>
      <span className={cn("text-right", !muted && "font-medium text-slate-900")}>{value}</span>
    </div>
  );
}
