# Loadline — Architecture (Phase 0 output)

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

* **Customer**: register → log in → dashboard → create booking (quote → confirm) → track status in booking history/details → cancel while allowed → manage profile.
* **Admin / Dispatcher**: log in → dashboard (what needs attention) → review pending jobs → confirm → assign driver + vehicle → progress statuses → adjust final price / notes → complete or cancel → manage customers (view, suspend) and fleet (vehicle types & rates, vehicles, drivers).
* **Driver** (Phase 2+): log in → see assigned jobs → progress job (en route → picked up → delivered) → capture POD.

---

## 3. MVP scope decision

**In Phase 1 (this build):**

* Email/password authentication (customer self-registration, seeded admin), JWT session cookie, password reset tokens, role-based permissions.
* Customer: dashboard, profile, create booking with instant quote, booking history (filters + pagination), booking details with status timeline, cancellation.
* Admin: dashboard KPIs, booking management (status workflow, driver/vehicle assignment, final price, notes), customer management, fleet management (vehicle types + pricing, vehicles, drivers).
* REST API with validation (zod), consistent error envelope, structured logging, PostgreSQL via Drizzle.

**Deliberately deferred:** driver mobile UI, live GPS tracking, card payments (Stripe), invoices/PDF, email delivery, multi-drop legs, ratings, notifications, marketplace auto-dispatch. The schema already carries the hooks for these (driver role, vehicle↔driver link, lat/lng columns, event log).

---

## 4. Stack

| Concern | Choice | Why |
| --- | --- | --- |
| Framework | **Next.js 16 (App Router)**, React 19, TypeScript | Single codebase for SSR UI + REST API route handlers. |
| Database | **PostgreSQL** via **Drizzle ORM** (`pg` driver) | Relational data (bookings ↔ users ↔ vehicles), type-safe queries, `drizzle-kit push` for schema. |
| Styling | **Tailwind CSS v4** | Fast, consistent UI without a component library dependency. |
| Auth | **JWT (HS256, `jose`)** in an `httpOnly` cookie; passwords hashed with **scrypt** (`node:crypto`) | Stateless sessions, no native deps, no third-party auth service. |
| Validation | **zod** | Shared request schemas for API routes; detailed 422 errors. |
| Geocoding | OpenStreetMap Nominatim (best-effort) with manual-distance fallback | Instant quotes need a distance; no paid maps key required for MVP. |
| Logging | Lightweight structured JSON logger (`src/lib/logger.ts`) | Request/response + error logs; swap for pino/Datadog later. |

---

## 5. System architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ Browser                                                              │
│  • Server-rendered pages (React Server Components) for reads         │
│  • Client components call the REST API for mutations (fetch/JSON)    │
└───────────────▲──────────────────────────────┬───────────────────────┘
                │ HTML                          │ JSON (cookie: ll_session JWT)
