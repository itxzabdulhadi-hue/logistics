# Loadline — Feature Specification (Phases 0–2)

## 1. Personas

| Persona | Who | Primary goal |
| --- | --- | --- |
| **Customer** | Businesses (warehouses, retailers, builders) and individuals needing a truck now or at a scheduled time | Book the right truck quickly, know the price up front, see what is happening with the job. |
| **Admin / Dispatcher** | Loadline operations staff | Keep every job moving: confirm, price, assign the right driver + vehicle, resolve problems, manage the fleet and customers. |
| **Driver** (future phase) | Owner-drivers and fleet drivers | See assigned jobs, execute them step by step, capture proof of delivery. |

---

## 2. Customer journey

1. **Discover & register** — landing page explains the service and vehicle classes; the customer registers with name, email, phone, optional company name, password. Registration logs them in.
2. **Dashboard** — KPIs (active jobs, completed jobs, total spend, next pickup), a prominent **Book a truck** call-to-action, and the latest bookings.
3. **Create booking**
   1. Enter pickup and delivery addresses with autocomplete; add up to four ordered stops when needed.
   2. Calculate a driving route → review its map, road distance and estimated drive time.
   3. Choose a vehicle class based on capacity, then describe the load (weight, pallets, item count).
   4. Choose ASAP or a scheduled pickup time and any additional services (tailgate lifter, hand unload).
   5. Review the itemized quote (base fare, routed distance, minimum adjustment, stop/service fees, ASAP surcharge, GST).
   6. Add on-site contacts, instructions and payment method, then **Confirm booking**.
   7. The server resolves the route and recalculates the price at submission; redirect to the booking detail page with the reference and status `pending`.
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

## 4. Driver journey (future phase — not built)

Login → "My jobs" (assigned, ordered by pickup time) → job detail with addresses/contacts → buttons: *On my way*, *Picked up*, *Delivered* (photo + signature POD) → job history. The schema (driver role, `driver_id` on bookings, `vehicles.driver_id`, event log, lat/lng) supports this without changing the booking workflow.

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

---

## 7. Phase 2 — Maps & quotation (implemented)

### Customer booking flow
- [x] Route first: pickup, drop-off and up to four ordered additional stops.
- [x] Debounced address autocomplete scoped to Australia.
- [x] Server-side geocoding and real road routing; show route distance, estimated driving time and route visualization.
- [x] Select vehicle and enter load details after the route is mapped.
- [x] Live itemized quote with base fare, distance, minimum-charge adjustment, additional stops, services, ASAP surcharge and GST.
- [x] Confirmation step with site contacts, instructions, payment method and booking summary.
- [x] Re-resolve route and recalculate price server-side when the booking is created; never trust browser distance/coordinates.
- [x] Persist stop order, stop coordinates, routed distance, estimated duration and quoted total.

### Admin pricing
- [x] Configure per-stop, tailgate, hand-unload, ASAP surcharge and GST rates at `/admin/pricing` (admin only).
- [x] Continue to configure vehicle base fare, per-kilometre rate and minimum fare under Fleet → vehicle classes.

### Maps provider

Autocomplete and geocoding use Photon; driving routes use OSRM; the embedded route preview uses OpenStreetMap tiles and includes attribution. Google Maps directions are also available as an external link. The public demo endpoints require no API key but have no production SLA; a production deployment should use a contracted or self-hosted provider.
