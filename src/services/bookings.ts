import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { z } from "zod";
import { db } from "@/db";
import {
  bookingEvents,
  bookingLiveLocations,
  bookings,
  driverProfiles,
  users,
  vehicleTypes,
  vehicles,
  type Booking,
  type BookingStatus,
  type BookingStop,
  type BookingStopStatus,
  type NewBooking,
} from "@/db/schema";
import { errors } from "@/lib/api";
import type { SafeUser } from "@/lib/auth";
import {
  ACTIVE_STATUSES,
  ASSIGNED_STATUSES,
  CUSTOMER_CANCELLABLE,
  DRIVER_TRANSITIONS,
  STATUS_META,
  calculateQuote,
  canTransition,
  generateReference,
} from "@/lib/booking-rules";
import { estimateDrivingRoute } from "@/lib/geocode";
import { logger } from "@/lib/logger";
import { ensureInvoiceForBooking } from "@/services/billing";
import type { createBookingSchema } from "@/lib/validation";
import { getPricingRules } from "@/services/pricing";

type CreateBookingInput = z.infer<typeof createBookingSchema>;
type Actor = Pick<SafeUser, "id" | "role" | "name">;

const customer = alias(users, "customer");
const driver = alias(users, "driver");

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createBooking(actor: Actor, input: CreateBookingInput): Promise<Booking> {
  const [vt] = await db
    .select()
    .from(vehicleTypes)
    .where(and(eq(vehicleTypes.id, input.vehicleTypeId), eq(vehicleTypes.active, true)))
    .limit(1);
  if (!vt) throw errors.validation({ vehicleTypeId: "This vehicle type is not available" });
  if (input.weightKg && input.weightKg > vt.maxWeightKg) {
    throw errors.validation({
      weightKg: `Exceeds the ${vt.name} payload limit of ${vt.maxWeightKg.toLocaleString()} kg`,
    });
  }
  if (input.pallets && vt.maxPallets && input.pallets > vt.maxPallets) {
    throw errors.validation({ pallets: `A ${vt.name} carries at most ${vt.maxPallets} pallets` });
  }

  // Never accept client-supplied distance or coordinates as pricing inputs. Resolve the
  // entered addresses and recalculate the complete road route on the server at booking time.
  const [route, pricingRules] = await Promise.all([
    estimateDrivingRoute(input),
    getPricingRules(),
  ]);
  if (!route) {
    throw errors.validation(
      { route: "We couldn't map a driving route for every address. Choose a suggested address or check the spelling, then try again." },
      "Route unavailable",
    );
  }
  const quote = calculateQuote({
    vehicleType: vt,
    distanceKm: route.distanceKm,
    additionalStops: input.additionalStops.length,
    requiresTailgate: input.requiresTailgate,
    requiresHandUnload: input.requiresHandUnload,
    isAsap: input.isAsap,
    pricingRules,
  });
  const scheduledAt = input.isAsap ? new Date(Date.now() + 60 * 60 * 1000) : input.scheduledAt!;

  return db.transaction(async (tx) => {
    let reference = generateReference();
    for (let attempt = 0; attempt < 5; attempt++) {
      const [clash] = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(eq(bookings.reference, reference))
        .limit(1);
      if (!clash) break;
      reference = generateReference();
    }

    const values: NewBooking = {
      reference,
      customerId: actor.id,
      vehicleTypeId: vt.id,
      status: "pending",
      pickupAddress: input.pickupAddress,
      pickupSuburb: input.pickupSuburb ?? null,
      pickupState: input.pickupState ?? null,
      pickupPostcode: input.pickupPostcode ?? null,
      pickupContactName: input.pickupContactName ?? null,
      pickupContactPhone: input.pickupContactPhone ?? null,
      pickupInstructions: input.pickupInstructions ?? null,
      pickupLat: route.pickup.lat,
      pickupLng: route.pickup.lng,
      dropoffAddress: input.dropoffAddress,
      dropoffSuburb: input.dropoffSuburb ?? null,
      dropoffState: input.dropoffState ?? null,
      dropoffPostcode: input.dropoffPostcode ?? null,
      dropoffContactName: input.dropoffContactName ?? null,
      dropoffContactPhone: input.dropoffContactPhone ?? null,
      dropoffInstructions: input.dropoffInstructions ?? null,
      dropoffLat: route.dropoff.lat,
      dropoffLng: route.dropoff.lng,
      additionalStops: route.stops.map((point, index) => {
        const sourceStopIndex = route.waypointOrder[index + 1] - 1;
        return {
          address: input.additionalStops[sourceStopIndex]?.address ?? point.label,
          lat: point.lat,
          lng: point.lng,
          status: "pending" as const,
          arrivedAt: null,
          completedAt: null,
        };
      }),
      routeGeometry: route.geometry,
      routeOptimized: route.optimized,
      isAsap: input.isAsap,
      scheduledAt,
      loadDescription: input.loadDescription,
      weightKg: input.weightKg ?? null,
      pallets: input.pallets,
      itemCount: input.itemCount ?? null,
      requiresTailgate: input.requiresTailgate,
      requiresHandUnload: input.requiresHandUnload,
      distanceKm: quote.distanceKm,
      estimatedDurationMinutes: Math.ceil(route.durationSeconds / 60),
      quotedPriceCents: quote.totalCents,
      quoteBreakdown: {
        baseFareCents: quote.baseFareCents,
        distanceCents: quote.distanceCents,
        coreCents: quote.coreCents,
        minimumApplied: quote.minimumApplied,
        minimumAdjustmentCents: quote.minimumAdjustmentCents,
        extras: quote.extras,
        subtotalCents: quote.subtotalCents,
        gstRateBasisPoints: quote.gstRateBasisPoints,
        gstCents: quote.gstCents,
        totalCents: quote.totalCents,
      },
      paymentMethod: input.paymentMethod,
      customerNotes: input.customerNotes ?? null,
    };

    const [booking] = await tx.insert(bookings).values(values).returning();
    await tx.insert(bookingEvents).values({
      bookingId: booking.id,
      fromStatus: null,
      toStatus: "pending",
      actorId: actor.id,
      actorRole: actor.role,
      note: input.isAsap ? "Booking created (ASAP)" : "Booking created",
    });
    logger.info("booking.created", { bookingId: booking.id, reference, customerId: actor.id });
    return booking;
  });
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export type BookingListFilter = {
  customerId?: number;
  driverId?: number;
  status?: BookingStatus;
  q?: string;
  page?: number;
  pageSize?: number;
};

export async function listBookings(filter: BookingListFilter) {
  const page = filter.page ?? 1;
  const pageSize = filter.pageSize ?? 20;
  const conditions: SQL[] = [];
  if (filter.customerId) conditions.push(eq(bookings.customerId, filter.customerId));
  if (filter.driverId) conditions.push(eq(bookings.driverId, filter.driverId));
  if (filter.status) conditions.push(eq(bookings.status, filter.status));
  if (filter.q) {
    const like = `%${filter.q}%`;
    conditions.push(
      or(
        ilike(bookings.reference, like),
        ilike(bookings.pickupAddress, like),
        ilike(bookings.dropoffAddress, like),
        ilike(customer.name, like),
        ilike(customer.companyName, like),
      )!,
    );
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: bookings.id,
        reference: bookings.reference,
        status: bookings.status,
        pickupAddress: bookings.pickupAddress,
        dropoffAddress: bookings.dropoffAddress,
        scheduledAt: bookings.scheduledAt,
        isAsap: bookings.isAsap,
        quotedPriceCents: bookings.quotedPriceCents,
        finalPriceCents: bookings.finalPriceCents,
        createdAt: bookings.createdAt,
        vehicleTypeName: vehicleTypes.name,
        customerId: customer.id,
        customerName: customer.name,
        customerCompany: customer.companyName,
        driverName: driver.name,
      })
      .from(bookings)
      .innerJoin(vehicleTypes, eq(vehicleTypes.id, bookings.vehicleTypeId))
      .innerJoin(customer, eq(customer.id, bookings.customerId))
      .leftJoin(driver, eq(driver.id, bookings.driverId))
      .where(where)
      .orderBy(desc(bookings.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: count() })
      .from(bookings)
      .innerJoin(customer, eq(customer.id, bookings.customerId))
      .where(where),
  ]);

  return { rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
export type BookingListRow = Awaited<ReturnType<typeof listBookings>>["rows"][number];

/** Jobs that still need a driver and vehicle; failed jobs must be reopened before re-dispatch. */
export async function listUnassignedBookings() {
  return db
    .select({
      id: bookings.id,
      reference: bookings.reference,
      status: bookings.status,
      driverId: bookings.driverId,
      vehicleId: bookings.vehicleId,
      scheduledAt: bookings.scheduledAt,
      isAsap: bookings.isAsap,
      pickupAddress: bookings.pickupAddress,
      dropoffAddress: bookings.dropoffAddress,
      vehicleTypeId: bookings.vehicleTypeId,
      vehicleTypeName: vehicleTypes.name,
      maxWeightKg: vehicleTypes.maxWeightKg,
      maxPallets: vehicleTypes.maxPallets,
      weightKg: bookings.weightKg,
      pallets: bookings.pallets,
      quotedPriceCents: bookings.quotedPriceCents,
      customerName: customer.name,
      customerCompany: customer.companyName,
    })
    .from(bookings)
    .innerJoin(vehicleTypes, eq(vehicleTypes.id, bookings.vehicleTypeId))
    .innerJoin(customer, eq(customer.id, bookings.customerId))
    .where(
      and(
        inArray(bookings.status, ["pending", "confirmed", "assigned"]),
        or(isNull(bookings.driverId), isNull(bookings.vehicleId)),
      ),
    )
    .orderBy(asc(bookings.scheduledAt), asc(bookings.createdAt));
}

export async function getBookingDetail(id: number) {
  const [row] = await db
    .select({
      booking: bookings,
      vehicleType: vehicleTypes,
      vehicle: vehicles,
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: customer.phone,
      customerCompany: customer.companyName,
      driverName: driver.name,
      driverPhone: driver.phone,
      driverEmail: driver.email,
    })
    .from(bookings)
    .innerJoin(vehicleTypes, eq(vehicleTypes.id, bookings.vehicleTypeId))
    .innerJoin(customer, eq(customer.id, bookings.customerId))
    .leftJoin(driver, eq(driver.id, bookings.driverId))
    .leftJoin(vehicles, eq(vehicles.id, bookings.vehicleId))
    .where(eq(bookings.id, id))
    .limit(1);
  if (!row) return null;

  const events = await db
    .select({
      id: bookingEvents.id,
      fromStatus: bookingEvents.fromStatus,
      toStatus: bookingEvents.toStatus,
      actorRole: bookingEvents.actorRole,
      note: bookingEvents.note,
      createdAt: bookingEvents.createdAt,
      actorName: users.name,
    })
    .from(bookingEvents)
    .leftJoin(users, eq(users.id, bookingEvents.actorId))
    .where(eq(bookingEvents.bookingId, id))
    .orderBy(asc(bookingEvents.createdAt), asc(bookingEvents.id));

  return { ...row, events };
}
export type BookingDetail = NonNullable<Awaited<ReturnType<typeof getBookingDetail>>>;

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

function label(status: BookingStatus) {
  return STATUS_META[status].label.toLowerCase();
}

export async function transitionBooking(
  id: number,
  to: BookingStatus,
  actor: Actor,
  note?: string,
  options: { driverId?: number; customerId?: number } = {},
): Promise<Booking> {
  const updatedBooking = await db.transaction(async (tx) => {
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, id)).for("update");
    if (!b) throw errors.notFound("Booking not found");
    if (options.driverId != null) {
      if (b.driverId !== options.driverId) throw errors.notFound("Assigned job not found");
      if (!DRIVER_TRANSITIONS[b.status]?.includes(to)) {
        throw errors.forbidden("Drivers can only move their own jobs through the driver workflow");
      }
    }
    if (to === "failed" && !note?.trim()) {
      throw errors.validation({ note: "Explain why this job could not be completed" });
    }
    if (options.customerId != null) {
      if (b.customerId !== options.customerId) throw errors.notFound("Booking not found");
      if (to !== "cancelled" || !CUSTOMER_CANCELLABLE.includes(b.status)) {
        throw errors.conflict("This job can no longer be cancelled online. Please contact dispatch.", "NOT_CANCELLABLE");
      }
    }
    if (options.driverId != null && to === "delivered" && (b.additionalStops ?? []).some((stop) => stop.status !== "completed")) {
      throw errors.conflict("Complete each delivery stop in order before marking the final delivery complete", "STOPS_REMAINING");
    }
    if (!canTransition(b.status, to)) {
      throw errors.conflict(`Cannot move this job from ${label(b.status)} to ${label(to)}`, "ILLEGAL_TRANSITION");
    }
    if (to === "assigned") {
      throw errors.conflict("Use the dispatch assignment action to reserve a driver and compatible vehicle", "ASSIGNMENT_REQUIRED");
    }

    const now = new Date();
    const patch: Partial<NewBooking> = { status: to, updatedAt: now };
    let releaseVehicle = false;
    switch (to) {
      case "confirmed":
        patch.confirmedAt = b.confirmedAt ?? now;
        if (b.status === "assigned" || b.status === "failed") {
          patch.driverId = null;
          patch.vehicleId = null;
          patch.assignedAt = null;
          releaseVehicle = true;
        }
        break;
      case "picked_up":
        patch.pickedUpAt = now;
        break;
      case "delivered":
        patch.deliveredAt = now;
        break;
      case "completed":
        patch.completedAt = now;
        if (b.finalPriceCents == null) patch.finalPriceCents = b.quotedPriceCents;
        releaseVehicle = true;
        break;
      case "cancelled":
        patch.cancelledAt = now;
        patch.cancellationReason = note ?? null;
        releaseVehicle = true;
        break;
      case "failed":
        releaseVehicle = true;
        break;
    }

    const [updated] = await tx.update(bookings).set(patch).where(eq(bookings.id, id)).returning();
    if (releaseVehicle) {
      await tx.delete(bookingLiveLocations).where(eq(bookingLiveLocations.bookingId, id));
    }
    if (releaseVehicle && b.vehicleId) {
      await tx
        .update(vehicles)
        .set({ status: "available", updatedAt: now })
        .where(and(eq(vehicles.id, b.vehicleId), eq(vehicles.status, "in_use")));
    }
    await tx.insert(bookingEvents).values({
      bookingId: id,
      fromStatus: b.status,
      toStatus: to,
      actorId: actor.id,
      actorRole: actor.role,
      note: note ?? null,
    });
    logger.info("booking.transition", { bookingId: id, from: b.status, to, actorId: actor.id });
    return updated;
  });
  if (to === "completed") await ensureInvoiceForBooking(id);
  return updatedBooking;
}

