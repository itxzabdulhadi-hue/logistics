import type { BookingStatus } from "@/db/schema";

export type Coordinate = { lat: number; lng: number };
export type TrackingStop = Coordinate & { address: string };

export type TrackingLocation = {
  latitude: number;
  longitude: number;
  timestamp: string;
  receivedAt: string;
  accuracyMeters: number | null;
  headingDegrees: number | null;
  speedMetersPerSecond: number | null;
};

/** Safe, customer-visible snapshot. Never includes internal user IDs or notes. */
export type TrackingSnapshot = {
  bookingId: number;
  reference: string;
  status: BookingStatus;
  updatedAt: string;
  driverName: string | null;
  vehicleRegistration: string | null;
  pickupAddress: string;
  dropoffAddress: string;
  pickup: Coordinate | null;
  dropoff: Coordinate | null;
  stops: TrackingStop[];
  route: Coordinate[];
  estimatedDurationMinutes: number | null;
  distanceKm: number | null;
  location: TrackingLocation | null;
};

export type TrackingServerEvent =
  | { type: "tracking.location"; bookingId: number; location: TrackingLocation }
  | { type: "tracking.booking"; bookingId: number; status: BookingStatus; updatedAt: string };

export type TrackingSocketMessage =
  | { type: "ready"; crossInstance: true }
  | { type: "subscribed"; bookingIds: number[] }
  | { type: "error"; message: string }
  | { type: "pong" }
  | TrackingServerEvent;
