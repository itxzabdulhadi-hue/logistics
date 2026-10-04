import { and, asc, desc, eq, gt, inArray, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { bookings, users, vehicleTypes, vehicles, type VehicleType } from "@/db/schema";
import { errors } from "@/lib/api";
import { ASSIGNED_STATUSES } from "@/lib/booking-rules";
import { logger } from "@/lib/logger";
import type { z } from "zod";
import type { vehicleSchema, vehicleTypeSchema } from "@/lib/validation";

type VehicleTypeInput = z.infer<typeof vehicleTypeSchema>;
type VehicleInput = z.infer<typeof vehicleSchema>;

// ---------------------------------------------------------------------------
// Vehicle types
// ---------------------------------------------------------------------------

export async function listVehicleTypes(opts: { activeOnly?: boolean } = {}): Promise<VehicleType[]> {
  return db
    .select()
    .from(vehicleTypes)
    .where(opts.activeOnly ? eq(vehicleTypes.active, true) : undefined)
    .orderBy(asc(vehicleTypes.sortOrder), asc(vehicleTypes.id));
}

export async function getVehicleType(id: number) {
  const [vt] = await db.select().from(vehicleTypes).where(eq(vehicleTypes.id, id)).limit(1);
  return vt ?? null;
}

export async function createVehicleType(input: VehicleTypeInput) {
  const [existing] = await db
    .select({ id: vehicleTypes.id })
    .from(vehicleTypes)
    .where(eq(vehicleTypes.code, input.code))
    .limit(1);
  if (existing) throw errors.conflict("A vehicle type with this code already exists", "CODE_TAKEN");
  const [vt] = await db
    .insert(vehicleTypes)
    .values({
      ...input,
      description: input.description ?? null,
      maxLengthM: input.maxLengthM ?? null,
      maxPallets: input.maxPallets ?? null,
    })
    .returning();
  logger.info("fleet.vehicle_type.created", { id: vt.id, code: vt.code });
  return vt;
}

export async function updateVehicleType(id: number, input: Partial<VehicleTypeInput>) {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(vehicleTypes).where(eq(vehicleTypes.id, id)).for("update");
    if (!current) throw errors.notFound("Vehicle type not found");
    const maxWeightKg = input.maxWeightKg ?? current.maxWeightKg;
    const maxPallets = input.maxPallets ?? current.maxPallets;

    if (input.maxWeightKg !== undefined) {
      const [oversizedVehicle] = await tx
        .select({ registration: vehicles.registration })
        .from(vehicles)
        .where(and(eq(vehicles.vehicleTypeId, id), gt(vehicles.capacityKg, maxWeightKg)))
        .limit(1);
      if (oversizedVehicle) {
        throw errors.conflict(`Lower ${oversizedVehicle.registration}'s capacity before reducing this class limit`, "VEHICLE_CAPACITY_CONFLICT");
      }
      const [overweightJob] = await tx
        .select({ reference: bookings.reference })
        .from(bookings)
        .where(and(eq(bookings.vehicleTypeId, id), inArray(bookings.status, ASSIGNED_STATUSES), gt(bookings.weightKg, maxWeightKg)))
        .limit(1);
      if (overweightJob) {
        throw errors.conflict(`Cannot reduce class capacity below the load for ${overweightJob.reference}`, "ACTIVE_LOAD_EXCEEDS_CAPACITY");
      }
    }
    if (maxPallets != null && input.maxPallets !== undefined) {
      const [overloadedJob] = await tx
        .select({ reference: bookings.reference })
        .from(bookings)
        .where(and(eq(bookings.vehicleTypeId, id), inArray(bookings.status, ASSIGNED_STATUSES), gt(bookings.pallets, maxPallets)))
        .limit(1);
      if (overloadedJob) {
        throw errors.conflict(`Cannot reduce pallet capacity below the load for ${overloadedJob.reference}`, "ACTIVE_LOAD_EXCEEDS_CAPACITY");
      }
    }

    const [updated] = await tx
      .update(vehicleTypes)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(vehicleTypes.id, id))
      .returning();
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

export type VehicleRow = {
  vehicle: typeof vehicles.$inferSelect;
  typeName: string;
  typeCode: string;
  typeMaxWeightKg: number;
  driverName: string | null;
};

export async function listVehicles(): Promise<VehicleRow[]> {
  return db
    .select({
      vehicle: vehicles,
      typeName: vehicleTypes.name,
      typeCode: vehicleTypes.code,
      typeMaxWeightKg: vehicleTypes.maxWeightKg,
      driverName: users.name,
    })
    .from(vehicles)
    .innerJoin(vehicleTypes, eq(vehicleTypes.id, vehicles.vehicleTypeId))
    .leftJoin(users, eq(users.id, vehicles.driverId))
    .orderBy(desc(vehicles.createdAt));
}

export async function getVehicle(id: number) {
  const [v] = await db.select().from(vehicles).where(eq(vehicles.id, id)).limit(1);
  return v ?? null;
}

async function assertDriverForVehicle(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  driverId: number,
  vehicleId?: number,
) {
  const [driver] = await tx
    .select({ id: users.id, status: users.status })
    .from(users)
    .where(and(eq(users.id, driverId), eq(users.role, "driver")))
    .for("update");
  if (!driver || driver.status !== "active") {
    throw errors.validation({ driverId: "Select an active driver" });
  }
  const [otherVehicle] = await tx
    .select({ id: vehicles.id, registration: vehicles.registration })
    .from(vehicles)
    .where(
      and(
        eq(vehicles.driverId, driverId),
        vehicleId ? ne(vehicles.id, vehicleId) : undefined,
      ),
    )
    .limit(1);
  if (otherVehicle) {
    throw errors.conflict(
      `This driver is already linked to ${otherVehicle.registration}. Unlink that vehicle first.`,
      "DRIVER_VEHICLE_TAKEN",
    );
  }
}

export async function createVehicle(input: VehicleInput) {
  return db.transaction(async (tx) => {
    const [vehicleType] = await tx
      .select()
      .from(vehicleTypes)
      .where(eq(vehicleTypes.id, input.vehicleTypeId))
      .for("share");
    if (!vehicleType) throw errors.validation({ vehicleTypeId: "Select a valid vehicle type" });
    if (input.capacityKg != null && input.capacityKg > vehicleType.maxWeightKg) {
      throw errors.validation({ capacityKg: `Capacity cannot exceed the ${vehicleType.name} class limit of ${vehicleType.maxWeightKg.toLocaleString()} kg` });
    }
    const [existing] = await tx
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.registration, input.registration))
      .limit(1);
    if (existing) throw errors.conflict("A vehicle with this registration already exists", "REGO_TAKEN");
    if (input.driverId != null) await assertDriverForVehicle(tx, input.driverId);

    const now = new Date();
    const [vehicle] = await tx
      .insert(vehicles)
      .values({
        vehicleTypeId: input.vehicleTypeId,
        registration: input.registration,
        make: input.make ?? null,
        model: input.model ?? null,
        year: input.year ?? null,
        capacityKg: input.capacityKg ?? null,
        status: input.status,
        currentLocation: input.currentLocation ?? null,
        locationUpdatedAt: input.currentLocation ? now : null,
        driverId: input.driverId ?? null,
        notes: input.notes ?? null,
      })
      .returning();
    logger.info("fleet.vehicle.created", { id: vehicle.id, registration: vehicle.registration });
    return vehicle;
  });
}

