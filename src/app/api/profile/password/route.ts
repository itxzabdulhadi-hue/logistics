import { handle, json, parseJson } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { changePasswordSchema } from "@/lib/validation";
import { changePassword } from "@/services/users";

export const dynamic = "force-dynamic";

export const PUT = handle(async (req) => {
  const user = await requireApiUser("profile:manage");
  const { currentPassword, newPassword } = await parseJson(req, changePasswordSchema);
  await changePassword(user.id, currentPassword, newPassword);
  return json({ ok: true });
});
