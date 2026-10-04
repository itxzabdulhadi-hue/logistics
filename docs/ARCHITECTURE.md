# Loadline — Architecture (Phases 0–5)

Loadline is an Instatruck-style on-demand truck booking SaaS: customers book a truck for a pickup → delivery job, dispatchers confirm/price/assign the job to a driver + vehicle, and drivers execute it. This document captures the Phase 0 decisions: how Instatruck works, the journeys we are modelling, the MVP cut, the stack, the system architecture, the database design, and the REST API surface.

---

## 1. How Instatruck works (what we studied)

Instatruck (AU) is a marketplace/dispatch platform for same-day and scheduled truck hire. The observable workflow:

| Stage | What happens |
| --- | --- |
| Quote | Customer picks a **vehicle class** (ute, van, 1T / 2T / 4T / 8T / 12T pantech or tray, semi), enters **pickup + delivery addresses**, chooses **ASAP or a scheduled window**, describes the **load** (weight, pallets/items, description) and **extras** (tailgate lifter, hand unload, extra labour). An **instant price** is shown (base fare + distance component + extras + GST). |
| Book | Customer confirms, pays by card or on account (business customers), and receives a booking reference. |
| Dispatch | Operations confirm the job, then assign it to a driver/vehicle (manually or via the driver marketplace). Price can be adjusted (e.g. waiting time, tolls). |
| Execution | Driver heads to pickup → loads → in transit → delivers; customer gets status updates & live tracking. |
| Completion | Proof of delivery (photo/signature), job closed, invoice issued, customer rates the driver. |

The three personas that fall out of this are **Customer**, **Admin/Dispatcher**, and **Driver**.

---

## 2. Journeys (summary — full detail in `FEATURE_SPEC.md`)

* **Customer**: register → log in → dashboard → route (pickup → ordered stops → final drop-off, optionally optimized) → vehicle/load → itemized quote → confirmation → booking → follow stop status and live vehicle tracking → cancel/manage profile.
* **Admin / Dispatcher**: log in → dashboard → dispatch board (unassigned jobs + available people/fleet + active vehicle map) → confirm/assign/reassign → review status and GPS progress → adjust final price/notes → complete or cancel → manage customers, driver profiles and fleet.
* **Driver**: log in → set on/off duty → see assigned jobs and planned route → start trip → optionally share device GPS → collect the load → mark each delivery stop arrived/completed in order → report final delivery or exceptions.

---

## 3. MVP scope decision

**Phase 1 — core operations:**

* Email/password authentication, JWT sessions, customer dashboard/profile, booking history/details/cancellation.
* Staff dashboard, booking workflow, customer management, fleet management and vehicle-class tariffs.
* REST API with zod validation, structured logging, PostgreSQL and Drizzle ORM.

**Phase 2 — maps & quotation:**

* Guided customer flow: pickup → up to eight additional stops → drop-off → vehicle/load → quote/schedule → confirmation.
* Australian address autocomplete, route visualization, real road distance and estimated drive time.
* Itemized price: vehicle base fare + routed distance + minimum fare adjustment + stop/service fees + ASAP surcharge + GST.
* Admin-configurable service fees, surcharge and GST, in addition to per-vehicle tariffs.
* Server-side route and price recalculation on booking creation; store route distance, duration, ordered stop locations and route geometry.

**Phase 3 — vehicles & dispatch:**

* Manage physical truck capacity, operating status, assigned driver and dispatcher-maintained last-known label; manage driver profiles, licences and on/off-duty availability.
* Central dispatch board for jobs missing a driver or compatible truck (including incomplete `assigned` records), available drivers and compatible fleet; atomically assign/reassign or release both resources.
* Driver workspace for assigned routes and authorized status progression; retain the booking event log as the operational audit trail.

**Phase 4 — driver interface & live tracking:**

* Drivers explicitly start/stop browser GPS sharing on an active assigned trip; each validated coordinate, device timestamp and optional accuracy/speed/heading is persisted as the booking's latest fix.
* Customer booking details, admin booking details and the dispatch board show the route, live vehicle marker, job status, route-based ETA and delivery progress.
* Vercel WebSockets push location/status events. Redis Pub/Sub fans events across Function instances; PostgreSQL remains the durable source of truth and reconnects reload the latest snapshot.

