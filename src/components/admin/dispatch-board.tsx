"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Select } from "@/components/ui";
import { api, errorMessage, fieldErrors } from "@/lib/client-api";
import { formatDateTime, formatMoney } from "@/lib/utils";

type DispatchJob = {
  id: number;
  reference: string;
  status: string;
  driverId: number | null;
  vehicleId: number | null;
  scheduledAt: Date | string;
  isAsap: boolean;
  pickupAddress: string;
  dropoffAddress: string;
  vehicleTypeId: number;
  vehicleTypeName: string;
  maxWeightKg: number;
  maxPallets: number | null;
  weightKg: number | null;
  pallets: number;
  quotedPriceCents: number;
  customerName: string;
  customerCompany: string | null;
};

type DispatchDriver = {
  id: number;
  name: string;
  status: string;
  availability: "available" | "off_duty";
  dispatchStatus: "available" | "off_duty" | "busy" | "suspended";
  activeJobs: number;
  vehicleId: number | null;
  vehicleRegistration: string | null;
  currentJob: { id: number; reference: string; status: string } | null;
};

type DispatchVehicle = {
  id: number;
  registration: string;
  status: string;
  driverId: number | null;
  vehicleTypeId: number;
  capacityKg: number | null;
  typeName: string;
  typeMaxWeightKg: number;
  typeMaxPallets: number | null;
};

