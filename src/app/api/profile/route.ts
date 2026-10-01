import { handle, json, parseJson } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { updateProfileSchema } from "@/lib/validation";
import { updateProfile } from "@/services/users";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const user = await requireApiUser();
  return json({ user });
});

export const PATCH = handle(async (req) => {
  const user = await requireApiUser("profile:manage");
  const input = await parseJson(req, updateProfileSchema);
  const updated = await updateProfile(user.id, input);
  return json({ user: updated });
});
