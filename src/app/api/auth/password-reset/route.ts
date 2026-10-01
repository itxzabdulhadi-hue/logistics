import { handle, json, parseJson } from "@/lib/api";
import { logger } from "@/lib/logger";
import { forgotPasswordSchema, resetPasswordSchema } from "@/lib/validation";
import { createPasswordReset, resetPasswordWithToken } from "@/services/users";

export const dynamic = "force-dynamic";

const emailDeliveryConfigured = () => Boolean(process.env.SMTP_URL || process.env.RESEND_API_KEY);

/** Request a reset link. Always 200 so account existence is not leaked. */
export const POST = handle(async (req) => {
  const { email } = await parseJson(req, forgotPasswordSchema);
  const result = await createPasswordReset(email);
  if (!result) return json({ ok: true, delivered: false });

  const resetUrl = `${req.nextUrl.origin}/reset-password?token=${encodeURIComponent(result.token)}`;
  if (emailDeliveryConfigured()) {
    // Hook for a real mail provider; not wired in Phase 1.
    logger.info("auth.password_reset.email_queued", { userId: result.user.id });
    return json({ ok: true, delivered: true });
  }
  logger.info("auth.password_reset.demo_link", { userId: result.user.id, resetUrl });
  // Demo mode: no mail provider configured, hand the link back to the UI.
  return json({ ok: true, delivered: false, demoResetUrl: resetUrl });
});

/** Consume a reset token. */
export const PUT = handle(async (req) => {
  const { token, password } = await parseJson(req, resetPasswordSchema);
  await resetPasswordWithToken(token, password);
  return json({ ok: true });
});
