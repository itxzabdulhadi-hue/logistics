import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BookingsTable } from "@/components/bookings-table";
import { Alert, Card, CardHeader, LinkButton, PageHeader, StatCard } from "@/components/ui";
import { isStaff, requireUser } from "@/lib/auth";
import { formatDateTime, formatMoney } from "@/lib/utils";
import { getCustomerStats, listBookings } from "@/services/bookings";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  if (isStaff(user.role)) redirect("/admin");

  const [stats, recent] = await Promise.all([
    getCustomerStats(user.id),
    listBookings({ customerId: user.id, pageSize: 6 }),
  ]);
  const firstName = user.name.split(" ")[0];

  return (
    <>
      <PageHeader
        eyebrow={user.companyName ?? "Customer"}
        title={`G'day, ${firstName}`}
        description="Here's what's happening with your deliveries."
        actions={<LinkButton href="/bookings/new" size="lg">+ Book a truck</LinkButton>}
      />

      {user.role === "driver" && (
        <Alert tone="info" title="Driver tools are planned for a future phase" className="mb-6">
          Your account has the driver role. For now, dispatch will progress your assigned jobs.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active jobs" value={stats.active} tone="orange" hint="Pending through delivered" />
        <StatCard label="Completed" value={stats.completed} tone="green" hint={`${stats.total} bookings in total`} />
        <StatCard label="Total spend" value={formatMoney(stats.spendCents)} tone="blue" hint="Excludes cancelled jobs" />
        <StatCard
          label="Next pickup"
          value={stats.nextPickup ? formatDateTime(stats.nextPickup.scheduledAt).split(",")[0] : "—"}
          tone="amber"
          hint={
            stats.nextPickup ? (
              <Link href={`/bookings/${stats.nextPickup.id}`} className="font-medium text-orange-600 hover:underline">
                {stats.nextPickup.reference} · {formatDateTime(stats.nextPickup.scheduledAt)}
              </Link>
            ) : (
              "Nothing scheduled"
            )
          }
        />
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Recent bookings"
          action={
            <Link href="/bookings" className="text-sm font-medium text-orange-600 hover:text-orange-700">
              View all →
            </Link>
          }
        />
        <BookingsTable
          rows={recent.rows}
          hrefBase="/bookings"
          emptyTitle="No bookings yet"
          emptyDescription="Create your first booking and get an instant quote."
        />
      </Card>
    </>
  );
}
