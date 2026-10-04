import { errors, handle, json, parseId, parseJson } from "@/lib/api";
import { hasPermission, requireApiUser, type SafeUser } from "@/lib/auth";
import { bookingActionSchema } from "@/lib/validation";
import { publishTrackingEvent } from "@/lib/tracking-realtime";
import {
  assignBooking,
  cancelBooking,
  getBookingDetail,
  transitionBooking,
  updateBookingAdmin,
  updateBookingStopStatus,
  type BookingDetail,
} from "@/services/bookings";

export const dynamic = "force-dynamic";

function assertCanView(user: SafeUser, detail: BookingDetail) {
  if (hasPermission(user.role, "bookings:read:any")) return;
  if (user.role === "driver" && detail.booking.driverId === user.id) return;
  if (detail.booking.customerId === user.id) return;
  throw errors.notFound("Booking not found");
}

export const GET = handle<{ id: string }>(async (_req, { params }) => {
  const user = await requireApiUser();
  const id = parseId((await params).id);
  const detail = await getBookingDetail(id);
  if (!detail) throw errors.notFound("Booking not found");
  assertCanView(user, detail);
  return json(detail);
});

export const PATCH = handle<{ id: string }>(async (req, { params }) => {
  const user = await requireApiUser();
  const id = parseId((await params).id);
  const action = await parseJson(req, bookingActionSchema);
  const staff = hasPermission(user.role, "bookings:manage");

  if (action.action === "cancel") {
    if (!staff && !hasPermission(user.role, "bookings:cancel:own")) throw errors.forbidden();
    await cancelBooking(id, user, action.reason, !staff);
  } else if (user.role === "driver") {
    if (!hasPermission(user.role, "bookings:progress")) throw errors.forbidden();
    if (action.action === "stop") {
      await updateBookingStopStatus(id, action.stopIndex, action.status, user);
    } else if (action.action === "transition") {
      await transitionBooking(id, action.status, user, action.note, { driverId: user.id });
    } else {
      throw errors.forbidden();
    }
  } else {
    if (!staff) throw errors.forbidden();
    switch (action.action) {
      case "transition":
        if (action.status === "cancelled") await cancelBooking(id, user, action.note, false);
        else await transitionBooking(id, action.status, user, action.note);
        break;
      case "assign":
        await assignBooking(id, { driverId: action.driverId, vehicleId: action.vehicleId }, user, action.note);
        break;
      case "unassign":
        await transitionBooking(id, "confirmed", user, action.note ?? "Assignment cancelled; job returned to confirmed");
        break;
      case "update":
        await updateBookingAdmin(id, { finalPriceCents: action.finalPriceCents, adminNotes: action.adminNotes }, user);
        break;
    }
  }

  const detail = await getBookingDetail(id);
  if (!detail) throw errors.notFound("Booking not found");
  await publishTrackingEvent({
    type: "tracking.booking",
    bookingId: id,
    status: detail.booking.status,
    updatedAt: detail.booking.updatedAt.toISOString(),
  });
  return json(detail);
});
