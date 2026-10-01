"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { api, errorMessage, fieldErrors } from "@/lib/client-api";

function useSubmit() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  async function run(fn: () => Promise<void>) {
    setLoading(true);
    setError(null);
    setFields({});
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
      setFields(fieldErrors(err));
    } finally {
      setLoading(false);
    }
  }
  return { loading, error, fields, run };
}

function formValues(e: FormEvent<HTMLFormElement>) {
  return Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
}

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const { loading, error, fields, run } = useSubmit();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const values = formValues(e);
        run(async () => {
          const data = await api<{ redirectTo: string }>("/api/auth/login", { method: "POST", body: values });
          router.push(next || data.redirectTo);
          router.refresh();
        });
      }}
    >
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="Email" htmlFor="email" error={fields.email} required>
        <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@company.com" />
      </Field>
      <Field label="Password" htmlFor="password" error={fields.password} required>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <div className="flex items-center justify-between text-sm">
        <Link href="/forgot-password" className="font-medium text-orange-600 hover:text-orange-700">
          Forgot password?
        </Link>
        <Link href="/register" className="text-slate-600 hover:text-slate-900">
          Create an account
        </Link>
      </div>
      <Button type="submit" className="w-full" size="lg" loading={loading}>
        Sign in
      </Button>
    </form>
  );
}

export function RegisterForm() {
  const router = useRouter();
  const { loading, error, fields, run } = useSubmit();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const values = formValues(e);
        run(async () => {
          await api("/api/auth/register", { method: "POST", body: values });
          router.push("/dashboard");
          router.refresh();
        });
      }}
    >
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="Full name" htmlFor="name" error={fields.name} required>
        <Input id="name" name="name" autoComplete="name" required placeholder="Jordan Lee" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" htmlFor="email" error={fields.email} required>
          <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@company.com" />
        </Field>
        <Field label="Mobile" htmlFor="phone" error={fields.phone}>
          <Input id="phone" name="phone" type="tel" autoComplete="tel" placeholder="04xx xxx xxx" />
        </Field>
      </div>
      <Field label="Company (optional)" htmlFor="companyName" error={fields.companyName}>
        <Input id="companyName" name="companyName" autoComplete="organization" placeholder="Business name for invoices" />
      </Field>
      <Field label="Password" htmlFor="password" error={fields.password} hint="At least 8 characters" required>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Button type="submit" className="w-full" size="lg" loading={loading}>
        Create account
      </Button>
      <p className="text-center text-sm text-slate-600">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-orange-600 hover:text-orange-700">
          Sign in
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const { loading, error, fields, run } = useSubmit();
  const [result, setResult] = useState<{ demoResetUrl?: string } | null>(null);
  if (result) {
    return (
      <div className="space-y-4">
        <Alert tone="success" title="Check your inbox">
          If an account exists for that email, a reset link is on its way.
        </Alert>
        {result.demoResetUrl && (
          <Alert tone="info" title="Demo mode — no email provider configured">
            <p>Use this link to reset your password:</p>
            <Link href={result.demoResetUrl} className="mt-1 block break-all font-medium underline">
              {result.demoResetUrl}
            </Link>
          </Alert>
        )}
        <Link href="/login" className="block text-center text-sm font-medium text-orange-600 hover:text-orange-700">
          Back to sign in
        </Link>
      </div>
    );
  }
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const values = formValues(e);
        run(async () => {
          const data = await api<{ demoResetUrl?: string }>("/api/auth/password-reset", { method: "POST", body: values });
          setResult(data);
        });
      }}
    >
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="Email" htmlFor="email" error={fields.email} required>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Button type="submit" className="w-full" size="lg" loading={loading}>
        Send reset link
      </Button>
      <Link href="/login" className="block text-center text-sm text-slate-600 hover:text-slate-900">
        Back to sign in
      </Link>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const { loading, error, fields, run } = useSubmit();
  const [done, setDone] = useState(false);
  const [mismatch, setMismatch] = useState<string | null>(null);
  if (!token) {
    return (
      <Alert tone="error" title="Invalid link">
        This reset link is missing its token.{" "}
        <Link href="/forgot-password" className="underline">
          Request a new one
        </Link>
        .
      </Alert>
    );
  }
  if (done) {
    return (
      <div className="space-y-4">
        <Alert tone="success" title="Password updated">
          You can now sign in with your new password.
        </Alert>
        <Link href="/login" className="block text-center text-sm font-medium text-orange-600 hover:text-orange-700">
          Go to sign in
        </Link>
      </div>
    );
  }
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const values = formValues(e);
        setMismatch(null);
        if (values.password !== values.confirm) {
          setMismatch("Passwords do not match");
          return;
        }
        run(async () => {
          await api("/api/auth/password-reset", { method: "PUT", body: { token, password: values.password } });
          setDone(true);
        });
      }}
    >
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="New password" htmlFor="password" error={fields.password} hint="At least 8 characters" required>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label="Confirm new password" htmlFor="confirm" error={mismatch ?? undefined} required>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Button type="submit" className="w-full" size="lg" loading={loading}>
        Set new password
      </Button>
    </form>
  );
}
