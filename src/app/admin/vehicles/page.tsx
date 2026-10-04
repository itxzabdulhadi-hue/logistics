import type { Metadata } from "next";
import { VehicleTypesManager, VehiclesManager } from "@/components/admin/fleet-manager";
import { PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { listVehicleTypes, listVehicles } from "@/services/fleet";
import { listDrivers } from "@/services/users";

export const metadata: Metadata = { title: "Vehicles" };
export const dynamic = "force-dynamic";

export default async function AdminVehiclesPage() {
  await requireRole(["admin", "dispatcher"]);
  const [vehicles, vehicleTypes, drivers] = await Promise.all([listVehicles(), listVehicleTypes(), listDrivers()]);
  return (
    <>
      <PageHeader title="Fleet" description="Manage physical vehicles and the vehicle classes customers can book." />
      <div className="space-y-6">
        <VehiclesManager vehicles={vehicles} vehicleTypes={vehicleTypes} drivers={drivers.map((d) => ({ id: d.id, name: d.name, vehicleId: d.vehicleId, status: d.status }))} />
        <VehicleTypesManager vehicleTypes={vehicleTypes} />
      </div>
    </>
  );
}
