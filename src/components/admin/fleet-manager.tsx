"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Badge, Button, Card, CardHeader, Checkbox, Field, Input, Select, Textarea, VehicleStatusBadge } from "@/components/ui";
import { api, errorMessage, fieldErrors } from "@/lib/client-api";
import { formatMoney } from "@/lib/utils";

type VehicleType = {
  id: number; code: string; name: string; description: string | null; maxWeightKg: number; maxLengthM: number | null;
  maxPallets: number | null; baseFareCents: number; perKmRateCents: number; minimumChargeCents: number; active: boolean; sortOrder: number;
};
type VehicleRow = {
  vehicle: { id: number; registration: string; make: string | null; model: string | null; year: number | null; capacityKg: number | null; status: string; driverId: number | null; vehicleTypeId: number; notes: string | null };
  typeName: string;
  driverName: string | null;
};
type Driver = { id: number; name: string };

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

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

export function VehiclesManager({ vehicles, vehicleTypes, drivers }: { vehicles: VehicleRow[]; vehicleTypes: VehicleType[]; drivers: Driver[] }) {
  const { busy, error, fields, run } = useAction();
  const [adding, setAdding] = useState(false);

  return (
    <Card>
      <CardHeader
        title="Vehicles"
        description={`${vehicles.length} units in the fleet.`}
        action={<Button size="sm" variant={adding ? "secondary" : "primary"} onClick={() => setAdding((a) => !a)}>{adding ? "Close" : "+ Add vehicle"}</Button>}
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
          <Field label="Capacity (kg)" error={fields.capacityKg}><Input name="capacityKg" type="number" min={0} /></Field>
          <Field label="Status" error={fields.status}>
            <Select name="status" defaultValue="available">{VEHICLE_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</Select>
          </Field>
          <Field label="Driver" error={fields.driverId}>
            <Select name="driverId" defaultValue=""><option value="">Unassigned</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
          </Field>
          <Field label="Notes" error={fields.notes} className="sm:col-span-2 lg:col-span-3"><Input name="notes" /></Field>
          <div className="flex items-end"><Button type="submit" loading={busy === "create"} className="w-full">Save vehicle</Button></div>
        </form>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-5 py-3">Rego</th><th className="px-5 py-3">Class</th><th className="px-5 py-3">Make / model</th>
              <th className="px-5 py-3">Capacity</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Driver</th><th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {vehicles.length === 0 && <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-500">No vehicles yet.</td></tr>}
            {vehicles.map(({ vehicle: v, typeName }) => (
              <tr key={v.id}>
                <td className="px-5 py-3 font-semibold text-slate-900">{v.registration}</td>
                <td className="px-5 py-3 text-slate-700">{typeName}</td>
                <td className="px-5 py-3 text-slate-700">{[v.make, v.model, v.year].filter(Boolean).join(" ") || "—"}</td>
                <td className="px-5 py-3 text-slate-700">{v.capacityKg ? `${v.capacityKg.toLocaleString()} kg` : "—"}</td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <VehicleStatusBadge status={v.status} />
                    <Select
                      className="w-36 py-1 text-xs"
                      value={v.status}
                      disabled={busy !== null}
                      onChange={(e) => run(`status-${v.id}`, async () => { await api(`/api/admin/vehicles/${v.id}`, { method: "PATCH", body: { status: e.target.value } }); })}
                    >
                      {VEHICLE_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                    </Select>
                  </div>
                </td>
                <td className="px-5 py-3">
                  <Select
                    className="w-44 py-1 text-xs"
                    value={v.driverId ?? ""}
                    disabled={busy !== null}
                    onChange={(e) => run(`driver-${v.id}`, async () => { await api(`/api/admin/vehicles/${v.id}`, { method: "PATCH", body: { driverId: e.target.value || null } }); })}
                  >
                    <option value="">Unassigned</option>
                    {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </Select>
                </td>
                <td className="px-5 py-3 text-right">
                  <Button
                    size="sm" variant="ghost" className="text-red-600 hover:bg-red-50"
                    loading={busy === `delete-${v.id}`} disabled={busy !== null}
                    onClick={() => { if (confirm(`Delete ${v.registration}?`)) run(`delete-${v.id}`, async () => { await api(`/api/admin/vehicles/${v.id}`, { method: "DELETE" }); }); }}
                  >
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
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

export function DriversManager({ drivers }: { drivers: { id: number; name: string; email: string; phone: string | null; status: string; vehicleRegistration: string | null; activeJobs: number; createdAt: string | Date }[] }) {
  const { busy, error, fields, run } = useAction();
  const [adding, setAdding] = useState(false);
  return (
    <Card>
      <CardHeader
        title="Drivers"
        description="Driver accounts can be allocated to jobs. The driver app ships in Phase 2."
        action={<Button size="sm" variant={adding ? "secondary" : "primary"} onClick={() => setAdding((a) => !a)}>{adding ? "Close" : "+ Add driver"}</Button>}
      />
      {error && <div className="px-5 pt-4"><Alert tone="error">{error}</Alert></div>}
      {adding && (
        <form
          className="grid gap-4 border-b border-slate-100 bg-slate-50/60 p-5 sm:grid-cols-2 lg:grid-cols-5"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const ok = await run("create-driver", async () => { await api("/api/admin/drivers", { method: "POST", body: values(e) }); });
            if (ok) { form.reset(); setAdding(false); }
          }}
        >
          <Field label="Full name" error={fields.name} required><Input name="name" required /></Field>
          <Field label="Email" error={fields.email} required><Input name="email" type="email" required /></Field>
          <Field label="Mobile" error={fields.phone}><Input name="phone" /></Field>
          <Field label="Temporary password" error={fields.password} required><Input name="password" type="text" minLength={8} required placeholder="min 8 characters" /></Field>
          <div className="flex items-end"><Button type="submit" loading={busy === "create-driver"} className="w-full">Create driver</Button></div>
        </form>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
            <tr><th className="px-5 py-3">Driver</th><th className="px-5 py-3">Contact</th><th className="px-5 py-3">Vehicle</th><th className="px-5 py-3">Active jobs</th><th className="px-5 py-3">Status</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {drivers.length === 0 && <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-500">No drivers yet.</td></tr>}
            {drivers.map((d) => (
              <tr key={d.id}>
                <td className="px-5 py-3 font-semibold text-slate-900">{d.name}</td>
                <td className="px-5 py-3 text-slate-700">{d.email}{d.phone && <div className="text-xs text-slate-500">{d.phone}</div>}</td>
                <td className="px-5 py-3 text-slate-700">{d.vehicleRegistration ?? <span className="text-slate-400">No vehicle linked</span>}</td>
                <td className="px-5 py-3 text-slate-700">{d.activeJobs}</td>
                <td className="px-5 py-3">{d.status === "active" ? <Badge tone="green">Active</Badge> : <Badge tone="red">Suspended</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
