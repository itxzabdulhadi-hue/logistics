import type { Metadata } from "next";
import { BookingsTable } from "@/components/bookings-table";
import { Button, Card, Input, LinkButton, PageHeader, Pagination, Select } from "@/components/ui";
import type { BookingStatus } from "@/db/schema";
import { requireRole } from "@/lib/auth";
import { BOOKING_STATUSES, STATUS_META } from "@/lib/booking-rules";
import { listBookings } from "@/services/bookings";

export const metadata: Metadata = { title: "Bookings" };
export const dynamic = "force-dynamic";

export default async function AdminBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string; customerId?: string }>;
}) {
  await requireRole(["admin", "dispatcher"]);
  const sp = await searchParams;
  const status = BOOKING_STATUSES.includes(sp.status as BookingStatus) ? (sp.status as BookingStatus) : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const q = sp.q?.trim() || undefined;
  const customerId = Number(sp.customerId) || undefined;
  const result = await listBookings({ status, q, customerId, page, pageSize: 20 });

  return (
    <>
      <PageHeader title="Bookings" description={`${result.total} job${result.total === 1 ? "" : "s"} match the current filters.`} />
      <Card>
        <form className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-5 py-4" method="get">
          {customerId && <input type="hidden" name="customerId" value={customerId} />}
          <div className="w-full sm:w-72"><Input name="q" defaultValue={q} placeholder="Reference, address, customer…" /></div>
          <div className="w-full sm:w-52">
            <Select name="status" defaultValue={status ?? ""}>
              <option value="">All statuses</option>
              {BOOKING_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </Select>
          </div>
          <Button type="submit" variant="secondary">Filter</Button>
          {(q || status || customerId) && <LinkButton href="/admin/bookings" variant="ghost">Clear</LinkButton>}
        </form>
        <BookingsTable rows={result.rows} hrefBase="/admin/bookings" showCustomer emptyTitle="No bookings match" emptyDescription="Try another status or clear the search." />
        {result.total > 0 && (
          <Pagination page={result.page} totalPages={result.totalPages} total={result.total} basePath="/admin/bookings" params={{ q, status, customerId: customerId ? String(customerId) : undefined }} />
        )}
      </Card>
    </>
  );
}
