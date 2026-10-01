import { handle, json, parseJson, parseQuery } from "@/lib/api";
import { hasPermission, requireApiUser } from "@/lib/auth";
import { bookingListQuerySchema, createBookingSchema } from "@/lib/validation";
import { createBooking, listBookings } from "@/services/bookings";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const user = await requireApiUser();
  const query = parseQuery(req, bookingListQuerySchema);
  const scope = hasPermission(user.role, "bookings:read:any")
    ? { customerId: query.customerId }
    : user.role === "driver"
      ? { driverId: user.id }
      : { customerId: user.id };
  const result = await listBookings({ ...query, ...scope });
  return json(result);
});

export const POST = handle(async (req) => {
  const user = await requireApiUser("bookings:create");
  const input = await parseJson(req, createBookingSchema);
  const booking = await createBooking(user, input);
  return json({ booking }, { status: 201 });
});
