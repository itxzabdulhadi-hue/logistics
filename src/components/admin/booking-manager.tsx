"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BookingStatus } from "@/db/schema";
import { Alert, Button, Card, CardHeader, Field, Input, Select, Textarea } from "@/components/ui";
import { STATUS_META, TRANSITIONS, TRANSITION_LABELS } from "@/lib/booking-rules";
import { api, errorMessage, fieldErrors } from "@/lib/client-api";

type Driver = {
  id: number;
  name: string;
  vehicleId: number | null;
  vehicleRegistration: string | null;
  activeJobs: number;
  status: string;
  availability: "available" | "off_duty";
  dispatchStatus: "available" | "off_duty" | "busy" | "suspended";
  currentJob: { reference: string } | null;
};
type Vehicle = {
  id: number;
  registration: string;
  typeName: string;
  status: string;
  driverId: number | null;
  vehicleTypeId: number;
  capacityKg: number | null;
  typeMaxWeightKg: number;
  typeMaxPallets: number | null;
};

type Props = {
  booking: {
    id: number;
    status: BookingStatus;
    driverId: number | null;
    vehicleId: number | null;
    vehicleTypeId: number;
    weightKg: number | null;
    pallets: number;
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
    const compatible = vehicles.filter((v) =>
      (v.status === "available" || v.id === booking.vehicleId) &&
      v.vehicleTypeId === booking.vehicleTypeId &&
      (v.driverId == null || v.driverId === d?.id) &&
      (booking.weightKg == null || booking.weightKg <= Math.min(v.capacityKg ?? v.typeMaxWeightKg, v.typeMaxWeightKg)) &&
      (v.typeMaxPallets == null || booking.pallets <= v.typeMaxPallets),
    );
    const driverVehicle = compatible.find((v) => v.id === d?.vehicleId);
    setVehicleId(String(driverVehicle?.id ?? compatible[0]?.id ?? ""));
  }

  const matchingVehicles = vehicles.filter((v) =>
    v.vehicleTypeId === booking.vehicleTypeId &&
    (booking.weightKg == null || booking.weightKg <= Math.min(v.capacityKg ?? v.typeMaxWeightKg, v.typeMaxWeightKg)) &&
    (v.typeMaxPallets == null || booking.pallets <= v.typeMaxPallets),
  );
  const selectedDriver = drivers.find((d) => String(d.id) === driverId);
  const driverCanBeAssigned = selectedDriver?.status === "active" && (
    selectedDriver.dispatchStatus === "available" ||
    (booking.status === "assigned" && selectedDriver.id === booking.driverId && selectedDriver.activeJobs <= 1)
  );
  const availableForSelectedDriver = matchingVehicles.filter((v) =>
    (v.driverId == null || v.driverId === selectedDriver?.id) &&
    (v.status === "available" || v.id === booking.vehicleId),
  );
  const selectedVehicle = availableForSelectedDriver.find((v) => String(v.id) === vehicleId);

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
                      {isUnassign ? "Cancel assignment" : TRANSITION_LABELS[s]}
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
          <CardHeader title={booking.driverId ? "Reassign driver & vehicle" : "Assign driver & vehicle"} description="A compatible truck is required. Assignment confirms a pending job and reserves both resources." />
          <div className="space-y-4 p-5">
            <Field label="Driver" error={fields.driverId} required>
              <Select value={driverId} onChange={(e) => pickDriver(e.target.value)}>
                <option value="">Select an available driver…</option>
                {drivers.map((d) => (
                  <option
                    key={d.id}
                    value={d.id}
                    disabled={d.status !== "active" || (d.dispatchStatus !== "available" && d.id !== booking.driverId)}
                  >
                    {d.name} · {d.dispatchStatus.replace("_", " ")}
                    {d.vehicleRegistration ? ` · ${d.vehicleRegistration}` : " · no linked truck"}
                    {d.currentJob ? ` · ${d.currentJob.reference}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Compatible vehicle" error={fields.vehicleId} required hint={booking.weightKg ? `Load: ${booking.weightKg.toLocaleString()} kg · ${booking.pallets} pallets.` : `${booking.pallets} pallets.`}>
              <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                <option value="">Select an available truck…</option>
                {availableForSelectedDriver.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.registration} · {v.typeName} · {Math.min(v.capacityKg ?? v.typeMaxWeightKg, v.typeMaxWeightKg).toLocaleString()} kg capacity
                    {v.status === "in_use" ? " · current assignment" : ""}
                  </option>
                ))}
              </Select>
              {driverId && availableForSelectedDriver.length === 0 && (
                <p className="mt-1 text-xs text-amber-700">No available truck in this class and capacity is linked to this driver. Assign an unallocated vehicle in Fleet or choose another driver.</p>
              )}
            </Field>
            <Button
              variant="dark"
              loading={busy === "assign"}
              disabled={busy !== null || !driverCanBeAssigned || !selectedVehicle}
              onClick={() => act("assign", { action: "assign", driverId: Number(driverId), vehicleId: Number(vehicleId), note: note || undefined })}
            >
              {booking.driverId ? "Save reassignment" : "Assign & confirm"}
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
