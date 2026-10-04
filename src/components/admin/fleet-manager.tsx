"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Badge, Button, Card, CardHeader, Checkbox, Field, Input, Select, Textarea, VehicleStatusBadge } from "@/components/ui";
import { api, errorMessage, fieldErrors } from "@/lib/client-api";
import { formatDateTime, formatMoney } from "@/lib/utils";

type VehicleType = {
  id: number; code: string; name: string; description: string | null; maxWeightKg: number; maxLengthM: number | null;
  maxPallets: number | null; baseFareCents: number; perKmRateCents: number; minimumChargeCents: number; active: boolean; sortOrder: number;
};
type VehicleRow = {
  vehicle: { id: number; registration: string; make: string | null; model: string | null; year: number | null; capacityKg: number | null; status: string; driverId: number | null; vehicleTypeId: number; notes: string | null; currentLocation: string | null; locationUpdatedAt: Date | null };
  typeName: string;
  typeMaxWeightKg: number;
  driverName: string | null;
};
type Driver = { id: number; name: string; vehicleId: number | null; status: string };

const MANUAL_VEHICLE_STATUSES = ["available", "maintenance", "inactive"] as const;
const VEHICLE_STATUSES = ["available", "in_use", "maintenance", "inactive"] as const;

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    setFields({});
    try {
      await fn();
      router.refresh();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      setFields(fieldErrors(err));
      return false;
    } finally {
      setBusy(null);
    }
  }
  return { busy, error, fields, run };
}

const values = (e: FormEvent<HTMLFormElement>) => Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
const dollarsToCents = (v: string) => Math.round(Number(v || 0) * 100);

function VehicleLocationCell({
  value,
  busy,
  onSave,
}: {
  value: string | null;
  busy: boolean;
  onSave: (location: string) => Promise<void>;
}) {
  const [location, setLocation] = useState(value ?? "");
  return (
    <form
      className="flex min-w-56 items-center gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        await onSave(location);
      }}
    >
      <Input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Set current location" aria-label="Vehicle current location" />
      <Button type="submit" size="sm" variant="secondary" disabled={busy || location === (value ?? "")}>Save</Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