export async function updateBookingStopStatus(
  id: number,
  stopIndex: number,
  status: Exclude<BookingStopStatus, "pending">,
  actor: Actor,
): Promise<Booking> {
  return db.transaction(async (tx) => {
    const [booking] = await tx.select().from(bookings).where(eq(bookings.id, id)).for("update");
    if (!booking || actor.role !== "driver" || booking.driverId !== actor.id) {
      throw errors.notFound("Assigned job not found");
    }
    if (booking.status !== "in_transit") {
      throw errors.conflict("Delivery stops can be updated while the job is in transit", "STOP_UPDATE_NOT_ACTIVE");
    }

    const stops = (booking.additionalStops ?? []) as BookingStop[];
    const currentStop = stops[stopIndex];
    if (!currentStop) throw errors.validation({ stopIndex: "Choose a valid delivery stop" });
    const nextStopIndex = stops.findIndex((stop) => (stop.status ?? "pending") !== "completed");
    if (nextStopIndex !== stopIndex) {
      throw errors.conflict("Complete delivery stops in the planned order", "STOP_ORDER_REQUIRED");
    }

    const currentStatus = currentStop.status ?? "pending";
    const canArrive = status === "arrived" && currentStatus === "pending";
    const canComplete = status === "completed" && currentStatus === "arrived";
    if (!canArrive && !canComplete) {
      throw errors.conflict(
        currentStatus === "completed" ? "This stop is already complete" : "Mark the stop as arrived before completing it",
        "ILLEGAL_STOP_TRANSITION",
      );
    }

    const now = new Date();
    const timestamp = now.toISOString();
    const updatedStops: BookingStop[] = stops.map((stop, index) => ({
      ...stop,
      status: index === stopIndex ? status : stop.status ?? "pending",
      arrivedAt: index === stopIndex && status === "arrived" ? timestamp : stop.arrivedAt ?? null,
      completedAt: index === stopIndex && status === "completed" ? timestamp : stop.completedAt ?? null,
    }));
    const [updated] = await tx
      .update(bookings)
      .set({ additionalStops: updatedStops, updatedAt: now })
      .where(eq(bookings.id, id))
      .returning();

    await tx.insert(bookingEvents).values({
      bookingId: id,
      fromStatus: booking.status,
      toStatus: booking.status,
      actorId: actor.id,
      actorRole: actor.role,
      note: `Delivery stop ${stopIndex + 1} ${status}: ${currentStop.address}`,
    });
    logger.info("booking.stop.updated", { bookingId: id, stopIndex, status, actorId: actor.id });
    return updated;
  });
}

