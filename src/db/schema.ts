import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRoleEnum = pgEnum("user_role", [
  "customer",
  "admin",
  "dispatcher",
  "driver",
]);

export const userStatusEnum = pgEnum("user_status", ["active", "suspended"]);

export const vehicleStatusEnum = pgEnum("vehicle_status", [
  "available",
  "in_use",
  "maintenance",
  "inactive",
]);

export const bookingStatusEnum = pgEnum("booking_status", [
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
]);

export const paymentMethodEnum = pgEnum("payment_method", ["card", "account"]);

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    companyName: text("company_name"),
    role: userRoleEnum("role").notNull().default("customer"),
    status: userStatusEnum("status").notNull().default("active"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("users_role_idx").on(t.role)],
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("password_reset_tokens_user_idx").on(t.userId)],
);

// ---------------------------------------------------------------------------
// Fleet
// ---------------------------------------------------------------------------

export const vehicleTypes = pgTable("vehicle_types", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  maxWeightKg: integer("max_weight_kg").notNull(),
  maxLengthM: doublePrecision("max_length_m"),
  maxPallets: integer("max_pallets"),
  baseFareCents: integer("base_fare_cents").notNull(),
  perKmRateCents: integer("per_km_rate_cents").notNull(),
  minimumChargeCents: integer("minimum_charge_cents").notNull().default(0),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Singleton, administrator-managed rates used by every new quote. Percentages use basis points. */
export const pricingRules = pgTable("pricing_rules", {
  id: integer("id").primaryKey().default(1),
  additionalStopFeeCents: integer("additional_stop_fee_cents").notNull().default(1500),
  tailgateFeeCents: integer("tailgate_fee_cents").notNull().default(2500),
  handUnloadFeeCents: integer("hand_unload_fee_cents").notNull().default(4500),
  asapSurchargeBasisPoints: integer("asap_surcharge_basis_points").notNull().default(1500),
  gstRateBasisPoints: integer("gst_rate_basis_points").notNull().default(1000),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const vehicles = pgTable(
  "vehicles",
  {
    id: serial("id").primaryKey(),
    vehicleTypeId: integer("vehicle_type_id")
      .notNull()
      .references(() => vehicleTypes.id),
    registration: text("registration").notNull().unique(),
    make: text("make"),
    model: text("model"),
    year: integer("year"),
    capacityKg: integer("capacity_kg"),
    status: vehicleStatusEnum("status").notNull().default("available"),
    driverId: integer("driver_id").references(() => users.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("vehicles_type_idx").on(t.vehicleTypeId),
    index("vehicles_driver_idx").on(t.driverId),
  ],
);

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

export type BookingStop = { address: string; lat: number; lng: number };

export const bookings = pgTable(
  "bookings",
  {
    id: serial("id").primaryKey(),
    reference: text("reference").notNull().unique(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => users.id),
    vehicleTypeId: integer("vehicle_type_id")
      .notNull()
      .references(() => vehicleTypes.id),
    vehicleId: integer("vehicle_id").references(() => vehicles.id, {
      onDelete: "set null",
    }),
    driverId: integer("driver_id").references(() => users.id, {
      onDelete: "set null",
    }),
    status: bookingStatusEnum("status").notNull().default("pending"),

    // Pickup
    pickupAddress: text("pickup_address").notNull(),
    pickupSuburb: text("pickup_suburb"),
    pickupState: text("pickup_state"),
    pickupPostcode: text("pickup_postcode"),
    pickupContactName: text("pickup_contact_name"),
    pickupContactPhone: text("pickup_contact_phone"),
    pickupInstructions: text("pickup_instructions"),
    pickupLat: doublePrecision("pickup_lat"),
    pickupLng: doublePrecision("pickup_lng"),

    // Drop-off
    dropoffAddress: text("dropoff_address").notNull(),
    dropoffSuburb: text("dropoff_suburb"),
    dropoffState: text("dropoff_state"),
    dropoffPostcode: text("dropoff_postcode"),
    dropoffContactName: text("dropoff_contact_name"),
    dropoffContactPhone: text("dropoff_contact_phone"),
    dropoffInstructions: text("dropoff_instructions"),
    dropoffLat: doublePrecision("dropoff_lat"),
    dropoffLng: doublePrecision("dropoff_lng"),
    additionalStops: jsonb("additional_stops")
      .$type<BookingStop[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),

    // Schedule
    isAsap: boolean("is_asap").notNull().default(false),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),

    // Load
    loadDescription: text("load_description").notNull(),
    weightKg: integer("weight_kg"),
    pallets: integer("pallets").notNull().default(0),
    itemCount: integer("item_count"),
    requiresTailgate: boolean("requires_tailgate").notNull().default(false),
    requiresHandUnload: boolean("requires_hand_unload")
      .notNull()
      .default(false),

    // Money
    distanceKm: doublePrecision("distance_km"),
    estimatedDurationMinutes: integer("estimated_duration_minutes"),
    quotedPriceCents: integer("quoted_price_cents").notNull(),
    finalPriceCents: integer("final_price_cents"),
    currency: text("currency").notNull().default("AUD"),
    paymentMethod: paymentMethodEnum("payment_method")
      .notNull()
      .default("card"),

    // Notes
    customerNotes: text("customer_notes"),
    adminNotes: text("admin_notes"),
    cancellationReason: text("cancellation_reason"),

    // Milestones
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    pickedUpAt: timestamp("picked_up_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("bookings_customer_idx").on(t.customerId),
    index("bookings_driver_idx").on(t.driverId),
    index("bookings_status_idx").on(t.status),
    index("bookings_scheduled_idx").on(t.scheduledAt),
  ],
);

export const bookingEvents = pgTable(
  "booking_events",
  {
    id: serial("id").primaryKey(),
    bookingId: integer("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    fromStatus: bookingStatusEnum("from_status"),
    toStatus: bookingStatusEnum("to_status"),
    actorId: integer("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorRole: text("actor_role"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("booking_events_booking_idx").on(t.bookingId)],
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type VehicleType = typeof vehicleTypes.$inferSelect;
export type Vehicle = typeof vehicles.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
export type BookingEvent = typeof bookingEvents.$inferSelect;

export type UserRole = (typeof userRoleEnum.enumValues)[number];
export type UserStatus = (typeof userStatusEnum.enumValues)[number];
export type VehicleStatus = (typeof vehicleStatusEnum.enumValues)[number];
export type BookingStatus = (typeof bookingStatusEnum.enumValues)[number];
export type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number];
