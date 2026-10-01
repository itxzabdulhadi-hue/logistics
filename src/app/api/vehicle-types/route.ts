import { handle, json } from "@/lib/api";
import { ensureSeeded } from "@/lib/seed";
import { listVehicleTypes } from "@/services/fleet";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await ensureSeeded();
  const vehicleTypes = await listVehicleTypes({ activeOnly: true });
  return json({ vehicleTypes });
});
