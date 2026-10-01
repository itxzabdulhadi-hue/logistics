# Loadline — Feature Specification (Phase 0 → Phase 1)

## 1. Personas

| Persona | Who | Primary goal |
| --- | --- | --- |
| **Customer** | Businesses (warehouses, retailers, builders) and individuals needing a truck now or at a scheduled time | Book the right truck quickly, know the price up front, see what is happening with the job. |
| **Admin / Dispatcher** | Loadline operations staff | Keep every job moving: confirm, price, assign the right driver + vehicle, resolve problems, manage the fleet and customers. |
| **Driver** (Phase 2) | Owner-drivers and fleet drivers | See assigned jobs, execute them step by step, capture proof of delivery. |

---

## 2. Customer journey

1. **Discover & register** — landing page explains the service and vehicle classes; the customer registers with name, email, phone, optional company name, password. Registration logs them in.
2. **Dashboard** — KPIs (active jobs, completed jobs, total spend, next pickup), a prominent **Book a truck** call-to-action, and the latest bookings.
3. **Create booking**
   1. Choose vehicle class (cards with capacity + rate guidance).
   2. Enter pickup and delivery addresses + on-site contacts and instructions.
   3. Choose ASAP or a scheduled pickup date/time.
   4. Describe the load (description, weight, pallets, item count) and extras (tailgate, hand unload).
   5. Click **Get quote** → live price breakdown (base, distance, extras, GST). If the address cannot be geocoded the customer enters an approximate distance.
   6. Select payment method (card / on account), add notes, **Confirm booking**.
   7. Redirect to the booking detail page with the booking reference; status is `pending`.
4. **Booking history** — table of all bookings with status filter, free-text search (reference / address), pagination.
5. **Booking details** — reference, status badge, route, schedule, load, driver/vehicle (once assigned), price (quoted vs final), status timeline with dispatcher notes, **Cancel booking** (allowed while `pending`, `confirmed`, `assigned`).
6. **Profile** — update name/phone/company, change password.
7. **Forgot password** — request a reset link, set a new password with the token.

## 3. Admin / Dispatcher journey

1. **Login** — staff accounts are seeded/created by an admin; staff land on `/admin`.
2. **Dashboard** — jobs needing dispatch (pending), active jobs, jobs scheduled today, revenue this month, customers, available vehicles, status breakdown, latest bookings.
3. **Booking management**
   * List with filters (status, search) and pagination.
   * Detail page shows everything the customer sees plus customer contact details and internal notes.
   * Actions: **Confirm**, **Assign** driver + vehicle, progress through `en_route_pickup → picked_up → in_transit → delivered → completed`, **Cancel**/**Fail** with reason, **Unassign**, set **final price**, edit **admin notes**. Every action is written to the timeline.
4. **Customer management** — searchable list with booking counts and lifetime spend, detail page with booking history, **suspend / reactivate** account.
5. **Fleet management**
   * **Vehicle types**: create/edit classes, capacities, base fare, per-km rate, minimum charge, active flag.
   * **Vehicles**: create/edit/delete units, status (available / in use / maintenance / inactive), link to a driver.
   * **Drivers**: create driver accounts, see linked vehicle.

## 4. Driver journey (Phase 2 — designed, not built)

Login → "My jobs" (assigned, ordered by pickup time) → job detail with addresses/contacts → buttons: *On my way*, *Picked up*, *Delivered* (photo + signature POD) → job history. The Phase 1 schema (driver role, `driver_id` on bookings, `vehicles.driver_id`, event log, lat/lng) supports this without migration.

---

## 5. Booking / job statuses

| Status | Meaning | Set by | Allowed next |
| --- | --- | --- | --- |
| `pending` | Submitted by customer, awaiting review | system (on create) | `confirmed`, `cancelled` |
| `confirmed` | Accepted by dispatch, price locked | staff | `assigned`, `cancelled` |
| `assigned` | Driver + vehicle allocated | staff | `en_route_pickup`, `confirmed` (unassign), `cancelled` |
| `en_route_pickup` | Driver travelling to pickup | staff / driver | `picked_up`, `failed`, `cancelled` |
| `picked_up` | Load collected | staff / driver | `in_transit`, `delivered` |
| `in_transit` | Travelling to delivery | staff / driver | `delivered`, `failed` |
| `delivered` | Delivered, POD captured | staff / driver | `completed` |
| `completed` | Closed & invoiced | staff | — |
| `cancelled` | Cancelled by customer or staff | customer / staff | — |
| `failed` | Could not be completed (no access, refused, breakdown) | staff / driver | `confirmed` (re-dispatch) |

"Active" for dashboards = `pending`, `confirmed`, `assigned`, `en_route_pickup`, `picked_up`, `in_transit`, `delivered`.

---

## 6. Phase 1 feature checklist

### Authentication
- [x] Customer registration (`/register`) and login (`/login`)
- [x] Admin / dispatcher login (same form, role-based redirect)
- [x] Password reset request + token-based reset (`/forgot-password`, `/reset-password`)
- [x] JWT session in `httpOnly` cookie, 7-day expiry, logout
- [x] Role & permission checks in layouts and in every API route

### Customer
- [x] Dashboard with KPIs and recent jobs
- [x] Profile (details + password)
- [x] Create booking with instant quote
- [x] Booking history (filters, search, pagination)
- [x] Booking details with timeline and cancellation

### Admin
- [x] Dashboard with operational KPIs
- [x] Customer management (list, detail, suspend/reactivate)
- [x] Booking management (status workflow, assignment, pricing, notes)
- [x] Basic vehicle management (vehicle types & tariffs, vehicles, drivers)

### Backend
- [x] REST API (`/api/**`)
- [x] PostgreSQL schema via Drizzle (`npx drizzle-kit push`)
- [x] zod validation with field-level 422 errors
- [x] Consistent error envelope & `ApiError` handling
- [x] Structured request / error logging
- [x] Idempotent seed data (admin, customer, drivers, vehicle types, vehicles, sample jobs)

### Demo accounts (seeded)

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@loadline.demo` | `Admin123!` |
| Dispatcher | `dispatch@loadline.demo` | `Dispatch123!` |
| Customer | `customer@loadline.demo` | `Customer123!` |
| Driver | `driver@loadline.demo` | `Driver123!` |

### Acceptance test (end of Phase 1)

1. Register a new customer → land on dashboard.
2. Create a booking → quote shown → confirm → detail page shows `pending` with reference.
3. Log in as admin → booking appears in `/admin/bookings` and the dashboard "needs dispatch" list.
4. Confirm → assign driver + vehicle → progress to delivered → completed; each step appears in the customer's timeline.
5. Customer can cancel a different pending booking; admin sees it as cancelled.
