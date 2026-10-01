# Loadline — on-demand truck booking SaaS (Instatruck-style)

Phase 0 deliverables live in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (stack, system architecture, database design, status model, REST API) and [`docs/FEATURE_SPEC.md`](docs/FEATURE_SPEC.md) (personas, customer / dispatcher / driver journeys, MVP scope, Phase 1 checklist).

Phase 1 delivers the working core platform: **a customer can create a logistics job and an admin/dispatcher can see and manage it.**

## Stack

Next.js 16 (App Router, RSC + route handlers) · React 19 · TypeScript · PostgreSQL · Drizzle ORM · Tailwind CSS v4 · zod · jose (JWT) · scrypt password hashing

## Run locally

```bash
npm install
npx drizzle-kit push          # creates tables from src/db/schema.ts
npm run dev                   # http://localhost:3000
```

`DATABASE_URL` is read from `.env`. Optional: `AUTH_SECRET` (JWT signing secret), `LOG_LEVEL`.

Demo data (admin, dispatcher, customers, drivers, vehicle classes, fleet, sample jobs) is seeded automatically the first time the app talks to an empty database (via `/api/health`, the landing page, or login).

### Demo accounts

| Role | Email | Password | Lands on |
| --- | --- | --- | --- |
| Admin | `admin@loadline.demo` | `Admin123!` | `/admin` |
| Dispatcher | `dispatch@loadline.demo` | `Dispatch123!` | `/admin` |
| Customer | `customer@loadline.demo` | `Customer123!` | `/dashboard` |
| Driver (Phase 2) | `driver@loadline.demo` | `Driver123!` | `/dashboard` |

## What's in Phase 1

**Customer** — register / login / password reset · dashboard KPIs · create booking with instant itemised quote (geocoded or manual distance) · booking history with filters & pagination · booking detail with status timeline · cancel while allowed · profile & password.

**Admin / Dispatcher** — operational dashboard (needs-dispatch queue, KPIs, status breakdown) · booking management (confirm → assign driver + vehicle → en route → picked up → in transit → delivered → completed, cancel / fail / unassign, final price, internal notes, full audit timeline) · customer management (search, detail, suspend / reactivate) · fleet management (vehicle classes & tariffs, vehicles, drivers).

**Backend** — REST API under `/api/**` with zod validation (field-level 422s), consistent `{ error: { code, message, details } }` envelope, structured JSON request/error logging, role & permission checks on every route, JWT `httpOnly` cookie sessions, enforced booking status machine.

## Project layout

```
docs/                 Phase 0 architecture + feature spec
src/db/schema.ts      Drizzle schema (users, password_reset_tokens, vehicle_types, vehicles, bookings, booking_events)
src/lib/              auth · api helpers · validation · booking-rules (status machine, pricing) · geocode · logger · seed
src/services/         bookings · users · fleet (all database access)
src/components/       UI primitives, app shell, forms, admin managers
src/app/(auth)        login · register · forgot-password · reset-password
src/app/(customer)    dashboard · bookings · bookings/new · bookings/[id] · profile
src/app/admin         dashboard · bookings · bookings/[id] · customers · customers/[id] · vehicles · drivers
src/app/api           REST API route handlers
```

## Validation

```bash
npx next typegen
npm exec tsc -- --noEmit
npm run build
```
