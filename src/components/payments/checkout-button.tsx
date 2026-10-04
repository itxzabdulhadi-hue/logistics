"use client";

import { useState } from "react";
import { Alert, Button } from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";

export function CheckoutButton({ bookingId }: { bookingId: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function beginCheckout() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ url: string }>("/api/payments/checkout", {
        method: "POST",
        body: { bookingId },
      });
      window.location.assign(result.url);
    } catch (requestError) {
      setError(errorMessage(requestError, "Unable to start checkout."));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button onClick={() => void beginCheckout()} loading={busy}>Pay outstanding balance</Button>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
