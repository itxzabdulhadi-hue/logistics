import { and, count, desc, eq, gt, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bookings,
  passwordResetTokens,
  users,
  vehicles,
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
import { ACTIVE_STATUSES } from "@/lib/booking-rules";
import { logger } from "@/lib/logger";

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

export type DriverRow = SafeUser & {
  vehicleId: number | null;
  vehicleRegistration: string | null;
  activeJobs: number;
};

export async function listDrivers(): Promise<DriverRow[]> {
  const activeJobs = db
    .select({
      driverId: bookings.driverId,
      activeJobs: sql<number>`count(*)::int`.as("active_jobs"),
    })
    .from(bookings)
    .where(inArray(bookings.status, ACTIVE_STATUSES))
    .groupBy(bookings.driverId)
    .as("active_jobs");

  const rows = await db
    .select({
      user: users,
      vehicleId: vehicles.id,
      vehicleRegistration: vehicles.registration,
      activeJobs: sql<number>`coalesce(${activeJobs.activeJobs}, 0)::int`,
    })
    .from(users)
    .leftJoin(vehicles, eq(vehicles.driverId, users.id))
    .leftJoin(activeJobs, eq(activeJobs.driverId, users.id))
    .where(eq(users.role, "driver"))
    .orderBy(users.name);

  // A driver may be linked to multiple vehicles; keep the first per driver.
  const seen = new Map<number, DriverRow>();
  for (const r of rows) {
    if (!seen.has(r.user.id)) {
      seen.set(r.user.id, {
        ...toSafeUser(r.user),
        vehicleId: r.vehicleId,
        vehicleRegistration: r.vehicleRegistration,
        activeJobs: r.activeJobs,
      });
    }
  }
  return [...seen.values()];
}

export async function createDriver(input: { name: string; email: string; phone?: string; password: string }) {
  return createUser({ ...input, role: "driver" });
}
