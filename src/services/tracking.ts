import { and, asc, eq, inArray, isNotNull, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  bookingLiveLocations,
  bookings,
  users,
  vehicles,
  type BookingStatus,
} from "@/db/schema";
import { errors } from "@/lib/api";
import type { SafeUser } from "@/lib/auth";
import type { Coordinate, TrackingLocation, TrackingSnapshot } from "@/lib/tracking-types";
import type { DriverLocationInput } from "@/lib/validation";

const trackingDriver = alias(users, "tracking_driver");
const LIVE_JOB_STATUSES: BookingStatus[] = [
  "assigned",
  "en_route_pickup",
  "picked_up",
  "in_transit",
  "delivered",
];
const GPS_ACTIVE_STATUSES: BookingStatus[] = ["en_route_pickup", "picked_up", "in_transit"];
const MAX_LOCATION_AGE_MS = 5 * 60_000;
const MAX_FUTURE_SKEW_MS = 60_000;

function buildViewerFilter(viewer: SafeUser): SQL | null {
  if (viewer.role === "admin" || viewer.role === "dispatcher") return null;
  if (viewer.role === "customer") return eq(bookings.customerId, viewer.id);
  if (viewer.role === "driver") {
    return and(eq(bookings.driverId, viewer.id), inArray(bookings.status, LIVE_JOB_STATUSES)) ?? eq(bookings.id, -1);
  }
  return eq(bookings.id, -1);
}

function snapshotFromRow(row: TrackingRow): TrackingSnapshot {
  const pickup =
    row.pickupLat == null || row.pickupLng == null
      ? null
      : { lat: row.pickupLat, lng: row.pickupLng };
  const dropoff =
    row.dropoffLat == null || row.dropoffLng == null
      ? null
      : { lat: row.dropoffLat, lng: row.dropoffLng };
  const stops = (row.additionalStops ?? []).map((stop) => ({
    ...stop,
    status: stop.status ?? "pending",
    arrivedAt: stop.arrivedAt ?? null,
    completedAt: stop.completedAt ?? null,
  }));
  const waypoints = [pickup, ...stops.map(({ lat, lng }) => ({ lat, lng })), dropoff].filter(
    (point): point is Coordinate => point !== null,
  );
  const savedRoute = row.routeGeometry ?? [];
  const route = savedRoute.length > 1 ? savedRoute : waypoints;
  const location =
    row.locationLatitude == null ||
    row.locationLongitude == null ||
    row.locationCapturedAt == null ||
    row.locationReceivedAt == null
      ? null
      : {
          latitude: row.locationLatitude,
          longitude: row.locationLongitude,
          timestamp: row.locationCapturedAt.toISOString(),
          receivedAt: row.locationReceivedAt.toISOString(),
          accuracyMeters: row.locationAccuracyMeters,
          headingDegrees: row.locationHeadingDegrees,
          speedMetersPerSecond: row.locationSpeedMetersPerSecond,
        };

  return {
    bookingId: row.bookingId,
    reference: row.reference,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
    driverName: row.driverName,
    vehicleRegistration: row.vehicleRegistration,
    pickupAddress: row.pickupAddress,
    dropoffAddress: row.dropoffAddress,
    pickup,
    dropoff,
    stops,
    route,
    estimatedDurationMinutes: row.estimatedDurationMinutes,
    distanceKm: row.distanceKm,
    routeOptimized: row.routeOptimized,
    location,
  };
}

const trackingSelection = {
  bookingId: bookings.id,
  customerId: bookings.customerId,
  driverId: bookings.driverId,
  reference: bookings.reference,
  status: bookings.status,
  updatedAt: bookings.updatedAt,
  pickupAddress: bookings.pickupAddress,
  pickupLat: bookings.pickupLat,
  pickupLng: bookings.pickupLng,
  dropoffAddress: bookings.dropoffAddress,
  dropoffLat: bookings.dropoffLat,
  dropoffLng: bookings.dropoffLng,
  additionalStops: bookings.additionalStops,
  routeGeometry: bookings.routeGeometry,
  routeOptimized: bookings.routeOptimized,
  distanceKm: bookings.distanceKm,
  estimatedDurationMinutes: bookings.estimatedDurationMinutes,
  driverName: trackingDriver.name,
  vehicleRegistration: vehicles.registration,
  locationLatitude: bookingLiveLocations.latitude,
  locationLongitude: bookingLiveLocations.longitude,
  locationCapturedAt: bookingLiveLocations.capturedAt,
  locationReceivedAt: bookingLiveLocations.receivedAt,
  locationAccuracyMeters: bookingLiveLocations.accuracyMeters,
  locationHeadingDegrees: bookingLiveLocations.headingDegrees,
  locationSpeedMetersPerSecond: bookingLiveLocations.speedMetersPerSecond,
};

type TrackingRow = Awaited<ReturnType<typeof selectTrackingRows>>[number];

