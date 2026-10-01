"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Field, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";

export function CancelBookingButton({ bookingId }: { bookingId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setLoading(true);
    setError(null);
    try {
      await api(`/api/bookings/${bookingId}`, { method: "PATCH", body: { action: "cancel", reason } });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Cancel booking
      </Button>
    );
  }
  return (
    <div className="w-full rounded-xl border border-red-200 bg-red-50/50 p-4">
      <p className="text-sm font-semibold text-slate-900">Cancel this booking?</p>
      <p className="mt-0.5 text-xs text-slate-600">Free of charge while no driver is on the way.</p>
      {error && <Alert tone="error" className="mt-3">{error}</Alert>}
      <Field label="Reason (optional)" className="mt-3">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Let dispatch know why" />
      </Field>
      <div className="mt-3 flex gap-2">
        <Button variant="danger" onClick={cancel} loading={loading}>
          Yes, cancel booking
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={loading}>
          Keep booking
        </Button>
      </div>
    </div>
  );
}
