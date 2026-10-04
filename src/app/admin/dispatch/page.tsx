import type { Metadata } from "next";
import { DispatchBoard } from "@/components/admin/dispatch-board";
import { PageHeader, StatCard } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { listUnassignedBookings } from "@/services/bookings";
import { listAssignableVehicles } from "@/services/fleet";
import { listDrivers } from "@/services/users";

export const metadata: Metadata = { title: "Dispatch board" };
export const dynamic = "force-dynamic";

export default async function DispatchPage() {
  await requireRole(["admin", "dispatcher"]);
  const [jobs, drivers] = await Promise.all([listUnassignedBookings(), listDrivers()]);
  const vehicles = await listAssignableVehicles({
    includeVehicleIds: jobs.map((job) => job.vehicleId).filter((id): id is number => id != null),
  });
  const availableDrivers = drivers.filter((driver) => driver.status === "active" && driver.dispatchStatus === "available");
  const availableVehicles = vehicles.filter((vehicle) => vehicle.status === "available");

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Dispatch board"
        description="Complete missing assignments with an on-duty driver and compatible truck; valid resources already allocated to a job remain selectable for repairs."
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Jobs needing assignment" value={jobs.length} tone="amber" hint="Pending, confirmed or incomplete assignments" />
        <StatCard label="Available drivers" value={availableDrivers.length} tone="green" hint="On duty with no active job" />
        <StatCard label="Available trucks" value={availableVehicles.length} tone="blue" hint="Excludes assigned, maintenance and inactive" />
      </div>
      <DispatchBoard jobs={jobs} drivers={drivers} vehicles={vehicles} />
    </>
  );
}
