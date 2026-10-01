"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Card, CardHeader, Field, Input } from "@/components/ui";
import { api, errorMessage, fieldErrors } from "@/lib/client-api";

type Props = { user: { name: string; email: string; phone: string | null; companyName: string | null } };

export function ProfileForm({ user }: Props) {
  const router = useRouter();
  const [state, setState] = useState<{ loading: boolean; error: string | null; ok: boolean; fields: Record<string, string> }>({
    loading: false, error: null, ok: false, fields: {},
  });
  const [pw, setPw] = useState<{ loading: boolean; error: string | null; ok: boolean; fields: Record<string, string> }>({
    loading: false, error: null, ok: false, fields: {},
  });

  async function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget).entries());
    setState({ loading: true, error: null, ok: false, fields: {} });
    try {
      await api("/api/profile", { method: "PATCH", body: values });
      setState({ loading: false, error: null, ok: true, fields: {} });
      router.refresh();
    } catch (err) {
      setState({ loading: false, error: errorMessage(err), ok: false, fields: fieldErrors(err) });
    }
  }

  async function savePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const values = Object.fromEntries(new FormData(formEl).entries()) as Record<string, string>;
    if (values.newPassword !== values.confirmPassword) {
      setPw({ loading: false, error: null, ok: false, fields: { confirmPassword: "Passwords do not match" } });
      return;
    }
    setPw({ loading: true, error: null, ok: false, fields: {} });
    try {
      await api("/api/profile/password", {
        method: "PUT",
        body: { currentPassword: values.currentPassword, newPassword: values.newPassword },
      });
      formEl.reset();
      setPw({ loading: false, error: null, ok: true, fields: {} });
    } catch (err) {
      setPw({ loading: false, error: errorMessage(err), ok: false, fields: fieldErrors(err) });
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Account details" description="Used on bookings and invoices." />
        <form onSubmit={saveProfile} className="space-y-4 p-5">
          {state.error && <Alert tone="error">{state.error}</Alert>}
          {state.ok && <Alert tone="success">Profile updated.</Alert>}
          <Field label="Email" hint="Contact support to change your email.">
            <Input value={user.email} disabled />
          </Field>
          <Field label="Full name" htmlFor="name" error={state.fields.name} required>
            <Input id="name" name="name" defaultValue={user.name} required />
          </Field>
          <Field label="Mobile" htmlFor="phone" error={state.fields.phone}>
            <Input id="phone" name="phone" defaultValue={user.phone ?? ""} />
          </Field>
          <Field label="Company" htmlFor="companyName" error={state.fields.companyName}>
            <Input id="companyName" name="companyName" defaultValue={user.companyName ?? ""} />
          </Field>
          <Button type="submit" loading={state.loading}>Save changes</Button>
        </form>
      </Card>
      <Card>
        <CardHeader title="Change password" />
        <form onSubmit={savePassword} className="space-y-4 p-5">
          {pw.error && <Alert tone="error">{pw.error}</Alert>}
          {pw.ok && <Alert tone="success">Password changed.</Alert>}
          <Field label="Current password" htmlFor="currentPassword" error={pw.fields.currentPassword} required>
            <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
          </Field>
          <Field label="New password" htmlFor="newPassword" error={pw.fields.newPassword} hint="At least 8 characters" required>
            <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={8} required />
          </Field>
          <Field label="Confirm new password" htmlFor="confirmPassword" error={pw.fields.confirmPassword} required>
            <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required />
          </Field>
          <Button type="submit" variant="dark" loading={pw.loading}>Update password</Button>
        </form>
      </Card>
    </div>
  );
}
