import { handle, json } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { getFinanceDashboard } from "@/services/billing";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await requireApiUser("finance:read");
  return json(await getFinanceDashboard());
});