async function selectTrackingRows(filters: SQL[], limit = 100) {
  return db
    .select(trackingSelection)
    .from(bookings)
    .leftJoin(trackingDriver, eq(trackingDriver.id, bookings.driverId))
    .leftJoin(vehicles, eq(vehicles.id, bookings.vehicleId))
    .leftJoin(bookingLiveLocations, eq(bookingLiveLocations.bookingId, bookings.id))
    .where(and(...filters))
    .orderBy(asc(bookings.scheduledAt), asc(bookings.id))
    .limit(limit);
}

/** A single booking's latest authorized GPS point, route, driver and delivery state. */
export async function getTrackingSnapshot(bookingId: number): Promise<TrackingSnapshot | null> {
  const rows = await selectTrackingRows([eq(bookings.id, bookingId)], 1);
  return rows[0] ? snapshotFromRow(rows[0]) : null;
}

/** Batch reads are used by the live dashboard and its low-frequency recovery sync. */
export async function listTrackingSnapshotsForViewer(
  bookingIds: number[],
  viewer: SafeUser,
): Promise<TrackingSnapshot[]> {
  if (bookingIds.length === 0) return [];
  const filters: SQL[] = [inArray(bookings.id, bookingIds)];
  const viewerFilter = buildViewerFilter(viewer);
  if (viewerFilter) filters.push(viewerFilter);
  return (await selectTrackingRows(filters, 100)).map(snapshotFromRow);
}

export async function listActiveTrackingSnapshots(limit = 100): Promise<TrackingSnapshot[]> {
  const rows = await selectTrackingRows(
    [
      inArray(bookings.status, LIVE_JOB_STATUSES),
      isNotNull(bookings.driverId),
      isNotNull(bookings.vehicleId),
    ],
    limit,
  );
  return rows.map(snapshotFromRow);
}

/** Return only IDs the user may subscribe to; no coordinates leave this query. */
export async function listAuthorizedTrackingIds(
  bookingIds: number[],
  viewer: SafeUser,
): Promise<number[]> {
  if (bookingIds.length === 0) return [];
  const filters: SQL[] = [inArray(bookings.id, bookingIds)];
  const viewerFilter = buildViewerFilter(viewer);
  if (viewerFilter) filters.push(viewerFilter);
  const rows = await db
    .select({ bookingId: bookings.id })
    .from(bookings)
    .where(and(...filters));
  return rows.map((row) => row.bookingId);
}

/** Persist a driver's most recent GPS fix, scoped to their currently active assignment. */
export async function recordDriverLocation(
  driverId: number,
  input: DriverLocationInput,
): Promise<{ accepted: boolean; location: TrackingLocation }> {
  const now = new Date();
  const capturedAt = input.timestamp;
  const age = now.getTime() - capturedAt.getTime();
  if (age > MAX_LOCATION_AGE_MS || age < -MAX_FUTURE_SKEW_MS) {
    throw errors.validation(
      { timestamp: "Send a recent GPS timestamp no more than five minutes old." },
      "GPS update is stale",
    );
  }

  return db.transaction(async (tx) => {
    const [booking] = await tx
      .select({ driverId: bookings.driverId, vehicleId: bookings.vehicleId, status: bookings.status })
      .from(bookings)
      .where(eq(bookings.id, input.bookingId))
      .for("update");

    if (!booking || booking.driverId !== driverId) {
      throw errors.notFound("Active assigned job not found");
    }
    if (!GPS_ACTIVE_STATUSES.includes(booking.status)) {
      throw errors.conflict("Start the trip before sharing GPS location", "TRACKING_NOT_ACTIVE");
    }
    if (booking.vehicleId == null) {
      throw errors.conflict("This job has no assigned vehicle", "VEHICLE_NOT_ASSIGNED");
    }

    const [previous] = await tx
      .select()
      .from(bookingLiveLocations)
      .where(eq(bookingLiveLocations.bookingId, input.bookingId))
      .for("update");
    if (
      previous &&
      previous.driverId === driverId &&
      previous.capturedAt.getTime() >= capturedAt.getTime()
    ) {
      return { accepted: false, location: locationFromRow(previous) };
    }

    const values = {
      bookingId: input.bookingId,
      driverId,
      vehicleId: booking.vehicleId,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyMeters: input.accuracyMeters ?? null,
      headingDegrees: input.headingDegrees ?? null,
      speedMetersPerSecond: input.speedMetersPerSecond ?? null,
      capturedAt,
      receivedAt: now,
    };
    const [stored] = await tx
      .insert(bookingLiveLocations)
      .values(values)
      .onConflictDoUpdate({
        target: bookingLiveLocations.bookingId,
        set: values,
      })
      .returning();

    return { accepted: true, location: locationFromRow(stored) };
  });
}

function locationFromRow(row: typeof bookingLiveLocations.$inferSelect): TrackingLocation {
  return {
    latitude: row.latitude,
    longitude: row.longitude,
    timestamp: row.capturedAt.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
    accuracyMeters: row.accuracyMeters,
    headingDegrees: row.headingDegrees,
    speedMetersPerSecond: row.speedMetersPerSecond,
  };
}
