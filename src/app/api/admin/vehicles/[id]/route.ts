import { handle, json, parseId, parseJson } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { vehicleUpdateSchema } from "@/lib/validation";
import { deleteVehicle, updateVehicle } from "@/services/fleet";

export const dynamic = "force-dynamic";

export const PATCH = handle<{ id: string }>(async (req, { params }) => {
  await requireApiUser("fleet:manage");
  const id = parseId((await params).id);
  const input = await parseJson(req, vehicleUpdateSchema);
  const vehicle = await updateVehicle(id, input);
  return json({ vehicle });
});

export const DELETE = handle<{ id: string }>(async (_req, { params }) => {
  await requireApiUser("fleet:manage");
  const id = parseId((await params).id);
  await deleteVehicle(id);
  return json({ ok: true });
});
