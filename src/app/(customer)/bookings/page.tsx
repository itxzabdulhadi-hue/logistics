import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BookingsTable } from "@/components/bookings-table";
import { Button, Card, Input, LinkButton, PageHeader, Pagination, Select } from "@/components/ui";
import type { BookingStatus } from "@/db/schema";
import { isStaff, requireUser } from "@/lib/auth";
import { BOOKING_STATUSES, STATUS_META } from "@/lib/booking-rules";
import { listBookings } from "@/services/bookings";

export const metadata: Metadata = { title: "My bookings" };
export const dynamic = "force-dynamic";

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const user = await requireUser();
  if (isStaff(user.role)) redirect("/admin/bookings");
  if (user.role === "driver") redirect("/driver");
  const sp = await searchParams;
  const status = BOOKING_STATUSES.includes(sp.status as BookingStatus) ? (sp.status as BookingStatus) : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const q = sp.q?.trim() || undefined;

  const result = await listBookings({
    customerId: user.id,
    status,
    q,
    page,
    pageSize: 15,
  });

  return (
    <>
      <PageHeader title="My bookings" description="Every job you've booked, newest first." actions={<LinkButton href="/bookings/new">+ Book a truck</LinkButton>} />
      <Card>
        <form className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-5 py-4" method="get">
          <div className="w-full sm:w-64">
            <Input name="q" defaultValue={q} placeholder="Search reference or address" />
          </div>
          <div className="w-full sm:w-52">
            <Select name="status" defaultValue={status ?? ""}>
              <option value="">All statuses</option>
              {BOOKING_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_META[s].label}</option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="secondary">Filter</Button>
          {(q || status) && <LinkButton href="/bookings" variant="ghost">Clear</LinkButton>}
        </form>
        <BookingsTable
          rows={result.rows}
          hrefBase="/bookings"
          emptyTitle={q || status ? "No bookings match your filters" : "No bookings yet"}
          emptyDescription={q || status ? "Try clearing the search or choosing another status." : "Create your first booking and get an instant quote."}
        />
        {result.total > 0 && (
          <Pagination page={result.page} totalPages={result.totalPages} total={result.total} basePath="/bookings" params={{ q, status }} />
        )}
      </Card>
    </>
  );
}