export async function assignBooking(
  id: number,
  input: { driverId: number; vehicleId?: number },
  actor: Actor,
  note?: string,
): Promise<Booking> {
  return db.transaction(async (tx) => {
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, id)).for("update");
    if (!b) throw errors.notFound("Booking not found");
    if (!["pending", "confirmed", "assigned"].includes(b.status)) {
      throw errors.conflict(`A job that is ${label(b.status)} cannot be (re)assigned`, "ILLEGAL_TRANSITION");
    }

    // Lock the driver before checking workload so two dispatchers cannot assign the
    // same person to different jobs at the same time.
    const [drv] = await tx
      .select({ id: users.id, name: users.name, status: users.status })
      .from(users)
      .where(and(eq(users.id, input.driverId), eq(users.role, "driver")))
      .for("update");
    if (!drv || drv.status !== "active") throw errors.validation({ driverId: "Select an active driver" });
    await tx.insert(driverProfiles).values({ driverId: drv.id }).onConflictDoNothing();
    const [profile] = await tx
      .select()
      .from(driverProfiles)
      .where(eq(driverProfiles.driverId, drv.id))
      .for("update");
    if (!profile) throw errors.conflict("This driver has no operating profile", "DRIVER_PROFILE_REQUIRED");
    if (profile.availability !== "available" && b.driverId !== drv.id) {
      throw errors.conflict("This driver is off duty and cannot be assigned", "DRIVER_UNAVAILABLE");
    }

    const [otherDriverJob] = await tx
      .select({ id: bookings.id, reference: bookings.reference })
      .from(bookings)
      .where(
        and(
          eq(bookings.driverId, drv.id),
          inArray(bookings.status, ASSIGNED_STATUSES),
          ne(bookings.id, id),
        ),
      )
      .limit(1);
    if (otherDriverJob) {
      throw errors.conflict(`This driver is already assigned to ${otherDriverJob.reference}`, "DRIVER_BUSY");
    }

    let vehicleId = input.vehicleId ?? (b.driverId === drv.id ? b.vehicleId : null);
    if (!vehicleId) {
      const [own] = await tx
        .select({ id: vehicles.id })
        .from(vehicles)
        .where(
          and(
            eq(vehicles.driverId, drv.id),
            eq(vehicles.vehicleTypeId, b.vehicleTypeId),
            eq(vehicles.status, "available"),
          ),
        )
        .limit(1);
      vehicleId = own?.id ?? null;
    }
    if (!vehicleId) {
      throw errors.validation({ vehicleId: "Select an available vehicle in the booked class" });
    }

    const [v] = await tx.select().from(vehicles).where(eq(vehicles.id, vehicleId)).for("update");
    if (!v) throw errors.validation({ vehicleId: "Select a valid vehicle" });
    if (v.vehicleTypeId !== b.vehicleTypeId) {
      throw errors.validation({ vehicleId: "Vehicle class must match the customer's booking" });
    }
    if (v.driverId != null && v.driverId !== drv.id) {
      throw errors.validation({ vehicleId: "This vehicle is assigned to a different driver" });
    }
    const keepingCurrentVehicle = b.vehicleId === v.id;
    if (v.status !== "available" && !(keepingCurrentVehicle && v.status === "in_use")) {
      throw errors.conflict("This vehicle is not available for dispatch", "VEHICLE_UNAVAILABLE");
    }

    const [otherVehicleJob] = await tx
      .select({ id: bookings.id, reference: bookings.reference })
      .from(bookings)
      .where(
        and(
          eq(bookings.vehicleId, v.id),
          inArray(bookings.status, ASSIGNED_STATUSES),
          ne(bookings.id, id),
        ),
      )
      .limit(1);
    if (otherVehicleJob) {
      throw errors.conflict(`This vehicle is already allocated to ${otherVehicleJob.reference}`, "VEHICLE_BUSY");
    }

    const [type] = await tx
      .select({ name: vehicleTypes.name, maxWeightKg: vehicleTypes.maxWeightKg, maxPallets: vehicleTypes.maxPallets })
      .from(vehicleTypes)
      .where(eq(vehicleTypes.id, v.vehicleTypeId))
      .for("share")
      .limit(1);
    if (!type) throw errors.validation({ vehicleId: "Vehicle class is no longer available" });
    const capacityKg = Math.min(v.capacityKg ?? type.maxWeightKg, type.maxWeightKg);
    if (b.weightKg != null && b.weightKg > capacityKg) {
      throw errors.validation({ vehicleId: `This truck carries up to ${capacityKg.toLocaleString()} kg, below the booked load weight` });
    }
    if (type.maxPallets != null && b.pallets > type.maxPallets) {
      throw errors.validation({ vehicleId: `This truck carries at most ${type.maxPallets} pallets` });
    }

    const [previousDriver] = b.driverId && b.driverId !== drv.id
      ? await tx.select({ name: users.name }).from(users).where(eq(users.id, b.driverId)).limit(1)
      : [undefined];
    const [previousVehicle] = b.vehicleId && b.vehicleId !== v.id
      ? await tx.select({ registration: vehicles.registration }).from(vehicles).where(eq(vehicles.id, b.vehicleId)).limit(1)
      : [undefined];

    const now = new Date();
    if (b.driverId !== drv.id || b.vehicleId !== v.id) {
      await tx.delete(bookingLiveLocations).where(eq(bookingLiveLocations.bookingId, id));
    }
    const [updated] = await tx
      .update(bookings)
      .set({
        driverId: drv.id,
        vehicleId: v.id,
        status: "assigned",
        confirmedAt: b.confirmedAt ?? now,
        assignedAt: now,
        updatedAt: now,
      })
      .where(eq(bookings.id, id))
      .returning();

    if (b.vehicleId && b.vehicleId !== v.id) {
      await tx
        .update(vehicles)
        .set({ status: "available", updatedAt: now })
        .where(and(eq(vehicles.id, b.vehicleId), eq(vehicles.status, "in_use")));
    }
    await tx.update(vehicles).set({ status: "in_use", updatedAt: now }).where(eq(vehicles.id, v.id));

    const assignedTo = `${drv.name} (${v.registration})`;
    const summary = previousDriver || previousVehicle
      ? `Reassigned from ${previousDriver?.name ?? "previous driver"}${previousVehicle?.registration ? ` (${previousVehicle.registration})` : ""} to ${assignedTo}`
      : `Assigned to ${assignedTo}`;
    await tx.insert(bookingEvents).values({
      bookingId: id,
      fromStatus: b.status,
      toStatus: "assigned",
      actorId: actor.id,
      actorRole: actor.role,
      note: note ? `${summary} — ${note}` : summary,
    });
    logger.info("booking.assigned", { bookingId: id, driverId: drv.id, vehicleId: v.id, actorId: actor.id });
    return updated;
  });
}

