import Link from "next/link";
import { EmptyState, LinkButton, RouteSummary, StatusBadge } from "@/components/ui";
import { formatDateTime, formatMoney } from "@/lib/utils";
import type { BookingListRow } from "@/services/bookings";

export function BookingsTable({
  rows,
  hrefBase,
  showCustomer = false,
  emptyTitle = "No bookings yet",
  emptyDescription,
  emptyAction,
}: {
  rows: BookingListRow[];
  hrefBase: string;
  showCustomer?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction ?? (!showCustomer ? <LinkButton href="/bookings/new">Book a truck</LinkButton> : undefined)}
      />
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-100 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-5 py-3">Job</th>
            {showCustomer && <th className="px-5 py-3">Customer</th>}
            <th className="px-5 py-3">Route</th>
            <th className="px-5 py-3">Pickup</th>
            <th className="px-5 py-3">Vehicle</th>
            <th className="px-5 py-3">Status</th>
            <th className="px-5 py-3 text-right">Price</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((b) => (
            <tr key={b.id} className="hover:bg-slate-50/70">
              <td className="whitespace-nowrap px-5 py-3">
                <Link href={`${hrefBase}/${b.id}`} className="font-semibold text-slate-900 hover:text-orange-600">
                  {b.reference}
                </Link>
                <div className="text-xs text-slate-500">{formatDateTime(b.createdAt)}</div>
              </td>
              {showCustomer && (
                <td className="px-5 py-3">
                  <div className="font-medium text-slate-900">{b.customerName}</div>
                  {b.customerCompany && <div className="text-xs text-slate-500">{b.customerCompany}</div>}
                </td>
              )}
              <td className="max-w-xs px-5 py-3">
                <RouteSummary pickup={b.pickupAddress} dropoff={b.dropoffAddress} compact />
              </td>
              <td className="whitespace-nowrap px-5 py-3 text-slate-700">
                {formatDateTime(b.scheduledAt)}
                {b.isAsap && <span className="ml-1 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-700">ASAP</span>}
              </td>
              <td className="whitespace-nowrap px-5 py-3 text-slate-700">
                {b.vehicleTypeName}
                {b.driverName && <div className="text-xs text-slate-500">{b.driverName}</div>}
              </td>
              <td className="whitespace-nowrap px-5 py-3">
                <StatusBadge status={b.status} />
              </td>
              <td className="whitespace-nowrap px-5 py-3 text-right font-semibold text-slate-900">
                {formatMoney(b.finalPriceCents ?? b.quotedPriceCents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