export function DispatchBoard({
  jobs,
  drivers,
  vehicles,
}: {
  jobs: DispatchJob[];
  drivers: DispatchDriver[];
  vehicles: DispatchVehicle[];
}) {
  const readyDrivers = drivers.filter((driver) => driver.status === "active" && driver.dispatchStatus === "available");
  const readyVehicles = vehicles.filter((vehicle) => vehicle.status === "available");

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader
          title="Jobs awaiting assignment"
          description={`${jobs.length} job${jobs.length === 1 ? "" : "s"} need a driver or a compatible truck.`}
        />
        {jobs.length === 0 ? (
          <EmptyState title="Dispatch queue is clear" description="New bookings and incomplete assignments appear here until both a driver and compatible truck are set." />
        ) : (
          <div className="divide-y divide-slate-100">
            {jobs.map((job) => (
              <DispatchJobCard key={job.id} job={job} drivers={drivers} vehicles={vehicles} />
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Driver & truck availability"
          description={`${readyDrivers.length} ready driver${readyDrivers.length === 1 ? "" : "s"} · ${readyVehicles.length} available vehicle${readyVehicles.length === 1 ? "" : "s"}.`}
          action={<Link href="/admin/drivers" className="text-sm font-semibold text-orange-700 hover:underline">Manage drivers →</Link>}
        />
        <div className="divide-y divide-slate-100">
          {drivers.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-500">No driver accounts yet.</p>}
          {drivers.map((driver) => (
            <div key={driver.id} className="px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-slate-900">{driver.name}</p>
                <AvailabilityBadge driver={driver} />
              </div>
              <p className="mt-1 text-xs text-slate-500">{driver.vehicleRegistration ?? "No linked vehicle"}</p>
              {driver.currentJob ? (
                <Link href={`/admin/bookings/${driver.currentJob.id}`} className="mt-2 block text-xs text-orange-700 hover:underline">
                  Current job {driver.currentJob.reference} · {driver.currentJob.status.replaceAll("_", " ")}
                </Link>
              ) : (
                <p className="mt-2 text-xs text-slate-400">No active assignment</p>
              )}
            </div>
          ))}
        </div>
        <div className="border-t border-slate-100 p-5">
          <Link href="/admin/vehicles" className="text-sm font-semibold text-orange-700 hover:underline">View fleet and locations →</Link>
        </div>
      </Card>
    </div>
  );
}

function AvailabilityBadge({ driver }: { driver: DispatchDriver }) {
  if (driver.dispatchStatus === "busy") return <Badge tone="blue">Busy</Badge>;
  if (driver.dispatchStatus === "suspended") return <Badge tone="red">Suspended</Badge>;
  if (driver.dispatchStatus === "off_duty") return <Badge tone="slate">Off duty</Badge>;
  return <Badge tone="green">Available</Badge>;
}

function DispatchJobCard({
  job,
  drivers,
  vehicles,
}: {
  job: DispatchJob;
  drivers: DispatchDriver[];
  vehicles: DispatchVehicle[];
}) {
  const router = useRouter();
  const [driverId, setDriverId] = useState(job.driverId == null ? "" : String(job.driverId));
  const [vehicleId, setVehicleId] = useState(job.vehicleId == null ? "" : String(job.vehicleId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrorsByName, setFieldErrorsByName] = useState<Record<string, string>>({});

  const selectableDrivers = drivers.filter((driver) =>
    driver.status === "active" && (
      driver.dispatchStatus === "available" ||
      (job.status === "assigned" && driver.id === job.driverId && driver.activeJobs <= 1)
    ),
  );
  const selectedDriver = selectableDrivers.find((driver) => String(driver.id) === driverId);
  const compatibleVehicles = vehicles.filter((vehicle) =>
    (vehicle.status === "available" || vehicle.id === job.vehicleId) &&
    vehicle.vehicleTypeId === job.vehicleTypeId &&
    (vehicle.driverId == null || vehicle.driverId === selectedDriver?.id) &&
    (job.weightKg == null || job.weightKg <= Math.min(vehicle.capacityKg ?? vehicle.typeMaxWeightKg, vehicle.typeMaxWeightKg)) &&
    (vehicle.typeMaxPallets == null || job.pallets <= vehicle.typeMaxPallets),
  );
  const selectedVehicle = compatibleVehicles.find((vehicle) => String(vehicle.id) === vehicleId);

  function chooseDriver(nextDriverId: string) {
    setDriverId(nextDriverId);
    const driver = selectableDrivers.find((item) => String(item.id) === nextDriverId);
    const validVehicles = vehicles.filter((vehicle) =>
      (vehicle.status === "available" || vehicle.id === job.vehicleId) &&
      vehicle.vehicleTypeId === job.vehicleTypeId &&
      (vehicle.driverId == null || vehicle.driverId === driver?.id) &&
      (job.weightKg == null || job.weightKg <= Math.min(vehicle.capacityKg ?? vehicle.typeMaxWeightKg, vehicle.typeMaxWeightKg)) &&
      (vehicle.typeMaxPallets == null || job.pallets <= vehicle.typeMaxPallets),
    );
    const linkedTruck = validVehicles.find((vehicle) => vehicle.id === driver?.vehicleId);
    setVehicleId(String(linkedTruck?.id ?? validVehicles[0]?.id ?? ""));
  }

  async function assign() {
    if (!selectedDriver || !selectedVehicle) return;
    setBusy(true);
    setError(null);
    setFieldErrorsByName({});
    try {
      await api(`/api/bookings/${job.id}`, {
        method: "PATCH",
        body: { action: "assign", driverId: Number(driverId), vehicleId: Number(vehicleId) },
      });
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setFieldErrorsByName(fieldErrors(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/admin/bookings/${job.id}`} className="font-semibold text-orange-700 hover:underline">{job.reference}</Link>
            <Badge tone={job.status === "pending" ? "amber" : "blue"}>{job.status}</Badge>
            {job.isAsap && <Badge tone="red">ASAP</Badge>}
          </div>
          <p className="mt-1 text-sm font-medium text-slate-800">{job.customerCompany || job.customerName}</p>
          <p className="mt-1 text-xs text-slate-500">{job.vehicleTypeName} · {formatDateTime(job.scheduledAt)} · {formatMoney(job.quotedPriceCents)}</p>
        </div>
        <p className="max-w-sm text-right text-xs text-slate-500">{job.weightKg != null ? `${job.weightKg.toLocaleString()} kg` : "Weight not provided"} · {job.pallets} pallets</p>
      </div>

      <div className="mt-4 grid gap-1 text-sm text-slate-700">
        <p className="truncate"><span className="font-medium text-emerald-700">Pickup:</span> {job.pickupAddress}</p>
        <p className="truncate"><span className="font-medium text-orange-700">Delivery:</span> {job.dropoffAddress}</p>
      </div>

      {error && <Alert className="mt-4" tone="error">{error}</Alert>}

      <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Driver" error={fieldErrorsByName.driverId} required>
          <Select value={driverId} onChange={(event) => chooseDriver(event.target.value)}>
            <option value="">Select driver…</option>
            {selectableDrivers.map((driver) => (
              <option key={driver.id} value={driver.id}>
                {driver.name}{driver.vehicleRegistration ? ` · ${driver.vehicleRegistration}` : " · no linked truck"}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Matching truck" error={fieldErrorsByName.vehicleId} required>
          <Select value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}>
            <option value="">Select truck…</option>
            {compatibleVehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.registration} · {vehicle.typeName} · {Math.min(vehicle.capacityKg ?? vehicle.typeMaxWeightKg, vehicle.typeMaxWeightKg).toLocaleString()} kg
              </option>
            ))}
          </Select>
        </Field>
        <Button variant="dark" loading={busy} disabled={!selectedDriver || !selectedVehicle || busy} onClick={assign}>
          {job.status === "assigned" ? "Save assignment" : "Assign & confirm"}
        </Button>
      </div>
      {driverId && compatibleVehicles.length === 0 && (
        <p className="mt-3 text-xs text-amber-700">No available vehicle of this class and capacity can serve this load. Update the fleet or choose a different driver.</p>
      )}
    </article>
  );
}
