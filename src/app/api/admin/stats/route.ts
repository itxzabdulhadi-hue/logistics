import { handle, json } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { getAdminStats, listAttentionBookings } from "@/services/bookings";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await requireApiUser("bookings:read:any");
  const [stats, attention] = await Promise.all([getAdminStats(), listAttentionBookings()]);
  return json({ ...stats, attention });
});
