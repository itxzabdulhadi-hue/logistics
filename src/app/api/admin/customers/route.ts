import { handle, json, parseQuery } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { customerListQuerySchema } from "@/lib/validation";
import { listCustomers } from "@/services/users";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  await requireApiUser("customers:read");
  const query = parseQuery(req, customerListQuerySchema);
  return json(await listCustomers(query));
});
