import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Set new password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Set a new password</h1>
      <p className="mt-1 mb-8 text-sm text-slate-600">Choose a strong password you don&apos;t use elsewhere.</p>
      <ResetPasswordForm token={token ?? ""} />
    </>
  );
}
