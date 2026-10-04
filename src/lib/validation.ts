import { z } from "zod";
import { BOOKING_STATUSES } from "@/lib/booking-rules";

/** Optional free-text field: blank strings become undefined. */
const optionalText = (max = 500) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(max).optional(),
  );

const nullableText = (max = 500) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(max).nullable().optional(),
  );

const optionalDate = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z.iso.date().nullable().optional(),
);

const optionalInt = (min = 0, max = 1_000_000) =>
  z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.coerce.number().int().min(min).max(max).optional(),
  );

const nullableInt = (min = 0, max = 1_000_000) =>
  z.preprocess(
    (v) => (v === "" ? null : v),
    z.coerce.number().int().min(min).max(max).nullable().optional(),
  );

const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password is too long");

const email = z.email("Enter a valid email address").max(254).transform((v) => v.toLowerCase());
const phone = optionalText(30);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(120),
  email,
  phone,
  companyName: optionalText(120),
  password,
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password"),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token: z.string().min(10, "Invalid reset token"),
  password,
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone,
  companyName: optionalText(120),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password"),
  newPassword: password,
});

// ---------------------------------------------------------------------------
// Routes, quotes & bookings
// ---------------------------------------------------------------------------

const routeStopSchema = z.object({
  address: z.string().trim().min(5, "Enter a full stop address").max(300),
});
const additionalStopsSchema = z.array(routeStopSchema).max(4, "A route can include up to 4 additional stops").default([]);

export const addressAutocompleteQuerySchema = z.object({
  q: z.string().trim().min(3).max(160),
});

export const routeEstimateSchema = z.object({
  pickupAddress: z.string().trim().min(5, "Enter a full pickup address").max(300),
  dropoffAddress: z.string().trim().min(5, "Enter a full delivery address").max(300),
  additionalStops: additionalStopsSchema,
});

export const quoteSchema = routeEstimateSchema.extend({
  vehicleTypeId: z.coerce.number().int().positive("Choose a vehicle type"),
  requiresTailgate: z.boolean().default(false),
  requiresHandUnload: z.boolean().default(false),
  isAsap: z.boolean().default(false),
});

export const createBookingSchema = z
  .object({
    vehicleTypeId: z.coerce.number().int().positive("Choose a vehicle type"),
    pickupAddress: z.string().trim().min(5, "Enter a full pickup address").max(300),
    pickupSuburb: optionalText(100),
    pickupState: optionalText(10),
    pickupPostcode: optionalText(10),
    pickupContactName: optionalText(100),
    pickupContactPhone: phone,
    pickupInstructions: optionalText(500),
    pickupLat: z.number().nullable().optional(),
    pickupLng: z.number().nullable().optional(),
    dropoffAddress: z.string().trim().min(5, "Enter a full delivery address").max(300),
    dropoffSuburb: optionalText(100),
    dropoffState: optionalText(10),
    dropoffPostcode: optionalText(10),
    dropoffContactName: optionalText(100),
    dropoffContactPhone: phone,
    dropoffInstructions: optionalText(500),
    dropoffLat: z.number().nullable().optional(),
    dropoffLng: z.number().nullable().optional(),
    additionalStops: additionalStopsSchema,
    isAsap: z.boolean().default(false),
    scheduledAt: z.preprocess(
      (v) => (v === "" || v === null ? undefined : v),
      z.coerce.date().optional(),
    ),
    loadDescription: z.string().trim().min(3, "Describe what is being moved").max(1000),
    weightKg: optionalInt(0, 60_000),
    pallets: z.preprocess((v) => (v === "" || v == null ? 0 : v), z.coerce.number().int().min(0).max(60)),
    itemCount: optionalInt(0, 100_000),
    requiresTailgate: z.boolean().default(false),
    requiresHandUnload: z.boolean().default(false),
    // Accepted for compatibility with older clients; the service always recalculates route distance server-side.
    distanceKm: z.preprocess(
      (v) => (v === "" || v === null ? undefined : v),
      z.coerce.number().min(0.1).max(5000).optional(),
    ),
    paymentMethod: z.enum(["card", "account"]).default("card"),
    customerNotes: optionalText(1000),
  })
  .superRefine((data, ctx) => {
    if (!data.isAsap && !data.scheduledAt) {
      ctx.addIssue({ code: "custom", path: ["scheduledAt"], message: "Choose a pickup date and time" });
    }
    if (!data.isAsap && data.scheduledAt && data.scheduledAt.getTime() < Date.now() - 10 * 60_000) {
      ctx.addIssue({ code: "custom", path: ["scheduledAt"], message: "Pickup time must be in the future" });
    }
  });


