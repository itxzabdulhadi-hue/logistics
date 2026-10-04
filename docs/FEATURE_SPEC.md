# Loadline — Feature Specification (Phases 0–4)

## 1. Personas

| Persona | Who | Primary goal |
| --- | --- | --- |
| **Customer** | Businesses (warehouses, retailers, builders) and individuals needing a truck now or at a scheduled time | Book the right truck quickly, know the price up front, see what is happening with the job. |
| **Admin / Dispatcher** | Loadline operations staff | Keep every job moving: confirm, price, assign the right driver + vehicle, resolve problems, manage the fleet and customers. |
| **Driver** | Owner-drivers and fleet drivers | Manage on-duty availability, see current assignments and progress each job through delivery. |

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
5. **Booking details** — reference, status badge, route, schedule, load, driver/vehicle (once assigned), price (quoted vs final), status timeline with dispatcher notes, live vehicle map/status/progress/ETA when assigned, **Cancel booking** (allowed while `pending`, `confirmed`, `assigned`).
6. **Profile** — update name/phone/company, change password.
7. **Forgot password** — request a reset link, set a new password with the token.

## 3. Admin / Dispatcher journey

1. **Login** — staff accounts are seeded/created by an admin; staff land on `/admin`.
2. **Dashboard** — jobs needing dispatch (pending), active jobs, jobs scheduled today, revenue this month, customers, available vehicles, status breakdown, latest bookings.
3. **Dispatch & booking management**
   * `/admin/dispatch` lists jobs still needing a driver/truck, shows the live available-driver/vehicle roster, and maps GPS positions/status/progress for active assigned vehicles.
   * Dispatch assigns a driver and a truck of the booked class whose capacity supports the load; it confirms pending jobs and reserves both resources atomically.
   * Booking list filters by status/search; detail shows customer and route information, timeline and current assignment.
   * Actions: **Confirm**, **Assign / Reassign**, **Cancel assignment** (release driver + vehicle), progress/cancel/fail jobs, set **final price**, edit **admin notes**. Every action is written to the timeline.
4. **Customer management** — searchable list with booking counts and lifetime spend, detail page with booking history, **suspend / reactivate** account.
5. **Fleet & driver management**
   * **Vehicle types**: create/edit classes, capacities, base fare, per-km rate, minimum charge, active flag.
   * **Vehicles**: create/edit/delete units, capacity, status (available / in use / maintenance / inactive), current last-known location, link to a single driver.
   * **Drivers**: create accounts and profiles with licence details, on-duty/off-duty availability, assigned vehicle and current job.
   * Busy/suspended/off-duty drivers and allocated trucks cannot be selected for a new dispatch.

## 4. Driver journey (Phases 3–4 — implemented)

Login → `/driver` → toggle on/off duty → see active assignments ordered by pickup time → review the mapped route, stops, customer contacts, load and assigned truck → progress *Assigned → En route to pickup → Picked up → In transit → Delivered*. On an active trip, the driver can explicitly start or stop location sharing; the browser sends GPS coordinates and a device timestamp about every 10 seconds. A driver can report a failed job with a required reason. Dispatch completes delivered jobs or reopens failed jobs for re-dispatch. Driver actions and GPS updates are restricted to that driver's current assignment; every status transition is added to the audit timeline.

Customer booking details and staff dispatch/detail pages show the current vehicle position, route, booking status, estimated arrival and delivery progress. WebSocket events push updates across instances via Redis Pub/Sub; PostgreSQL stores the latest fix, and clients resubscribe/reload after reconnects. Plain `next dev` uses automatic snapshot sync because Vercel's experimental WebSocket upgrade is platform-specific. Proof-of-delivery photos/signatures, push/email notifications, ratings and driver payment remain future work.

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
| `delivered` | Delivery reported; awaiting dispatch close-out (POD is not captured yet) | staff / driver | `completed` |
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

---

## 8. Phase 3 — Vehicles & Dispatch (implemented)

### Fleet
- [x] Manage vehicle types and rated capacity; each physical vehicle can set a lower payload capacity than its class maximum.
- [x] Track vehicle status (`available`, `in_use`, `maintenance`, `inactive`), one assigned driver, and a dispatcher-maintained last-known location.
- [x] Prevent dispatch of an in-use, maintenance or inactive truck. While a truck serves an active job, block availability/class changes, capacity reductions below that load, and deletion; changing its linked driver is blocked while it is in use. Non-disruptive details and last-known location remain editable.

### Drivers
- [x] Create driver login accounts and operating profiles with licence number/class/expiry and notes.
- [x] Manage account status separately from on-duty/off-duty availability.
- [x] Show the linked truck, current active job and operational availability on the Drivers page and dispatch board.
- [x] Drivers can toggle availability when they have no open assignment.