export async function cancelBooking(id: number, actor: Actor, reason: string | undefined, asCustomer: boolean) {
  return transitionBooking(
    id,
    "cancelled",
    actor,
    reason || (asCustomer ? "Cancelled by customer" : "Cancelled by dispatch"),
    asCustomer ? { customerId: actor.id } : {},
  );
}

export async function updateBookingAdmin(
  id: number,
  input: { finalPriceCents?: number | null; adminNotes?: string | null },
  actor: Actor,
): Promise<Booking> {
  return db.transaction(async (tx) => {
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, id)).for("update");
    if (!b) throw errors.notFound("Booking not found");
    if (b.status === "completed" && input.finalPriceCents !== undefined && input.finalPriceCents !== b.finalPriceCents) {
      throw errors.conflict("The final price is locked when the job is completed. Use a refund for post-invoice corrections.", "INVOICE_PRICE_LOCKED");
    }
    const patch: Partial<NewBooking> = { updatedAt: new Date() };
    const notes: string[] = [];
    if (input.finalPriceCents !== undefined && input.finalPriceCents !== b.finalPriceCents) {
      patch.finalPriceCents = input.finalPriceCents;
      notes.push(
        input.finalPriceCents == null
          ? "Final price reset to quoted price"
          : `Final price set to $${(input.finalPriceCents / 100).toFixed(2)}`,
      );
    }
    if (input.adminNotes !== undefined && input.adminNotes !== b.adminNotes) {
      patch.adminNotes = input.adminNotes;
      notes.push("Internal notes updated");
    }
    const [updated] = await tx.update(bookings).set(patch).where(eq(bookings.id, id)).returning();
    if (notes.length) {
      await tx.insert(bookingEvents).values({
        bookingId: id,
        fromStatus: b.status,
        toStatus: b.status,
        actorId: actor.id,
        actorRole: actor.role,
        note: notes.join(" · "),
      });
    }
    return updated;
  });
}