export const bookingListQuerySchema = z.object({
  status: z.enum(BOOKING_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  customerId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const bookingActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel"), reason: optionalText(500) }),
  z.object({
    action: z.literal("transition"),
    status: z.enum(BOOKING_STATUSES),
    note: optionalText(500),
  }),
  z.object({
    action: z.literal("assign"),
    driverId: z.coerce.number().int().positive(),
    vehicleId: z.preprocess(
      (v) => (v === "" || v === null ? undefined : v),
      z.coerce.number().int().positive().optional(),
    ),
    note: optionalText(500),
  }),
  z.object({ action: z.literal("unassign"), note: optionalText(500) }),
  z.object({
    action: z.literal("update"),
    finalPriceCents: z.preprocess(
      (v) => (v === "" ? null : v),
      z.coerce.number().int().min(0).nullable().optional(),
    ),
    adminNotes: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z.string().trim().max(2000).nullable().optional(),
    ),
  }),
]);
export type BookingAction = z.infer<typeof bookingActionSchema>;

// ---------------------------------------------------------------------------
// Admin: customers / fleet
// ---------------------------------------------------------------------------

export const customerListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export const updateUserStatusSchema = z.object({
  status: z.enum(["active", "suspended"]),
});

export const vehicleTypeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(30)
    .regex(/^[a-z0-9_]+$/, "Lowercase letters, numbers and underscores only"),
  name: z.string().trim().min(2).max(80),
  description: optionalText(300),
  maxWeightKg: z.coerce.number().int().min(1).max(100_000),
  maxLengthM: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().min(0).max(50).optional()),
  maxPallets: optionalInt(0, 60),
  baseFareCents: z.coerce.number().int().min(0),
  perKmRateCents: z.coerce.number().int().min(0),
  minimumChargeCents: z.coerce.number().int().min(0).default(0),
  active: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
});
export const vehicleTypeUpdateSchema = vehicleTypeSchema.partial();

export const pricingRulesSchema = z.object({
  additionalStopFeeCents: z.coerce.number().int().min(0).max(10_000_000),
  tailgateFeeCents: z.coerce.number().int().min(0).max(10_000_000),
  handUnloadFeeCents: z.coerce.number().int().min(0).max(10_000_000),
  asapSurchargeBasisPoints: z.coerce.number().int().min(0).max(10_000),
  gstRateBasisPoints: z.coerce.number().int().min(0).max(10_000),
});

export const vehicleSchema = z.object({
  vehicleTypeId: z.coerce.number().int().positive(),
  registration: z.string().trim().min(2).max(12).transform((v) => v.toUpperCase()),
  make: nullableText(60),
  model: nullableText(60),
  year: nullableInt(1980, 2100),
  capacityKg: nullableInt(1, 100_000),
  status: z.enum(["available", "maintenance", "inactive"]).default("available"),
  currentLocation: nullableText(200),
  driverId: z.preprocess(
    (v) => (v === "" || v === null ? null : v),
    z.coerce.number().int().positive().nullable().optional(),
  ),
  notes: nullableText(500),
});
export const vehicleUpdateSchema = vehicleSchema.partial();

export const createDriverSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email,
  phone,
  password,
  availability: z.enum(["available", "off_duty"]).default("available"),
  licenseNumber: optionalText(50),
  licenseClass: optionalText(30),
  licenseExpiryDate: optionalDate,
  notes: optionalText(500),
});

export const driverProfileUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: email.optional(),
  phone: nullableText(30),
  status: z.enum(["active", "suspended"]).optional(),
  availability: z.enum(["available", "off_duty"]).optional(),
  licenseNumber: nullableText(50),
  licenseClass: nullableText(30),
  licenseExpiryDate: optionalDate,
  notes: nullableText(500),
});

export const driverAvailabilitySchema = z.object({
  availability: z.enum(["available", "off_duty"]),
});
