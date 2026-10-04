import type { Metadata } from "next";
import Link from "next/link";
import { DriverAvailabilityControl } from "@/components/driver/availability-control";
import { DriverJobActions } from "@/components/driver/driver-job-actions";
import { DriverLocationTracker } from "@/components/driver/driver-location-tracker";
import { DriverStopProgress } from "@/components/driver/driver-stop-progress";
import { RouteMap } from "@/components/route-map";
import { Badge, Card, CardHeader, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { formatDateTime, formatDuration, formatKm } from "@/lib/utils";
import { listDriverJobs } from "@/services/bookings";
import { listDrivers } from "@/services/users";

export const metadata: Metadata = { title: "My jobs" };
export const dynamic = "force-dynamic";

export default async function DriverHomePage() {
  const user = await requireRole(["driver"]);
  const [drivers, jobs] = await Promise.all([listDrivers(), listDriverJobs(user.id)]);
  const driver = drivers.find((item) => item.id === user.id);

  return (
    <>
      <PageHeader
        eyebrow="Driver workspace"
        title={`G'day, ${user.name.split(" ")[0]}`}
        description="Your active assignments, route details and job progress."
        actions={<Link href="/profile" className="text-sm font-semibold text-orange-700 hover:underline">Edit profile →</Link>}
      />
      {driver && <div className="mb-6"><DriverAvailabilityControl availability={driver.availability} activeJobs={driver.activeJobs} /></div>}

      <div className="space-y-5">
        {jobs.length === 0 ? (
          <Card><EmptyState title="No active jobs assigned" description="When dispatch assigns you a job, the route and next actions will appear here." /></Card>
        ) : (
          jobs.map((job) => {
            const directions = new URL("https://www.google.com/maps/dir/");
            directions.searchParams.set("api", "1");
            directions.searchParams.set("origin", job.pickupAddress);
            directions.searchParams.set("destination", job.dropoffAddress);
            if (job.additionalStops.length) directions.searchParams.set("waypoints", job.additionalStops.map((stop) => stop.address).join("|"));
            directions.searchParams.set("travelmode", "driving");
            const routeWaypoints = [
              job.pickupLat != null && job.pickupLng != null ? { lat: job.pickupLat, lng: job.pickupLng } : null,
              ...job.additionalStops.map(({ lat, lng }) => ({ lat, lng })),
              job.dropoffLat != null && job.dropoffLng != null ? { lat: job.dropoffLat, lng: job.dropoffLng } : null,
            ].filter((point): point is { lat: number; lng: number } => point != null);
            const routeGeometry = job.routeGeometry.length > 1 ? job.routeGeometry : routeWaypoints;
            const currentLocation =
              job.locationLatitude != null && job.locationLongitude != null
                ? { lat: job.locationLatitude, lng: job.locationLongitude }
                : null;

            return (
              <Card key={job.id}>
                <CardHeader
                  title={job.reference}
                  description={`${job.customerName} · ${formatDateTime(job.scheduledAt)}${job.routeOptimized ? " · Optimized stop order" : ""}`}
                  action={<div className="flex items-center gap-2"><StatusBadge status={job.status} /><a href={directions.toString()} target="_blank" rel="noreferrer" className="text-xs font-semibold text-orange-700 hover:underline">Directions ↗</a></div>}
                />
                <div className="grid gap-6 p-5 lg:grid-cols-[1fr_280px]">
                  <div className="space-y-5">
                    {routeGeometry.length > 0 && (
                      <RouteMap geometry={routeGeometry} waypoints={routeWaypoints} currentLocation={currentLocation} />
                    )}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Stop label="Pickup" address={job.pickupAddress} contact={job.pickupContactName} phone={job.pickupContactPhone} instructions={job.pickupInstructions} tone="green" />
                      {job.additionalStops.map((stop, stopIndex) => (
                        <Stop key={`${job.id}-stop-${stopIndex}`} label={`Stop ${stopIndex + 1}`} address={stop.address} tone="slate" />
                      ))}
                      <Stop label="Delivery" address={job.dropoffAddress} contact={job.dropoffContactName} phone={job.dropoffContactPhone} instructions={job.dropoffInstructions} tone="orange" />
                    </div>
                    {job.customerNotes && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600"><span className="font-semibold">Customer note:</span> {job.customerNotes}</p>}
                  </div>

                  <div className="space-y-4 rounded-xl bg-slate-50 p-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vehicle</p>
                      <p className="mt-1 font-semibold text-slate-900">{job.vehicleTypeName}{job.vehicleRegistration ? ` · ${job.vehicleRegistration}` : ""}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Load</p>
                      <p className="mt-1 text-sm font-medium text-slate-900">{job.loadDescription}</p>
                      <p className="mt-1 text-xs text-slate-500">{job.weightKg != null ? `${job.weightKg.toLocaleString()} kg · ` : ""}{job.pallets} pallets{job.itemCount != null ? ` · ${job.itemCount} items` : ""}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs text-slate-600">
                      <div><p className="font-semibold text-slate-500">Distance</p><p className="mt-1">{formatKm(job.distanceKm)}</p></div>
                      <div><p className="font-semibold text-slate-500">Drive estimate</p><p className="mt-1">{job.estimatedDurationMinutes == null ? "—" : formatDuration(job.estimatedDurationMinutes * 60)}</p></div>
                    </div>
                    {job.isAsap && <Badge tone="red">Priority · ASAP</Badge>}
                  </div>
                </div>
                <DriverStopProgress bookingId={job.id} bookingStatus={job.status} stops={job.additionalStops} />
                <DriverLocationTracker bookingId={job.id} status={job.status} />
                <DriverJobActions bookingId={job.id} status={job.status} stops={job.additionalStops} />
              </Card>
            );
          })
        )}
      </div>
    </>
  );
}

function Stop({
  label,
  address,
  contact,
  phone,
  instructions,
  tone,
}: {
  label: string;
  address: string;
  contact?: string | null;
  phone?: string | null;
  instructions?: string | null;
  tone: "green" | "orange" | "slate";
}) {
  const marker = tone === "green" ? "bg-emerald-500" : tone === "orange" ? "bg-orange-500" : "bg-slate-400";
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><span className={`h-2.5 w-2.5 rounded-full ${marker}`} />{label}</div>
      <p className="mt-2 text-sm font-semibold text-slate-900">{address}</p>
      {(contact || phone) && <p className="mt-1 text-xs text-slate-600">{[contact, phone].filter(Boolean).join(" · ")}</p>}
      {instructions && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{instructions}</p>}
    </div>
  );
}
