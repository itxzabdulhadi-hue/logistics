import { errors, handle, json } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { listTrackingSnapshotsForViewer } from "@/services/tracking";

export const dynamic = "force-dynamic";

export const GET = handle(async (request) => {
  const user = await requireApiUser();
  const rawIds = request.nextUrl.searchParams.get("bookingIds");
  if (!rawIds) throw errors.badRequest("bookingIds is required");

  const bookingIds = [...new Set(rawIds.split(",").map((value) => Number(value)))];
  if (
    bookingIds.length === 0 ||
    bookingIds.length > 100 ||
    bookingIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
  ) {
    throw errors.badRequest("Provide between 1 and 100 valid booking IDs");
  }

  const snapshots = await listTrackingSnapshotsForViewer(bookingIds, user);
  return json({ snapshots });
});