export function VehiclesManager({ vehicles, vehicleTypes, drivers }: { vehicles: VehicleRow[]; vehicleTypes: VehicleType[]; drivers: Driver[] }) {
  const { busy, error, fields, run } = useAction();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);

  return (
    <Card>
      <CardHeader
        title="Vehicles"
        description={`${vehicles.length} units in the fleet.`}
        action={<Button size="sm" variant={adding ? "secondary" : "primary"} onClick={() => { setAdding((a) => !a); setEditing(null); }}>{adding ? "Close" : "+ Add vehicle"}</Button>}
      />
      {error && <div className="px-5 pt-4"><Alert tone="error">{error}</Alert></div>}
      {adding && (
        <form
          className="grid gap-4 border-b border-slate-100 bg-slate-50/60 p-5 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const v = values(e);
            const ok = await run("create", async () => {
              await api("/api/admin/vehicles", { method: "POST", body: { ...v, driverId: v.driverId || null } });
            });
            if (ok) { form.reset(); setAdding(false); }
          }}
        >
          <Field label="Registration" error={fields.registration} required><Input name="registration" required placeholder="ABC123" /></Field>
          <Field label="Vehicle class" error={fields.vehicleTypeId} required>
            <Select name="vehicleTypeId" required defaultValue="">
              <option value="" disabled>Select…</option>
              {vehicleTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Make" error={fields.make}><Input name="make" placeholder="Isuzu" /></Field>
          <Field label="Model" error={fields.model}><Input name="model" placeholder="NLR 45-150" /></Field>
          <Field label="Year" error={fields.year}><Input name="year" type="number" min={1980} max={2100} /></Field>
          <Field label="Capacity (kg)" error={fields.capacityKg} hint="Leave blank to use the class limit."><Input name="capacityKg" type="number" min={1} /></Field>
          <Field label="Status" error={fields.status}>
            <Select name="status" defaultValue="available">{MANUAL_VEHICLE_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</Select>
          </Field>
          <Field label="Driver" error={fields.driverId}>
            <Select name="driverId" defaultValue=""><option value="">Unassigned</option>{drivers.filter((d) => d.status === "active" && d.vehicleId == null).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
          </Field>
          <Field label="Current location" error={fields.currentLocation}><Input name="currentLocation" placeholder="e.g. Alexandria depot" /></Field>
          <Field label="Notes" error={fields.notes} className="sm:col-span-2 lg:col-span-2"><Input name="notes" /></Field>
          <div className="flex items-end"><Button type="submit" loading={busy === "create"} className="w-full">Save vehicle</Button></div>
        </form>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-5 py-3">Rego</th><th className="px-5 py-3">Class</th><th className="px-5 py-3">Make / model</th>
              <th className="px-5 py-3">Capacity</th><th className="px-5 py-3">Location</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Driver</th><th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {vehicles.length === 0 && <tr><td colSpan={8} className="px-5 py-10 text-center text-slate-500">No vehicles yet.</td></tr>}
            {vehicles.map((row) => (
              <VehicleTableRows
                key={row.vehicle.id}
                row={row}
                vehicleTypes={vehicleTypes}
                drivers={drivers}
                editing={editing === row.vehicle.id}
                onEdit={() => { setEditing(editing === row.vehicle.id ? null : row.vehicle.id); setAdding(false); }}
                onDone={() => setEditing(null)}
                busy={busy}
                fields={fields}
                run={run}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function VehicleTableRows({ row, vehicleTypes, drivers, editing, onEdit, onDone, busy, fields, run }: {
  row: VehicleRow;
  vehicleTypes: VehicleType[];
  drivers: Driver[];
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
  busy: string | null;
  fields: Record<string, string>;
  run: (key: string, fn: () => Promise<void>) => Promise<boolean>;
}) {
  const { vehicle, typeName, typeMaxWeightKg } = row;
  return (
    <>
      <tr className={editing ? "bg-orange-50/40" : undefined}>
        <td className="px-5 py-3 font-semibold text-slate-900">{vehicle.registration}</td>
        <td className="px-5 py-3 text-slate-700">{typeName}</td>
        <td className="px-5 py-3 text-slate-700">{[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "—"}</td>
        <td className="px-5 py-3 text-slate-700">
          {Math.min(vehicle.capacityKg ?? typeMaxWeightKg, typeMaxWeightKg).toLocaleString()} kg
          {vehicle.capacityKg == null && <span className="ml-1 text-xs text-slate-400">class cap</span>}
        </td>
        <td className="px-5 py-3">
          <VehicleLocationCell
            key={`${vehicle.id}:${vehicle.currentLocation ?? ""}`}
            value={vehicle.currentLocation}
            busy={busy !== null}
            onSave={async (currentLocation) => {
              await run(`location-${vehicle.id}`, async () => {
                await api(`/api/admin/vehicles/${vehicle.id}`, { method: "PATCH", body: { currentLocation } });
              });
            }}
          />
        </td>
        <td className="px-5 py-3">
          <div className="flex items-center gap-2">
            <VehicleStatusBadge status={vehicle.status} />
            <Select
              className="w-36 py-1 text-xs"
              value={vehicle.status}
              disabled={busy !== null}
              onChange={(event) => run(`status-${vehicle.id}`, async () => {
                await api(`/api/admin/vehicles/${vehicle.id}`, { method: "PATCH", body: { status: event.target.value } });
              })}
            >
              {VEHICLE_STATUSES.map((status) => <option key={status} value={status} disabled={status === "in_use"}>{status.replace("_", " ")}</option>)}
            </Select>
          </div>
        </td>
        <td className="px-5 py-3">
          <Select
            className="w-44 py-1 text-xs"
            value={vehicle.driverId ?? ""}
            disabled={busy !== null || vehicle.status === "in_use"}
            onChange={(event) => run(`driver-${vehicle.id}`, async () => {
              await api(`/api/admin/vehicles/${vehicle.id}`, { method: "PATCH", body: { driverId: event.target.value || null } });
            })}
          >
            <option value="">Unassigned</option>
            {drivers.filter((driver) =>
              (driver.status === "active" && (driver.vehicleId == null || driver.vehicleId === vehicle.id)) || driver.id === vehicle.driverId,
            ).map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
          </Select>
        </td>
        <td className="px-5 py-3 text-right">
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={onEdit}>{editing ? "Close" : "Edit"}</Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-red-600 hover:bg-red-50"
              loading={busy === `delete-${vehicle.id}`}
              disabled={busy !== null}
              onClick={() => {
                if (confirm(`Delete ${vehicle.registration}?`)) {
                  run(`delete-${vehicle.id}`, async () => {
                    await api(`/api/admin/vehicles/${vehicle.id}`, { method: "DELETE" });
                  });
                }
              }}
            >
              Delete
            </Button>
          </div>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={8} className="p-0">
            <VehicleEditForm
              vehicle={vehicle}
              vehicleTypes={vehicleTypes}
              drivers={drivers}
              busy={busy}
              fields={fields}
              onCancel={onDone}
              onSave={async (body) => {
                const ok = await run(`edit-${vehicle.id}`, async () => {
                  await api(`/api/admin/vehicles/${vehicle.id}`, { method: "PATCH", body });
                });
                if (ok) onDone();
              }}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function VehicleEditForm({ vehicle, vehicleTypes, drivers, busy, fields, onCancel, onSave }: {
  vehicle: VehicleRow["vehicle"];
  vehicleTypes: VehicleType[];
  drivers: Driver[];
  busy: string | null;
  fields: Record<string, string>;
  onCancel: () => void;
  onSave: (body: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <form
      className="grid gap-4 bg-slate-50/70 p-5 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = values(event);
        await onSave({
          registration: form.registration,
          vehicleTypeId: form.vehicleTypeId,
          make: form.make || null,
          model: form.model || null,
          year: form.year || null,
          capacityKg: form.capacityKg || null,
          ...(form.status ? { status: form.status } : {}),
          currentLocation: form.currentLocation || null,
          ...(vehicle.status === "in_use" ? {} : { driverId: form.driverId || null }),
          notes: form.notes || null,
        });
      }}
    >
      <Field label="Registration" error={fields.registration} required><Input name="registration" defaultValue={vehicle.registration} required /></Field>
      <Field label="Vehicle class" error={fields.vehicleTypeId} required>
        <Select name="vehicleTypeId" defaultValue={vehicle.vehicleTypeId} required>
          {vehicleTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
        </Select>
      </Field>
      <Field label="Make" error={fields.make}><Input name="make" defaultValue={vehicle.make ?? ""} /></Field>
      <Field label="Model" error={fields.model}><Input name="model" defaultValue={vehicle.model ?? ""} /></Field>
      <Field label="Year" error={fields.year}><Input name="year" type="number" min={1980} max={2100} defaultValue={vehicle.year ?? ""} /></Field>
      <Field label="Capacity (kg)" error={fields.capacityKg} hint="Leave blank to use the class limit.">
        <Input name="capacityKg" type="number" min={1} max={100_000} defaultValue={vehicle.capacityKg ?? ""} />
      </Field>
      <Field label="Status" error={fields.status}>
        {vehicle.status === "in_use" ? (
          <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">In use — managed by the active assignment</p>
        ) : (
          <Select name="status" defaultValue={vehicle.status}>
            {MANUAL_VEHICLE_STATUSES.map((status) => <option key={status} value={status}>{status.replace("_", " ")}</option>)}
          </Select>
        )}
      </Field>
      <Field label="Assigned driver" error={fields.driverId}>
        <Select name="driverId" defaultValue={vehicle.driverId ?? ""} disabled={busy !== null || vehicle.status === "in_use"}>
          <option value="">Unassigned</option>
          {drivers.filter((driver) =>
            (driver.status === "active" && (driver.vehicleId == null || driver.vehicleId === vehicle.id)) || driver.id === vehicle.driverId,
          ).map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
        </Select>
      </Field>
      <Field label="Current location" error={fields.currentLocation}><Input name="currentLocation" defaultValue={vehicle.currentLocation ?? ""} /></Field>
      <Field label="Notes" error={fields.notes} className="sm:col-span-2 lg:col-span-2"><Input name="notes" defaultValue={vehicle.notes ?? ""} /></Field>
      <div className="flex items-end gap-2">
        <Button type="submit" loading={busy === `edit-${vehicle.id}`}>Save changes</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Vehicle types & tariffs
// ---------------------------------------------------------------------------

function VehicleTypeForm({ initial, onDone, submitLabel, busyKey, run, fields, busy }: {
  initial?: VehicleType; onDone: () => void; submitLabel: string; busyKey: string;
  run: (key: string, fn: () => Promise<void>) => Promise<boolean>; fields: Record<string, string>; busy: string | null;
}) {
  return (
    <form
      className="grid gap-4 bg-slate-50/60 p-5 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const v = values(e);
        const body = {
          code: v.code, name: v.name, description: v.description,
          maxWeightKg: v.maxWeightKg, maxLengthM: v.maxLengthM, maxPallets: v.maxPallets,
          baseFareCents: dollarsToCents(v.baseFare), perKmRateCents: dollarsToCents(v.perKm), minimumChargeCents: dollarsToCents(v.minimum),
          sortOrder: v.sortOrder || 0, active: v.active === "on",
        };
        const ok = await run(busyKey, async () => {
          if (initial) await api(`/api/admin/vehicle-types/${initial.id}`, { method: "PATCH", body });
          else await api("/api/admin/vehicle-types", { method: "POST", body });
        });
        if (ok) onDone();
      }}
    >
      <Field label="Code" error={fields.code} hint="e.g. 2t_pantech" required><Input name="code" defaultValue={initial?.code} required disabled={!!initial} /></Field>
      {initial && <input type="hidden" name="code" value={initial.code} />}
      <Field label="Name" error={fields.name} required><Input name="name" defaultValue={initial?.name} required /></Field>
      <Field label="Description" error={fields.description} className="sm:col-span-2"><Input name="description" defaultValue={initial?.description ?? ""} /></Field>
      <Field label="Max weight (kg)" error={fields.maxWeightKg} required><Input name="maxWeightKg" type="number" min={1} defaultValue={initial?.maxWeightKg} required /></Field>
      <Field label="Max length (m)" error={fields.maxLengthM}><Input name="maxLengthM" type="number" step="0.1" min={0} defaultValue={initial?.maxLengthM ?? ""} /></Field>
      <Field label="Max pallets" error={fields.maxPallets}><Input name="maxPallets" type="number" min={0} defaultValue={initial?.maxPallets ?? ""} /></Field>
      <Field label="Sort order" error={fields.sortOrder}><Input name="sortOrder" type="number" defaultValue={initial?.sortOrder ?? 0} /></Field>
      <Field label="Base fare ($)" error={fields.baseFareCents} required><Input name="baseFare" type="number" step="0.01" min={0} defaultValue={initial ? (initial.baseFareCents / 100).toFixed(2) : ""} required /></Field>
      <Field label="Per km ($)" error={fields.perKmRateCents} required><Input name="perKm" type="number" step="0.01" min={0} defaultValue={initial ? (initial.perKmRateCents / 100).toFixed(2) : ""} required /></Field>
      <Field label="Minimum charge ($)" error={fields.minimumChargeCents}><Input name="minimum" type="number" step="0.01" min={0} defaultValue={initial ? (initial.minimumChargeCents / 100).toFixed(2) : "0"} /></Field>
      <div className="flex items-end"><Checkbox name="active" label="Bookable by customers" defaultChecked={initial?.active ?? true} className="w-full" /></div>
      <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="submit" loading={busy === busyKey}>{submitLabel}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

export function VehicleTypesManager({ vehicleTypes }: { vehicleTypes: VehicleType[] }) {
  const { busy, error, fields, run } = useAction();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);

  return (
    <Card>
      <CardHeader
        title="Vehicle classes & tariffs"
        description="Prices customers see are computed from these rates: max(minimum, base + km × rate) + extras + GST."
        action={<Button size="sm" variant={adding ? "secondary" : "primary"} onClick={() => { setAdding((a) => !a); setEditing(null); }}>{adding ? "Close" : "+ Add class"}</Button>}
      />
      {error && <div className="px-5 pt-4"><Alert tone="error">{error}</Alert></div>}
      {adding && <div className="border-b border-slate-100"><VehicleTypeForm onDone={() => setAdding(false)} submitLabel="Create class" busyKey="create-type" run={run} fields={fields} busy={busy} /></div>}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-5 py-3">Class</th><th className="px-5 py-3">Capacity</th><th className="px-5 py-3 text-right">Base</th>
              <th className="px-5 py-3 text-right">Per km</th><th className="px-5 py-3 text-right">Minimum</th><th className="px-5 py-3">Status</th><th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {vehicleTypes.map((t) => (
              <VehicleTypeRows key={t.id} t={t} editing={editing === t.id} onEdit={() => { setEditing(editing === t.id ? null : t.id); setAdding(false); }} onDone={() => setEditing(null)} run={run} fields={fields} busy={busy} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function VehicleTypeRows({ t, editing, onEdit, onDone, run, fields, busy }: {
  t: VehicleType; editing: boolean; onEdit: () => void; onDone: () => void;
  run: (key: string, fn: () => Promise<void>) => Promise<boolean>; fields: Record<string, string>; busy: string | null;
}) {
  return (
    <>
      <tr className={editing ? "bg-orange-50/40" : undefined}>
        <td className="px-5 py-3">
          <div className="font-semibold text-slate-900">{t.name}</div>
          <div className="text-xs text-slate-500">{t.code}</div>
        </td>
        <td className="px-5 py-3 text-slate-700">{t.maxWeightKg.toLocaleString()} kg{t.maxPallets ? ` · ${t.maxPallets} pallets` : ""}{t.maxLengthM ? ` · ${t.maxLengthM} m` : ""}</td>
        <td className="px-5 py-3 text-right text-slate-700">{formatMoney(t.baseFareCents)}</td>
        <td className="px-5 py-3 text-right text-slate-700">{formatMoney(t.perKmRateCents)}</td>
        <td className="px-5 py-3 text-right text-slate-700">{formatMoney(t.minimumChargeCents)}</td>
        <td className="px-5 py-3">{t.active ? <Badge tone="green">Active</Badge> : <Badge tone="slate">Hidden</Badge>}</td>
        <td className="px-5 py-3 text-right">
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={onEdit}>{editing ? "Close" : "Edit"}</Button>
            <Button size="sm" variant="ghost" loading={busy === `toggle-${t.id}`} disabled={busy !== null}
              onClick={() => run(`toggle-${t.id}`, async () => { await api(`/api/admin/vehicle-types/${t.id}`, { method: "PATCH", body: { active: !t.active } }); })}>
              {t.active ? "Hide" : "Activate"}
            </Button>
          </div>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={7} className="p-0">
            <VehicleTypeForm initial={t} onDone={onDone} submitLabel="Save changes" busyKey={`edit-${t.id}`} run={run} fields={fields} busy={busy} />
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

type ManagedDriver = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  availability: "available" | "off_duty";
  licenseNumber: string | null;
  licenseClass: string | null;
  licenseExpiryDate: string | null;
  driverNotes: string | null;
  vehicleId: number | null;
  vehicleRegistration: string | null;
  activeJobs: number;
  dispatchStatus: "available" | "off_duty" | "busy" | "suspended";
  currentJob: { id: number; reference: string; status: string; scheduledAt: Date | string; pickupAddress: string; dropoffAddress: string } | null;
  createdAt: Date | string;
};

function DriverProfileForm({
  driver,
  busy,
  fields,
  onCancel,
  onSave,
}: {
  driver: ManagedDriver;
  busy: string | null;
  fields: Record<string, string>;
  onCancel: () => void;
  onSave: (body: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <form
      className="grid gap-4 bg-slate-50/70 p-5 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={async (event) => {
        event.preventDefault();
        await onSave(values(event));
      }}
    >
      <Field label="Full name" error={fields.name} required><Input name="name" defaultValue={driver.name} required /></Field>
      <Field label="Email" error={fields.email} required><Input name="email" type="email" defaultValue={driver.email} required /></Field>
      <Field label="Mobile" error={fields.phone}><Input name="phone" defaultValue={driver.phone ?? ""} /></Field>
      <Field label="Account" error={fields.status}>
        <Select name="status" defaultValue={driver.status}>
          <option value="active">Active</option><option value="suspended">Suspended</option>
        </Select>
      </Field>
      <Field label="Availability" error={fields.availability}>
        <Select name="availability" defaultValue={driver.availability}>
          <option value="available">On duty</option><option value="off_duty">Off duty</option>
        </Select>
      </Field>
      <Field label="Licence number" error={fields.licenseNumber}><Input name="licenseNumber" defaultValue={driver.licenseNumber ?? ""} /></Field>
      <Field label="Licence class" error={fields.licenseClass}><Input name="licenseClass" defaultValue={driver.licenseClass ?? ""} placeholder="e.g. HR" /></Field>
      <Field label="Licence expiry" error={fields.licenseExpiryDate}><Input name="licenseExpiryDate" type="date" defaultValue={driver.licenseExpiryDate ?? ""} /></Field>
      <Field label="Profile notes" error={fields.notes} className="sm:col-span-2 lg:col-span-3"><Textarea name="notes" defaultValue={driver.driverNotes ?? ""} placeholder="Induction, endorsements, preferred shifts…" /></Field>
      <div className="flex items-end gap-2">
        <Button type="submit" loading={busy === `driver-${driver.id}`}>Save profile</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Close</Button>
      </div>
    </form>
  );
}

function DriverAvailabilityBadge({ driver }: { driver: ManagedDriver }) {
  if (driver.dispatchStatus === "busy") return <Badge tone="blue">Assigned</Badge>;
  if (driver.dispatchStatus === "suspended") return <Badge tone="red">Suspended</Badge>;
  if (driver.dispatchStatus === "off_duty") return <Badge tone="slate">Off duty</Badge>;
  return <Badge tone="green">Available</Badge>;
}

export function DriversManager({ drivers }: { drivers: ManagedDriver[] }) {
  const { busy, error, fields, run } = useAction();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  return (
    <Card>
      <CardHeader
        title="Drivers"
        description="Manage driver accounts, licences, on-duty availability, linked trucks and current assignments."
        action={<Button size="sm" variant={adding ? "secondary" : "primary"} onClick={() => { setAdding((a) => !a); setEditing(null); }}>{adding ? "Close" : "+ Add driver"}</Button>}
      />
      {error && <div className="px-5 pt-4"><Alert tone="error">{error}</Alert></div>}
      {adding && (
        <form
          className="grid gap-4 border-b border-slate-100 bg-slate-50/60 p-5 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const ok = await run("create-driver", async () => { await api("/api/admin/drivers", { method: "POST", body: values(event) }); });
            if (ok) { form.reset(); setAdding(false); }
          }}
        >
          <Field label="Full name" error={fields.name} required><Input name="name" required /></Field>
          <Field label="Email" error={fields.email} required><Input name="email" type="email" required /></Field>
          <Field label="Mobile" error={fields.phone}><Input name="phone" /></Field>
          <Field label="Temporary password" error={fields.password} required><Input name="password" type="password" minLength={8} required placeholder="At least 8 characters" /></Field>
          <Field label="Licence number" error={fields.licenseNumber}><Input name="licenseNumber" /></Field>
          <Field label="Licence class" error={fields.licenseClass}><Input name="licenseClass" placeholder="e.g. HR" /></Field>
          <Field label="Licence expiry" error={fields.licenseExpiryDate}><Input name="licenseExpiryDate" type="date" /></Field>
          <Field label="Availability" error={fields.availability}>
            <Select name="availability" defaultValue="available"><option value="available">On duty</option><option value="off_duty">Off duty</option></Select>
          </Field>
          <Field label="Profile notes" error={fields.notes} className="sm:col-span-2 lg:col-span-3"><Textarea name="notes" placeholder="Induction, endorsements, preferred shifts…" /></Field>
          <div className="flex items-end"><Button type="submit" loading={busy === "create-driver"} className="w-full">Create driver account</Button></div>
        </form>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-5 py-3">Driver / contact</th><th className="px-5 py-3">Licence</th><th className="px-5 py-3">Availability</th>
              <th className="px-5 py-3">Assigned vehicle</th><th className="px-5 py-3">Current job</th><th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {drivers.length === 0 && <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-500">No drivers yet.</td></tr>}
            {drivers.map((driver) => (
              <DriverTableRow
                key={driver.id}
                driver={driver}
                editing={editing === driver.id}
                onEdit={() => { setEditing(editing === driver.id ? null : driver.id); setAdding(false); }}
                onCancel={() => setEditing(null)}
                busy={busy}
                fields={fields}
                run={run}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function DriverTableRow({
  driver,
  editing,
  onEdit,
  onCancel,
  busy,
  fields,
  run,
}: {
  driver: ManagedDriver;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  busy: string | null;
  fields: Record<string, string>;
  run: (key: string, fn: () => Promise<void>) => Promise<boolean>;
}) {
  return (
    <>
      <tr className={editing ? "bg-orange-50/40" : undefined}>
        <td className="px-5 py-3">
          <div className="font-semibold text-slate-900">{driver.name}</div>
          <div className="text-xs text-slate-600">{driver.email}{driver.phone ? ` · ${driver.phone}` : ""}</div>
          <div className="mt-1 text-xs text-slate-400">Account {driver.status}</div>
        </td>
        <td className="px-5 py-3 text-slate-700">
          {driver.licenseClass || driver.licenseNumber ? <>{driver.licenseClass ?? "Licence"}{driver.licenseNumber ? ` · ${driver.licenseNumber}` : ""}</> : <span className="text-slate-400">Not recorded</span>}
          {driver.licenseExpiryDate && <div className="text-xs text-slate-500">Expires {driver.licenseExpiryDate}</div>}
        </td>
        <td className="px-5 py-3"><DriverAvailabilityBadge driver={driver} /></td>
        <td className="px-5 py-3 text-slate-700">{driver.vehicleRegistration ?? <span className="text-slate-400">No vehicle linked</span>}</td>
        <td className="px-5 py-3">
          {driver.currentJob ? (
            <Link className="font-medium text-orange-700 hover:underline" href={`/admin/bookings/${driver.currentJob.id}`}>
              {driver.currentJob.reference} · {driver.currentJob.status.replaceAll("_", " ")}
              {driver.activeJobs > 1 && <span className="ml-1 text-xs text-red-600">(+{driver.activeJobs - 1} more)</span>}
              <span className="block text-xs font-normal text-slate-500">{formatDateTime(driver.currentJob.scheduledAt)}</span>
            </Link>
          ) : <span className="text-slate-400">No active job</span>}
        </td>
        <td className="px-5 py-3 text-right"><Button size="sm" variant="secondary" onClick={onEdit}>{editing ? "Close" : "Edit profile"}</Button></td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={6} className="p-0">
            <DriverProfileForm
              driver={driver}
              busy={busy}
              fields={fields}
              onCancel={onCancel}
              onSave={async (body) => {
                const ok = await run(`driver-${driver.id}`, async () => {
                  await api(`/api/admin/drivers/${driver.id}`, { method: "PATCH", body });
                });
                if (ok) onCancel();
              }}
            />
          </td>
        </tr>
      )}
    </>
  );
}
