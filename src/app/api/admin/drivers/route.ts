import { handle, json, parseJson } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { createDriverSchema } from "@/lib/validation";
import { createDriver, listDrivers } from "@/services/users";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await requireApiUser("fleet:read");
  return json({ drivers: await listDrivers() });
});

export const POST = handle(async (req) => {
  await requireApiUser("fleet:manage");
  const input = await parseJson(req, createDriverSchema);
  const driver = await createDriver(input);
  return json({ driver }, { status: 201 });
});
