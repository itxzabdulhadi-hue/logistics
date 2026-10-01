import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Forgot your password?</h1>
      <p className="mt-1 mb-8 text-sm text-slate-600">Enter your email and we&apos;ll send you a link to set a new one.</p>
      <ForgotPasswordForm />
    </>
  );
}