export async function updateVehicle(id: number, input: Partial<VehicleInput>) {
  return db.transaction(async (tx) => {
    const [snapshot] = await tx.select().from(vehicles).where(eq(vehicles.id, id)).limit(1);
    if (!snapshot) throw errors.notFound("Vehicle not found");
    // Use the same driver → vehicle lock order as dispatch to avoid deadlocks.
    const driverIds = [...new Set([snapshot.driverId, input.driverId].filter((driverId): driverId is number => driverId != null))].sort((a, b) => a - b);
    if (driverIds.length) {
      await tx.select({ id: users.id }).from(users).where(inArray(users.id, driverIds)).orderBy(asc(users.id)).for("update");
    }
    const [current] = await tx.select().from(vehicles).where(eq(vehicles.id, id)).for("update");
    if (!current) throw errors.notFound("Vehicle not found");
    if (current.driverId !== snapshot.driverId) {
      throw errors.conflict("This vehicle changed while you were editing it. Refresh and try again.", "VEHICLE_CHANGED");
    }
    if (input.registration && input.registration !== current.registration) {
      const [duplicate] = await tx
        .select({ id: vehicles.id })
        .from(vehicles)
        .where(eq(vehicles.registration, input.registration))
        .limit(1);
      if (duplicate) throw errors.conflict("A vehicle with this registration already exists", "REGO_TAKEN");
    }

    const typeId = input.vehicleTypeId ?? current.vehicleTypeId;
    const [vehicleType] = await tx.select().from(vehicleTypes).where(eq(vehicleTypes.id, typeId)).for("share");
    if (!vehicleType) throw errors.validation({ vehicleTypeId: "Select a valid vehicle type" });
    const capacityKg = input.capacityKg === undefined ? current.capacityKg : input.capacityKg;
    if (capacityKg != null && capacityKg > vehicleType.maxWeightKg) {
      throw errors.validation({ capacityKg: `Capacity cannot exceed the ${vehicleType.name} class limit of ${vehicleType.maxWeightKg.toLocaleString()} kg` });
    }

    if (input.driverId != null && input.driverId !== current.driverId) {
      await assertDriverForVehicle(tx, input.driverId, id);
    }
    if (input.driverId !== undefined && input.driverId !== current.driverId && current.status === "in_use") {
      throw errors.conflict("Reassign or complete this vehicle's active job before changing its driver", "VEHICLE_IN_USE");
    }

    const [activeBooking] = await tx
      .select({ id: bookings.id, weightKg: bookings.weightKg })
      .from(bookings)
      .where(and(eq(bookings.vehicleId, id), inArray(bookings.status, ASSIGNED_STATUSES)))
      .limit(1);
    if (activeBooking && input.status && input.status !== current.status) {
      throw errors.conflict("This vehicle has an active job. Reassign or complete it before changing availability.", "VEHICLE_IN_USE");
    }
    if (activeBooking && input.vehicleTypeId && input.vehicleTypeId !== current.vehicleTypeId) {
      throw errors.conflict("A vehicle's class cannot change while it is assigned to an active job", "VEHICLE_IN_USE");
    }
    const effectiveCapacityKg = Math.min(capacityKg ?? vehicleType.maxWeightKg, vehicleType.maxWeightKg);
    if (activeBooking && activeBooking.weightKg != null && activeBooking.weightKg > effectiveCapacityKg) {
      throw errors.conflict("Capacity cannot be reduced below the load weight of this vehicle's active job", "VEHICLE_IN_USE");
    }

    const now = new Date();
    const patch = {
      ...input,
      ...(input.currentLocation !== undefined ? { locationUpdatedAt: input.currentLocation ? now : null } : {}),
      updatedAt: now,
    };
    const [vehicle] = await tx.update(vehicles).set(patch).where(eq(vehicles.id, id)).returning();
    logger.info("fleet.vehicle.updated", { id, fields: Object.keys(input) });
    return vehicle;
  });
}

