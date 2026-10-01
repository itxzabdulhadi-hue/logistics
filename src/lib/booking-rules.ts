import type { BookingStatus, VehicleType } from "@/db/schema";

// This module is intentionally free of server-only imports so it can be used
// in both server code (enforcement) and client components (labels/UI).

export const BOOKING_STATUSES = [
  "pending",
  "confirmed",
  "assigned",
  "en_route_pickup",
  "picked_up",
  "in_transit",
  "delivered",
  "completed",
  "cancelled",
  "failed",
] as const satisfies readonly BookingStatus[];

export type StatusTone =
  | "slate"
  | "amber"
  | "blue"
  | "indigo"
  | "violet"
  | "cyan"
  | "emerald"
  | "green"
  | "red"
  | "rose";

export const STATUS_META: Record<
  BookingStatus,
  { label: string; description: string; tone: StatusTone }
> = {
  pending: { label: "Pending", description: "Awaiting dispatcher review", tone: "amber" },
  confirmed: { label: "Confirmed", description: "Accepted, awaiting driver assignment", tone: "blue" },
  assigned: { label: "Assigned", description: "Driver and vehicle allocated", tone: "indigo" },
  en_route_pickup: { label: "En route to pickup", description: "Driver is heading to the pickup", tone: "violet" },
  picked_up: { label: "Picked up", description: "Load collected", tone: "cyan" },
  in_transit: { label: "In transit", description: "On the way to delivery", tone: "cyan" },
  delivered: { label: "Delivered", description: "Delivered, awaiting close-out", tone: "emerald" },
  completed: { label: "Completed", description: "Job closed", tone: "green" },
  cancelled: { label: "Cancelled", description: "Booking cancelled", tone: "slate" },
  failed: { label: "Failed", description: "Delivery could not be completed", tone: "red" },
};

/** Legal status transitions (enforced in the service layer). */
export const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["assigned", "cancelled"],
  assigned: ["en_route_pickup", "confirmed", "cancelled"],
  en_route_pickup: ["picked_up", "failed", "cancelled"],
  picked_up: ["in_transit", "delivered"],
  in_transit: ["delivered", "failed"],
  delivered: ["completed"],
  completed: [],
  cancelled: [],
  failed: ["confirmed"],
};

export const TRANSITION_LABELS: Record<BookingStatus, string> = {
  pending: "Reopen",
  confirmed: "Confirm booking",
  assigned: "Mark assigned",
  en_route_pickup: "Driver en route",
  picked_up: "Mark picked up",
  in_transit: "Mark in transit",
  delivered: "Mark delivered",
  completed: "Complete job",
  cancelled: "Cancel booking",
  failed: "Mark failed",
};

export const ACTIVE_STATUSES: BookingStatus[] = [
  "pending",
  "confirmed",
  "assigned",
  "en_route_pickup",
  "picked_up",
  "in_transit",
  "delivered",
];
export const TERMINAL_STATUSES: BookingStatus[] = ["completed", "cancelled", "failed"];
export const CUSTOMER_CANCELLABLE: BookingStatus[] = ["pending", "confirmed", "assigned"];

export function canTransition(from: BookingStatus, to: BookingStatus) {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function isActiveStatus(status: BookingStatus) {
  return ACTIVE_STATUSES.includes(status);
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity

export function generateReference(length = 6) {
  let out = "";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i++) out += REF_ALPHABET[bytes[i] % REF_ALPHABET.length];
  return `LL-${out}`;
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

/** Rates stored in the singleton pricing_rules table (percentages are basis points). */
export type PricingRules = {
  additionalStopFeeCents: number;
  tailgateFeeCents: number;
  handUnloadFeeCents: number;
  asapSurchargeBasisPoints: number;
  gstRateBasisPoints: number;
};

export const DEFAULT_PRICING_RULES: PricingRules = {
  additionalStopFeeCents: 1500,
  tailgateFeeCents: 2500,
  handUnloadFeeCents: 4500,
  asapSurchargeBasisPoints: 1500,
  gstRateBasisPoints: 1000,
};

export type QuoteInput = {
  vehicleType: Pick<VehicleType, "baseFareCents" | "perKmRateCents" | "minimumChargeCents">;
  distanceKm: number;
  additionalStops?: number;
  requiresTailgate?: boolean;
  requiresHandUnload?: boolean;
  isAsap?: boolean;
  pricingRules?: PricingRules;
};

export type QuoteBreakdown = {
  distanceKm: number;
  baseFareCents: number;
  distanceCents: number;
  coreCents: number;
  minimumApplied: boolean;
  minimumAdjustmentCents: number;
  extras: { label: string; cents: number }[];
  subtotalCents: number;
  gstRateBasisPoints: number;
  gstCents: number;
  totalCents: number;
};

export function calculateQuote(input: QuoteInput): QuoteBreakdown {
  const { vehicleType } = input;
  const rules = input.pricingRules ?? DEFAULT_PRICING_RULES;
  const distanceKm = Math.max(0, Math.round(input.distanceKm * 10) / 10);
  const baseFareCents = vehicleType.baseFareCents;
  const distanceCents = Math.round(distanceKm * vehicleType.perKmRateCents);
  const raw = baseFareCents + distanceCents;
  const minimumApplied = raw < vehicleType.minimumChargeCents;
  const coreCents = Math.max(raw, vehicleType.minimumChargeCents);
  const minimumAdjustmentCents = coreCents - raw;
  const stopCount = Math.max(0, Math.trunc(input.additionalStops ?? 0));

  const extras: { label: string; cents: number }[] = [];
  if (stopCount > 0) {
    extras.push({
      label: `Additional stops (${stopCount} × $${(rules.additionalStopFeeCents / 100).toFixed(2)})`,
      cents: rules.additionalStopFeeCents * stopCount,
    });
  }
  if (input.requiresTailgate) extras.push({ label: "Tailgate lifter", cents: rules.tailgateFeeCents });
  if (input.requiresHandUnload) extras.push({ label: "Hand unload", cents: rules.handUnloadFeeCents });
  if (input.isAsap && rules.asapSurchargeBasisPoints > 0) {
    const percent = rules.asapSurchargeBasisPoints / 100;
    extras.push({
      label: `ASAP priority (${percent.toFixed(percent % 1 === 0 ? 0 : 2)}%)`,
      cents: Math.round((coreCents * rules.asapSurchargeBasisPoints) / 10_000),
    });
  }

  const subtotalCents = coreCents + extras.reduce((sum, extra) => sum + extra.cents, 0);
  const gstCents = Math.round((subtotalCents * rules.gstRateBasisPoints) / 10_000);
  return {
    distanceKm,
    baseFareCents,
    distanceCents,
    coreCents,
    minimumApplied,
    minimumAdjustmentCents,
    extras,
    subtotalCents,
    gstRateBasisPoints: rules.gstRateBasisPoints,
    gstCents,
    totalCents: subtotalCents + gstCents,
  };
}
