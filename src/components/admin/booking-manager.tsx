"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BookingStatus } from "@/db/schema";
import { Alert, Button, Card, CardHeader, Field, Input, Select, Textarea } from "@/components/ui";
import { STATUS_META, TRANSITIONS, TRANSITION_LABELS } from "@/lib/booking-rules";
import { api, errorMessage, fieldErrors } from "@/lib/client-api";

type Driver = { id: number; name: string; vehicleId: number | null; vehicleRegistration: string | null; activeJobs: number; status: string };
type Vehicle = { id: number; registration: string; typeName: string; status: string; driverId: number | null; vehicleTypeId: number };

type Props = {
  booking: {
    id: number;
    status: BookingStatus;
    driverId: number | null;
    vehicleId: number | null;
    vehicleTypeId: number;
    quotedPriceCents: number;
    finalPriceCents: number | null;
    adminNotes: string | null;
  };
  drivers: Driver[];
  vehicles: Vehicle[];
};

export function BookingManager({ booking, drivers, vehicles }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [driverId, setDriverId] = useState<string>(booking.driverId ? String(booking.driverId) : "");
  const [vehicleId, setVehicleId] = useState<string>(booking.vehicleId ? String(booking.vehicleId) : "");
  const [finalPrice, setFinalPrice] = useState<string>(booking.finalPriceCents != null ? (booking.finalPriceCents / 100).toFixed(2) : "");
  const [adminNotes, setAdminNotes] = useState(booking.adminNotes ?? "");

  const next = TRANSITIONS[booking.status].filter((s) => s !== "assigned");
  const canAssign = ["pending", "confirmed", "assigned"].includes(booking.status);

  async function act(key: string, body: Record<string, unknown>) {
    setBusy(key);
    setError(null);
    setFields({});
    try {
      await api(`/api/bookings/${booking.id}`, { method: "PATCH", body });
      setNote("");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setFields(fieldErrors(err));
    } finally {
      setBusy(null);
    }
  }

  function pickDriver(id: string) {
    setDriverId(id);
    const d = drivers.find((x) => String(x.id) === id);
    if (d?.vehicleId) setVehicleId(String(d.vehicleId));
  }

  const matchingVehicles = vehicles.filter((v) => v.vehicleTypeId === booking.vehicleTypeId);
  const otherVehicles = vehicles.filter((v) => v.vehicleTypeId !== booking.vehicleTypeId);

  return (
    <div className="space-y-6">
      {error && <Alert tone="error">{error}</Alert>}

      <Card>
        <CardHeader title="Workflow" description={`Currently ${STATUS_META[booking.status].label.toLowerCase()}. ${STATUS_META[booking.status].description}.`} />
        <div className="space-y-4 p-5">
          {next.length === 0 ? (
            <p className="text-sm text-slate-500">This job is in a terminal state — no further transitions.</p>
          ) : (
            <>
              <Field label="Note for the timeline" hint="Required when cancelling or failing a job.">
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Visible to the customer" />
              </Field>
              <div className="flex flex-wrap gap-2">
                {next.map((s) => {
                  const destructive = s === "cancelled" || s === "failed";
                  const isUnassign = booking.status === "assigned" && s === "confirmed";
                  return (
                    <Button
                      key={s}
                      variant={destructive ? "danger" : isUnassign ? "secondary" : s === "completed" ? "dark" : "primary"}
                      loading={busy === s}
                      disabled={busy !== null || (destructive && note.trim().length === 0)}
                      onClick={() =>
                        isUnassign
                          ? act(s, { action: "unassign", note: note || undefined })
                          : act(s, { action: "transition", status: s, note: note || undefined })
                      }
                    >
                      {isUnassign ? "Unassign driver" : TRANSITION_LABELS[s]}
                    </Button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </Card>

      {canAssign && (
        <Card>
          <CardHeader title={booking.driverId ? "Reassign driver & vehicle" : "Assign driver & vehicle"} description="Assigning also confirms a pending job." />
          <div className="space-y-4 p-5">
            <Field label="Driver" error={fields.driverId} required>
              <Select value={driverId} onChange={(e) => pickDriver(e.target.value)}>
                <option value="">Select a driver…</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id} disabled={d.status !== "active"}>
                    {d.name}
                    {d.vehicleRegistration ? ` · ${d.vehicleRegistration}` : ""} · {d.activeJobs} active job{d.activeJobs === 1 ? "" : "s"}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Vehicle" error={fields.vehicleId} hint="Defaults to the driver's usual vehicle.">
              <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                <option value="">Driver&apos;s own vehicle / decide later</option>
                {matchingVehicles.length > 0 && (
                  <optgroup label="Matching vehicle class">
                    {matchingVehicles.map((v) => (
                      <option key={v.id} value={v.id}>{v.registration} · {v.typeName} ({v.status.replace("_", " ")})</option>
                    ))}
                  </optgroup>
                )}
                {otherVehicles.length > 0 && (
                  <optgroup label="Other classes">
                    {otherVehicles.map((v) => (
                      <option key={v.id} value={v.id}>{v.registration} · {v.typeName} ({v.status.replace("_", " ")})</option>
                    ))}
                  </optgroup>
                )}
              </Select>
            </Field>
            <Button
              variant="dark"
              loading={busy === "assign"}
              disabled={busy !== null || !driverId}
              onClick={() => act("assign", { action: "assign", driverId: Number(driverId), vehicleId: vehicleId ? Number(vehicleId) : undefined, note: note || undefined })}
            >
              {booking.driverId ? "Update assignment" : "Assign & confirm"}
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Pricing & internal notes" description="Internal notes are never shown to the customer." />
        <div className="space-y-4 p-5">
          <Field label="Final price (AUD, inc. GST)" error={fields.finalPriceCents} hint={`Quoted ${(booking.quotedPriceCents / 100).toLocaleString("en-AU", { style: "currency", currency: "AUD" })}. Leave blank to bill the quoted price.`}>
            <Input type="number" min={0} step="0.01" value={finalPrice} onChange={(e) => setFinalPrice(e.target.value)} placeholder={(booking.quotedPriceCents / 100).toFixed(2)} />
          </Field>
          <Field label="Internal notes" error={fields.adminNotes}>
            <Textarea value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} placeholder="Key account, access issues, tolls, waiting time…" />
          </Field>
          <Button
            variant="secondary"
            loading={busy === "update"}
            disabled={busy !== null}
            onClick={() =>
              act("update", {
                action: "update",
                finalPriceCents: finalPrice.trim() === "" ? null : Math.round(Number(finalPrice) * 100),
                adminNotes,
              })
            }
          >
            Save pricing & notes
          </Button>
        </div>
      </Card>
    </div>
  );
}
