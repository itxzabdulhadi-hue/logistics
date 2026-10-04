"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BookingStop, BookingStatus, BookingStopStatus } from "@/db/schema";
import { Alert, Button } from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";

type Props = {
  bookingId: number;
  bookingStatus: BookingStatus;
  stops: BookingStop[];
};

const STATUS_LABEL: Record<BookingStopStatus, string> = {
  pending: "Upcoming",
  arrived: "Arrived",
  completed: "Completed",
};

function stopStatus(stop: BookingStop): BookingStopStatus {
  return stop.status ?? "pending";
}

function timeLabel(value?: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function DriverStopProgress({ bookingId, bookingStatus, stops }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"arrived" | "completed" | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (stops.length === 0) return null;

  const nextIndex = stops.findIndex((stop) => stopStatus(stop) !== "completed");
  const nextStop = nextIndex >= 0 ? stops[nextIndex] : null;
  const nextStatus = nextStop ? stopStatus(nextStop) : null;

  async function updateStop(stopIndex: number, status: "arrived" | "completed") {
    setBusy(status);
    setError(null);
    try {
      await api(`/api/bookings/${bookingId}`, {
        method: "PATCH",
        body: { action: "stop", stopIndex, status },
      });
      router.refresh();
    } catch (requestError) {
      setError(errorMessage(requestError, "Unable to update this delivery stop."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mx-5 mb-4 rounded-xl border border-slate-200 bg-white p-4" aria-label="Delivery stop progress">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Delivery stop progress</h3>
          <p className="mt-1 text-xs text-slate-500">Complete each stop in the planned order before marking the final delivery.</p>
        </div>
        <span className="text-xs font-medium text-slate-500">{stops.filter((stop) => stopStatus(stop) === "completed").length} of {stops.length} complete</span>
      </div>

      {error && <div className="mt-3"><Alert tone="error">{error}</Alert></div>}
      <ol className="mt-3 divide-y divide-slate-100">
        {stops.map((stop, index) => {
          const status = stopStatus(stop);
          const isNext = index === nextIndex;
          const time = status === "completed" ? timeLabel(stop.completedAt) : timeLabel(stop.arrivedAt);
          return (
            <li key={`${bookingId}-stop-${index}`} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="flex min-w-0 items-start gap-3">
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${status === "completed" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
                  {status === "completed" ? "✓" : index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-900">Delivery stop {index + 1} · {STATUS_LABEL[status]}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{stop.address}</p>
                  {time && <p className="mt-0.5 text-[11px] text-slate-400">{status === "completed" ? "Completed" : "Arrived"} at {time}</p>}
                </div>
              </div>

              {isNext && bookingStatus === "in_transit" && nextStatus === "pending" && (
                <Button size="sm" variant="secondary" loading={busy === "arrived"} disabled={busy !== null} onClick={() => void updateStop(index, "arrived")}>
                  Mark arrived
                </Button>
              )}
              {isNext && bookingStatus === "in_transit" && nextStatus === "arrived" && (
                <Button size="sm" variant="dark" loading={busy === "completed"} disabled={busy !== null} onClick={() => void updateStop(index, "completed")}>
                  Complete stop
                </Button>
              )}
            </li>
          );
        })}
      </ol>
      {bookingStatus !== "in_transit" && nextStop && (
        <p className="mt-3 text-xs text-slate-500">Stop actions unlock after you depart for delivery.</p>
      )}
    </section>
  );
}
