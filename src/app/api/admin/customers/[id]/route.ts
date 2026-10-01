import { errors, handle, json, parseId, parseJson } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { updateUserStatusSchema } from "@/lib/validation";
import { listBookings } from "@/services/bookings";
import { getCustomerDetail, setUserStatus } from "@/services/users";

export const dynamic = "force-dynamic";

export const GET = handle<{ id: string }>(async (_req, { params }) => {
  await requireApiUser("customers:read");
  const id = parseId((await params).id);
  const customer = await getCustomerDetail(id);
  if (!customer) throw errors.notFound("Customer not found");
  const bookings = await listBookings({ customerId: id, pageSize: 50 });
  return json({ customer, bookings: bookings.rows });
});

export const PATCH = handle<{ id: string }>(async (req, { params }) => {
  const actor = await requireApiUser("customers:manage");
  const id = parseId((await params).id);
  if (id === actor.id) throw errors.conflict("You cannot change your own account status", "SELF_UPDATE");
  const existing = await getCustomerDetail(id);
  if (!existing) throw errors.notFound("Customer not found");
  const { status } = await parseJson(req, updateUserStatusSchema);
  const user = await setUserStatus(id, status);
  return json({ user });
});
