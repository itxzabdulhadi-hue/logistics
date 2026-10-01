import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { UserStatusToggle } from "@/components/admin/user-status-toggle";
import { BookingsTable } from "@/components/bookings-table";
import { Alert, Badge, Card, CardHeader, DescriptionList, PageHeader, StatCard } from "@/components/ui";
import { hasPermission, requireRole } from "@/lib/auth";
import { formatDateTime, formatMoney } from "@/lib/utils";
import { listBookings } from "@/services/bookings";
import { getCustomerDetail } from "@/services/users";

export const metadata: Metadata = { title: "Customer" };
export const dynamic = "force-dynamic";

export default async function AdminCustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireRole(["admin", "dispatcher"]);
  const { id } = await params;
  const customerId = Number(id);
  if (!Number.isInteger(customerId)) notFound();
  const [customer, bookings] = await Promise.all([getCustomerDetail(customerId), listBookings({ customerId, pageSize: 25 })]);
  if (!customer) notFound();

  return (
    <>
      <div className="mb-4 text-sm"><Link href="/admin/customers" className="text-slate-500 hover:text-slate-900">← All customers</Link></div>
      <PageHeader
        eyebrow={customer.companyName ?? "Individual customer"}
        title={customer.name}
        description={`Customer since ${formatDateTime(customer.createdAt)}`}
        actions={
          <div className="flex items-center gap-3">
            {customer.status === "active" ? <Badge tone="green" className="px-3 py-1 text-sm">Active</Badge> : <Badge tone="red" className="px-3 py-1 text-sm">Suspended</Badge>}
            <UserStatusToggle userId={customer.id} status={customer.status} canManage={hasPermission(staff.role, "customers:manage")} />
          </div>
        }
      />
      {customer.status === "suspended" && <Alert tone="warning" className="mb-6">This account is suspended — the customer cannot sign in or create bookings.</Alert>}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Bookings" value={customer.bookingCount} tone="slate" />
        <StatCard label="Active jobs" value={customer.activeJobs} tone="orange" />
        <StatCard label="Lifetime spend" value={formatMoney(customer.spendCents)} tone="green" hint="Excludes cancelled / failed" />
      </div>

      <Card className="mt-6">
        <CardHeader title="Contact details" />
        <div className="p-5">
          <DescriptionList columns={3} items={[
            { label: "Email", value: customer.email },
            { label: "Phone", value: customer.phone ?? "—" },
            { label: "Company", value: customer.companyName ?? "—" },
            { label: "Last login", value: formatDateTime(customer.lastLoginAt) },
            { label: "Role", value: customer.role },
            { label: "Customer ID", value: `#${customer.id}` },
          ]} />
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Booking history" action={<Link href={`/admin/bookings?customerId=${customer.id}`} className="text-sm font-medium text-orange-600 hover:text-orange-700">Filter all bookings →</Link>} />
        <BookingsTable rows={bookings.rows} hrefBase="/admin/bookings" emptyTitle="No bookings for this customer yet" emptyAction={<span />} />
      </Card>
    </>
  );
}
