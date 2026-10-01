# Loadline — on-demand truck booking SaaS (Instatruck-style)

Architecture and feature notes live in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/FEATURE_SPEC.md`](docs/FEATURE_SPEC.md), including the Phase 1 core, Phase 2 maps/quotation, and the future driver workflow.

Phase 1 delivers the working core platform: **a customer can create a logistics job and an admin/dispatcher can see and manage it.** Phase 2 adds a real road-routed booking quote and configurable pricing rules.

## Stack

Next.js 16 (App Router, RSC + route handlers) · React 19 · TypeScript · PostgreSQL · Drizzle ORM · Tailwind CSS v4 · zod · jose (JWT) · scrypt password hashing

## Run locally

```bash
cp .env.example .env
# Edit .env with your PostgreSQL DATABASE_URL and a local AUTH_SECRET
npm ci
npm run db:push              # creates/updates tables from src/db/schema.ts
npm run dev                  # http://localhost:3000
```

Maps use Photon, OSRM and OpenStreetMap tiles without a Google API key; booking and admin pages also provide Google Maps directions links. The public map/geocoding/routing endpoints are best-effort demo providers, so use a contracted or self-hosted provider for production traffic.

## Deploy on Vercel

The repo is configured for Vercel in [`vercel.json`](vercel.json): Next.js framework, `npm ci` install, and `npm run build`. Import the repository into Vercel; no custom output directory or Edge runtime is needed. The app uses the Node.js runtime for PostgreSQL and server-side routing calls.

Before the first deployment, add these environment variables in **Vercel → Project → Settings → Environment Variables**:

| Variable | Required | Setup |
| --- | --- | --- |
| `DATABASE_URL` | Yes | A PostgreSQL URL reachable from Vercel. Use your database provider's TLS-enabled pooled/serverless URL where available. |
| `AUTH_SECRET` | Yes in production | Generate a strong value with `openssl rand -base64 32`. Use a different secret for Production and Preview. |
| `LOG_LEVEL` | No | Optional logger setting, e.g. `info`. |
| `PG_POOL_MAX` | No | Defaults to `1` connection per serverless instance; raise only if your database connection budget allows it. |

Set the variables for the appropriate Vercel environments (Production and Preview); keep local values in `.env`. The production app rejects missing or too-short `AUTH_SECRET` values rather than using the development fallback. Do not set `COOKIE_SECURE=false` on Vercel.

Run `npm run db:push` once from a trusted machine or CI shell with the **target database's** `DATABASE_URL` set, before serving the deployment. Schema updates are intentionally not run during Vercel builds. Confirm the database accepts connections from Vercel and set the Vercel Function Region near the database (for example, `syd1` for a Sydney-hosted database); this repo leaves the region unset to avoid pinning functions far from your database.

Demo data (admin, dispatcher, customers, drivers, vehicle classes, fleet, sample jobs) is seeded automatically the first time the app talks to an empty database (via `/api/health`, the landing page, or login).

### Demo accounts

| Role | Email | Password | Lands on |
| --- | --- | --- | --- |
| Admin | `admin@loadline.demo` | `Admin123!` | `/admin` |
| Dispatcher | `dispatch@loadline.demo` | `Dispatch123!` | `/admin` |
| Customer | `customer@loadline.demo` | `Customer123!` | `/dashboard` |
| Driver | `driver@loadline.demo` | `Driver123!` | `/dashboard` |

## What's in Phase 1

**Customer** — register / login / password reset · dashboard KPIs · guided booking · booking history with filters & pagination · booking detail with status timeline · cancel while allowed · profile & password.

**Admin / Dispatcher** — operational dashboard (needs-dispatch queue, KPIs, status breakdown) · booking management (confirm → assign driver + vehicle → en route → picked up → in transit → delivered → completed, cancel / fail / unassign, final price, internal notes, full audit timeline) · customer management (search, detail, suspend / reactivate) · fleet management (vehicle classes & tariffs, vehicles, drivers).

**Backend** — REST API under `/api/**` with zod validation (field-level 422s), consistent `{ error: { code, message, details } }` envelope, structured JSON request/error logging, role & permission checks on every route, JWT `httpOnly` cookie sessions, enforced booking status machine.

## Phase 2 — Maps & quotation

- A four-step customer journey: **route → vehicle/load → quote/schedule → confirmation**.
- Debounced Australian address autocomplete, up to four ordered additional stops, driving directions, routed distance and estimated travel time.
- The route is visualized on an OpenStreetMap tile map with pickup, stop and delivery markers; a one-click Google Maps directions link is available.
- Quotes itemize vehicle base fare, routed distance, minimum fare adjustment, additional-stop fees, optional services, ASAP surcharge and GST.
- An admin-only `/admin/pricing` screen configures stop/service fees, ASAP surcharge and GST. Vehicle class base fares, per-kilometre rates and minimums remain configurable under **Fleet**.
- Quote and booking APIs resolve addresses and recompute road distance and price server-side. A browser-supplied distance or coordinate cannot set the booking price. Estimated duration and ordered stop addresses/coordinates are stored with the booking.

Route services are implemented with Photon (autocomplete/geocoding), OSRM (driving directions) and OpenStreetMap tiles. The default public endpoints need no key but have no production SLA; replace them with a contracted or self-hosted provider for production workloads.

## Project layout

```
docs/                 Phase 0 architecture + feature spec
src/db/schema.ts      Drizzle schema (users, fleet, pricing_rules, bookings, booking_events)
src/lib/              auth · api helpers · validation · booking-rules · route geocoding · logger · seed
src/services/         bookings · users · fleet · pricing (all database access)
src/components/       UI primitives, app shell, route map, address autocomplete, booking wizard, admin managers
src/app/(auth)        login · register · forgot-password · reset-password
src/app/(customer)    dashboard · bookings · bookings/new · bookings/[id] · profile
src/app/admin         dashboard · bookings · bookings/[id] · customers · customers/[id] · vehicles · pricing · drivers
src/app/api           REST API route handlers
```

## Validation

```bash
npx next typegen
npm exec tsc -- --noEmit
npm run build
```
