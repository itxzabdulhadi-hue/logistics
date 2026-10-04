# Loadline — on-demand truck booking SaaS (Instatruck-style)

Architecture and feature notes live in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/FEATURE_SPEC.md`](docs/FEATURE_SPEC.md), covering the core platform, maps/quotation, fleet dispatch, live tracking, multi-stop journeys, and payments/invoicing.

Phase 1 delivers the booking and operations foundation; Phase 2 adds mapped routes and configurable quotes; Phase 3 adds capacity-aware fleet management and the driver workspace; Phase 4 adds opt-in driver GPS, live maps and WebSocket updates; Phase 5 adds ordered multi-stop journeys, lightweight stop optimization, driver stop progress and per-stop ETAs; Phase 6 adds invoice generation, hosted card checkout, payment/refund history and finance reconciliation.

## Stack

Next.js 16 (App Router, RSC + route handlers) · React 19 · TypeScript · PostgreSQL · Drizzle ORM · Stripe Checkout · Tailwind CSS v4 · zod · jose (JWT) · scrypt password hashing

## Run locally

```bash
cp .env.example .env
# Edit .env with your PostgreSQL DATABASE_URL and a local AUTH_SECRET
npm ci
npm run db:push              # creates/updates tables from src/db/schema.ts
npm run dev                  # http://localhost:3000
```

`REDIS_URL` is optional for local development. The Vercel WebSocket upgrade API is platform-specific; under plain `next dev`, tracking automatically falls back to authenticated snapshot sync. Configure Upstash Redis and use Vercel (or its local runtime) to exercise cross-instance WebSocket delivery.

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
| `REDIS_URL` | Required for WebSocket fan-out | Upstash Redis TLS connection URL. Add Upstash from the Vercel Marketplace (or provide a compatible Redis URL) so GPS/status events reach sockets on other Function instances. |
| `STRIPE_SECRET_KEY` | Required for card checkout | Stripe secret API key (`sk_test_...` in test mode; use a restricted live key in Production). Keep it server-side only. |
| `STRIPE_WEBHOOK_SECRET` | Required for payment confirmation | Signing secret (`whsec_...`) for the Stripe webhook endpoint `https://<your-domain>/api/payments/webhook`. Configure the same secret for each Vercel environment. |
| `APP_URL` | Recommended in production | Canonical public origin, e.g. `https://haulage.example`; used for safe Stripe success/cancel return URLs. Vercel's deployment URL is a fallback for preview deployments. |

Set the variables for the appropriate Vercel environments (Production and Preview); keep local values in `.env`. The production app rejects missing or too-short `AUTH_SECRET` values rather than using the development fallback. Do not set `COOKIE_SECURE=false` on Vercel.