/** Operational board for a driver: only jobs actively assigned to their account. */
export async function listDriverJobs(driverId: number) {
  return db
    .select({
      id: bookings.id,
      reference: bookings.reference,
      status: bookings.status,
      scheduledAt: bookings.scheduledAt,
      isAsap: bookings.isAsap,
      pickupAddress: bookings.pickupAddress,
      pickupLat: bookings.pickupLat,
      pickupLng: bookings.pickupLng,
      pickupContactName: bookings.pickupContactName,
      pickupContactPhone: bookings.pickupContactPhone,
      pickupInstructions: bookings.pickupInstructions,
      dropoffAddress: bookings.dropoffAddress,
      dropoffLat: bookings.dropoffLat,
      dropoffLng: bookings.dropoffLng,
      dropoffContactName: bookings.dropoffContactName,
      dropoffContactPhone: bookings.dropoffContactPhone,
      dropoffInstructions: bookings.dropoffInstructions,
      additionalStops: bookings.additionalStops,
      routeGeometry: bookings.routeGeometry,
      routeOptimized: bookings.routeOptimized,
      locationLatitude: bookingLiveLocations.latitude,
      locationLongitude: bookingLiveLocations.longitude,
      loadDescription: bookings.loadDescription,
      weightKg: bookings.weightKg,
      pallets: bookings.pallets,
      itemCount: bookings.itemCount,
      estimatedDurationMinutes: bookings.estimatedDurationMinutes,
      distanceKm: bookings.distanceKm,
      customerNotes: bookings.customerNotes,
      vehicleTypeName: vehicleTypes.name,
      vehicleRegistration: vehicles.registration,
      vehicleMake: vehicles.make,
      customerName: customer.name,
    })
    .from(bookings)
    .innerJoin(vehicleTypes, eq(vehicleTypes.id, bookings.vehicleTypeId))
    .innerJoin(customer, eq(customer.id, bookings.customerId))
    .leftJoin(vehicles, eq(vehicles.id, bookings.vehicleId))
    .leftJoin(bookingLiveLocations, eq(bookingLiveLocations.bookingId, bookings.id))
    .where(and(eq(bookings.driverId, driverId), inArray(bookings.status, ASSIGNED_STATUSES)))
    .orderBy(asc(bookings.scheduledAt), asc(bookings.assignedAt));
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

const effectivePrice = sql<number>`coalesce(${bookings.finalPriceCents}, ${bookings.quotedPriceCents})`;

export async function getCustomerStats(customerId: number) {
  const [row] = await db
    .select({
      total: count(),
      active: sql<number>`count(*) filter (where ${inArray(bookings.status, ACTIVE_STATUSES)})::int`,
      completed: sql<number>`count(*) filter (where ${bookings.status} = 'completed')::int`,
      spendCents: sql<number>`coalesce(sum(${effectivePrice}) filter (where ${bookings.status} not in ('cancelled','failed')), 0)::int`,
    })
    .from(bookings)
    .where(eq(bookings.customerId, customerId));

  const [next] = await db
    .select({ id: bookings.id, reference: bookings.reference, scheduledAt: bookings.scheduledAt, status: bookings.status })
    .from(bookings)
    .where(
      and(
        eq(bookings.customerId, customerId),
        inArray(bookings.status, ["pending", "confirmed", "assigned", "en_route_pickup"]),
        gte(bookings.scheduledAt, new Date(Date.now() - 2 * 60 * 60 * 1000)),
      ),
    )
    .orderBy(asc(bookings.scheduledAt))
    .limit(1);

  return { ...row, nextPickup: next ?? null };
}

export async function getAdminStats() {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [[jobs], byStatus, [people], [fleet]] = await Promise.all([
    db
      .select({
        total: count(),
        pending: sql<number>`count(*) filter (where ${bookings.status} = 'pending')::int`,
        active: sql<number>`count(*) filter (where ${inArray(bookings.status, ACTIVE_STATUSES)})::int`,
        today: sql<number>`count(*) filter (where ${bookings.scheduledAt} >= ${startOfToday} and ${bookings.scheduledAt} < ${endOfToday} and ${bookings.status} not in ('cancelled','failed'))::int`,
        completedMonth: sql<number>`count(*) filter (where ${bookings.status} = 'completed' and ${bookings.completedAt} >= ${startOfMonth})::int`,
        revenueMonthCents: sql<number>`coalesce(sum(${effectivePrice}) filter (where ${bookings.status} in ('delivered','completed') and ${bookings.createdAt} >= ${startOfMonth}), 0)::int`,
        pipelineCents: sql<number>`coalesce(sum(${effectivePrice}) filter (where ${inArray(bookings.status, ACTIVE_STATUSES)}), 0)::int`,
      })
      .from(bookings),
    db
      .select({ status: bookings.status, count: count() })
      .from(bookings)
      .groupBy(bookings.status),
    db
      .select({
        customers: sql<number>`count(*) filter (where ${users.role} = 'customer')::int`,
        drivers: sql<number>`count(*) filter (where ${users.role} = 'driver' and ${users.status} = 'active')::int`,
      })
      .from(users),
    db
      .select({
        total: count(),
        available: sql<number>`count(*) filter (where ${vehicles.status} = 'available')::int`,
        inUse: sql<number>`count(*) filter (where ${vehicles.status} = 'in_use')::int`,
      })
      .from(vehicles),
  ]);

  return { jobs, byStatus, people, fleet };
}

/** Jobs that need dispatcher attention: pending, or assigned-but-overdue. */
export async function listAttentionBookings(limit = 8) {
  const overdue = new Date(Date.now() - 30 * 60 * 1000);
  return db
    .select({
      id: bookings.id,
      reference: bookings.reference,
      status: bookings.status,
      scheduledAt: bookings.scheduledAt,
      isAsap: bookings.isAsap,
      pickupAddress: bookings.pickupAddress,
      dropoffAddress: bookings.dropoffAddress,
      customerName: customer.name,
      vehicleTypeName: vehicleTypes.name,
      quotedPriceCents: bookings.quotedPriceCents,
    })
    .from(bookings)
    .innerJoin(customer, eq(customer.id, bookings.customerId))
    .innerJoin(vehicleTypes, eq(vehicleTypes.id, bookings.vehicleTypeId))
    .where(
      or(
        eq(bookings.status, "pending"),
        and(inArray(bookings.status, ["confirmed", "assigned"]), lt(bookings.scheduledAt, overdue)),
      ),
    )
    .orderBy(asc(bookings.scheduledAt))
    .limit(limit);
}
