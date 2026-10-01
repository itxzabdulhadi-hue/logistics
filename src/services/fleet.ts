import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { bookings, users, vehicleTypes, vehicles, type VehicleType } from "@/db/schema";
import { errors } from "@/lib/api";
import { ACTIVE_STATUSES } from "@/lib/booking-rules";
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
  const [vt] = await db
    .update(vehicleTypes)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(vehicleTypes.id, id))
    .returning();
  if (!vt) throw errors.notFound("Vehicle type not found");
  return vt;
}

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

export type VehicleRow = {
  vehicle: typeof vehicles.$inferSelect;
  typeName: string;
  typeCode: string;
  driverName: string | null;
};

export async function listVehicles(): Promise<VehicleRow[]> {
  return db
    .select({
      vehicle: vehicles,
      typeName: vehicleTypes.name,
      typeCode: vehicleTypes.code,
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

async function assertDriver(driverId: number | null | undefined) {
  if (driverId == null) return;
  const [driver] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, driverId), eq(users.role, "driver")))
    .limit(1);
  if (!driver) throw errors.validation({ driverId: "Select a valid driver" });
}

export async function createVehicle(input: VehicleInput) {
  const [existing] = await db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(eq(vehicles.registration, input.registration))
    .limit(1);
  if (existing) throw errors.conflict("A vehicle with this registration already exists", "REGO_TAKEN");
  if (!(await getVehicleType(input.vehicleTypeId))) {
    throw errors.validation({ vehicleTypeId: "Select a valid vehicle type" });
  }
  await assertDriver(input.driverId);
  const [v] = await db
    .insert(vehicles)
    .values({
      vehicleTypeId: input.vehicleTypeId,
      registration: input.registration,
      make: input.make ?? null,
      model: input.model ?? null,
      year: input.year ?? null,
      capacityKg: input.capacityKg ?? null,
      status: input.status,
      driverId: input.driverId ?? null,
      notes: input.notes ?? null,
    })
    .returning();
  logger.info("fleet.vehicle.created", { id: v.id, registration: v.registration });
  return v;
}

export async function updateVehicle(id: number, input: Partial<VehicleInput>) {
  if (input.driverId !== undefined) await assertDriver(input.driverId);
  const [v] = await db
    .update(vehicles)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(vehicles.id, id))
    .returning();
  if (!v) throw errors.notFound("Vehicle not found");
  return v;
}

export async function deleteVehicle(id: number) {
  const [{ activeCount }] = await db
    .select({ activeCount: count() })
    .from(bookings)
    .where(and(eq(bookings.vehicleId, id), inArray(bookings.status, ACTIVE_STATUSES)));
  if (activeCount > 0) {
    throw errors.conflict(
      "This vehicle is allocated to active jobs. Reassign them or mark the vehicle inactive instead.",
      "VEHICLE_IN_USE",
    );
  }
  const deleted = await db.delete(vehicles).where(eq(vehicles.id, id)).returning({ id: vehicles.id });
  if (deleted.length === 0) throw errors.notFound("Vehicle not found");
  logger.info("fleet.vehicle.deleted", { id });
}

/** Vehicles that can be allocated to a job (not inactive / in maintenance). */
export async function listAssignableVehicles() {
  return db
    .select({
      id: vehicles.id,
      registration: vehicles.registration,
      status: vehicles.status,
      driverId: vehicles.driverId,
      typeName: vehicleTypes.name,
      vehicleTypeId: vehicles.vehicleTypeId,
    })
    .from(vehicles)
    .innerJoin(vehicleTypes, eq(vehicleTypes.id, vehicles.vehicleTypeId))
    .where(inArray(vehicles.status, ["available", "in_use"]))
    .orderBy(asc(vehicleTypes.sortOrder), asc(vehicles.registration));
}
