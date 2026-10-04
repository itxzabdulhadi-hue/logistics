import { and, count, desc, eq, gt, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bookings,
  driverProfiles,
  passwordResetTokens,
  users,
  vehicles,
  type DriverAvailability,
  type User,
  type UserRole,
  type UserStatus,
} from "@/db/schema";
import { ApiError, errors } from "@/lib/api";
import {
  hashPassword,
  randomToken,
  sha256,
  toSafeUser,
  verifyPassword,
  type SafeUser,
} from "@/lib/auth";
import { ACTIVE_STATUSES, ASSIGNED_STATUSES } from "@/lib/booking-rules";
import { logger } from "@/lib/logger";
import type { z } from "zod";
import type { createDriverSchema, driverProfileUpdateSchema } from "@/lib/validation";

const RESET_TTL_MS = 60 * 60 * 1000;

export async function findUserByEmail(email: string): Promise<User | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  return user ?? null;
}

export async function getUserById(id: number): Promise<SafeUser | null> {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user ? toSafeUser(user) : null;
}

export async function createUser(input: {
  email: string;
  password: string;
  name: string;
  phone?: string | null;
  companyName?: string | null;
  role?: UserRole;
}): Promise<SafeUser> {
  const existing = await findUserByEmail(input.email);
  if (existing) throw errors.conflict("An account with this email already exists", "EMAIL_TAKEN");
  const passwordHash = await hashPassword(input.password);
  const [user] = await db
    .insert(users)
    .values({
      email: input.email.toLowerCase(),
      passwordHash,
      name: input.name,
      phone: input.phone ?? null,
      companyName: input.companyName ?? null,
      role: input.role ?? "customer",
    })
    .returning();
  logger.info("user.created", { userId: user.id, role: user.role });
  return toSafeUser(user);
}

/** Returns the user on success, null for bad credentials; throws 403 when suspended. */
export async function authenticateUser(email: string, password: string): Promise<SafeUser | null> {
  const user = await findUserByEmail(email);
  if (!user) {
    // Burn similar time to a real check so timing doesn't leak account existence.
    await hashPassword(password);
    return null;
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return null;
  if (user.status !== "active") {
    throw new ApiError(403, "ACCOUNT_SUSPENDED", "This account has been suspended. Contact support.");
  }
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  return toSafeUser(user);
}

export async function updateProfile(
  userId: number,
  data: { name: string; phone?: string; companyName?: string },
): Promise<SafeUser> {
  const [user] = await db
    .update(users)
    .set({
      name: data.name,
      phone: data.phone ?? null,
      companyName: data.companyName ?? null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning();
  if (!user) throw errors.notFound("User not found");
  return toSafeUser(user);
}

export async function changePassword(userId: number, currentPassword: string, newPassword: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw errors.notFound("User not found");
  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) throw errors.validation({ currentPassword: "Current password is incorrect" });
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() })
    .where(eq(users.id, userId));
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export async function createPasswordReset(email: string): Promise<{ token: string; user: SafeUser } | null> {
  const user = await findUserByEmail(email);
  if (!user || user.status !== "active") return null;
  const token = randomToken(32);
  await db.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
  });
  logger.info("auth.password_reset.requested", { userId: user.id });
  return { token, user: toSafeUser(user) };
}

export async function resetPasswordWithToken(token: string, newPassword: string) {
  const [row] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, sha256(token)),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) throw new ApiError(400, "INVALID_TOKEN", "This reset link is invalid or has expired.");
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() })
      .where(eq(users.id, row.userId));
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, row.id));
  });
  logger.info("auth.password_reset.completed", { userId: row.userId });
}

// ---------------------------------------------------------------------------
// Admin: customers
// ---------------------------------------------------------------------------

export type CustomerRow = SafeUser & { bookingCount: number; spendCents: number; activeJobs: number };

const spendExpr = sql<number>`coalesce(sum(coalesce(${bookings.finalPriceCents}, ${bookings.quotedPriceCents})) filter (where ${bookings.status} not in ('cancelled', 'failed')), 0)::int`;