**Phase 5 — multi-stop & smarter routing:**

* Customers can add up to eight intermediate stops, manually order them, or opt into OSRM's lightweight Trip heuristic. Pickup and final delivery are fixed; failed optimization falls back to the entered order.
* The resulting stop order and optimized flag are persisted with the route geometry. Customer, staff and driver views show the complete journey.
* Intermediate stop status and timestamps live on each existing JSONB stop entry. Drivers mark stops arrived and completed sequentially while in transit, and the server prevents final delivery before the stops are complete.
* Tracking estimates each delivery stop's ETA from the route duration and current route progress; it is deliberately not live-traffic aware.

**Deliberately deferred:** proof-of-delivery photos/signatures, card payments (Stripe), invoices/PDF, email/push notifications, ratings and marketplace auto-dispatch. Fleet's editable vehicle location remains a dispatcher-maintained label and is separate from consented trip GPS.

---

## 4. Stack

| Concern | Choice | Why |
| --- | --- | --- |
| Framework | **Next.js 16 (App Router)**, React 19, TypeScript | Single codebase for SSR UI + REST API route handlers. |
| Database | **PostgreSQL** via **Drizzle ORM** (`pg` driver) | Relational data (bookings ↔ users ↔ vehicles), type-safe queries, `drizzle-kit push` for schema. |
| Styling | **Tailwind CSS v4** | Fast, consistent UI without a component library dependency. |
| Auth | **JWT (HS256, `jose`)** in an `httpOnly` cookie; passwords hashed with **scrypt** (`node:crypto`) | Stateless sessions, no native deps, no third-party auth service. |
| Validation | **zod** | Shared request schemas for API routes; detailed 422 errors. |
| Maps & routing | Photon autocomplete/geocoding + OSRM driving routes + OpenStreetMap tiles | API-key-free route lookup, driving distance/time, and attributed route preview; replace public demo endpoints with a production provider for SLA/volume. |
| Realtime | Vercel `experimental_upgradeWebSocket` + Redis Pub/Sub | Persistent Vercel socket connections with Redis fan-out across instances; latest GPS/status snapshots stay durable in PostgreSQL. Requires `REDIS_URL`; clients reconnect at the configured five-minute function limit. |
| Logging | Lightweight structured JSON logger (`src/lib/logger.ts`) | Request/response + error logs; swap for pino/Datadog later. |

---

## 5. System architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ Browser                                                              │
│  • Server-rendered pages (React Server Components) for reads         │
│  • Client components use REST for mutations/snapshots and WebSockets │
└───────────────▲──────────────────────────────┬───────────────────────┘
                │ HTML                          │ JSON (cookie: ll_session JWT)
