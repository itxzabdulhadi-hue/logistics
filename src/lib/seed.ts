import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  bookingEvents,
  bookings,
  users,
  vehicleTypes,
  vehicles,
  type BookingStatus,
  type NewBooking,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { calculateQuote, generateReference } from "@/lib/booking-rules";
import { logger } from "@/lib/logger";

let seededPromise: Promise<void> | null = null;

/**
 * Seeds demo data exactly once per process (and only if the database is
 * empty). Safe to call from any server entrypoint.
 */
export function ensureSeeded(): Promise<void> {
  if (!seededPromise) {
    seededPromise = seed().catch((error) => {
      seededPromise = null;
      logger.error("seed.failed", { error });
    });
  }
  return seededPromise;
}

const VEHICLE_TYPES = [
  { code: "ute", name: "Ute", description: "Small loads, tools, a few boxes or a pallet.", maxWeightKg: 800, maxLengthM: 2.4, maxPallets: 1, baseFareCents: 4500, perKmRateCents: 220, minimumChargeCents: 6500, sortOrder: 1 },
  { code: "van", name: "Van", description: "Enclosed cargo van for parcels, furniture and weather-sensitive goods.", maxWeightKg: 1200, maxLengthM: 3.0, maxPallets: 2, baseFareCents: 5500, perKmRateCents: 240, minimumChargeCents: 7500, sortOrder: 2 },
  { code: "1t_tray", name: "1 Tonne Tray", description: "Open tray for building materials and awkward shapes.", maxWeightKg: 1000, maxLengthM: 3.2, maxPallets: 2, baseFareCents: 6000, perKmRateCents: 250, minimumChargeCents: 8500, sortOrder: 3 },
  { code: "2t_pantech", name: "2 Tonne Pantech", description: "Enclosed box truck with optional tailgate. Office and retail moves.", maxWeightKg: 2000, maxLengthM: 4.2, maxPallets: 4, baseFareCents: 8500, perKmRateCents: 290, minimumChargeCents: 11000, sortOrder: 4 },
  { code: "4t_pantech", name: "4 Tonne Pantech", description: "Mid-size pantech for palletised freight; tailgate lifter available.", maxWeightKg: 4000, maxLengthM: 5.5, maxPallets: 6, baseFareCents: 11000, perKmRateCents: 340, minimumChargeCents: 15000, sortOrder: 5 },
  { code: "8t_pantech", name: "8 Tonne Pantech", description: "Large pantech for multi-pallet runs between warehouses.", maxWeightKg: 8000, maxLengthM: 7.2, maxPallets: 10, baseFareCents: 15500, perKmRateCents: 410, minimumChargeCents: 21000, sortOrder: 6 },
  { code: "12t_tautliner", name: "12 Tonne Tautliner", description: "Curtain-sider for forklift side loading of pallets.", maxWeightKg: 12000, maxLengthM: 8.5, maxPallets: 14, baseFareCents: 21000, perKmRateCents: 480, minimumChargeCents: 29000, sortOrder: 7 },
  { code: "semi", name: "Semi-Trailer", description: "Full semi for 20+ pallets and heavy industrial freight.", maxWeightKg: 24000, maxLengthM: 13.6, maxPallets: 22, baseFareCents: 32000, perKmRateCents: 620, minimumChargeCents: 45000, sortOrder: 8 },
];

