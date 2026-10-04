import { errors, handle, json, parseJson } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { driverAvailabilitySchema } from "@/lib/validation";
import { setDriverAvailability } from "@/services/users";

export const dynamic = "force-dynamic";

export const PATCH = handle(async (req) => {
  const user = await requireApiUser("profile:manage");
  if (user.role !== "driver") throw errors.forbidden();
  const { availability } = await parseJson(req, driverAvailabilitySchema);
  const driver = await setDriverAvailability(user.id, availability);
  return json({ availability: driver.availability });
});