export async function deleteVehicle(id: number) {
  await db.transaction(async (tx) => {
    const [vehicle] = await tx.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, id)).for("update");
    if (!vehicle) throw errors.notFound("Vehicle not found");
    const [activeBooking] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.vehicleId, id), inArray(bookings.status, ASSIGNED_STATUSES)))
      .limit(1);
    if (activeBooking) {
      throw errors.conflict(
        "This vehicle is allocated to an active job. Reassign it or mark it inactive instead.",
        "VEHICLE_IN_USE",
      );
    }
    await tx.delete(vehicles).where(eq(vehicles.id, id));
  });
  logger.info("fleet.vehicle.deleted", { id });
}

/** Available trucks, plus currently allocated trucks for jobs whose assignment needs repair/editing. */
export async function listAssignableVehicles(options: { includeVehicleId?: number; includeVehicleIds?: number[] } = {}) {
  const includeIds = [...new Set([options.includeVehicleId, ...(options.includeVehicleIds ?? [])].filter((id): id is number => id != null))];
  const allocatedCurrentVehicles = includeIds.length
    ? and(inArray(vehicles.id, includeIds), eq(vehicles.status, "in_use"))
    : undefined;
  const availability = allocatedCurrentVehicles
    ? or(eq(vehicles.status, "available"), allocatedCurrentVehicles)
    : eq(vehicles.status, "available");
  return db
    .select({
      id: vehicles.id,
      registration: vehicles.registration,
      status: vehicles.status,
      driverId: vehicles.driverId,
      vehicleTypeId: vehicles.vehicleTypeId,
      capacityKg: vehicles.capacityKg,
      typeName: vehicleTypes.name,
      typeMaxWeightKg: vehicleTypes.maxWeightKg,
      typeMaxPallets: vehicleTypes.maxPallets,
    })
    .from(vehicles)
    .innerJoin(vehicleTypes, eq(vehicleTypes.id, vehicles.vehicleTypeId))
    .where(availability)
    .orderBy(asc(vehicleTypes.sortOrder), asc(vehicles.registration));
}
