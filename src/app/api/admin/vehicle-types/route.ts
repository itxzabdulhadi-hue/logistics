import { handle, json, parseJson } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { vehicleTypeSchema } from "@/lib/validation";
import { createVehicleType, listVehicleTypes } from "@/services/fleet";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await requireApiUser("fleet:read");
  return json({ vehicleTypes: await listVehicleTypes() });
});

export const POST = handle(async (req) => {
  await requireApiUser("fleet:manage");
  const input = await parseJson(req, vehicleTypeSchema);
  const vehicleType = await createVehicleType(input);
  return json({ vehicleType }, { status: 201 });
});
