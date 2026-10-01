import { handle, json, parseJson } from "@/lib/api";
import { createSession } from "@/lib/auth";
import { ensureSeeded } from "@/lib/seed";
import { registerSchema } from "@/lib/validation";
import { createUser } from "@/services/users";

export const dynamic = "force-dynamic";

export const POST = handle(async (req) => {
  await ensureSeeded();
  const input = await parseJson(req, registerSchema);
  const user = await createUser({ ...input, role: "customer" });
  await createSession(user);
  return json({ user }, { status: 201 });
});
