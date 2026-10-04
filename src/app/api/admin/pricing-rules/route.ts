import { errors, handle, json, parseJson } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { pricingRulesSchema } from "@/lib/validation";
import { getPricingRules, savePricingRules } from "@/services/pricing";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const user = await requireApiUser();
  if (user.role !== "admin") throw errors.forbidden("Only an admin can configure pricing rules");
}

export const GET = handle(async () => {
  await requireAdmin();
  return json({ pricingRules: await getPricingRules() });
});

export const PATCH = handle(async (req) => {
  await requireAdmin();
  const input = await parseJson(req, pricingRulesSchema);
  const pricingRules = await savePricingRules(input);
  return json({ pricingRules });
});
