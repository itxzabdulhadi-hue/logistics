import type { Metadata } from "next";
import { RegisterForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Create your account</h1>
      <p className="mt-1 mb-8 text-sm text-slate-600">Book trucks on demand, track every job, and pay by card or on account.</p>
      <RegisterForm />
    </>
  );
}
