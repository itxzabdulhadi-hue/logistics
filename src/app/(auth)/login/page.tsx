import type { Metadata } from "next";
import { LoginForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Welcome back</h1>
      <p className="mt-1 mb-8 text-sm text-slate-600">Sign in to manage your bookings or run dispatch.</p>
      <LoginForm next={next?.startsWith("/") ? next : undefined} />
    </>
  );
}
