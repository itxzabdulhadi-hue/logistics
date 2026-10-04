"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Badge, Button, Card, CardHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";

export function DriverAvailabilityControl({
  availability,
  activeJobs,
}: {
  availability: "available" | "off_duty";
  activeJobs: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setAvailability(next: "available" | "off_duty") {
    setBusy(true);
    setError(null);
    try {
      await api("/api/driver/availability", { method: "PATCH", body: { availability: next } });
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Your availability"
        description="Dispatch can assign new jobs while you are on duty and have no open assignment."
        action={availability === "available" ? <Badge tone={activeJobs > 0 ? "blue" : "green"}>{activeJobs > 0 ? "Assigned" : "On duty"}</Badge> : <Badge tone="slate">Off duty</Badge>}
      />
      <div className="flex flex-wrap items-center justify-between gap-4 p-5">
        <p className="max-w-xl text-sm text-slate-600">
          {activeJobs > 0
            ? `You have ${activeJobs} active assignment${activeJobs === 1 ? "" : "s"}. Finish or ask dispatch to reassign your current job before going off duty.`
            : availability === "available"
              ? "You are visible to dispatch for a compatible job."
              : "You are not available for new dispatches."}
        </p>
        {availability === "available" ? (
          <Button variant="secondary" loading={busy} disabled={busy || activeJobs > 0} onClick={() => setAvailability("off_duty")}>Go off duty</Button>
        ) : (
          <Button loading={busy} disabled={busy} onClick={() => setAvailability("available")}>Go on duty</Button>
        )}
      </div>
      {error && <div className="px-5 pb-5"><Alert tone="error">{error}</Alert></div>}
    </Card>
  );
}
