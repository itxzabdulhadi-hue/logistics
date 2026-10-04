"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BookingStatus, BookingStop } from "@/db/schema";
import { Alert, Button, Field, Textarea } from "@/components/ui";
import { DRIVER_TRANSITIONS, TRANSITION_LABELS } from "@/lib/booking-rules";
import { api, errorMessage } from "@/lib/client-api";

const DRIVER_ACTION_LABELS: Partial<Record<BookingStatus, string>> = {
  en_route_pickup: "Start route to pickup",
  picked_up: "Mark load picked up",
  in_transit: "Depart for delivery",
  delivered: "Mark delivered",
  failed: "Report a problem",
};

export function DriverJobActions({ bookingId, status, stops = [] }: { bookingId: number; status: BookingStatus; stops?: BookingStop[] }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<BookingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const transitions = DRIVER_TRANSITIONS[status] ?? [];
  const canFail = transitions.includes("failed");
  const stopsIncomplete = status === "in_transit" && stops.some((stop) => stop.status !== "completed");

  async function progress(nextStatus: BookingStatus) {
    if (nextStatus === "failed" && !note.trim()) {
      setError("Add a short reason before reporting a failed job.");
      return;
    }
    setBusy(nextStatus);
    setError(null);
    try {
      await api(`/api/bookings/${bookingId}`, {
        method: "PATCH",
        body: { action: "transition", status: nextStatus, note: note.trim() || undefined },
      });
      setNote("");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (transitions.length === 0) return null;

  return (
    <div className="space-y-3 border-t border-slate-100 px-5 py-4">
      {canFail && (
        <Field label="Problem / exception note" hint="Required if you report that the job failed.">
          <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Breakdown, access issue, refused delivery…" />
        </Field>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      {stopsIncomplete && (
        <Alert tone="warning">Complete every delivery stop in order before marking the final delivery complete.</Alert>
      )}
      <div className="flex flex-wrap gap-2">
        {transitions.map((nextStatus) => (
          <Button
            key={nextStatus}
            variant={nextStatus === "failed" ? "danger" : "dark"}
            loading={busy === nextStatus}
            disabled={busy !== null || (nextStatus === "failed" && !note.trim()) || (nextStatus === "delivered" && stopsIncomplete)}
            onClick={() => progress(nextStatus)}
          >
            {DRIVER_ACTION_LABELS[nextStatus] ?? TRANSITION_LABELS[nextStatus]}
          </Button>
        ))}
      </div>
    </div>
  );
}
