import Link from "next/link";
import { Brand } from "@/components/app-shell";
import { LinkButton } from "@/components/ui";
import { getCurrentUser, homeForRole } from "@/lib/auth";
import { ensureSeeded } from "@/lib/seed";
import { formatMoney } from "@/lib/utils";
import { listVehicleTypes } from "@/services/fleet";

export const dynamic = "force-dynamic";

const STEPS = [
  { title: "Map the route, choose a truck", body: "Enter pickup and delivery addresses with autocomplete, add any stops, see the driving route and estimated time, then choose a vehicle and get an itemized price." },
  { title: "We dispatch the right truck", body: "Our dispatch team confirms your job and allocates a vetted driver and vehicle — ASAP or at your scheduled time." },
  { title: "Track it to the door", body: "Follow every status change from confirmation to delivery in your booking timeline, with notes from dispatch." },
];

export default async function HomePage() {
  await ensureSeeded();
  const [user, vehicleTypes] = await Promise.all([getCurrentUser(), listVehicleTypes({ activeOnly: true })]);

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-20 border-b border-slate-100 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/">
            <Brand dark={false} />
          </Link>
          <nav className="flex items-center gap-3">
            {user ? (
              <LinkButton href={homeForRole(user.role)} size="sm">
                Go to {user.role === "admin" || user.role === "dispatcher" ? "dispatch console" : "dashboard"}
              </LinkButton>
            ) : (
              <>
                <Link href="/login" className="text-sm font-medium text-slate-700 hover:text-slate-900">
                  Sign in
                </Link>
                <LinkButton href="/register" size="sm">
                  Get started
                </LinkButton>
              </>
            )}
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden bg-slate-900">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(249,115,22,0.35),_transparent_55%)]" />
        <div className="relative mx-auto grid max-w-6xl gap-12 px-6 py-20 lg:grid-cols-2 lg:py-28">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-orange-300">
              Same-day &amp; scheduled truck hire
            </p>
            <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl">
              Book a truck in minutes. <span className="text-orange-400">Know the price up front.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-slate-300">
              From a ute for a few boxes to a semi for 22 pallets — Loadline gives you an instant quote, a dedicated dispatcher, and a live status timeline for every job.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton href={user ? "/bookings/new" : "/register"} size="lg">
                Get an instant quote
              </LinkButton>
              <LinkButton href="/login" size="lg" variant="secondary">
                Dispatcher sign in
              </LinkButton>
            </div>
            <dl className="mt-10 grid grid-cols-3 gap-6 border-t border-white/10 pt-8">
              {[
                ["8", "vehicle classes"],
                ["< 60s", "to a quote"],
                ["10", "job status milestones"],
              ].map(([v, l]) => (
                <div key={l}>
                  <dt className="text-2xl font-bold text-white">{v}</dt>
                  <dd className="text-sm text-slate-400">{l}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Try the demo</p>
            <ul className="mt-4 space-y-3 text-sm">
              {[
                ["Customer", "customer@loadline.demo", "Customer123!"],
                ["Dispatcher", "dispatch@loadline.demo", "Dispatch123!"],
                ["Admin", "admin@loadline.demo", "Admin123!"],
              ].map(([role, email, pw]) => (
                <li key={role} className="flex items-center justify-between gap-4 rounded-xl bg-slate-800/60 px-4 py-3">
                  <span className="font-semibold text-white">{role}</span>
                  <span className="text-right font-mono text-xs text-slate-300">
                    {email}
                    <br />
                    {pw}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-slate-400">Or register your own customer account — it takes 20 seconds.</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900">How it works</h2>
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={s.title} className="rounded-2xl border border-slate-200 p-6">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-orange-500 text-sm font-bold text-white">
                {i + 1}
              </div>
              <h3 className="text-lg font-semibold text-slate-900">{s.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-slate-50 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-3xl font-bold tracking-tight text-slate-900">Pick the right vehicle</h2>
              <p className="mt-2 text-slate-600">Transparent quotes from your routed distance, vehicle class, stops and services. GST included at checkout.</p>
            </div>
          </div>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {vehicleTypes.map((vt) => (
              <div key={vt.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-900">{vt.name}</h3>
                <p className="mt-1 flex-1 text-sm text-slate-600">{vt.description}</p>
                <dl className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-500">
                  <div>
                    <dt>Payload</dt>
                    <dd className="font-semibold text-slate-900">{vt.maxWeightKg.toLocaleString()} kg</dd>
                  </div>
                  <div>
                    <dt>Pallets</dt>
                    <dd className="font-semibold text-slate-900">{vt.maxPallets ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Base fare</dt>
                    <dd className="font-semibold text-slate-900">{formatMoney(vt.baseFareCents)}</dd>
                  </div>
                  <div>
                    <dt>Per km</dt>
                    <dd className="font-semibold text-slate-900">{formatMoney(vt.perKmRateCents)}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 py-10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 text-sm text-slate-500">
          <Brand dark={false} />
          <p>Route-based quoting + dispatch console. Driver tools are planned for a future phase.</p>
        </div>
      </footer>
    </div>
  );
}