async function seed() {
  const [{ admins }] = await db
    .select({ admins: count() })
    .from(users)
    .where(eq(users.role, "admin"));
  if (admins > 0) return;

  logger.info("seed.start");

  // --- Users ---------------------------------------------------------------
  const [admin, dispatcher, customer, customer2, driver1, driver2, driver3] = await db
    .insert(users)
    .values([
      { email: "admin@loadline.demo", passwordHash: await hashPassword("Admin123!"), name: "Alex Morgan", phone: "0400 000 001", role: "admin", companyName: "Loadline" },
      { email: "dispatch@loadline.demo", passwordHash: await hashPassword("Dispatch123!"), name: "Priya Nair", phone: "0400 000 002", role: "dispatcher", companyName: "Loadline" },
      { email: "customer@loadline.demo", passwordHash: await hashPassword("Customer123!"), name: "Jordan Lee", phone: "0412 345 678", role: "customer", companyName: "Harbour City Fitouts" },
      { email: "ops@northsideretail.demo", passwordHash: await hashPassword("Customer123!"), name: "Sam Carter", phone: "0433 222 111", role: "customer", companyName: "Northside Retail Group" },
      { email: "driver@loadline.demo", passwordHash: await hashPassword("Driver123!"), name: "Marco Rossi", phone: "0455 111 222", role: "driver" },
      { email: "driver2@loadline.demo", passwordHash: await hashPassword("Driver123!"), name: "Aisha Khan", phone: "0455 333 444", role: "driver" },
      { email: "driver3@loadline.demo", passwordHash: await hashPassword("Driver123!"), name: "Tom Nguyen", phone: "0455 555 666", role: "driver" },
    ])
    .returning();
  void admin;
  void dispatcher;

  // --- Vehicle types -------------------------------------------------------
  const types = await db.insert(vehicleTypes).values(VEHICLE_TYPES).onConflictDoNothing().returning();
  const typeByCode = Object.fromEntries(types.map((t) => [t.code, t]));

  // --- Vehicles ------------------------------------------------------------
  const fleet = await db
    .insert(vehicles)
    .values([
      { vehicleTypeId: typeByCode["2t_pantech"].id, registration: "LL2T001", make: "Isuzu", model: "NLR 45-150", year: 2022, capacityKg: 2000, status: "available", driverId: driver1.id },
      { vehicleTypeId: typeByCode["4t_pantech"].id, registration: "LL4T002", make: "Hino", model: "300 Series 616", year: 2021, capacityKg: 4000, status: "available", driverId: driver2.id },
      { vehicleTypeId: typeByCode["van"].id, registration: "LLVN003", make: "Toyota", model: "HiAce LWB", year: 2023, capacityKg: 1200, status: "available", driverId: driver3.id },
      { vehicleTypeId: typeByCode["8t_pantech"].id, registration: "LL8T004", make: "Fuso", model: "Fighter 1024", year: 2020, capacityKg: 8000, status: "available" },
      { vehicleTypeId: typeByCode["ute"].id, registration: "LLUT005", make: "Ford", model: "Ranger XL", year: 2022, capacityKg: 800, status: "maintenance", notes: "Brake service due" },
    ])
    .returning();
  const vehicleByRego = Object.fromEntries(fleet.map((v) => [v.registration, v]));

  // --- Bookings ------------------------------------------------------------
  const hours = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000);
  const days = (d: number) => hours(d * 24);

  type SeedJob = {
    customerId: number;
    typeCode: string;
    status: BookingStatus;
    scheduledAt: Date;
    isAsap?: boolean;
    pickup: Partial<NewBooking> & { pickupAddress: string };
    dropoff: Partial<NewBooking> & { dropoffAddress: string };
    load: string;
    weightKg?: number;
    pallets?: number;
    distanceKm: number;
    tailgate?: boolean;
    handUnload?: boolean;
    driverId?: number;
    vehicleRego?: string;
    adminNotes?: string;
    paymentMethod?: "card" | "account";
    createdHoursAgo: number;
  };

  const jobs: SeedJob[] = [
    {
      customerId: customer.id, typeCode: "2t_pantech", status: "pending", scheduledAt: hours(5),
      pickup: { pickupAddress: "12 Bourke Road, Alexandria NSW 2015", pickupSuburb: "Alexandria", pickupState: "NSW", pickupPostcode: "2015", pickupContactName: "Jordan Lee", pickupContactPhone: "0412 345 678", pickupInstructions: "Loading dock at rear, buzz unit 3." },
      dropoff: { dropoffAddress: "88 George Street, Parramatta NSW 2150", dropoffSuburb: "Parramatta", dropoffState: "NSW", dropoffPostcode: "2150", dropoffContactName: "Site office", dropoffContactPhone: "02 9000 1234" },
      load: "Office fitout: 6 flat-packed workstations and 2 pallets of partition panels", weightKg: 900, pallets: 2, distanceKm: 24.5, tailgate: true, paymentMethod: "account", createdHoursAgo: 1,
    },
    {
      customerId: customer.id, typeCode: "van", status: "confirmed", scheduledAt: hours(26),
      pickup: { pickupAddress: "5 Danks Street, Waterloo NSW 2017", pickupSuburb: "Waterloo", pickupState: "NSW", pickupPostcode: "2017", pickupContactName: "Showroom", pickupContactPhone: "02 9555 8000" },
      dropoff: { dropoffAddress: "210 Military Road, Neutral Bay NSW 2089", dropoffSuburb: "Neutral Bay", dropoffState: "NSW", dropoffPostcode: "2089", dropoffContactName: "Reception" },
      load: "Display furniture: 2 sofas, 1 dining table (wrapped)", weightKg: 250, pallets: 0, distanceKm: 11.2, handUnload: true, createdHoursAgo: 20,
    },
    {
      customerId: customer.id, typeCode: "4t_pantech", status: "assigned", scheduledAt: hours(3),
      pickup: { pickupAddress: "Unit 4, 20 Prime Drive, Seven Hills NSW 2147", pickupSuburb: "Seven Hills", pickupState: "NSW", pickupPostcode: "2147", pickupContactName: "Warehouse", pickupContactPhone: "02 9600 4000", pickupInstructions: "Forklift on site." },
      dropoff: { dropoffAddress: "1 Macquarie Place, Sydney NSW 2000", dropoffSuburb: "Sydney", dropoffState: "NSW", dropoffPostcode: "2000", dropoffContactName: "Building manager", dropoffContactPhone: "0411 000 999", dropoffInstructions: "Loading dock booked 2–4pm, height limit 3.8m." },
      load: "5 pallets of joinery for level 12 fitout", weightKg: 2800, pallets: 5, distanceKm: 33.0, tailgate: true, driverId: driver2.id, vehicleRego: "LL4T002", adminNotes: "Customer is a key account — call ahead 30 min before arrival.", paymentMethod: "account", createdHoursAgo: 30,
    },
    {
      customerId: customer2.id, typeCode: "8t_pantech", status: "in_transit", scheduledAt: hours(-2), 
      pickup: { pickupAddress: "35 Newton Road, Wetherill Park NSW 2164", pickupSuburb: "Wetherill Park", pickupState: "NSW", pickupPostcode: "2164", pickupContactName: "DC dispatch", pickupContactPhone: "02 9700 7000" },
      dropoff: { dropoffAddress: "Westfield Chatswood, 1 Anderson Street, Chatswood NSW 2067", dropoffSuburb: "Chatswood", dropoffState: "NSW", dropoffPostcode: "2067", dropoffContactName: "Store manager", dropoffContactPhone: "02 9411 2222" },
      load: "9 pallets of seasonal stock", weightKg: 5400, pallets: 9, distanceKm: 41.0, tailgate: true, driverId: driver1.id, vehicleRego: "LL8T004", paymentMethod: "account", createdHoursAgo: 28,
    },
    {
      customerId: customer.id, typeCode: "ute", status: "completed", scheduledAt: days(-3),
      pickup: { pickupAddress: "Bunnings Alexandria, 8/40 Euston Road, Alexandria NSW 2015", pickupSuburb: "Alexandria", pickupState: "NSW", pickupPostcode: "2015" },
      dropoff: { dropoffAddress: "14 Rowntree Street, Balmain NSW 2041", dropoffSuburb: "Balmain", dropoffState: "NSW", dropoffPostcode: "2041", dropoffContactName: "Jordan Lee", dropoffContactPhone: "0412 345 678" },
      load: "Timber, plasterboard and tools", weightKg: 350, pallets: 0, distanceKm: 8.4, driverId: driver3.id, vehicleRego: "LLVN003", createdHoursAgo: 80,
    },
    {
      customerId: customer.id, typeCode: "2t_pantech", status: "completed", scheduledAt: days(-9),
      pickup: { pickupAddress: "300 Botany Road, Alexandria NSW 2015", pickupSuburb: "Alexandria", pickupState: "NSW", pickupPostcode: "2015" },
      dropoff: { dropoffAddress: "45 Victoria Avenue, Chatswood NSW 2067", dropoffSuburb: "Chatswood", dropoffState: "NSW", dropoffPostcode: "2067" },
      load: "Reception desk and 3 pallets of flooring", weightKg: 1500, pallets: 3, distanceKm: 19.7, tailgate: true, handUnload: true, driverId: driver1.id, vehicleRego: "LL2T001", paymentMethod: "account", createdHoursAgo: 230,
    },
    {
      customerId: customer.id, typeCode: "van", status: "cancelled", scheduledAt: days(-1),
      pickup: { pickupAddress: "2 Park Street, Sydney NSW 2000", pickupSuburb: "Sydney", pickupState: "NSW", pickupPostcode: "2000" },
      dropoff: { dropoffAddress: "77 King Street, Newtown NSW 2042", dropoffSuburb: "Newtown", dropoffState: "NSW", dropoffPostcode: "2042" },
      load: "Marketing collateral — 12 boxes", weightKg: 120, pallets: 0, distanceKm: 6.1, createdHoursAgo: 50,
    },
    {
      customerId: customer2.id, typeCode: "4t_pantech", status: "delivered", scheduledAt: hours(-6),
      pickup: { pickupAddress: "Lot 2, 10 Hume Highway, Chullora NSW 2190", pickupSuburb: "Chullora", pickupState: "NSW", pickupPostcode: "2190" },
      dropoff: { dropoffAddress: "Macquarie Centre, Herring Road, North Ryde NSW 2113", dropoffSuburb: "North Ryde", dropoffState: "NSW", dropoffPostcode: "2113" },
      load: "Shop fixtures: 4 pallets", weightKg: 2100, pallets: 4, distanceKm: 27.3, tailgate: true, driverId: driver2.id, vehicleRego: "LL4T002", paymentMethod: "account", createdHoursAgo: 32,
    },
  ];

  const trail: Record<BookingStatus, BookingStatus[]> = {
    pending: ["pending"],
    confirmed: ["pending", "confirmed"],
    assigned: ["pending", "confirmed", "assigned"],
    en_route_pickup: ["pending", "confirmed", "assigned", "en_route_pickup"],
    picked_up: ["pending", "confirmed", "assigned", "en_route_pickup", "picked_up"],
    in_transit: ["pending", "confirmed", "assigned", "en_route_pickup", "picked_up", "in_transit"],
    delivered: ["pending", "confirmed", "assigned", "en_route_pickup", "picked_up", "in_transit", "delivered"],
    completed: ["pending", "confirmed", "assigned", "en_route_pickup", "picked_up", "in_transit", "delivered", "completed"],
    cancelled: ["pending", "cancelled"],
    failed: ["pending", "confirmed", "assigned", "en_route_pickup", "failed"],
  };

  for (const job of jobs) {
    const vt = typeByCode[job.typeCode];
    const quote = calculateQuote({
      vehicleType: vt,
      distanceKm: job.distanceKm,
      requiresTailgate: job.tailgate,
      requiresHandUnload: job.handUnload,
      isAsap: job.isAsap,
    });
    const createdAt = hours(-job.createdHoursAgo);
    const steps = trail[job.status];
    const stepTime = (i: number) =>
      new Date(createdAt.getTime() + ((job.scheduledAt.getTime() - createdAt.getTime()) * (i + 1)) / (steps.length + 1));
    const at = (s: BookingStatus) => {
      const i = steps.indexOf(s);
      return i >= 0 ? stepTime(i) : null;
    };
    const vehicle = job.vehicleRego ? vehicleByRego[job.vehicleRego] : null;

    const [b] = await db
      .insert(bookings)
      .values({
        reference: generateReference(),
        customerId: job.customerId,
        vehicleTypeId: vt.id,
        vehicleId: vehicle?.id ?? null,
        driverId: job.driverId ?? null,
        status: job.status,
        ...job.pickup,
        ...job.dropoff,
        isAsap: job.isAsap ?? false,
        scheduledAt: job.scheduledAt,
        loadDescription: job.load,
        weightKg: job.weightKg ?? null,
        pallets: job.pallets ?? 0,
        requiresTailgate: job.tailgate ?? false,
        requiresHandUnload: job.handUnload ?? false,
        distanceKm: quote.distanceKm,
        quotedPriceCents: quote.totalCents,
        finalPriceCents: job.status === "completed" ? quote.totalCents : null,
        paymentMethod: job.paymentMethod ?? "card",
        adminNotes: job.adminNotes ?? null,
        cancellationReason: job.status === "cancelled" ? "Customer no longer needs the delivery" : null,
        confirmedAt: at("confirmed"),
        assignedAt: at("assigned"),
        pickedUpAt: at("picked_up"),
        deliveredAt: at("delivered"),
        completedAt: at("completed"),
        cancelledAt: at("cancelled"),
        createdAt,
        updatedAt: createdAt,
      })
      .returning();

    await db.insert(bookingEvents).values(
      steps.map((s, i) => ({
        bookingId: b.id,
        fromStatus: i === 0 ? null : steps[i - 1],
        toStatus: s,
        actorId: s === "pending" || s === "cancelled" ? job.customerId : dispatcher.id,
        actorRole: s === "pending" || s === "cancelled" ? "customer" : "dispatcher",
        note:
          s === "pending"
            ? "Booking created"
            : s === "assigned" && job.driverId
              ? `Assigned to ${[driver1, driver2, driver3].find((d) => d.id === job.driverId)?.name}${vehicle ? ` (${vehicle.registration})` : ""}`
              : s === "cancelled"
                ? "Customer no longer needs the delivery"
                : null,
        createdAt: stepTime(i),
      })),
    );

    if (vehicle && ["assigned", "en_route_pickup", "picked_up", "in_transit"].includes(job.status)) {
      await db.update(vehicles).set({ status: "in_use" }).where(eq(vehicles.id, vehicle.id));
    }
  }

  logger.info("seed.done", { users: 7, vehicleTypes: types.length, vehicles: fleet.length, bookings: jobs.length });
}
