import { handle, json, parseId, parseJson } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { driverProfileUpdateSchema } from "@/lib/validation";
import { updateDriverProfile } from "@/services/users";

export const dynamic = "force-dynamic";

export const PATCH = handle<{ id: string }>(async (req, { params }) => {
  await requireApiUser("fleet:manage");
  const id = parseId((await params).id, "driver id");
  const input = await parseJson(req, driverProfileUpdateSchema);
  const driver = await updateDriverProfile(id, input);
  return json({ driver });
});