export async function listCustomers(opts: { q?: string; page?: number; pageSize?: number }) {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const stats = db
    .select({
      customerId: bookings.customerId,
      bookingCount: count().as("booking_count"),
      activeJobs: sql<number>`count(*) filter (where ${inArray(bookings.status, ACTIVE_STATUSES)})::int`.as("active_jobs"),
      spendCents: spendExpr.as("spend_cents"),
    })
    .from(bookings)
    .groupBy(bookings.customerId)
    .as("stats");

  const where = and(
    eq(users.role, "customer"),
    opts.q
      ? or(
          ilike(users.name, `%${opts.q}%`),
          ilike(users.email, `%${opts.q}%`),
          ilike(users.companyName, `%${opts.q}%`),
        )
      : undefined,
  );

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        user: users,
        bookingCount: sql<number>`coalesce(${stats.bookingCount}, 0)::int`,
        activeJobs: sql<number>`coalesce(${stats.activeJobs}, 0)::int`,
        spendCents: sql<number>`coalesce(${stats.spendCents}, 0)::int`,
      })
      .from(users)
      .leftJoin(stats, eq(stats.customerId, users.id))
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(users).where(where),
  ]);

  const customers: CustomerRow[] = rows.map((r) => ({
    ...toSafeUser(r.user),
    bookingCount: r.bookingCount,
    activeJobs: r.activeJobs,
    spendCents: r.spendCents,
  }));
  return { customers, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getCustomerDetail(id: number) {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user || user.role !== "customer") return null;
  const [stats] = await db
    .select({
      bookingCount: count(),
      activeJobs: sql<number>`count(*) filter (where ${inArray(bookings.status, ACTIVE_STATUSES)})::int`,
      spendCents: spendExpr,
    })
    .from(bookings)
    .where(eq(bookings.customerId, id));
  return { ...toSafeUser(user), ...stats } as CustomerRow;
}

export async function setUserStatus(id: number, status: UserStatus): Promise<SafeUser> {
  const [user] = await db
    .update(users)
    .set({ status, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  if (!user) throw errors.notFound("User not found");
  logger.info("user.status_changed", { userId: id, status });
  return toSafeUser(user);
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

export type DriverCurrentJob = {
  id: number;
  reference: string;
  status: (typeof bookings.$inferSelect)["status"];
  scheduledAt: Date;
  pickupAddress: string;
  dropoffAddress: string;
};

export type DriverRow = SafeUser & {
  availability: DriverAvailability;
  licenseNumber: string | null;
  licenseClass: string | null;
  licenseExpiryDate: string | null;
  driverNotes: string | null;
  vehicleId: number | null;
  vehicleRegistration: string | null;
  activeJobs: number;
  currentJob: DriverCurrentJob | null;
  dispatchStatus: "available" | "off_duty" | "busy" | "suspended";
};

type CreateDriverInput = z.infer<typeof createDriverSchema>;
type DriverProfileUpdate = z.infer<typeof driverProfileUpdateSchema>;

async function ensureDriverProfiles() {
  const driverRows = await db.select({ driverId: users.id }).from(users).where(eq(users.role, "driver"));
  if (driverRows.length) {
    await db.insert(driverProfiles).values(driverRows.map(({ driverId }) => ({ driverId }))).onConflictDoNothing();
  }
}

export async function listDrivers(): Promise<DriverRow[]> {
  // Backfill profiles for driver accounts created before the profile table existed.
  await ensureDriverProfiles();
  const rows = await db
    .select({
      user: users,
      profile: driverProfiles,
      vehicleId: vehicles.id,
      vehicleRegistration: vehicles.registration,
      jobId: bookings.id,
      jobReference: bookings.reference,
      jobStatus: bookings.status,
      jobScheduledAt: bookings.scheduledAt,
      jobPickupAddress: bookings.pickupAddress,
      jobDropoffAddress: bookings.dropoffAddress,
    })
    .from(users)
    .leftJoin(driverProfiles, eq(driverProfiles.driverId, users.id))
    .leftJoin(vehicles, eq(vehicles.driverId, users.id))
    .leftJoin(bookings, and(eq(bookings.driverId, users.id), inArray(bookings.status, ASSIGNED_STATUSES)))
    .where(eq(users.role, "driver"))
    .orderBy(users.name, bookings.scheduledAt);

  const drivers = new Map<number, DriverRow>();
  const seenJobs = new Map<number, Set<number>>();
  for (const row of rows) {
    let driver = drivers.get(row.user.id);
    if (!driver) {
      const availability = row.profile?.availability ?? "available";
      driver = {
        ...toSafeUser(row.user),
        availability,
        licenseNumber: row.profile?.licenseNumber ?? null,
        licenseClass: row.profile?.licenseClass ?? null,
        licenseExpiryDate: row.profile?.licenseExpiryDate ?? null,
        driverNotes: row.profile?.notes ?? null,
        vehicleId: row.vehicleId,
        vehicleRegistration: row.vehicleRegistration,
        activeJobs: 0,
        currentJob: null,
        dispatchStatus: row.user.status !== "active" ? "suspended" : availability,
      };
      drivers.set(row.user.id, driver);
      seenJobs.set(row.user.id, new Set());
    }
    if (row.jobId != null && row.jobReference && row.jobStatus && row.jobScheduledAt && row.jobPickupAddress && row.jobDropoffAddress) {
      const driverJobs = seenJobs.get(row.user.id)!;
      if (!driverJobs.has(row.jobId)) {
        driverJobs.add(row.jobId);
        driver.activeJobs += 1;
        if (!driver.currentJob) {
          driver.currentJob = {
            id: row.jobId,
            reference: row.jobReference,
            status: row.jobStatus,
            scheduledAt: row.jobScheduledAt,
            pickupAddress: row.jobPickupAddress,
            dropoffAddress: row.jobDropoffAddress,
          };
        }
      }
    }
    if (driver.activeJobs > 0 && driver.dispatchStatus !== "suspended") driver.dispatchStatus = "busy";
  }
  return [...drivers.values()];
}

export async function createDriver(input: CreateDriverInput) {
  const existing = await findUserByEmail(input.email);
  if (existing) throw errors.conflict("An account with this email already exists", "EMAIL_TAKEN");
  const passwordHash = await hashPassword(input.password);
  const result = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        email: input.email.toLowerCase(),
        passwordHash,
        name: input.name,
        phone: input.phone ?? null,
        role: "driver",
      })
      .returning();
    const [profile] = await tx
      .insert(driverProfiles)
      .values({
        driverId: user.id,
        availability: input.availability,
        licenseNumber: input.licenseNumber ?? null,
        licenseClass: input.licenseClass ?? null,
        licenseExpiryDate: input.licenseExpiryDate ?? null,
        notes: input.notes ?? null,
      })
      .returning();
    return { user, profile };
  });
  logger.info("driver.created", { driverId: result.user.id });
  return {
    ...toSafeUser(result.user),
    availability: result.profile.availability,
    licenseNumber: result.profile.licenseNumber,
    licenseClass: result.profile.licenseClass,
    licenseExpiryDate: result.profile.licenseExpiryDate,
    driverNotes: result.profile.notes,
  };
}

