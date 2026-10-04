"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { UserRole } from "@/db/schema";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: ReactNode; exact?: boolean };

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
    <path d={d} />
  </svg>
);
const ICONS = {
  home: icon("M3 11l9-8 9 8v9a2 2 0 01-2 2h-4v-6H9v6H5a2 2 0 01-2-2z"),
  list: icon("M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"),
  plus: icon("M12 5v14M5 12h14"),
  user: icon("M20 21a8 8 0 10-16 0M12 13a4 4 0 100-8 4 4 0 000 8z"),
  users: icon("M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"),
  truck: icon("M1 7h13v10H1zM14 10h4l3 3v4h-7zM5.5 20a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17.5 20a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"),
  wheel: icon("M12 22a10 10 0 100-20 10 10 0 000 20zM12 15a3 3 0 100-6 3 3 0 000 6zM12 2v7M4.2 17l6.1-3.5M19.8 17l-6.1-3.5"),
  chart: icon("M3 3v18h18M7 15l4-4 4 4 5-6"),
  sliders: icon("M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3M2 14h4m4-4h4m4 6h4"),
  receipt: icon("M5 3h14v18l-3-2-3 2-3-2-3 2-2-2zM8 8h8M8 12h8M8 16h4"),
};

const CUSTOMER_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: ICONS.home },
  { href: "/bookings/new", label: "Book a truck", icon: ICONS.plus, exact: true },
  { href: "/bookings", label: "My bookings", icon: ICONS.list },
  { href: "/profile", label: "Profile", icon: ICONS.user },
];
const STAFF_NAV: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: ICONS.chart, exact: true },
  { href: "/admin/dispatch", label: "Dispatch", icon: ICONS.truck },
  { href: "/admin/bookings", label: "Bookings", icon: ICONS.list },
  { href: "/admin/finance", label: "Finance", icon: ICONS.receipt },
  { href: "/admin/customers", label: "Customers", icon: ICONS.users },
  { href: "/admin/vehicles", label: "Vehicles", icon: ICONS.truck },
  { href: "/admin/pricing", label: "Pricing rules", icon: ICONS.sliders },
  { href: "/admin/drivers", label: "Drivers", icon: ICONS.wheel },
  { href: "/profile", label: "My profile", icon: ICONS.user },
];
const DRIVER_NAV: NavItem[] = [
  { href: "/driver", label: "My jobs", icon: ICONS.list, exact: true },
  { href: "/profile", label: "Profile", icon: ICONS.user },
];

export function Brand({ dark = true }: { dark?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500 text-white shadow-sm">
        {ICONS.truck}
      </span>
      <span className={cn("text-lg font-bold tracking-tight", dark ? "text-white" : "text-slate-900")}>
        Loadline
      </span>
    </span>
  );
}

export function AppShell({
  user,
  children,
}: {
  user: { name: string; email: string; role: UserRole; companyName: string | null };
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const nav =
    user.role === "admin"
      ? STAFF_NAV
      : user.role === "dispatcher"
        ? STAFF_NAV.filter((item) => item.href !== "/admin/pricing")
        : user.role === "driver"
          ? DRIVER_NAV
          : CUSTOMER_NAV;

  const isActive = (item: NavItem) =>
    item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/");

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5">
        <Link href={nav[0].href} onClick={() => setOpen(false)}>
          <Brand />
        </Link>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-2">
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
              isActive(item)
                ? "bg-white/10 text-white"
                : "text-slate-300 hover:bg-white/5 hover:text-white",
            )}
          >
            <span className={cn(isActive(item) ? "text-orange-400" : "text-slate-400")}>{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="border-t border-white/10 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-500/20 text-sm font-bold text-orange-300">
            {user.name
              .split(" ")
              .map((p) => p[0])
              .slice(0, 2)
              .join("")
              .toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{user.name}</p>
            <p className="truncate text-xs text-slate-400">{user.companyName ?? user.email}</p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-300">
            {user.role}
          </span>
          <button
            onClick={logout}
            disabled={loggingOut}
            className="text-xs font-medium text-slate-300 hover:text-white disabled:opacity-50"
          >
            {loggingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      <aside className="hidden w-64 shrink-0 bg-slate-900 lg:fixed lg:inset-y-0 lg:block">{sidebar}</aside>

      {/* Mobile header */}
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 lg:hidden">
        <Brand dark={false} />
        <button
          onClick={() => setOpen(true)}
          className="rounded-lg p-2 text-slate-700 hover:bg-slate-100"
          aria-label="Open menu"
        >
          {ICONS.list}
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-slate-900 shadow-xl">{sidebar}</aside>
        </div>
      )}

      <main className="flex-1 lg:pl-64">
        <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-10">{children}</div>
      </main>
    </div>
  );
}
