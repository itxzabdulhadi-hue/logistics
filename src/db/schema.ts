import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  pgSequence,
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

export const driverAvailabilityEnum = pgEnum("driver_availability", ["available", "off_duty"]);

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
export const paymentProviderEnum = pgEnum("payment_provider", ["stripe", "manual"]);
export const paymentStatusEnum = pgEnum("payment_status", ["pending", "succeeded", "failed", "partially_refunded", "refunded"]);
export const refundStatusEnum = pgEnum("refund_status", ["pending", "succeeded", "failed", "cancelled"]);
export const invoicePaymentStatusEnum = pgEnum("invoice_payment_status", [
  "outstanding",
  "pending",
  "partially_paid",
  "paid",
  "failed",
  "partially_refunded",
  "refunded",
]);

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

/** Driver-specific operating profile; account status remains on users. */
export const driverProfiles = pgTable(
  "driver_profiles",
  {
    driverId: integer("driver_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    availability: driverAvailabilityEnum("availability").notNull().default("available"),
    licenseNumber: text("license_number"),
    licenseClass: text("license_class"),
    licenseExpiryDate: date("license_expiry_date", { mode: "string" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("driver_profiles_availability_idx").on(t.availability)],
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
    currentLocation: text("current_location"),
    locationUpdatedAt: timestamp("location_updated_at", { withTimezone: true }),
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

export type RoutePoint = { lat: number; lng: number };
export type BookingStopStatus = "pending" | "arrived" | "completed";
export type BookingStop = RoutePoint & {
  address: string;
  status?: BookingStopStatus;
  arrivedAt?: string | null;
  completedAt?: string | null;
};
export type BookingQuoteSnapshot = {
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
export type InvoiceCharge = { description: string; amountCents: number };
export type InvoiceStopSnapshot = { address: string; lat: number | null; lng: number | null };

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
    routeGeometry: jsonb("route_geometry")
      .$type<RoutePoint[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    routeOptimized: boolean("route_optimized").notNull().default(false),

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
    quoteBreakdown: jsonb("quote_breakdown").$type<BookingQuoteSnapshot>(),
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

/** A finalized, immutable billing snapshot issued when a booking is completed. */
export const invoiceNumberSequence = pgSequence("loadline_invoice_number_seq");

export const invoices = pgTable(
  "invoices",
  {
    id: serial("id").primaryKey(),
    invoiceNumber: text("invoice_number").notNull().unique(),
    bookingId: integer("booking_id")
      .notNull()
      .unique()
      .references(() => bookings.id, { onDelete: "restrict" }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    bookingReference: text("booking_reference").notNull(),
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    customerCompany: text("customer_company"),
    vehicleDescription: text("vehicle_description").notNull(),
    loadDescription: text("load_description").notNull(),
    pickupAddress: text("pickup_address").notNull(),
    dropoffAddress: text("dropoff_address").notNull(),
    additionalStops: jsonb("additional_stops")
      .$type<InvoiceStopSnapshot[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    charges: jsonb("charges")
      .$type<InvoiceCharge[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    subtotalCents: integer("subtotal_cents").notNull(),
    taxLabel: text("tax_label").notNull().default("GST"),
    taxRateBasisPoints: integer("tax_rate_basis_points").notNull(),
    taxCents: integer("tax_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    currency: text("currency").notNull().default("AUD"),
    paymentMethod: paymentMethodEnum("payment_method").notNull(),
    paymentStatus: invoicePaymentStatusEnum("payment_status").notNull().default("outstanding"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("invoices_amounts_nonnegative", sql`${t.subtotalCents} >= 0 and ${t.taxCents} >= 0 and ${t.totalCents} >= 0`),
    check("invoices_total_matches_components", sql`${t.totalCents} = ${t.subtotalCents} + ${t.taxCents}`),
    index("invoices_customer_idx").on(t.customerId),
    index("invoices_payment_status_idx").on(t.paymentStatus),
    index("invoices_issued_idx").on(t.issuedAt),
  ],
);

/** Each hosted-checkout attempt or manually reconciled account payment is append-only. */
export const payments = pgTable(
  "payments",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    bookingId: integer("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "restrict" }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    provider: paymentProviderEnum("provider").notNull(),
    status: paymentStatusEnum("status").notNull().default("pending"),
    amountCents: integer("amount_cents").notNull(),
    refundedCents: integer("refunded_cents").notNull().default(0),
    currency: text("currency").notNull().default("AUD"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
    stripePaymentIntentId: text("stripe_payment_intent_id").unique(),
    externalReference: text("external_reference"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    recordedBy: integer("recorded_by").references(() => users.id, { onDelete: "set null" }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("payments_amounts_valid", sql`${t.amountCents} > 0 and ${t.refundedCents} >= 0 and ${t.refundedCents} <= ${t.amountCents}`),
    index("payments_invoice_idx").on(t.invoiceId),
    index("payments_booking_idx").on(t.bookingId),
    index("payments_customer_idx").on(t.customerId),
    index("payments_status_idx").on(t.status),
    index("payments_created_idx").on(t.createdAt),
  ],
);

export const refunds = pgTable(
  "refunds",
  {
    id: serial("id").primaryKey(),
    paymentId: integer("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    stripeRefundId: text("stripe_refund_id").unique(),
    amountCents: integer("amount_cents").notNull(),
    status: refundStatusEnum("status").notNull().default("pending"),
    reason: text("reason"),
    failureMessage: text("failure_message"),
    recordedBy: integer("recorded_by").references(() => users.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("refunds_amount_positive", sql`${t.amountCents} > 0`),
    index("refunds_payment_idx").on(t.paymentId),
    index("refunds_status_idx").on(t.status),
  ],
);

/** Stripe retries delivery; this ledger makes every event idempotent. */
export const stripeWebhookEvents = pgTable("stripe_webhook_events", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Latest consented driver GPS fix for an active booking; one row per booking. */
export const bookingLiveLocations = pgTable(
  "booking_live_locations",
  {
    bookingId: integer("booking_id")
      .primaryKey()
      .references(() => bookings.id, { onDelete: "cascade" }),
    driverId: integer("driver_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    vehicleId: integer("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    accuracyMeters: doublePrecision("accuracy_meters"),
    headingDegrees: doublePrecision("heading_degrees"),
    speedMetersPerSecond: doublePrecision("speed_meters_per_second"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("booking_live_locations_latitude_range", sql`${t.latitude} between -90 and 90`),
    check("booking_live_locations_longitude_range", sql`${t.longitude} between -180 and 180`),
    index("booking_live_locations_vehicle_idx").on(t.vehicleId),
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
export type DriverProfile = typeof driverProfiles.$inferSelect;
export type DriverAvailability = (typeof driverAvailabilityEnum.enumValues)[number];
export type Vehicle = typeof vehicles.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
export type BookingEvent = typeof bookingEvents.$inferSelect;
export type BookingLiveLocation = typeof bookingLiveLocations.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
export type Refund = typeof refunds.$inferSelect;
export type NewRefund = typeof refunds.$inferInsert;

export type UserRole = (typeof userRoleEnum.enumValues)[number];
export type UserStatus = (typeof userStatusEnum.enumValues)[number];
export type VehicleStatus = (typeof vehicleStatusEnum.enumValues)[number];
export type BookingStatus = (typeof bookingStatusEnum.enumValues)[number];
export type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number];
export type PaymentProvider = (typeof paymentProviderEnum.enumValues)[number];
export type PaymentStatus = (typeof paymentStatusEnum.enumValues)[number];
export type RefundStatus = (typeof refundStatusEnum.enumValues)[number];
export type InvoicePaymentStatus = (typeof invoicePaymentStatusEnum.enumValues)[number];
