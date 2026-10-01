import type { Metadata } from "next";
import Link from "next/link";
import { BookingsTable } from "@/components/bookings-table";
import { Card, CardHeader, EmptyState, LinkButton, PageHeader, StatCard, StatusBadge } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { BOOKING_STATUSES, STATUS_META } from "@/lib/booking-rules";
import { formatDateTime, formatMoney } from "@/lib/utils";
import { getAdminStats, listAttentionBookings, listBookings } from "@/services/bookings";

export const metadata: Metadata = { title: "Dispatch console" };
export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const user = await requireRole(["admin", "dispatcher"]);
  const [stats, attention, recent] = await Promise.all([
    getAdminStats(),
    listAttentionBookings(8),
    listBookings({ pageSize: 8 }),
  ]);
  const byStatus = Object.fromEntries(stats.byStatus.map((r) => [r.status, r.count]));

  return (
    <>
      <PageHeader
        eyebrow="Dispatch console"
        title={`Welcome back, ${user.name.split(" ")[0]}`}
        description="Operational overview across all customers, jobs and fleet."
        actions={<LinkButton href="/admin/bookings?status=pending" variant="dark">Review pending jobs</LinkButton>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Needs dispatch" value={stats.jobs.pending} tone="amber" hint="Pending customer bookings" />
        <StatCard label="Active jobs" value={stats.jobs.active} tone="orange" hint={`${stats.jobs.today} scheduled today`} />
        <StatCard label="Revenue this month" value={formatMoney(stats.jobs.revenueMonthCents)} tone="green" hint={`${stats.jobs.completedMonth} completed · ${formatMoney(stats.jobs.pipelineCents)} in pipeline`} />
        <StatCard label="Fleet" value={`${stats.fleet.available}/${stats.fleet.total}`} tone="blue" hint={`vehicles available · ${stats.people.drivers} active drivers · ${stats.people.customers} customers`} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader title="Needs attention" description="Pending jobs and confirmed/assigned jobs past their pickup time." action={<Link href="/admin/bookings?status=pending" className="text-sm font-medium text-orange-600 hover:text-orange-700">All pending →</Link>} />
          {attention.length === 0 ? (
            <EmptyState title="All clear" description="No jobs waiting on dispatch right now." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {attention.map((b) => (
                <li key={b.id}>
                  <Link href={`/admin/bookings/${b.id}`} className="flex flex-wrap items-center gap-4 px-5 py-3 hover:bg-slate-50">
                    <div className="min-w-[120px]">
                      <div className="font-semibold text-slate-900">{b.reference}</div>
                      <div className="text-xs text-slate-500">{b.customerName}</div>
                    </div>
                    <div className="min-w-0 flex-1 text-sm text-slate-700">
                      <div className="truncate">{b.pickupAddress}</div>
                      <div className="truncate text-xs text-slate-500">→ {b.dropoffAddress}</div>
                    </div>
                    <div className="text-right text-xs text-slate-600">
                      <div className="font-medium text-slate-900">{formatDateTime(b.scheduledAt)}{b.isAsap && <span className="ml-1 rounded bg-orange-100 px-1 text-[10px] font-bold text-orange-700">ASAP</span>}</div>
                      <div>{b.vehicleTypeName} · {formatMoney(b.quotedPriceCents)}</div>
                    </div>
                    <StatusBadge status={b.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Jobs by status" />
          <ul className="divide-y divide-slate-100">
            {BOOKING_STATUSES.map((s) => (
              <li key={s}>
                <Link href={`/admin/bookings?status=${s}`} className="flex items-center justify-between px-5 py-2.5 text-sm hover:bg-slate-50">
                  <StatusBadge status={s} />
                  <span className="font-semibold text-slate-900">{byStatus[s] ?? 0}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="px-5 py-3 text-xs text-slate-500">{stats.jobs.total} jobs total · {STATUS_META.completed.label.toLowerCase()} = closed &amp; invoiced</p>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Latest bookings" action={<Link href="/admin/bookings" className="text-sm font-medium text-orange-600 hover:text-orange-700">All bookings →</Link>} />
        <BookingsTable rows={recent.rows} hrefBase="/admin/bookings" showCustomer emptyTitle="No bookings yet" />
      </Card>
    </>
  );
}
