import { handle, json, parseJson } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { vehicleSchema } from "@/lib/validation";
import { createVehicle, listVehicles } from "@/services/fleet";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await requireApiUser("fleet:read");
  return json({ vehicles: await listVehicles() });
});

export const POST = handle(async (req) => {
  await requireApiUser("fleet:manage");
  const input = await parseJson(req, vehicleSchema);
  const vehicle = await createVehicle(input);
  return json({ vehicle }, { status: 201 });
});