### Dispatch & lifecycle
- [x] `/admin/dispatch` shows pending/confirmed jobs without a complete assignment and `assigned` jobs missing a driver or truck, so incomplete assignments can be repaired; the current driver/truck is retained as a choice when still valid.
- [x] Require an active on-duty driver and a compatible available vehicle for new allocations; repairing an incomplete `assigned` job can keep its existing allocated resource.
- [x] Lock resource rows during dispatch to prevent two simultaneous assignments to the same driver or truck.
- [x] Reassign from a job detail; cancel an assignment to return the job to confirmed and free its resources.
- [x] Drivers can only read/progress their own assigned jobs; they can report failure only with a reason.
- [x] Record assignment, reassignment, unassignment and status progress in the booking timeline.

Standard lifecycle:

```text
pending → confirmed (or dispatch assigns directly) → assigned → en_route_pickup → picked_up → in_transit → delivered → completed
   └───────────┴───────────┴────────────────────┴────────→ cancelled (dispatch; customers cancel only before en route)
assigned → confirmed (cancel assignment; release driver and vehicle)
en_route_pickup / in_transit → failed → confirmed (dispatch reopens for re-dispatch)
```

### Phase 3 acceptance checks

1. Create a vehicle and driver profile; set the driver on duty and link one truck.
2. A pending booking appears on `/admin/dispatch`; assigning an unavailable driver, wrong class or undersized truck is rejected.
3. Assign a compatible driver/truck. The booking becomes `assigned`; both resources disappear from the available roster and the timeline records the assignment.
4. Reassign the job or cancel its assignment. The old resources become available and the timeline records the change.
5. Log in as the driver and progress the assigned job through pickup and delivery. Another driver cannot view or update that job.
6. Mark a delivered job completed from dispatch; the driver and vehicle become available. A failed job can be reopened and re-dispatched.

---

## 9. Phase 4 — Driver Interface & Live Tracking (implemented)

### GPS and realtime behavior

- [x] Persist the routed polyline on the booking so the driver, customer and staff map the same planned route.
- [x] After starting the trip, let the driver explicitly start/stop browser geolocation. Send `{ bookingId, latitude, longitude, timestamp }` with optional accuracy, heading and speed at a throttled cadence.
- [x] Authenticate location writes; verify that the signed-in driver still owns an `en_route_pickup`, `picked_up` or `in_transit` booking; reject invalid coordinates and stale/future timestamps.
- [x] Keep a single latest GPS fix per booking in PostgreSQL, rather than an unbounded breadcrumb stream. Clear it when assignment is released or the job is cancelled, failed or completed.
- [x] Show the current vehicle marker, route, booking status, route-based progress and estimated delivery on customer booking details, admin booking details and the dispatch board.
- [x] Push GPS and booking-status events over authenticated Vercel WebSockets. Redis Pub/Sub coordinates delivery across function instances; PostgreSQL snapshots are reloaded on reconnect. Plain `next dev` falls back to periodic HTTP snapshot sync.
- [x] Limit WebSocket subscription IDs to bookings visible to the signed-in customer, assigned driver or staff role. Check the WebSocket Origin and use the existing `httpOnly` session cookie.

Vercel setup: enable Fluid Compute (default on newer projects) and configure `REDIS_URL` to a TLS-enabled Upstash Redis URL. This app sets the WebSocket function duration to five minutes and clients reconnect/resubscribe automatically. Apply schema changes with `npm run db:push` before deployment. ETA uses the booking's route-duration estimate and GPS route progress; it is not a live traffic estimate.

### Phase 4 acceptance checks

1. Apply the schema, log in as the demo driver and open an assigned job at `/driver`; verify the route map and pickup/delivery details.
2. Start the trip, grant browser location permission, and start sharing. Confirm `POST /api/driver/location` accepts recent `latitude`, `longitude` and `timestamp` values and the latest fix is visible in PostgreSQL.
3. Attempt a GPS update as another driver, for an inactive job, with invalid coordinates or with a stale timestamp; confirm it is rejected.
4. Open the same booking as its customer and as admin/dispatcher. Confirm the marker moves, booking status and delivery progress update without a page refresh, and the map includes the planned route and ETA.
5. Force a socket disconnect or wait for its duration limit; confirm the client reconnects, resubscribes and restores current state. Repeat after a new Vercel deployment.
6. With `REDIS_URL` removed or under plain `next dev`, confirm tracking stays authenticated and falls back to snapshot sync instead of claiming WebSocket delivery is live.