export async function updateDriverProfile(id: number, input: DriverProfileUpdate) {
  const [existing] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), eq(users.role, "driver")))
    .limit(1);
  if (!existing) throw errors.notFound("Driver not found");
  const email = input.email?.toLowerCase();
  if (email && email !== existing.email) {
    const duplicate = await findUserByEmail(email);
    if (duplicate && duplicate.id !== id) throw errors.conflict("An account with this email already exists", "EMAIL_TAKEN");
  }

  await db.insert(driverProfiles).values({ driverId: id }).onConflictDoNothing();
  const result = await db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, id)).for("update");
    if (!user || user.role !== "driver") throw errors.notFound("Driver not found");
    const [profile] = await tx.select().from(driverProfiles).where(eq(driverProfiles.driverId, id)).for("update");
    if (!profile) throw errors.notFound("Driver profile not found");

    const [activeJob] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.driverId, id), inArray(bookings.status, ASSIGNED_STATUSES)))
      .limit(1);
    if (activeJob && input.status === "suspended") {
      throw errors.conflict("Reassign or complete this driver's active job before suspending the account", "DRIVER_BUSY");
    }
    if (activeJob && input.availability === "off_duty") {
      throw errors.conflict("Reassign or complete this driver's active job before marking them off duty", "DRIVER_BUSY");
    }

    const userPatch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) userPatch.name = input.name;
    if (email !== undefined) userPatch.email = email;
    if (input.phone !== undefined) userPatch.phone = input.phone;
    if (input.status !== undefined) userPatch.status = input.status;
    const [updatedUser] = await tx.update(users).set(userPatch).where(eq(users.id, id)).returning();

    const profilePatch: Partial<typeof driverProfiles.$inferInsert> = { updatedAt: new Date() };
    if (input.availability !== undefined) profilePatch.availability = input.availability;
    if (input.licenseNumber !== undefined) profilePatch.licenseNumber = input.licenseNumber;
    if (input.licenseClass !== undefined) profilePatch.licenseClass = input.licenseClass;
    if (input.licenseExpiryDate !== undefined) profilePatch.licenseExpiryDate = input.licenseExpiryDate;
    if (input.notes !== undefined) profilePatch.notes = input.notes;
    const [updatedProfile] = await tx
      .update(driverProfiles)
      .set(profilePatch)
      .where(eq(driverProfiles.driverId, id))
      .returning();
    return { user: updatedUser, profile: updatedProfile };
  });
  logger.info("driver.profile.updated", { driverId: id });
  return {
    ...toSafeUser(result.user),
    availability: result.profile.availability,
    licenseNumber: result.profile.licenseNumber,
    licenseClass: result.profile.licenseClass,
    licenseExpiryDate: result.profile.licenseExpiryDate,
    driverNotes: result.profile.notes,
  };
}

export async function setDriverAvailability(id: number, availability: DriverAvailability) {
  return updateDriverProfile(id, { availability });
}
