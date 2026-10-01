import { ApiError, handle, json, parseJson } from "@/lib/api";
import { createSession, homeForRole } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { ensureSeeded } from "@/lib/seed";
import { loginSchema } from "@/lib/validation";
import { authenticateUser } from "@/services/users";

export const dynamic = "force-dynamic";

export const POST = handle(async (req) => {
  await ensureSeeded();
  const { email, password } = await parseJson(req, loginSchema);
  const user = await authenticateUser(email, password);
  if (!user) {
    logger.warn("auth.login.failed", { email });
    throw new ApiError(401, "INVALID_CREDENTIALS", "Incorrect email or password");
  }
  await createSession(user);
  logger.info("auth.login.success", { userId: user.id, role: user.role });
  return json({ user, redirectTo: homeForRole(user.role) });
});
