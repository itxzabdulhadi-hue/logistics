import type { Metadata } from "next";
import { DriversManager } from "@/components/admin/fleet-manager";
import { PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { listDrivers } from "@/services/users";

export const metadata: Metadata = { title: "Drivers" };
export const dynamic = "force-dynamic";

export default async function AdminDriversPage() {
  await requireRole(["admin", "dispatcher"]);
  const drivers = await listDrivers();
  return (
    <>
      <PageHeader title="Drivers" description="Driver accounts that can be allocated to jobs." />
      <DriversManager drivers={drivers} />
    </>
  );
}
