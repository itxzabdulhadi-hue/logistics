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

export const EXTRA_FEES = {
  tailgateCents: 2500,
  handUnloadCents: 4500,
  asapSurchargeRate: 0.15,
};
export const GST_RATE = 0.1;

export type QuoteInput = {
  vehicleType: Pick<VehicleType, "baseFareCents" | "perKmRateCents" | "minimumChargeCents">;
  distanceKm: number;
  requiresTailgate?: boolean;
  requiresHandUnload?: boolean;
  isAsap?: boolean;
};

export type QuoteBreakdown = {
  distanceKm: number;
  baseFareCents: number;
  distanceCents: number;
  coreCents: number;
  minimumApplied: boolean;
  extras: { label: string; cents: number }[];
  subtotalCents: number;
  gstCents: number;
  totalCents: number;
};

export function calculateQuote(input: QuoteInput): QuoteBreakdown {
  const { vehicleType } = input;
  const distanceKm = Math.max(0, Math.round(input.distanceKm * 10) / 10);
  const baseFareCents = vehicleType.baseFareCents;
  const distanceCents = Math.round(distanceKm * vehicleType.perKmRateCents);
  const raw = baseFareCents + distanceCents;
  const minimumApplied = raw < vehicleType.minimumChargeCents;
  const coreCents = Math.max(raw, vehicleType.minimumChargeCents);

  const extras: { label: string; cents: number }[] = [];
  if (input.requiresTailgate) extras.push({ label: "Tailgate lifter", cents: EXTRA_FEES.tailgateCents });
  if (input.requiresHandUnload) extras.push({ label: "Hand unload", cents: EXTRA_FEES.handUnloadCents });
  if (input.isAsap) {
    extras.push({
      label: "ASAP priority (15%)",
      cents: Math.round(coreCents * EXTRA_FEES.asapSurchargeRate),
    });
  }

  const subtotalCents = coreCents + extras.reduce((s, e) => s + e.cents, 0);
  const gstCents = Math.round(subtotalCents * GST_RATE);
  return {
    distanceKm,
    baseFareCents,
    distanceCents,
    coreCents,
    minimumApplied,
    extras,
    subtotalCents,
    gstCents,
    totalCents: subtotalCents + gstCents,
  };
}
