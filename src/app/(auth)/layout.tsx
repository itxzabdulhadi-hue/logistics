import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Brand } from "@/components/app-shell";
import { getCurrentUser, homeForRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (user) redirect(homeForRole(user.role));

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-slate-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_rgba(249,115,22,0.35),_transparent_55%)]" />
        <Link href="/" className="relative">
          <Brand />
        </Link>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-bold leading-tight">The fastest way to get freight moving across the city.</h2>
          <ul className="mt-8 space-y-4 text-slate-300">
            {[
              "Instant, itemised quotes for 8 vehicle classes",
              "Dispatch team confirms and allocates every job",
              "Live status timeline from pickup to delivery",
            ].map((t) => (
              <li key={t} className="flex gap-3">
                <span className="mt-1 h-5 w-5 shrink-0 rounded-full bg-orange-500/20 text-center text-xs leading-5 text-orange-300">✓</span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-slate-500">© {new Date().getFullYear()} Loadline Logistics Pty Ltd</p>
      </aside>
      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <Link href="/" className="mb-8 inline-block lg:hidden">
            <Brand dark={false} />
          </Link>
          {children}
        </div>
      </main>
    </div>
  );
}
