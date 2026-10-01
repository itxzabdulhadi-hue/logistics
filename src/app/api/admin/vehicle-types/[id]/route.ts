import { handle, json, parseId, parseJson } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { vehicleTypeUpdateSchema } from "@/lib/validation";
import { updateVehicleType } from "@/services/fleet";

export const dynamic = "force-dynamic";

export const PATCH = handle<{ id: string }>(async (req, { params }) => {
  await requireApiUser("fleet:manage");
  const id = parseId((await params).id);
  const input = await parseJson(req, vehicleTypeUpdateSchema);
  const vehicleType = await updateVehicleType(id, input);
  return json({ vehicleType });
});
