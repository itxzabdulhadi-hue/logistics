import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CancelBookingButton } from "@/components/booking-actions";
import { LiveTrackingFeed } from "@/components/live-tracking-feed";
import { RouteMap } from "@/components/route-map";
import { Alert, Card, CardHeader, DescriptionList, PageHeader, StatusBadge, Timeline } from "@/components/ui";
import { isStaff, requireUser } from "@/lib/auth";
import { CUSTOMER_CANCELLABLE, STATUS_META } from "@/lib/booking-rules";
import { formatDateTime, formatDuration, formatKm, formatMoney, titleCase } from "@/lib/utils";
import { getBookingDetail } from "@/services/bookings";
import { getTrackingSnapshot } from "@/services/tracking";

export const metadata: Metadata = { title: "Booking" };
export const dynamic = "force-dynamic";

export default async function BookingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const user = await requireUser();
  if (user.role === "driver") redirect("/driver");
  const { id } = await params;
  const { created } = await searchParams;
  const bookingId = Number(id);
  if (!Number.isInteger(bookingId)) notFound();
  if (isStaff(user.role)) redirect(`/admin/bookings/${bookingId}`);

  const detail = await getBookingDetail(bookingId);
  if (!detail) notFound();
  const { booking: b } = detail;
  const ownsIt = b.customerId === user.id;
  if (!ownsIt) notFound();
  const trackable = ["assigned", "en_route_pickup", "picked_up", "in_transit", "delivered"].includes(b.status);
  const tracking = b.driverId != null && trackable ? await getTrackingSnapshot(b.id) : null;

  const canCancel = b.customerId === user.id && CUSTOMER_CANCELLABLE.includes(b.status);
  const directionsUrl = new URL("https://www.google.com/maps/dir/");
  directionsUrl.searchParams.set("api", "1");
  directionsUrl.searchParams.set("origin", b.pickupAddress);
  directionsUrl.searchParams.set("destination", b.dropoffAddress);
  if (b.additionalStops?.length) {
    directionsUrl.searchParams.set("waypoints", b.additionalStops.map((stop) => stop.address).join("|"));
  }
  directionsUrl.searchParams.set("travelmode", "driving");
  const routeWaypoints = [
    b.pickupLat != null && b.pickupLng != null ? { lat: b.pickupLat, lng: b.pickupLng } : null,
    ...(b.additionalStops ?? []).map(({ lat, lng }) => ({ lat, lng })),
    b.dropoffLat != null && b.dropoffLng != null ? { lat: b.dropoffLat, lng: b.dropoffLng } : null,
  ].filter((point): point is { lat: number; lng: number } => point != null);
  const routeGeometry = b.routeGeometry.length > 1 ? b.routeGeometry : routeWaypoints;

  return (
    <>
      <div className="mb-4 text-sm">
        <Link href="/bookings" className="text-slate-500 hover:text-slate-900">← My bookings</Link>
      </div>
      <PageHeader
        eyebrow={detail.vehicleType.name}
        title={b.reference}
        description={STATUS_META[b.status].description}
        actions={
          <div className="flex flex-col items-end gap-3">
            <StatusBadge status={b.status} className="px-3 py-1 text-sm" />
            {canCancel && <CancelBookingButton bookingId={b.id} />}
          </div>
        }
      />

      {created && (
        <Alert tone="success" title="Booking received" className="mb-6">
          Your reference is <b>{b.reference}</b>. A dispatcher will confirm it shortly — you can follow progress on this page.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Route"
              description={b.routeOptimized ? "Intermediate stops reordered to shorten the route; pickup and final delivery stay fixed." : "Stops will be visited in the entered order."}
              action={<a href={directionsUrl.toString()} target="_blank" rel="noreferrer" className="text-xs font-semibold text-orange-700 hover:text-orange-800">Open in Google Maps ↗</a>}
            />
            {!tracking && routeGeometry.length > 1 && <div className="px-5 pt-4"><RouteMap geometry={routeGeometry} waypoints={routeWaypoints} /></div>}
            <div className="grid gap-6 p-5 md:grid-cols-2">
              <Stop label="Pickup" tone="emerald" address={b.pickupAddress} contact={b.pickupContactName} phone={b.pickupContactPhone} instructions={b.pickupInstructions} />
              {b.additionalStops?.map((stop, index) => (
                <Stop key={`${stop.address}-${index}`} label={`Stop ${index + 1}`} tone="orange" address={stop.address} contact={null} phone={null} instructions={null} />
              ))}
              <Stop label="Delivery" tone="orange" address={b.dropoffAddress} contact={b.dropoffContactName} phone={b.dropoffContactPhone} instructions={b.dropoffInstructions} />
            </div>
          </Card>

          {tracking && (
            <LiveTrackingFeed
              snapshots={[tracking]}
              title="Live vehicle tracking"
              description="Follow the assigned vehicle, current job status, route progress and estimated delivery."
            />
          )}

          <Card>
            <CardHeader title="Job details" />
            <div className="p-5">
              <DescriptionList
                columns={3}
                items={[
                  { label: "Pickup time", value: <>{formatDateTime(b.scheduledAt)}{b.isAsap && <span className="ml-1 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-700">ASAP</span>}</> },
                  { label: "Vehicle", value: detail.vehicleType.name },
                  { label: "Road distance", value: formatKm(b.distanceKm) },
                  { label: "Estimated drive", value: b.estimatedDurationMinutes != null ? formatDuration(b.estimatedDurationMinutes * 60) : "—" },
                  { label: "Load", value: b.loadDescription },
                  { label: "Weight / pallets / items", value: `${b.weightKg ? `${b.weightKg.toLocaleString()} kg` : "—"} · ${b.pallets} pallets · ${b.itemCount ?? "—"} items` },
                  { label: "Extras", value: [b.requiresTailgate && "Tailgate lifter", b.requiresHandUnload && "Hand unload"].filter(Boolean).join(", ") || "None" },
                  { label: "Payment", value: b.paymentMethod === "account" ? "On account" : "Card" },
                  { label: "Booked", value: formatDateTime(b.createdAt) },
                  { label: "Your notes", value: b.customerNotes || "—" },
                ]}
              />
            </div>
          </Card>

          {(detail.driverName || detail.vehicle) && (
            <Card>
              <CardHeader title="Your driver" />
              <div className="p-5">
                <DescriptionList
                  columns={3}
                  items={[
                    { label: "Driver", value: detail.driverName ?? "To be allocated" },
                    { label: "Phone", value: detail.driverPhone ?? "—" },
                    { label: "Vehicle", value: detail.vehicle ? `${detail.vehicle.registration}${detail.vehicle.make ? ` · ${detail.vehicle.make} ${detail.vehicle.model ?? ""}` : ""}` : "—" },
                  ]}
                />
              </div>
            </Card>
          )}

          {b.status === "cancelled" && b.cancellationReason && (
            <Alert tone="warning" title="Cancellation reason">{b.cancellationReason}</Alert>
          )}
        </div>

        <div className="space-y-6">
          <Card className="overflow-hidden">
            <div className="bg-slate-900 px-5 py-4 text-white">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{b.finalPriceCents != null ? "Final price" : "Quoted price"}</p>
              <p className="mt-1 text-3xl font-bold">{formatMoney(b.finalPriceCents ?? b.quotedPriceCents)}</p>
              <p className="text-xs text-slate-400">inc. GST · {titleCase(b.paymentMethod)}</p>
            </div>
            {b.finalPriceCents != null && b.finalPriceCents !== b.quotedPriceCents && (
              <p className="px-5 py-3 text-xs text-slate-500">Originally quoted {formatMoney(b.quotedPriceCents)}. Adjusted by dispatch — see timeline.</p>
            )}
          </Card>
          <Card>
            <CardHeader title="Timeline" />
            <div className="p-5">
              <Timeline events={detail.events} />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function Stop({ label, tone, address, contact, phone, instructions }: { label: string; tone: "emerald" | "orange"; address: string; contact: string | null; phone: string | null; instructions: string | null }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        <span className={tone === "emerald" ? "h-2.5 w-2.5 rounded-full bg-emerald-500" : "h-2.5 w-2.5 rounded-full bg-orange-500"} />
        {label}
      </div>
      <p className="mt-2 text-sm font-medium text-slate-900">{address}</p>
      {(contact || phone) && <p className="mt-1 text-sm text-slate-600">{[contact, phone].filter(Boolean).join(" · ")}</p>}
      {instructions && <p className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">{instructions}</p>}
    </div>
  );
}