In Stripe, register `POST /api/payments/webhook` and enable `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `refund.created`, `refund.updated`, and `refund.failed`. The endpoint verifies Stripe's signature and deduplicates event IDs; return/refresh URLs do not mark an invoice paid. Use Stripe test mode and test cards in Preview before enabling live payments.

Run `npm run db:push` once from a trusted machine or CI shell with the **target database's** `DATABASE_URL` set, before serving the deployment. Schema updates are intentionally not run during Vercel builds. Confirm the database accepts connections from Vercel and set the Vercel Function Region near the database (for example, `syd1` for a Sydney-hosted database); this repo leaves the region unset to avoid pinning functions far from your database.

Demo data (admin, dispatcher, customers, drivers, vehicle classes, fleet, sample jobs) is seeded automatically the first time the app talks to an empty database (via `/api/health`, the landing page, or login). Drivers land on `/driver`; GPS sharing is opt-in per active trip and can be stopped by the driver at any time.

### Demo accounts

| Role | Email | Password | Lands on |
| --- | --- | --- | --- |
| Admin | `admin@loadline.demo` | `Admin123!` | `/admin` |
| Dispatcher | `dispatch@loadline.demo` | `Dispatch123!` | `/admin` |
| Customer | `customer@loadline.demo` | `Customer123!` | `/dashboard` |
| Driver | `driver@loadline.demo` | `Driver123!` | `/driver` |

## What's in Phase 1

**Customer** — register / login / password reset · dashboard KPIs · guided booking · booking history with filters & pagination · booking detail with status timeline · cancel while allowed · profile & password.

**Admin / Dispatcher** — operational dashboard (needs-dispatch queue, KPIs, status breakdown) · booking management (confirm → assign driver + vehicle → en route → picked up → in transit → delivered → completed, cancel / fail / unassign, final price, internal notes, full audit timeline) · customer management (search, detail, suspend / reactivate) · fleet management (vehicle classes & tariffs, vehicles, drivers).

**Backend** — REST API under `/api/**` with zod validation (field-level 422s), consistent `{ error: { code, message, details } }` envelope, structured JSON request/error logging, role & permission checks on every route, JWT `httpOnly` cookie sessions, enforced booking status machine.

## Phase 2 — Maps & quotation

- A four-step customer journey: **route → vehicle/load → quote/schedule → confirmation**.
- Debounced Australian address autocomplete, up to eight ordered additional stops, driving directions, routed distance and estimated travel time.
- The route is visualized on an OpenStreetMap tile map with pickup, stop and delivery markers; a one-click Google Maps directions link is available.
- Quotes itemize vehicle base fare, routed distance, minimum fare adjustment, additional-stop fees, optional services, ASAP surcharge and GST.
- An admin-only `/admin/pricing` screen configures stop/service fees, ASAP surcharge and GST. Vehicle class base fares, per-kilometre rates and minimums remain configurable under **Fleet**.
- Quote and booking APIs resolve addresses and recompute road distance and price server-side. A browser-supplied distance or coordinate cannot set the booking price. Estimated duration and ordered stop addresses/coordinates are stored with the booking.

Route services are implemented with Photon (autocomplete/geocoding), OSRM (driving directions) and OpenStreetMap tiles. The default public endpoints need no key but have no production SLA; replace them with a contracted or self-hosted provider for production workloads.

## Phase 3 — Vehicles & dispatch

- Manage vehicle classes and physical trucks, including rated capacity, operational status, assigned driver, and a dispatcher-maintained last-known location.
- Create driver accounts and profiles with licence details and on-duty/off-duty availability. Driver availability becomes busy while an assigned job is open; the driver and their usual truck are shown on the dispatch roster.
- Use `/admin/dispatch` to see jobs missing a driver or compatible truck, including incomplete assigned jobs that need repair. New assignments require an on-duty driver and an available vehicle of the booked class with enough capacity for the load; a valid resource already allocated to the same incomplete job may be retained.
- Reassign or cancel an assignment from a job's admin detail. These actions release the old vehicle and add an auditable timeline entry. Driver/vehicle collisions are guarded in the service transaction.
- Drivers sign in to `/driver` to see active assignments, route/contact/load information, and progress jobs through en route → picked up → in transit → delivered. Dispatch closes delivered jobs; failed jobs can be reopened for re-dispatch.

### Job lifecycle

```text
pending → confirmed (dispatch may assign directly) → assigned → en route to pickup → picked up → in transit → delivered → completed
   └───────────┴───────────┴────────────────────┴────────→ cancelled (dispatch; customer cancellation ends before en route)
                                     en route / in transit → failed → confirmed (re-dispatch)
assigned → confirmed (cancel assignment / release resources)
```

Fleet's editable vehicle location remains a dispatcher-maintained label; trip GPS is stored separately as the latest booking location.

## Phase 4 — Driver interface & real-time tracking

- Drivers see an assigned job, pickup/drop-off contacts, mapped route, and next status actions in `/driver`. After starting the trip, they can explicitly start or stop browser GPS sharing; each update includes `latitude`, `longitude`, and the device `timestamp` (plus optional accuracy/speed/heading).
- The authenticated `/api/driver/location` endpoint accepts fixes only from the currently assigned driver on an active trip, validates coordinate ranges and freshness, and persists one latest location per booking. GPS is cleared on unassignment or when the job is closed/cancelled/failed.
- Customer booking detail, admin booking detail, and `/admin/dispatch` show the route, last vehicle position, status, progress, and an ETA derived from the booked route estimate. A stale-fix label makes pauses or signal loss visible.
- Vercel's WebSocket upgrade API pushes GPS and booking-status events. Upstash Redis Pub/Sub fans events across Function instances; PostgreSQL remains the durable source of truth. Clients resubscribe and reload state after reconnects/function duration limits. Without Vercel WebSockets (such as plain `next dev`) the UI keeps itself current with authenticated snapshot sync instead.
- For production on Vercel, set `REDIS_URL` to a TLS-enabled Upstash Redis URL. WebSocket support is currently a Vercel beta and each connection is capped at five minutes by this app configuration; reconnect is automatic. ETA is route-based, not a live traffic guarantee.

### Job lifecycle

```text
pending → confirmed (dispatch may assign directly) → assigned → en route to pickup → picked up → in transit → delivered → completed
   └───────────┴───────────┴────────────────────┴────────→ cancelled (dispatch; customer cancellation ends before en route)
                                     en route / in transit → failed → confirmed (re-dispatch)
assigned → confirmed (cancel assignment / release resources)
```

Proof-of-delivery capture, customer/driver notifications, ratings and marketplace auto-dispatch remain future work. Phase 6 below covers payment and invoicing.

## Phase 5 — Multi-stop & smarter routing

- Customers can add up to eight intermediate delivery stops, manually move them up/down, and choose whether to optimize their order.
- When enabled with at least two intermediate stops, OSRM's trip heuristic may reorder only the middle stops; pickup and final delivery remain fixed. If optimization is unavailable, the entered order is retained and shown in the route preview.
- The planned route and ordered stop list are shown to customers, dispatchers and drivers. Intermediate stops store `pending` / `arrived` / `completed` state and timestamps; drivers must mark each stop arrived and completed sequentially while in transit before final delivery.
- Customer/admin tracking shows a route-based ETA and state for each delivery stop. These estimates divide the booked route duration by route progress; they are not live traffic forecasts.

Run `npm run db:push` against the target database to add the route optimization flag. Stop state reuses the existing JSONB `additional_stops` data.

## Phase 6 — Payments, invoices & finance

- Booking quote line items and GST are snapshotted at creation. When dispatch completes a job, the app issues one immutable, numbered invoice from the final price and customer, booking, vehicle and route details; a unique booking constraint and transactional invoice-number sequence prevent duplicates.
- Card invoices use Stripe-hosted Checkout. The customer can retry failed checkout from the booking page. Only signed, idempotently processed Stripe webhooks update payment/refund state; redirect pages are informational, not proof of payment.
- Customers see their invoice, itemized charges, tax, payment status and transaction/refund history. On-account invoices remain outstanding until an admin records a bank payment and optional reference.
- Admins and dispatchers have read-only finance access to monthly net revenue, collected payments, refunds, outstanding balances, recent payment attempts and failed attempts. Admins can issue Stripe refunds or reconcile account payments; refund and manual-payment actions are audited.
- Configure `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and (in production) `APP_URL` as described above. Without Stripe credentials, invoices and account reconciliation remain available; card checkout is visibly disabled.

Run `npm run db:push` against the target database to add the invoice/payment tables and booking quote snapshots (along with any remaining earlier schema changes). Back up production data and review the schema diff before applying it.

## Project layout

```
docs/                 Architecture + feature spec for Phases 0–6
src/db/schema.ts      Drizzle schema (accounts, fleet, bookings, invoices, payments, refunds, webhook ledger)
src/lib/              auth · API helpers · validation · booking rules · routing · invoices · realtime · logger · seed
src/services/         bookings · users · fleet · pricing · tracking · billing (database access)
src/components/       UI primitives, app shell, maps, booking wizard, live tracking, payments, admin and driver operations
src/app/(auth)        login · register · forgot-password · reset-password
src/app/(customer)    dashboard · bookings · bookings/new · bookings/[id] · profile
src/app/admin         dashboard · dispatch · bookings · finance · customers · vehicles · pricing · drivers
src/app/driver        active assignment board + job progress
src/app/api           REST APIs for bookings, GPS, tracking snapshots and WebSockets
```

## Validation

```bash
npx next typegen
npm exec tsc -- --noEmit
npm run build
```