┌───────────────┴──────────────────────────────▼───────────────────────┐
│ Next.js 16 app (src/app)                                             │
│                                                                      │
│  Route groups           API route handlers (src/app/api/**)          │
│  ├ (auth)   login …     ├ /api/auth/*         register/login/reset   │
│  ├ (customer) dashboard ├ /api/bookings/*     create/list/get/patch  │
│  │    bookings, profile ├ /api/quote          price estimate         │
│  └ admin/*  dashboard,  ├ /api/profile        self-service           │
│       bookings,         ├ /api/vehicle-types  public catalogue       │
│       customers, fleet  └ /api/admin/*        stats, customers, fleet│
│                                                                      │
│  src/lib        auth (jwt, cookies, permissions), api (errors,       │
│                 handler wrapper), validation (zod), booking-rules    │
│                 (status machine, pricing, references), geocode,      │
│                 logger, seed                                         │
│  src/services   bookings.ts · users.ts · fleet.ts  (all DB access)   │
│  src/db         schema.ts (Drizzle) · index.ts (pool)                │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ SQL (pg pool)
                     ┌──────────▼───────────┐        ┌────────────────┐
                     │ PostgreSQL           │        │ Nominatim (OSM)│
                     └──────────────────────┘        └────────────────┘
```

Design rules:

* **Pages read through services, never raw SQL in components.** The same service functions back the REST API, so UI and API can never drift.
* **All mutations go through the REST API** (`/api/**`) so the surface is reusable by a future driver app / mobile client.
* **Authorization is enforced server-side twice:** the layout for each route group redirects unauthenticated / wrong-role users, and every API handler calls `requireApiUser(permission)`.
* **Prices are always recomputed server-side** from the vehicle type's current rates — the client's displayed quote is informational only.
* **Every status change writes a `booking_events` row** (who, from → to, note, when); the booking row itself caches the current status and milestone timestamps for cheap querying.

---

## 6. Database design

Entity relationship overview:

```
users 1──∞ bookings ∞──1 vehicle_types
  │            │ ∞──0..1 vehicles ∞──1 vehicle_types
  │            │ ∞──0..1 users (driver)
  │            └─1──∞ booking_events ∞──0..1 users (actor)
  ├─0..1 vehicles (driver ↔ vehicle)
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

**password_reset_tokens** — hashed one-time tokens, 1 h expiry, `used_at` set on consumption.

**vehicle_types** — the bookable classes and their tariff.

| column | notes |
| --- | --- |
| code (unique), name, description | e.g. `van`, `2t_pantech` |
| max_weight_kg, max_length_m, max_pallets | capacity guidance shown to customers |
| base_fare_cents, per_km_rate_cents, minimum_charge_cents | tariff used by the quote engine |
| active, sort_order | catalogue control |

**vehicles** — physical fleet units (`registration` unique), linked to a `vehicle_type` and optionally a `driver` (user). `status`: `available`, `in_use`, `maintenance`, `inactive`.

**bookings** — the job. Key groups of columns:

* identity: `reference` (unique, `LL-XXXXXX`), `customer_id`, `vehicle_type_id`, optional `vehicle_id`, `driver_id`
* workflow: `status` (enum below), milestone timestamps (`confirmed_at`, `assigned_at`, `picked_up_at`, `delivered_at`, `completed_at`, `cancelled_at`)
* pickup / dropoff: address, suburb, state, postcode, contact name/phone, instructions, lat/lng
* schedule: `is_asap`, `scheduled_at`
* load: `load_description`, `weight_kg`, `pallets`, `item_count`, `requires_tailgate`, `requires_hand_unload`
* money: `distance_km`, `quoted_price_cents`, `final_price_cents`, `currency` (AUD), `payment_method` (`card` | `account`)
* notes: `customer_notes`, `admin_notes`, `cancellation_reason`

Indexes on `customer_id`, `driver_id`, `status`, `scheduled_at`.

**booking_events** — append-only audit/timeline: `booking_id`, `from_status`, `to_status`, `actor_id`, `actor_role`, `note`, `created_at`.

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
                             ▼ POD captured
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
* `assigned` requires a driver on the booking.

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
| `POST /api/quote` | public | price estimate (geocodes addresses, or accepts manual km) |
| `GET /api/bookings` | customer / staff | own bookings (customer) or all (staff); `status`, `q`, `page` filters |
| `POST /api/bookings` | customer | create booking (server recomputes price) |
| `GET /api/bookings/:id` | owner / staff | booking detail + timeline |
| `PATCH /api/bookings/:id` | owner / staff | `{action:"cancel"}` (owner) · `{action:"transition"|"assign"|"update"}` (staff) |
| `GET/PATCH /api/profile` · `PUT /api/profile/password` | any | self-service profile + password |
| `GET /api/admin/stats` | staff | dashboard KPIs |
| `GET /api/admin/customers` · `GET/PATCH /api/admin/customers/:id` | staff | customer list / detail / suspend |
| `GET/POST /api/admin/vehicles` · `PATCH/DELETE /api/admin/vehicles/:id` | staff | fleet CRUD |
| `GET/POST /api/admin/vehicle-types` · `PATCH /api/admin/vehicle-types/:id` | staff | classes + tariffs |
| `GET/POST /api/admin/drivers` | staff | driver accounts |

### Permissions

| role | permissions |
| --- | --- |
| customer | `bookings:create`, `bookings:read:own`, `bookings:cancel:own`, `profile:manage` |
| dispatcher | `bookings:read:any`, `bookings:manage`, `customers:read`, `fleet:read`, `fleet:manage`, `profile:manage` |
| admin | everything above + `customers:manage`, `users:manage` |
| driver (Phase 2) | `bookings:read:assigned`, `bookings:progress`, `profile:manage` |

---

## 9. Pricing engine (quote)

```
distance_component = distance_km × per_km_rate
core               = max(minimum_charge, base_fare + distance_component)
extras             = tailgate ($25) + hand unload ($45) + ASAP surcharge (15 % of core)
subtotal           = core + extras
GST (10 %)         = subtotal × 0.10
total              = subtotal + GST
```

Distance comes from Nominatim geocoding of both addresses (haversine × 1.25 road factor). If geocoding is unavailable the customer enters an approximate distance; dispatchers can override the final price.

---

## 10. Repository layout

```
docs/                      Phase 0 deliverables (this file + FEATURE_SPEC.md)
src/db/schema.ts           Drizzle schema (source of truth)
src/lib/                   auth, api helpers, validation, booking rules, geocode, logger, seed
src/services/              data access & business operations
src/components/            UI primitives + client components (forms, managers)
src/app/(auth)/            login, register, forgot/reset password
src/app/(customer)/        dashboard, bookings, profile
src/app/admin/             admin dashboard, bookings, customers, vehicles, drivers
src/app/api/               REST API
```
