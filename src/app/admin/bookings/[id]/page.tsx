import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingManager } from "@/components/admin/booking-manager";
import { LiveTrackingFeed } from "@/components/live-tracking-feed";
import { RouteMap } from "@/components/route-map";
import { Alert, Card, CardHeader, DescriptionList, PageHeader, StatusBadge, Timeline } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { STATUS_META } from "@/lib/booking-rules";
import { formatDateTime, formatDuration, formatKm, formatMoney, titleCase } from "@/lib/utils";
import { getBookingDetail } from "@/services/bookings";
import { listAssignableVehicles } from "@/services/fleet";
import { listDrivers } from "@/services/users";
import { getTrackingSnapshot } from "@/services/tracking";

export const metadata: Metadata = { title: "Manage booking" };
export const dynamic = "force-dynamic";

export default async function AdminBookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin", "dispatcher"]);
  const { id } = await params;
  const bookingId = Number(id);
  if (!Number.isInteger(bookingId)) notFound();
  const detail = await getBookingDetail(bookingId);
  if (!detail) notFound();
  const { booking: b } = detail;
  const trackable = b.driverId != null && ["assigned", "en_route_pickup", "picked_up", "in_transit", "delivered"].includes(b.status);
  const [drivers, vehicles, tracking] = await Promise.all([
    listDrivers(),
    listAssignableVehicles({ includeVehicleId: b.vehicleId ?? undefined }),
    trackable ? getTrackingSnapshot(b.id) : Promise.resolve(null),
  ]);
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
      <div className="mb-4 text-sm"><Link href="/admin/bookings" className="text-slate-500 hover:text-slate-900">← All bookings</Link></div>
      <PageHeader
        eyebrow={`${detail.vehicleType.name} · ${titleCase(b.paymentMethod)}`}
        title={b.reference}
        description={STATUS_META[b.status].description}
        actions={<StatusBadge status={b.status} className="px-3 py-1 text-sm" />}
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Customer" action={<Link href={`/admin/customers/${b.customerId}`} className="text-sm font-medium text-orange-600 hover:text-orange-700">View customer →</Link>} />
            <div className="p-5">
              <DescriptionList columns={3} items={[
                { label: "Name", value: detail.customerName },
                { label: "Company", value: detail.customerCompany ?? "—" },
                { label: "Contact", value: <>{detail.customerEmail}<br />{detail.customerPhone ?? ""}</> },
              ]} />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Route"
              description={b.routeOptimized ? "Intermediate stops reordered to shorten the route; pickup and final delivery stay fixed." : "Stops will be visited in the entered order."}
              action={<a href={directionsUrl.toString()} target="_blank" rel="noreferrer" className="text-xs font-semibold text-orange-700 hover:text-orange-800">Open in Google Maps ↗</a>}
            />
            {!tracking && routeGeometry.length > 1 && <div className="px-5 pt-4"><RouteMap geometry={routeGeometry} waypoints={routeWaypoints} /></div>}
            <div className="grid gap-6 p-5 md:grid-cols-2">
              {[
                { label: "Pickup", dot: "bg-emerald-500", address: b.pickupAddress, contact: b.pickupContactName, phone: b.pickupContactPhone, instructions: b.pickupInstructions },
                ...(b.additionalStops ?? []).map((stop, index) => ({ label: `Stop ${index + 1}`, dot: "bg-slate-500", address: stop.address, contact: null, phone: null, instructions: null })),
                { label: "Delivery", dot: "bg-orange-500", address: b.dropoffAddress, contact: b.dropoffContactName, phone: b.dropoffContactPhone, instructions: b.dropoffInstructions },
              ].map((s) => (
                <div key={s.label}>
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500"><span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} />{s.label}</div>
                  <p className="mt-2 text-sm font-medium text-slate-900">{s.address}</p>
                  {(s.contact || s.phone) && <p className="mt-1 text-sm text-slate-600">{[s.contact, s.phone].filter(Boolean).join(" · ")}</p>}
                  {s.instructions && <p className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">{s.instructions}</p>}
                </div>
              ))}
            </div>
          </Card>

          {tracking && (
            <LiveTrackingFeed
              snapshots={[tracking]}
              title="Live vehicle tracking"
              description="Latest GPS position, route progress and estimated delivery from the assigned driver."
            />
          )}

          <Card>
            <CardHeader title="Job details" />
            <div className="p-5">
              <DescriptionList columns={3} items={[
                { label: "Pickup time", value: <>{formatDateTime(b.scheduledAt)}{b.isAsap && <span className="ml-1 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-700">ASAP</span>}</> },
                { label: "Road distance", value: formatKm(b.distanceKm) },
                { label: "Estimated drive", value: b.estimatedDurationMinutes != null ? formatDuration(b.estimatedDurationMinutes * 60) : "—" },
                { label: "Booked", value: formatDateTime(b.createdAt) },
                { label: "Load", value: b.loadDescription },
                { label: "Weight / pallets / items", value: `${b.weightKg ? `${b.weightKg.toLocaleString()} kg` : "—"} · ${b.pallets} pallets · ${b.itemCount ?? "—"} items` },
                { label: "Extras", value: [b.requiresTailgate && "Tailgate lifter", b.requiresHandUnload && "Hand unload"].filter(Boolean).join(", ") || "None" },
                { label: "Customer notes", value: b.customerNotes || "—" },
                { label: "Driver", value: detail.driverName ? `${detail.driverName}${detail.driverPhone ? ` · ${detail.driverPhone}` : ""}` : "Unassigned" },
                { label: "Vehicle", value: detail.vehicle ? `${detail.vehicle.registration}${detail.vehicle.make ? ` · ${detail.vehicle.make} ${detail.vehicle.model ?? ""}` : ""}` : "—" },
                { label: "Quoted", value: formatMoney(b.quotedPriceCents) },
                { label: "Final", value: b.finalPriceCents != null ? formatMoney(b.finalPriceCents) : "— (quoted price applies)" },
                { label: "Milestones", value: <span className="text-xs">{[["Confirmed", b.confirmedAt], ["Assigned", b.assignedAt], ["Picked up", b.pickedUpAt], ["Delivered", b.deliveredAt], ["Completed", b.completedAt], ["Cancelled", b.cancelledAt]].filter(([, v]) => v).map(([l, v]) => `${l} ${formatDateTime(v as Date)}`).join(" · ") || "—"}</span> },
              ]} />
              {b.adminNotes && <Alert tone="info" title="Internal notes" className="mt-5">{b.adminNotes}</Alert>}
              {b.cancellationReason && <Alert tone="warning" title="Cancellation reason" className="mt-5">{b.cancellationReason}</Alert>}
            </div>
          </Card>

          <Card>
            <CardHeader title="Timeline" />
            <div className="p-5"><Timeline events={detail.events} /></div>
          </Card>
        </div>

        <div>
          <BookingManager
            booking={{ id: b.id, status: b.status, driverId: b.driverId, vehicleId: b.vehicleId, vehicleTypeId: b.vehicleTypeId, weightKg: b.weightKg, pallets: b.pallets, quotedPriceCents: b.quotedPriceCents, finalPriceCents: b.finalPriceCents, adminNotes: b.adminNotes }}
            drivers={drivers.map((d) => ({ id: d.id, name: d.name, vehicleId: d.vehicleId, vehicleRegistration: d.vehicleRegistration, activeJobs: d.activeJobs, status: d.status, availability: d.availability, dispatchStatus: d.dispatchStatus, currentJob: d.currentJob }))}
            vehicles={vehicles}
          />
        </div>
      </div>
    </>
  );
}
