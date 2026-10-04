import { errors, handle, json, parseJson } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { driverLocationSchema } from "@/lib/validation";
import { publishTrackingEvent } from "@/lib/tracking-realtime";
import { recordDriverLocation } from "@/services/tracking";

export const dynamic = "force-dynamic";

export const POST = handle(async (request) => {
  const user = await requireApiUser("bookings:progress");
  if (user.role !== "driver") throw errors.forbidden();
  const input = await parseJson(request, driverLocationSchema);
  const result = await recordDriverLocation(user.id, input);

  if (result.accepted) {
    await publishTrackingEvent({
      type: "tracking.location",
      bookingId: input.bookingId,
      location: result.location,
    });
  }

  return json({ accepted: result.accepted, location: result.location });
});