┌───────────────┴──────────────────────────────▼───────────────────────┐
│ Next.js 16 app (src/app)                                             │
│                                                                      │
│  Route groups           API route handlers (src/app/api/**)          │
│  ├ (auth)   login …     ├ /api/auth/*         register/login/reset   │
│  ├ (customer) bookings  ├ /api/bookings/*     create/list/get/patch  │
│  │    dashboard/profile├ /api/quote          price estimate         │
│  ├ admin/* dispatch …   ├ /api/driver/*       availability + GPS     │
│  ├ driver/* my jobs    ├ /api/tracking/*     snapshots + WebSocket  │
│  └ profile             └ /api/admin/*        stats, customers, fleet│
│                                                                      │
│  src/lib        auth (jwt, cookies, permissions), api, validation,   │
│                 booking rules, routing, tracking realtime, seed     │
│  src/services   bookings · users · fleet · pricing · tracking       │
│                 (all database access)                                │
│  src/db         schema.ts (Drizzle) · index.ts (pool)                │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ SQL (pg pool)
                     ┌──────────▼───────────┐        ┌────────────────┐
                     │ PostgreSQL           │        │ Photon · OSRM │
                     └──────────────────────┘        │ OSM map tiles  │
                                                     └────────────────┘
```

Design rules:

* **Pages read through services, never raw SQL in components.** The same service functions back the REST API, so UI and API can never drift.
* **All mutations go through the REST API** (`/api/**`) so the surface is reusable by future mobile clients; driver status actions additionally verify the job is currently assigned to that driver.
* **Authorization is enforced server-side twice:** the layout for each route group redirects unauthenticated / wrong-role users, and every API handler calls `requireApiUser(permission)`. Resource availability and status edges are enforced in service transactions.
* **Prices and routes are always recomputed server-side** from the entered addresses, current vehicle tariff and current admin rules; client distance/coordinates are never accepted as the booking price source.
* **Every status change writes a `booking_events` row** (who, from → to, note, when); the booking row itself caches the current status and milestone timestamps for cheap querying.
* **Realtime state is externalized:** the latest driver fix is stored in PostgreSQL, while Redis Pub/Sub relays transient WebSocket events between Vercel Function instances. WebSocket sessions are authenticated, booking subscriptions are authorized server-side, and reconnects reload durable snapshots.

---

## 6. Database design

Entity relationship overview:

```
users 1──∞ bookings ∞──1 vehicle_types
  │            │ ∞──0..1 vehicles ∞──1 vehicle_types
  │            │ ∞──0..1 users (driver)
  │            ├─1──∞ booking_events ∞──0..1 users (actor)
  │            └─1──0..1 booking_live_locations
  ├─0..1 driver_profiles
  ├─0..1 vehicles (one usual vehicle per driver)
  └─1──∞ password_reset_tokens
```

### Tables

**users** — every person on the platform; `role` decides the UI they see.

| column | type | notes |
| --- | --- | --- |
| id | serial PK | |
| email | text, unique, lowercase | login identity |
| password_hash | text | `scrypt$salt$hash` |
| name, phone, company_name | text | company is optional (business accounts) |
| role | enum `user_role` (`customer`, `admin`, `dispatcher`, `driver`) | |
| status | enum `user_status` (`active`, `suspended`) | suspended users cannot log in |
| last_login_at, created_at, updated_at | timestamp | |

**driver_profiles** — one optional operating profile per driver account: `driver_id`, `availability` (`available` / `off_duty`), licence number/class/expiry, notes and timestamps. Busy state and current job are derived from open assigned bookings; account suspension remains on `users.status`.

**password_reset_tokens** — hashed one-time tokens, 1 h expiry, `used_at` set on consumption.

**vehicle_types** — the bookable classes and their tariff.

| column | notes |
| --- | --- |
| code (unique), name, description | e.g. `van`, `2t_pantech` |
| max_weight_kg, max_length_m, max_pallets | capacity guidance shown to customers |
| base_fare_cents, per_km_rate_cents, minimum_charge_cents | tariff used by the quote engine |
| active, sort_order | catalogue control |

**pricing_rules** — singleton, admin-managed rates used for every new quote: `additional_stop_fee_cents`, `tailgate_fee_cents`, `hand_unload_fee_cents`, `asap_surcharge_basis_points`, `gst_rate_basis_points`, `updated_at`.

**vehicles** — physical fleet units (`registration` unique), linked to a `vehicle_type` and optionally one usual `driver` (user). `capacity_kg` may cap the class payload; `current_location` is a dispatcher-maintained last-known label. `status`: `available`, `in_use` (reserved/assigned by dispatch), `maintenance`, `inactive`. Assignment reserves a compatible truck; completion, cancellation, failure or unassignment releases it.

**bookings** — the job. Key groups of columns:

* identity: `reference` (unique, `LL-XXXXXX`), `customer_id`, `vehicle_type_id`, optional `vehicle_id`, `driver_id`
* workflow: `status` (enum below), milestone timestamps (`confirmed_at`, `assigned_at`, `picked_up_at`, `delivered_at`, `completed_at`, `cancelled_at`)
* pickup / dropoff: address, suburb, state, postcode, contact name/phone, instructions, lat/lng
* route: ordered `additional_stops` JSONB array (`address`, `lat`, `lng`, optional `status` = `pending`/`arrived`/`completed`, `arrivedAt`, `completedAt`), OSRM `route_geometry` JSONB, `route_optimized`, road `distance_km`, `estimated_duration_minutes`
* schedule: `is_asap`, `scheduled_at`
* load: `load_description`, `weight_kg`, `pallets`, `item_count`, `requires_tailgate`, `requires_hand_unload`
* money: `quoted_price_cents`, `final_price_cents`, `currency` (AUD), `payment_method` (`card` | `account`)
* notes: `customer_notes`, `admin_notes`, `cancellation_reason`

Indexes on `customer_id`, `driver_id`, `status`, `scheduled_at`.

**booking_events** — append-only audit/timeline: `booking_id`, `from_status`, `to_status`, `actor_id`, `actor_role`, `note`, `created_at`.

**booking_live_locations** — one latest, consented GPS fix per active trip: booking/driver/vehicle IDs, latitude/longitude, optional accuracy/heading/speed, device `captured_at`, and server `received_at`. The row is deleted when the assignment is released or the trip is cancelled, failed or completed; it is not a high-volume breadcrumb history.

All money is stored as **integer cents** to avoid floating point drift; distances are `double precision`.

---

## 7. Booking status model

```
            ┌────────────┐
            │  pending   │  customer submitted, awaiting dispatcher review
            └─────┬──────┘
                  ▼ confirm
            ┌────────────┐
            │ confirmed  │  accepted & priced, not yet assigned
            └─────┬──────┘
                  ▼ assign driver + vehicle
            ┌────────────┐
            │  assigned  │  driver/vehicle allocated          ──┐ unassign
            └─────┬──────┘                                      │ (back to confirmed)
                  ▼ driver departs
            ┌─────────────────┐
            │ en_route_pickup │
            └─────┬───────────┘
                  ▼ loaded
            ┌────────────┐      ┌────────────┐
            │ picked_up  │ ───▶ │ in_transit │
            └─────┬──────┘      └─────┬──────┘
                  └──────────┬────────┘
                             ▼ driver reports delivery
                       ┌────────────┐
                       │ delivered  │
                       └─────┬──────┘
                             ▼ invoiced / closed
                       ┌────────────┐
                       │ completed  │  (terminal)
                       └────────────┘

   cancelled (terminal) ◀── allowed from pending / confirmed / assigned / en_route_pickup
   failed    (terminal-ish) ◀── from en_route_pickup / in_transit; dispatcher may re-dispatch → confirmed
```

* Customers may cancel only while the job is `pending`, `confirmed`, or `assigned`.
* Dispatchers can move through any legal edge; the transition table lives in `src/lib/booking-rules.ts` and is enforced in the service layer.
* `assigned` requires a driver and a compatible vehicle on the booking. Only the dispatch assignment action can create this state; it locks both resources and checks load capacity.
* Driver transitions are limited to their own assigned jobs; delivered jobs remain reserved until dispatch completes them. Assignment cancellation returns the booking to `confirmed` and releases resources.

---

## 8. REST API

Conventions: JSON in/out, cookie-based auth, `{ error: { code, message, details? } }` envelope on failure, `422` for validation errors (with per-field `details`), `401` unauthenticated, `403` forbidden, `404` not found, `409` conflict (duplicate email / illegal status transition).

| Method & path | Auth | Purpose |
| --- | --- | --- |
| `POST /api/auth/register` | public | create customer account, starts session |
| `POST /api/auth/login` | public | email + password → session cookie |
| `POST /api/auth/logout` | any | clear session |
| `GET /api/auth/me` | any | current user |
| `POST /api/auth/password-reset` | public | request reset token (link returned in demo mode) |
| `PUT /api/auth/password-reset` | public | consume token, set new password |
| `GET /api/vehicle-types` | public | active vehicle classes + rates |
| `GET /api/places/autocomplete?q=…` | public | debounced Australia-scoped address suggestions |
| `POST /api/route` | public | geocode the journey; optionally optimize intermediate stops with fixed endpoints and return planned order, distance, duration and geometry |
| `POST /api/quote` | public | itemized quote from server-routed distance and current rates |
| `GET /api/bookings` | customer / driver / staff | own bookings (customer), assigned jobs (driver) or all (staff); `status`, `q`, `page` filters |
| `POST /api/bookings` | customer | create booking (server recomputes price) |
| `GET /api/bookings/:id` | owner / staff | booking detail + timeline |
| `PATCH /api/bookings/:id` | owner / assigned driver / staff | `{action:"cancel"}` (customer) · assigned driver status progress or ordered `{action:"stop", stopIndex, status}` · assign/reassign/unassign, status, price and notes (staff); emits realtime status events |
| `POST /api/driver/location` | assigned driver | validate and persist the latest GPS fix for an active job; publish its location event |
| `GET /api/tracking?bookingIds=…` | booking owner / assigned driver / staff | authorized batch snapshot for route, status, ETA inputs and latest GPS position |
| `GET /api/tracking/socket` | authenticated user | Vercel WebSocket; server authorizes each booking subscription and relays Redis Pub/Sub events |
| `GET/PATCH /api/profile` · `PUT /api/profile/password` | any | self-service profile + password |
| `GET /api/admin/stats` | staff | dashboard KPIs |
| `GET /api/admin/customers` · `GET/PATCH /api/admin/customers/:id` | staff | customer list / detail / suspend |
| `GET/POST /api/admin/vehicles` · `PATCH/DELETE /api/admin/vehicles/:id` | staff | fleet CRUD |
| `GET/POST /api/admin/vehicle-types` · `PATCH /api/admin/vehicle-types/:id` | staff | classes + tariffs |
| `GET/PATCH /api/admin/pricing-rules` | admin | global stop/service fees, ASAP surcharge and GST |
| `GET/POST /api/admin/drivers` · `PATCH /api/admin/drivers/:id` | staff | driver accounts, operating profiles and availability |
| `PATCH /api/driver/availability` | driver | set own on-duty/off-duty state (cannot leave while assigned) |

### Permissions

| role | permissions |
| --- | --- |
| customer | `bookings:create`, `bookings:read:own`, `bookings:cancel:own`, `profile:manage` |
| dispatcher | `bookings:read:any`, `bookings:manage`, `customers:read`, `fleet:read`, `fleet:manage`, `profile:manage` |
| admin | everything above + `customers:manage`, `users:manage` |
| driver | `bookings:read:assigned`, `bookings:progress`, `profile:manage` |

The `/admin/pricing` page and pricing-rules mutation are restricted to the `admin` role.

---

## 9. Pricing engine (quote)

```
distance_component = OSRM driving_distance_km × vehicle_type.per_km_rate
core               = max(minimum_charge, base_fare + distance_component)
minimum_adjustment = core - (base_fare + distance_component)
extras             = (additional_stop_count × configured_stop_fee)
                   + selected_service_fees
                   + (ASAP ? core × configured_surcharge : 0)
subtotal           = core + extras
GST                = subtotal × configured_gst_rate
total              = subtotal + GST
```

Admins configure the stop/service fees, ASAP percentage and GST at `/admin/pricing`; vehicle base fares, per-kilometre rates and minimum charges are managed per class under Fleet. Photon resolves each address and OSRM routes the full ordered stop sequence. If route lookup fails, booking submission fails with a field-level error rather than pricing a straight-line or browser-supplied distance. Dispatch can still override a booking's final price after creation.

---

## 10. Repository layout

```
docs/                      Architecture and feature spec for Phases 0–4
src/db/schema.ts           Drizzle schema (source of truth)
src/lib/                   auth, API helpers, validation, booking rules, routing, tracking realtime, logger, seed
src/services/              bookings, users, fleet, pricing and tracking data access
src/components/            UI primitives, maps, booking wizard, live tracking, admin and driver operations
src/app/(auth)/            login, register, forgot/reset password
src/app/(customer)/        dashboard, bookings, profile
src/app/admin/             dashboard, dispatch, bookings, customers, vehicles, pricing, drivers
src/app/driver/            active jobs, availability and job progression
src/app/api/               REST API (auth, dispatch resources, availability, routing, bookings, admin)
```
