# REST API Contract Specification

## 1. Overview & General Standards

This API contract defines the exact interface for all communication between the frontends and the backend for the **Railway Reservation & Management System**. It aligns with the Business Rules (`docs/BUSINESS_RULES.md`), the Relational Schema (`docs/DATA_SCHEMA.md`), and the approved ER diagram.

### 1.0 Route index (every route that exists in the code)
This index is checked against `backend/src/routes` (a script compares both lists). If you add or remove a route, change this index and the detail section.
"Any logged-in user" means any valid token. A token of the wrong role gets `403 FORBIDDEN`.
Aliases (same handler, two addresses): `/api/admin/route-stops` = `/api/admin/routes`, `/api/admin/concessions` = `/api/admin/concession-rules`, `/api/admin/refunds` = `/api/admin/refund-rules`, `PUT /api/tdr/admin/:id` = `PUT /api/admin/tdr/:id`, `GET /api/me` and `GET /me` = `GET /api/auth/me`.

**1. Health**

| Method | Path | Who | One-line purpose |
| :--- | :--- | :--- | :--- |
| GET | `/api/health` | Public | MySQL and MongoDB status |

**2. Login and account**

| Method | Path | Who | One-line purpose |
| :--- | :--- | :--- | :--- |
| POST | `/api/auth/passenger/register` | Public | Create a passenger account |
| POST | `/api/auth/passenger/login` | Public | Passenger login (email + password) |
| POST | `/api/auth/staff/login` | Public | Staff login (employee id + password) |
| POST | `/api/auth/admin/login` | Public | Admin login (email + password) |
| POST | `/api/auth/login` | Public | Login for any role by email (used by the website login page) |
| GET | `/api/auth/me` | Any logged-in user | Profile of the logged-in user |
| POST | `/api/auth/change-password` | Any logged-in user | Change own password |
| GET | `/api/me` | Any logged-in user | Same as GET /api/auth/me (short address) |
| GET | `/me` | Any logged-in user | Same as GET /api/auth/me (without the /api prefix) |

**3. Trains, stations, availability**

| Method | Path | Who | One-line purpose |
| :--- | :--- | :--- | :--- |
| GET | `/api/trains` | Public | List all trains |
| GET | `/api/trains/search` | Public | Search trains between two stations on a date |
| GET | `/api/trains/:trainId/live-status` | Any logged-in user | Live delay of a train (MongoDB) |
| GET | `/api/trains/:trainId` | Public | Route and timetable of one train |
| GET | `/api/trains/:trainId/availability` | Public | Seats, RAC and waiting list for one class (with quota fallback advice) |
| GET | `/api/trains/:trainId/run-status` | Public | Run status and delay of one dated run (Track your train) |
| GET | `/api/alerts` | Public | Service alerts: delayed or cancelled runs of the next 7 days |
| GET | `/api/live-trains` | Public | Every train run of one date with live seat numbers (filters, paging) |
| GET | `/api/live-trains/:scheduleId` | Public | One run: per class and per quota seats, queues and current fare |
| GET | `/api/booking-rules` | Public | The real booking rules: passenger limits, senior ages, Tatkal rules, concession list |
| GET | `/api/contact-info` | Public | Helpline, e-mail and address of the Contact Us panel (from SETTING) |
| POST | `/api/contact` | Public | Send a Contact Us message (saved in MongoDB) |
| GET | `/api/stations` | Public | List all stations |
| GET | `/api/schedules/:scheduleId/live-status` | Any logged-in user | Live status of one dated run (MongoDB) |

**4. Booking, payment, cancellation, counter**

| Method | Path | Who | One-line purpose |
| :--- | :--- | :--- | :--- |
| GET | `/api/bookings` | Any logged-in user | My bookings |
| POST | `/api/bookings` | Any logged-in user | Create a booking in PAYMENT_PENDING (starts the 10-minute hold) |
| POST | `/api/bookings/fare-preview` | Any logged-in user | Read-only fare lines, rule problems and estimated status per passenger |
| POST | `/api/bookings/:pnr/cancel-unpaid` | Passenger (owner) | Give up a booking that is still waiting for payment |
| GET | `/api/bookings/:pnr/hold` | Any logged-in user | Seconds left on the hold of my unpaid booking |
| GET | `/api/bookings/:pnr/refund-estimate` | Any logged-in user | Preview the cancellation charge and refund (writes nothing) |
| POST | `/api/bookings/:pnr/cancel` | Any logged-in user | Cancel a whole PNR or some passengers (promotion happens in the database) |
| GET | `/api/bookings/:pnr` | Any logged-in user | PNR status |
| POST | `/api/payments/razorpay/order` | Any logged-in user | Create the Razorpay order for a PNR |
| POST | `/api/payments/razorpay/verify` | Any logged-in user | Check the payment signature and issue the ticket |
| POST | `/api/payments/razorpay/reconcile` | Any logged-in user | Ask Razorpay about a payment and finish the order |
| POST | `/api/counter/bookings` | Any logged-in user | Station counter booking for a walk-in or registered passenger |
| POST | `/api/payments/razorpay/webhook` | Razorpay (signature) | Razorpay calls this (captured, paid, refund events) |

**5. TDR (passenger side)**

| Method | Path | Who | One-line purpose |
| :--- | :--- | :--- | :--- |
| PUT | `/api/tdr/admin/:id` | Admin | Review a TDR (admin only; same as PUT /api/admin/tdr/:id) |
| POST | `/api/tdr` | Passenger | File a TDR for one or more passengers |
| GET | `/api/tdr` | Passenger | My TDRs (with passenger name, train, refund amount and refund status) |
| GET | `/api/tdr/eligibility/:pnr` | Passenger | Which TDR reasons each passenger of my PNR can use right now, and why not |
| GET | `/api/tdr/:tdrRefNo` | Passenger | One of my TDRs |

**6. Staff and maintenance**

| Method | Path | Who | One-line purpose |
| :--- | :--- | :--- | :--- |
| GET | `/api/staff/assignments/current` | Staff | My current duty |
| GET | `/api/staff/schedules/:scheduleId/chart` | Staff or Admin | Passenger chart of a run (needs the chart to be prepared) |
| POST | `/api/staff/verification` | Staff | Record a ticket check |
| POST | `/api/staff/boarding` | Staff | Mark a passenger BOARDED |
| POST | `/api/staff/no-show` | Staff | Mark a passenger NO_SHOW (next in line is promoted) |
| GET | `/api/staff/pnr/:pnr` | Staff or Admin | PNR status for staff or admin |
| POST | `/api/staff/fines` | Staff | Issue an on-spot fine |
| POST | `/api/staff/incidents` | Staff | Report an incident |
| POST | `/api/staff/delays` | Staff | Log a train delay |
| POST | `/api/staff/crowd-reports` | Staff | Report platform crowd |
| POST | `/api/staff/cleanliness-reports` | Staff | Report a cleanliness problem |
| POST | `/api/maintenance/tasks` | Staff on MAINTENANCE_DUTY or Admin | Create a maintenance task |
| PUT | `/api/maintenance/tasks/:maintId/status` | Maintenance staff | Change a maintenance task status |

**7. Admin operations**

| Method | Path | Who | One-line purpose |
| :--- | :--- | :--- | :--- |
| GET | `/api/admin/schedules` | Admin | List dated runs with class inventory |
| POST | `/api/admin/schedules/:scheduleId/chart-preparation` | Admin | Run chart preparation for a run |
| GET | `/api/admin/settings` | Admin | List settings |
| PUT | `/api/admin/settings/:key` | Admin | Change a setting (checked by a trigger, audited) |
| GET | `/api/admin/contact-messages` | Admin | Contact Us messages (MongoDB), newest first, optional `?status=NEW` or `DONE` |
| PATCH | `/api/admin/contact-messages/:id` | Admin | Mark a message DONE or open it again |
| GET | `/api/admin/quotas` | Admin | The five quotas with their real rules and usage (read only) |
| GET | `/api/admin/fares/calculate` | Admin | The real fare for one passenger from `fn_calculate_fare` (read only) |
| GET | `/api/admin/bookings` | Admin | Search all bookings |
| GET | `/api/admin/users` | Admin | List and search users |
| PUT | `/api/admin/users/:id/status` | Admin | Activate, suspend or deactivate a user |
| GET | `/api/admin/platforms` | Admin | List platforms |
| POST | `/api/admin/platforms` | Admin | Add a platform |
| PUT | `/api/admin/platforms/:id` | Admin | Edit a platform |
| DELETE | `/api/admin/platforms/:id` | Admin | Delete a platform |
| GET | `/api/admin/fines` | Admin | List fines |
| GET | `/api/admin/incidents` | Admin | List incidents |
| GET | `/api/admin/tdr` | Admin | List all TDRs |
| GET | `/api/admin/refund-transactions` | Admin | List refund money rows (PENDING, PROCESSED, FAILED) |
| POST | `/api/admin/refund-transactions/:refundId/retry` | Admin | Retry one PENDING or FAILED refund at the gateway |
| PUT | `/api/admin/tdr/:id` | Admin | Review a TDR: approve (refund + promotion) or reject |
| GET | `/api/admin/audit-logs` | Admin | Audit trail written by triggers and procedures |
| GET | `/api/admin/activity-logs` | Admin | Activity log (MongoDB) |
| GET | `/api/admin/complaints` | Admin | List complaints (MongoDB) |
| PUT | `/api/admin/complaints/:grievanceId` | Admin | Answer or close a complaint (MongoDB) |
| GET | `/api/admin/reports` | Admin | List report names |
| GET | `/api/admin/reports/rank` | Admin | All RANK() reports in one call |
| GET | `/api/admin/reports/:reportKey` | Admin | One RANK() report |
| GET | `/api/admin/staff` | Admin | List staff |
| POST | `/api/admin/staff` | Admin | Create a staff account |
| PUT | `/api/admin/staff/:staffId/status` | Admin | Change staff status |

**8. Admin master data**

| Method | Path | Who | One-line purpose |
| :--- | :--- | :--- | :--- |
| GET | `/api/admin/stations` | Admin | List stations |
| GET | `/api/admin/stations/:id` | Admin | Read one station |
| POST | `/api/admin/stations` | Admin | Add a station |
| PUT | `/api/admin/stations/:id` | Admin | Edit a station |
| DELETE | `/api/admin/stations/:id` | Admin | Delete a station |
| GET | `/api/admin/trains` | Admin | List trains |
| GET | `/api/admin/trains/:id` | Admin | Read one train |
| POST | `/api/admin/trains` | Admin | Add a train |
| PUT | `/api/admin/trains/:id` | Admin | Edit a train |
| DELETE | `/api/admin/trains/:id` | Admin | Delete a train |
| GET | `/api/admin/routes` | Admin | List route stops |
| GET | `/api/admin/routes/:id` | Admin | Read one route stop |
| POST | `/api/admin/routes` | Admin | Add a route stop |
| PUT | `/api/admin/routes/:id` | Admin | Edit a route stop |
| DELETE | `/api/admin/routes/:id` | Admin | Delete a route stop |
| GET | `/api/admin/route-stops` | Admin | List route stop (alias of /routes)s |
| GET | `/api/admin/route-stops/:id` | Admin | Read one route stop (alias of /routes) |
| POST | `/api/admin/route-stops` | Admin | Add a route stop (alias of /routes) |
| PUT | `/api/admin/route-stops/:id` | Admin | Edit a route stop (alias of /routes) |
| DELETE | `/api/admin/route-stops/:id` | Admin | Delete a route stop (alias of /routes) |
| GET | `/api/admin/coaches` | Admin | List coachs |
| GET | `/api/admin/coaches/:id` | Admin | Read one coach |
| POST | `/api/admin/coaches` | Admin | Add a coach |
| PUT | `/api/admin/coaches/:id` | Admin | Edit a coach |
| DELETE | `/api/admin/coaches/:id` | Admin | Delete a coach |
| GET | `/api/admin/seats` | Admin | List seats |
| GET | `/api/admin/seats/:id` | Admin | Read one seat |
| POST | `/api/admin/seats` | Admin | Add a seat |
| PUT | `/api/admin/seats/:id` | Admin | Edit a seat |
| DELETE | `/api/admin/seats/:id` | Admin | Delete a seat |
| GET | `/api/admin/fares` | Admin | List fare rates |
| GET | `/api/admin/fares/:id` | Admin | Read one fare rate |
| POST | `/api/admin/fares` | Admin | Add a fare rate |
| PUT | `/api/admin/fares/:id` | Admin | Edit a fare rate |
| DELETE | `/api/admin/fares/:id` | Admin | Delete a fare rate |
| GET | `/api/admin/concession-rules` | Admin | List concession rules |
| GET | `/api/admin/concession-rules/:id` | Admin | Read one concession rule |
| POST | `/api/admin/concession-rules` | Admin | Add a concession rule |
| PUT | `/api/admin/concession-rules/:id` | Admin | Edit a concession rule |
| DELETE | `/api/admin/concession-rules/:id` | Admin | Delete a concession rule |
| GET | `/api/admin/concessions` | Admin | List concession rule (alias of /concession-rules)s |
| GET | `/api/admin/concessions/:id` | Admin | Read one concession rule (alias of /concession-rules) |
| POST | `/api/admin/concessions` | Admin | Add a concession rule (alias of /concession-rules) |
| PUT | `/api/admin/concessions/:id` | Admin | Edit a concession rule (alias of /concession-rules) |
| DELETE | `/api/admin/concessions/:id` | Admin | Delete a concession rule (alias of /concession-rules) |
| GET | `/api/admin/refund-rules` | Admin | List refund rules |
| GET | `/api/admin/refund-rules/:id` | Admin | Read one refund rule |
| POST | `/api/admin/refund-rules` | Admin | Add a refund rule |
| PUT | `/api/admin/refund-rules/:id` | Admin | Edit a refund rule |
| DELETE | `/api/admin/refund-rules/:id` | Admin | Delete a refund rule |
| GET | `/api/admin/refunds` | Admin | List refund rule (alias of /refund-rules; not the refund money, see refund-transactions)s |
| GET | `/api/admin/refunds/:id` | Admin | Read one refund rule (alias of /refund-rules; not the refund money, see refund-transactions) |
| POST | `/api/admin/refunds` | Admin | Add a refund rule (alias of /refund-rules; not the refund money, see refund-transactions) |
| PUT | `/api/admin/refunds/:id` | Admin | Edit a refund rule (alias of /refund-rules; not the refund money, see refund-transactions) |
| DELETE | `/api/admin/refunds/:id` | Admin | Delete a refund rule (alias of /refund-rules; not the refund money, see refund-transactions) |

**9. Passenger extras (saved passengers, notifications, complaints)**

| Method | Path | Who | One-line purpose |
| :--- | :--- | :--- | :--- |
| GET | `/api/notifications` | Any logged-in user | My notifications (MongoDB) |
| PUT | `/api/notifications/:id/read` | Any logged-in user | Mark a notification as read |
| POST | `/api/complaints` | Any logged-in user | File a complaint (MongoDB) |
| GET | `/api/complaints` | Any logged-in user | My complaints |
| GET | `/api/saved-passengers` | Passenger | My saved passengers |
| POST | `/api/saved-passengers` | Passenger | Add a saved passenger |
| PUT | `/api/saved-passengers/:id` | Passenger | Edit a saved passenger (only mine) |
| DELETE | `/api/saved-passengers/:id` | Passenger | Delete a saved passenger (409 if a booking uses it) |

### 1.1 HTTP Response Conventions
- All date-times are India time as 'YYYY-MM-DD HH:MM:SS', never append Z.
- All successful responses return JSON with standard wrapper schemas:
```json
{
  "success": true,
  "data": { ... },
  "message": "Operation completed successfully"
}
```
- In case of failure:
```json
{
  "success": false,
  "error": {
    "code": "BERTH_PREFERENCE_NOT_MET",
    "message": "The requested berth preference could not be satisfied for all passengers in the selected class."
  }
}
```
- Server and database errors (HTTP 500, or any error that carries raw SQL or driver text) return the fixed message `An unexpected server error occurred.` with code `INTERNAL_SERVER_ERROR`. The raw text is sent only when the server runs with `NODE_ENV=development`; otherwise it is written to the server log.
- `GET /api/health` returns `timestamp` as an India-time string, and short fixed text instead of raw database errors.

### 1.2 Error codes (complete and checked against the code)
Every error answers `{ "success": false, "error": { "code": "...", "message": "..." } }`. The table lists every code that the SQL files or the backend can really return. The HTTP status comes from `backend/src/middleware/errorHandler.js`.

**Booking and money rules (raised by SQL procedures or functions, shown by the API as HTTP 400)**

| Code | HTTP | Meaning |
| :--- | :--- | :--- |
| `SEAT_NOT_AVAILABLE` | 400 | No seats left in the requested quota or segment (and the passenger did not accept the General fallback). |
| `WAITING_LIST_FULL` | 400 | The waiting list capacity (25% of the class seats) is used up. |
| `TRAIN_NOT_RUNNING` | 400 | The train has no run on that origin date, or the run is cancelled (BR-B1a). |
| `JOURNEY_PAST` | 400 | The train has already left the boarding station (India time). |
| `OUTSIDE_BOOKING_WINDOW` | 400 | The boarding date is more than `BOOKING_WINDOW_DAYS` (default 7) days away. |
| `QUOTA_NOT_ELIGIBLE` | 400 | The passengers do not fit the quota. LADIES: everyone aged 12 or more must be FEMALE. SENIOR_CITIZEN: a man or OTHER aged 60 or more, or a woman aged 45 or more. DIVYAANG: every passenger needs a proof type and reference. |
| `CONCESSION_PROOF_REQUIRED` | 400 | A concession other than NONE was chosen without proof type and reference. |
| `NO_ADULT_PASSENGER` | 400 | The booking has nobody aged 18 or more. |
| `BERTH_PREFERENCE_NOT_MET` | 400 | "Book only if my berth is given" was ticked and the berth, or a confirmed seat, could not be given. |
| `MONTHLY_LIMIT_EXCEEDED` | 400 | More than 12 bookings in the calendar month (24 if Aadhaar verified). Counted by booking date, includes cancelled, excludes FAILED. |
| `CHART_PREPARED` | 400 | The chart of the run is prepared (8 hours before origin departure). New bookings, counter bookings and online cancellations are refused. |
| `TRANSACTION_FAILED` | 400 | The booking procedure hit a database error and rolled everything back. Nothing was saved. Try again. |
| `PAYMENT_AMOUNT_MISMATCH` | 400 | The paid amount is not the booking fare. No ticket is issued. |
| `PAYMENT_AMOUNT_INVALID` | 400 | The paid amount is zero or negative. No ticket is issued. |
| `REFUND_EXCEEDS_PAYMENT` | 400 | A refund would return more than was paid on the payment, or the seat already got a TDR refund. Cancellation and TDR approval return it and change nothing. |
| `INVALID_SETTING_VALUE` | 400 | The setting trigger refused the value (`PUT /api/admin/settings/:key`). |
| `HOLD_EXPIRED` | 200 | Only in `POST /api/payments/razorpay/verify`: the payment arrived after the 10-minute hold. The body has `success: false`, no seat is given and the money is refunded automatically (see 4.3.2). |
| `INVALID_STOPS` | 400 | The stored procedure `sp_create_booking` refuses a stop that is not on the train or not before the destination. The API checks stops first and answers `VALIDATION_ERROR`, so a client normally never sees this code. |

**General codes (raised by the Node code)**

| Code | HTTP | Meaning |
| :--- | :--- | :--- |
| `VALIDATION_ERROR` | 400 | A field is missing, has the wrong type or is out of range. Also used for a bad reference (foreign key) and a failed CHECK constraint. |
| `BAD_REQUEST` | 400 | The request is understood but not allowed in this state (for example cancelling twice, an unpaid booking, a TDR the rules refuse, a bad payment signature). |
| `WRONG_CURRENT_PASSWORD` | 400 | Change password with a wrong current password. HTTP 400 on purpose: the portals treat 401 as "session expired". |
| `UNAUTHORIZED` | 401 | No token, bad or expired token, or wrong login. |
| `FORBIDDEN` | 403 | Wrong role, not the owner of the PNR, or staff not on duty for the run. |
| `NOT_FOUND` | 404 | Unknown id, PNR, train, route (also an unknown path, and the removed promote route). |
| `CONFLICT` | 409 | Duplicate value (email, phone, slab) or a record still in use. |
| `TOO_MANY_REQUESTS` | 429 | Reconcile called again within 10 seconds for the same PNR. |
| `INTERNAL_SERVER_ERROR` | 500 | Unexpected error. The message is always "An unexpected server error occurred." unless `NODE_ENV=development`. |
| `SERVICE_UNAVAILABLE` | 503 | A needed service is down or not set up: Razorpay keys, webhook secret, or MongoDB (notifications, complaints, activity log). |

**Reserved, not raised**

| Code | Note |
| :--- | :--- |
| `NOT_ALL_CONFIRMED` | Kept in the error map for the idea "book only if everyone is confirmed". No procedure or route raises it and the booking API ignores `bookOnlyIfConfirmed`. |

**Database-only messages.** The triggers `trg_check_seat_overlap` and the RAC rules can stop an insert with `SEAT_OVERLAP_ERROR`, `RAC_BERTH_ERROR` or `RAC_CAPACITY_EXCEEDED`. They only appear when someone writes to the tables by hand (Workbench). The normal booking path never reaches them; if one did, the API would answer `INTERNAL_SERVER_ERROR`.

**Status words that are not error codes.** Procedures such as `sp_file_tdr`, `sp_board_passenger` and `sp_mark_passenger_noshow` return a status text (`DUPLICATE_TDR`, `NOT_ON_DUTY`, `TDR_OPEN`, `NOT_ELIGIBLE` and so on). The controller turns each one into one of the general codes above (see the "Errors" line of each route).

### 1.3 Authentication Header
Endpoints requiring authentication expect the standard Bearer header:
```http
Authorization: Bearer <jwt_or_mock_token>
```

---

## 2. Authentication & User Account APIs

### 2.1 Passenger Registration
- **Method / Endpoint**: `POST /api/auth/passenger/register`
- **Role**: Public (Unauthenticated)
- **Request Body**:
```json
{
  "name": "Rahul Sharma",
  "email": "rahul.sharma@example.com",
  "phone": "+91-9876543210",
  "password": "Password123!"
}
```
- **Response (201 Created)**:
```json
{
  "success": true,
  "data": {
    "userId": 1,
    "name": "Rahul Sharma",
    "email": "rahul.sharma@example.com",
    "phone": "+91-9876543210",
    "role": "PASSENGER",
    "accountStatus": "ACTIVE",
    "aadhaarVerified": false,
    "token": "<jwt>"
  }
}
```
- **Errors**: `400 Bad Request` (Validation failure), `409 Conflict` (Email or phone already registered).

---

### 2.2 Passenger Login
- **Method / Endpoint**: `POST /api/auth/passenger/login`
- **Role**: Public
- **Request Body**:
```json
{
  "email": "rahul.sharma@example.com",
  "password": "Password123!"
}
```
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "userId": 1,
    "name": "Rahul Sharma",
    "role": "PASSENGER",
    "aadhaarVerified": false,
    "monthlyBookingsUsed": 3,
    "monthlyBookingsAllowed": 12,
    "token": "<jwt>"
  }
}
```

---

### 2.3 Staff Login
- **Method / Endpoint**: `POST /api/auth/staff/login`
- **Role**: Public
- **Request Body**:
```json
{
  "employeeId": "EMP-TC-101",
  "password": "StaffPassword123!"
}
```
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "userId": 4,
    "staffId": 1,
    "employeeId": "EMP-TC-101",
    "name": "Vikram Singh",
    "designation": "Ticket Collector (TC)",
    "role": "STAFF",
    "token": "<jwt>"
  }
}
```
- Also accepts `{ "email": "...", "password": "..." }` instead of `employeeId`. The current duty is read with `GET /api/staff/assignments/current`.
- **Errors**: `401 UNAUTHORIZED` (wrong login or password), `403` (account not active).

---

### 2.4 Admin Login
- **Method / Endpoint**: `POST /api/auth/admin/login`
- **Role**: Public
- **Request Body**:
```json
{
  "email": "admin@railways.gov.in",
  "password": "AdminPassword123!"
}
```
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "userId": 7,
    "adminId": 1,
    "name": "Rajesh Gupta",
    "role": "ADMIN",
    "accessLevel": "SUPER_ADMIN",
    "token": "<jwt>"
  }
}
```

### 2.5 Change Own Password
- **Method / Endpoint**: `POST /api/auth/change-password`
- **Role**: Any logged-in user
- **Request Body**: `{ "currentPassword": "OldPassw0rd!", "newPassword": "NewPassw0rd!" }` (new password at least 8 characters and different from the current one)
- **Response (200 OK)**: `{ "success": true, "data": { "changed": true } }`
- **Errors**: `400 WRONG_CURRENT_PASSWORD` (HTTP 400 on purpose: the portals treat 401 as "session expired"), `400 VALIDATION_ERROR`, `401 Unauthorized`. The change is written to AUDIT_LOG (`CHANGE_PASSWORD`).

---

### 2.6 Universal Login and Profile
- `POST /api/auth/login` (public): body `{ "email", "password" }`, answers `userId, name, email, role, aadhaarVerified, monthlyBookingsUsed, monthlyBookingsAllowed, token`. Works for every role (the website login page uses it). Wrong login: `401 UNAUTHORIZED`.
- `GET /api/auth/me` (also `GET /api/me` and `GET /me`): answers `userId, name, email, phone, role, accountStatus, aadhaarVerified, monthlyBookingsUsed, monthlyBookingsAllowed, createdAt`.
- Tokens are real signed JWTs. The server will not start without `JWT_SECRET`.

---

## 3. Train Enquiry & Availability APIs

### 3.1 Search Trains with Running-Day Check (BR-B1a)
- **Method / Endpoint**: `GET /api/trains/search`
- **Role**: Public / Passenger
- **Query Parameters**:
  - `sourceStationId` (int, required) e.g. `21` (BCT - Mumbai Central)
  - `destinationStationId` (int, required) e.g. `10` (NDLS - New Delhi)
  - `journeyDate` (YYYY-MM-DD, required) - Passenger boarding date (within 7-day window, BR-B1)
  - `classType` (string, optional) e.g. `3A`
  - `quota` (string, optional, default `GENERAL`) e.g. `GENERAL`
- **Business Logic (BR-B1a)**:
  - System locates the boarding stop along the train's route and retrieves `day_offset`.
  - Calculates `originDate = journeyDate - day_offset`.
  - Checks if the train operates on `originDate`'s day-of-week (`MON`–`SUN`).
  - If train does not run on that weekday, the train is omitted from search results.
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "trainId": 129,
      "trainNumber": "12951",
      "shortName": "TEJAS RAJDHANI",
      "displayName": "Mumbai Tejas Rajdhani Express (12951)",
      "trainType": "RAJDHANI",
      "boardingStation": {
        "stationId": 21,
        "stationCode": "BCT",
        "stationName": "MUMBAI CENTRAL",
        "departureTime": "17:00",
        "boardingDate": "2026-10-20",
        "dayOffset": 0
      },
      "destinationStation": {
        "stationId": 10,
        "stationCode": "NDLS",
        "stationName": "NEW DELHI",
        "arrivalTime": "08:32",
        "arrivalDate": "2026-10-21",
        "dayOffset": 1
      },
      "originDate": "2026-10-20",
      "duration": "15h 32m",
      "distanceKm": 1386,
      "runningDays": ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
      "availableClasses": [
        {
          "classType": "3A",
          "availableSeats": 42,
          "racCount": 10,
          "racCapacity": 12,
          "waitingListCount": 0,
          "waitingListCapacity": 40,
          "baseFare": 1857.24,
          "superfastCharge": 45.00,
          "reservationCharge": 40.00,
          "gst": 97.11,
          "estimatedTotalFare": 2039.35
        },
        {
          "classType": "2A",
          "availableSeats": 18,
          "racCount": 4,
          "waitingListCount": 0,
          "baseFare": 2702.70,
          "superfastCharge": 45.00,
          "reservationCharge": 50.00,
          "gst": 139.89,
          "estimatedTotalFare": 2937.59
        }
      ]
    }
  ]
}
```

---

### 3.2 Get Train Route & Timetable
- **Method / Endpoint**: `GET /api/trains/:trainId`
- **Role**: Public / Passenger / Staff
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "trainId": 129,
    "trainNumber": "12951",
    "shortName": "TEJAS RAJDHANI",
    "displayName": "Mumbai Tejas Rajdhani Express (12951)",
    "trainType": "RAJDHANI",
    "sourceStationId": 21,
    "destinationStationId": 10,
    "runningDays": ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
    "route": [
      {
        "stopId": 1142,
        "stationId": 21,
        "stationCode": "BCT",
        "stationName": "MUMBAI CENTRAL",
        "stopSequence": 1,
        "arrivalTime": "17:00",
        "departureTime": "17:00",
        "dayOffset": 0,
        "distanceFromOriginKm": 0,
        "platformNo": 1
      },
      {
        "stopId": 1143,
        "stationId": 24,
        "stationCode": "ST",
        "stationName": "SURAT",
        "stopSequence": 2,
        "arrivalTime": "19:42",
        "departureTime": "19:47",
        "dayOffset": 0,
        "distanceFromOriginKm": 263,
        "platformNo": 1
      },
      {
        "stopId": 1144,
        "stationId": 26,
        "stationCode": "BRC",
        "stationName": "VADODARA JN",
        "stopSequence": 3,
        "arrivalTime": "21:05",
        "departureTime": "21:15",
        "dayOffset": 0,
        "distanceFromOriginKm": 392,
        "platformNo": 2
      },
      {
        "stopId": 1145,
        "stationId": 10,
        "stationCode": "NDLS",
        "stationName": "NEW DELHI",
        "stopSequence": 4,
        "arrivalTime": "08:32",
        "departureTime": "08:32",
        "dayOffset": 1,
        "distanceFromOriginKm": 1386,
        "platformNo": 3
      }
    ]
  }
}
```

---

### 3.3 Quota Availability & Fallback Advisory (BR-Q13)
- **Method / Endpoint**: `GET /api/trains/:trainId/availability`
- **Role**: Public / Passenger
- **Query Parameters**: `journeyDate`, `classType`, `quota`, `passengerCount`
- **Response (200 OK - Direct Availability)**:
```json
{
  "success": true,
  "data": {
    "trainId": 129,
    "journeyDate": "2026-10-20",
    "classType": "3A",
    "quota": "GENERAL",
    "availableSeats": 42,
    "racCount": 10,
    "waitingListCount": 0,
    "fallbackOffered": false
  }
}
```
- **Response (200 OK - Fallback Triggered per BR-Q13)**:
```json
{
  "success": true,
  "data": {
    "trainId": 129,
    "journeyDate": "2026-10-20",
    "classType": "3A",
    "requestedQuota": "LADIES",
    "availableSeats": 0,
    "fallbackOffered": true,
    "fallbackNotice": "No seats are left in the LADIES quota for this train and date. We can book you in the General quota instead. Your seat may not be your preferred one (for example an upper berth or a different coach), and General seats go first-come-first-served, so you may get RAC or Waiting List instead of a confirmed seat. Fare, refund and cancellation rules stay the same.",
    "generalQuotaStatus": {
      "availableSeats": 12,
      "projectedStatus": "CONFIRMED"
    }
  }
}
```

---

### 3.4 List Stations (Public)
- **Method / Endpoint**: `GET /api/stations`
- **Role**: Public (Unauthenticated)
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "stationId": 10,
      "stationCode": "NDLS",
      "stationName": "New Delhi",
      "city": "New Delhi",
      "state": "Delhi"
    },
    {
      "stationId": 21,
      "stationCode": "BCT",
      "stationName": "Mumbai Central",
      "city": "Mumbai",
      "state": "Maharashtra"
    }
  ]
}
```
- **Errors**: `500 Internal Server Error`.

---

### 3.5 List Trains (Public)
- **Method / Endpoint**: `GET /api/trains`
- **Role**: Public (Unauthenticated)
- `shortName` is an abbreviated label and clients should show `displayName`.
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "trainId": 101,
      "trainNumber": "12221",
      "shortName": "PA-HWH DURAN",
      "displayName": "Pune–Howrah Duronto Express (12221)",
      "trainType": "DURONTO"
    },
    {
      "trainId": 129,
      "trainNumber": "12951",
      "shortName": "MUMBAI RAJDH",
      "displayName": "Mumbai Rajdhani Express (12951)",
      "trainType": "RAJDHANI"
    }
  ]
}
```
- **Errors**: `500 Internal Server Error`.

---

### 3.6 Public Run Status, Service Alerts and Contact Us (landing page and Train Info)
These three routes need no login. They feed the landing page, the Train Info page and the floating Contact Us button.

#### 3.6.1 Run status (Track your train)
- **Method / Endpoint**: `GET /api/trains/:trainId/run-status?journeyDate=YYYY-MM-DD` (`:trainId` is the train id or the train number)
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "trainId": 101,
    "trainNumber": "12221",
    "trainName": "Pune–Howrah Duronto Express (12221)",
    "journeyDate": "2026-11-21",
    "departureTime": "13:15",
    "status": "DELAYED",
    "delayMinutes": 200,
    "chartPrepared": false,
    "stops": [
      { "stopSequence": 1, "stationCode": "PUNE", "stationName": "Pune Jn", "arrivalTime": "13:15", "departureTime": "13:15", "dayOffset": 0 }
    ]
  }
}
```
- `status` is `ON_TIME`, `DELAYED`, `CANCELLED` or `COMPLETED` (from `TRAIN_SCHEDULE`). There is no live GPS: the page works out the last stop from the timetable and the delay.
- **Errors**: `400 VALIDATION_ERROR` (missing or bad date), `404 NOT_FOUND` (the train has no run on that date).

#### 3.6.2 Service alerts
- **Method / Endpoint**: `GET /api/alerts`
- **Response (200 OK)**: the dated runs from today to today + 6 days that are `DELAYED` or `CANCELLED` (or have a delay above 0), at most 20, soonest first. An empty list means every run is on time.
```json
{
  "success": true,
  "data": [
    {
      "scheduleId": 1399,
      "trainNumber": "12221",
      "trainName": "Pune–Howrah Duronto Express (12221)",
      "journeyDate": "2026-11-21",
      "departureTime": "13:15",
      "status": "DELAYED",
      "delayMinutes": 200,
      "severity": "WARNING",
      "message": "Pune–Howrah Duronto Express (12221) on 2026-11-21 is running 200 minutes late."
    }
  ]
}
```
- `severity` is `WARNING` (delayed) or `CRITICAL` (cancelled). The alert disappears when staff set the delay back to 0.

#### 3.6.3 Contact Us message
- **Method / Endpoint**: `POST /api/contact`
- **Request Body**: `{ "name": "Asha Rao", "email": "asha@example.com", "message": "My refund is late." }` (name 2 to 80 characters, a valid e-mail, message 5 to 1000 characters)
- **Response (201 Created)**: `{ "success": true, "data": { "received": true, "messageId": "6aff4742e972f86fca3615d8" } }`. The message is saved in the MongoDB collection `contact_messages`.
- **Errors**: `400 VALIDATION_ERROR`, `429 TOO_MANY_REQUESTS` (more than 5 messages from one address in 10 minutes), `503 SERVICE_UNAVAILABLE` (MongoDB is down).

---

### 3.7 Live Trains (public, read only)

The Live Trains window of the site (`/live-trains`). Seat numbers come from `SCHEDULE_CLASS_INVENTORY` (the single source of truth), the delay and run state from `TRAIN_SCHEDULE` (the same source as the Alerts strip). "Now" is `COALESCE(@as_of_time, NOW())`, the project test clock. Nothing is calculated in the browser.

#### 3.7.1 List of runs
- **Method / Endpoint**: `GET /api/live-trains`
- **Role**: Public
- **Query** (all optional): `date` (YYYY-MM-DD, default today by the test clock), `from` and `to` (station code or id; both must be stops of the train with `from` before `to`; one alone is also allowed), `type` (`RAJDHANI`, `SHATABDI`, `DURONTO`), `class` (class code the run has), `status` (`NOT_STARTED`, `RUNNING`, `DELAYED`, `COMPLETED`, `CANCELLED`), `q` (part of the train number or name), `page` (default 1), `pageSize` (default 25, at most 100).
- **How it is made**: one SQL query per page. The class inventory of every run comes in the same query as a JSON list (no query per train). A "run on a date" is the dated run whose origin journey date is that date.
- **Run status**: `COMPLETED` (marked completed, or now is past the arrival at the last stop plus the delay); else `DELAYED` (delay above 0); else `RUNNING` (now is past the departure plus the delay); else `NOT_STARTED`; `CANCELLED` for a cancelled run. The filter `RUNNING` means "on the way", so it also finds a late train that has left; `DELAYED` means late and not finished.
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "date": "2026-11-21",
    "asOf": "2026-11-20 12:30:00",
    "page": 1, "pageSize": 25, "total": 48,
    "trains": [
      {
        "scheduleId": 1399, "trainId": 141, "trainNumber": "12221", "trainName": "Pune–Howrah Duronto Express (12221)", "trainType": "DURONTO",
        "journeyDate": "2026-11-21",
        "origin": { "stationId": 20, "code": "PUNE", "name": "PUNE JN.", "departureTime": "09:15" },
        "destination": { "stationId": 95, "code": "HWH", "name": "HOWRAH JN.", "arrivalTime": "08:10", "dayOffset": 1 },
        "runStatus": "NOT_STARTED", "departed": false, "delayMinutes": 0, "chartPrepared": false, "occupancyPct": 14.2,
        "classes": [
          { "classCode": "2A", "className": "AC 2 Tier", "totalSeats": 96, "availableSeats": 26, "bookedSeats": 70,
            "racCount": 10, "racCapacity": 10, "waitingListCount": 24, "waitingListCapacity": 24, "status": "AVAILABLE" }
        ]
      }
    ]
  }
}
```
- `bookedSeats` is total minus available (the confirmed passengers). `status` of a class: `AVAILABLE` (seats free), else `RAC` (RAC room left), else `WL` (waiting-list room left), else `NOT AVAILABLE`. Seats can be free while the General quota is full (the free seats belong to other quotas): the quota detail shows that.
- **Errors**: `400 VALIDATION_ERROR` (bad date, bad status).

#### 3.7.2 One run in detail
- **Method / Endpoint**: `GET /api/live-trains/:scheduleId` (optional `?from=CODE&to=CODE` to price a segment)
- **Role**: Public
- **Response (200 OK)**: the run fields above plus `fareFor` (`from`, `to`, `distanceKm`; the whole route unless `from` and `to` are given) and, for every class, `fare` (General quota, one passenger, insurance included, no concession) and `quotas`: five rows `GENERAL`, `TATKAL`, `LADIES`, `SENIOR_CITIZEN`, `DIVYAANG` with `totalSeats` (seat share, BR-Q10), `bookedSeats`, `availableSeats`, `racCount`, `waitingListCount`, `fare` and `status`. `SCHEDULE_CLASS_INVENTORY` has no quota column, so the quota rows are worked out in the API from the reservations of the run with the same seat-share rules as `sp_create_booking`. RAC and waiting list exist only for GENERAL and TATKAL (BR-Q12).
- **Errors**: `404 NOT_FOUND` (unknown run).

### 3.8 Booking Rules and Contact Info (public)

#### 3.8.1 Booking rules
- **Method / Endpoint**: `GET /api/booking-rules`
- **Role**: Public
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "limits": { "maxPassengers": 6, "maxPassengersTatkal": 4, "holdMinutes": 10, "bookingWindowDays": 7, "adultRequired": true, "minAdultAge": 18 },
    "seniorCitizen": { "minAgeMale": 60, "minAgeFemale": 45, "concessionEnabled": false },
    "ladiesQuotaFemaleFromAge": 12,
    "children": { "note": "There is no child fare and no free child seat in this system. ..." },
    "tatkal": { "maxPassengers": 4, "concessionAllowed": false, "chargePercentAc": 30, "chargePercentNonAc": 10, "rules": ["..."] },
    "fare": { "gstRateAc": 0.05, "insurancePerPassenger": 0.45 },
    "quotas": [ { "quota": "GENERAL", "label": "General", "rule": "..." } ],
    "concessions": [
      { "type": "NONE", "label": "No concession", "description": "Full fare. No proof needed.", "needsProof": false, "proofTypes": [], "discounts": [] },
      { "type": "DIVYAANG", "label": "Divyaang (person with disability)", "description": "...", "needsProof": true,
        "proofTypes": ["RAILWAY_DIVYANGJAN_ID", "UDID", "CONCESSION_CERTIFICATE"],
        "discounts": [ { "classCode": "3A", "trainGroup": "STANDARD", "discountPct": 75, "active": true } ] }
    ]
  }
}
```
- The limits, the senior ages (`SENIOR_AGE_MALE`, `SENIOR_AGE_FEMALE`) and the senior-concession switch come from `SETTING`; the concession list from `CONCESSION_RULE`. **Children:** the business rules have no child fare (BR scope note: children are booked as normal passengers at full fare), so the response says so; there is no "under 5, no seat" rule.
- **The passenger limit is now enforced by the API** (`POST /api/bookings` and `POST /api/counter/bookings`): more than `MAX_PASSENGERS_PER_PNR` (6), or more than `MAX_PASSENGERS_PER_PNR_TATKAL` (4) on a Tatkal booking, is refused with `400 VALIDATION_ERROR`. Before this change the screen said 4 for Tatkal while the API accepted 6.

#### 3.8.2 Contact info
- **Method / Endpoint**: `GET /api/contact-info`
- **Role**: Public
- **Response (200 OK)**: `{ "success": true, "data": { "helpline": "...", "email": "...", "address": "..." } }`, read from the `SETTING` rows `CONTACT_HELPLINE`, `CONTACT_EMAIL`, `CONTACT_ADDRESS` (demo values; change them in Admin, Settings).

## 4. Booking & Ticket Lifecycle APIs

### 4.1 The 10-Minute Hold (BR-B2)
There is no separate "hold" route. `POST /api/bookings` (4.2) creates the booking as `PAYMENT_PENDING` and holds the seats, RAC or waiting-list place for `HOLD_MINUTES` (default 10) minutes. The hold is the `BOOKING` row itself (the table `SEAT_HOLD` is not used).
- **Method / Endpoint**: `GET /api/bookings/:pnr/hold`
- **Role**: Passenger (owner of the PNR only)
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "pnr": "2849102841",
    "bookingStatus": "PAYMENT_PENDING",
    "expiresAt": "2026-10-18 16:10:00",
    "secondsRemaining": 412
  }
}
```
- **After the hold**: a background job calls `sp_release_expired_holds` every minute. The booking becomes `FAILED`, seats are released and the next passengers are promoted. A payment that arrives later is refunded automatically (4.3.2).
- **Errors**: `403 FORBIDDEN` (not the owner), `404 NOT_FOUND`.

---

### 4.2 Create Booking (Initiate Payment Pending State)
- **Method / Endpoint**: `POST /api/bookings`
- **Role**: Passenger / Staff
- **Request Body**:
```json
{
  "trainId": 129,
  "journeyDate": "2026-10-20",
  "boardingStationId": 21,
  "destinationStationId": 10,
  "classType": "3A",
  "quota": "GENERAL",
  "requestedQuota": "LADIES",
  "continueWithGeneralQuota": true,
  "passengers": [
    {
      "name": "Sunita Sharma",
      "age": 48,
      "gender": "FEMALE",
      "idProofType": "AADHAAR",
      "idProofReference": "XXXX-XXXX-3829",
      "disabilityType": "NONE",
      "concessionType": "NONE",
      "berthPreference": "LOWER"
    },
    {
      "name": "Ananya Sharma",
      "age": 19,
      "gender": "FEMALE",
      "idProofType": "AADHAAR",
      "idProofReference": "XXXX-XXXX-9912",
      "disabilityType": "NONE",
      "concessionType": "NONE",
      "berthPreference": "MIDDLE"
    }
  ],
  "preferences": {
    "berthCondition": true
  }
}
```
- **Fields the server reads**: `trainId, journeyDate, boardingStationId, destinationStationId, classType, quota`, optional `requestedQuota` and `continueWithGeneralQuota` (consent to the General fallback), `passengers[]` (1 to 6) and `preferences.berthCondition`. Passenger fields: `name, age, gender`, optional `savedPassengerId` (must be yours, else `403`), `concessionType`, `idProofType` and `idProofReference` (used as the concession proof), `berthPreference`. Other fields in older examples (`holdToken`, `autoUpgrade`, `bookOnlyIfConfirmed`, `travelInsurance`) are ignored.
- **Response (201 Created)**:
```json
{
  "success": true,
  "data": {
    "pnr": "2849102841",
    "bookingStatus": "PAYMENT_PENDING",
    "projectedStatus": "CONFIRMED",
    "totalFare": 4079.60,
    "fareBreakdown": [
      {
        "passengerNo": 1,
        "name": "Sunita Sharma",
        "baseFare": 1857.24,
        "concessionDiscount": 0.00,
        "reservationCharge": 40.00,
        "superfastCharge": 45.00,
        "tatkalCharge": 0.00,
        "dynamicSurcharge": 0.00,
        "gst": 97.11,
        "insurance": 0.45,
        "totalFare": 2039.80
      },
      {
        "passengerNo": 2,
        "name": "Ananya Sharma",
        "baseFare": 1857.24,
        "concessionDiscount": 0.00,
        "reservationCharge": 40.00,
        "superfastCharge": 45.00,
        "tatkalCharge": 0.00,
        "dynamicSurcharge": 0.00,
        "gst": 97.11,
        "insurance": 0.45,
        "totalFare": 2039.80
      }
    ],
    "expiresAt": "2026-10-18 16:10:00",
    "secondsRemaining": 600
  }
}
```
`projectedStatus` is what the passenger will get once paid (`CONFIRMED`, `RAC` or `WAITING_LIST`).
- **Errors**: `VALIDATION_ERROR` (400), `FORBIDDEN` (403, someone else's saved passenger), and the booking rule codes in 1.2: `SEAT_NOT_AVAILABLE`, `WAITING_LIST_FULL`, `TRAIN_NOT_RUNNING`, `JOURNEY_PAST`, `OUTSIDE_BOOKING_WINDOW`, `QUOTA_NOT_ELIGIBLE`, `CONCESSION_PROOF_REQUIRED`, `NO_ADULT_PASSENGER`, `BERTH_PREFERENCE_NOT_MET`, `MONTHLY_LIMIT_EXCEEDED`, `CHART_PREPARED`, `TRANSACTION_FAILED`.

---

#### 4.2.1 Fare Preview (read only)
- **Method / Endpoint**: `POST /api/bookings/fare-preview`
- **Role**: Any logged-in user. Nothing is held, saved or charged.
- **Request Body**: the same fields as `POST /api/bookings` (`trainId`, `journeyDate`, `boardingStationId`, `destinationStationId`, `classType`, `quota`, `passengers[]`; per passenger `name`, `age`, `gender`, `concessionType`, `idProofType`, `idProofReference`).
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "valid": false,
    "errors": [ { "index": 2, "code": "CONCESSION_PROOF_REQUIRED", "message": "Old Rao: a concession needs an ID proof type and number." } ],
    "warnings": [ { "index": 1, "code": "NO_CONCESSION_ON_TATKAL", "message": "..." } ],
    "quota": "GENERAL", "distanceKm": 2156,
    "passengers": [ { "index": 0, "name": "Asha Rao", "concessionType": "NONE", "projectedStatus": "CONFIRMED",
      "baseFare": 2889.04, "concessionDiscount": 0, "reservationCharge": 40, "superfastCharge": 45, "tatkalCharge": 0,
      "dynamicSurcharge": 0, "gst": 148.7, "insurance": 0.45, "totalFare": 3123.19 } ],
    "totalFare": 8611.2, "estimate": true, "note": "..."
  }
}
```
- Every line is the answer of `fn_calculate_fare` (the function the booking uses), so the preview equals the fare of the real booking line by line. `errors` are the refusals the booking would give (passenger limit, no adult, concession without proof, Ladies, Senior citizen and Divyaang quota rules, chart prepared); `warnings` are allowed cases the passenger should know (no concession on Tatkal, senior concession switched off). `projectedStatus` is an estimate (`CONFIRMED`, `RAC`, `WAITING_LIST`, `NOT AVAILABLE`); the real status is decided when the seats are held.
- **Errors**: `400 VALIDATION_ERROR` (missing field, bad stops, bad class), `400 TRAIN_NOT_RUNNING`, `401`.

#### 4.2.2 Cancel an Unpaid Booking
- **Method / Endpoint**: `POST /api/bookings/:pnr/cancel-unpaid`
- **Role**: Passenger (owner only)
- **What it does**: `sp_cancel_unpaid_booking` releases the hold of ONE booking: every reservation is cancelled, the freed seats are promoted, the inventory counters are re-synced and the booking ends as `FAILED` (the same end state as an expired hold). The booking's open payment orders are then checked at Razorpay (a payment that already went through is finished or refunded as usual) and closed (`EXPIRED`).
- **Response (200 OK)**: `{ "success": true, "data": { "pnr": "2849102841", "bookingStatus": "FAILED", "released": true, "ordersClosed": 1 } }`
- **Errors**: `403 FORBIDDEN` (not the owner), `404 NOT_FOUND`, `409 CONFLICT` (the booking is not waiting for payment any more).
- `GET /api/bookings/:pnr` (owner) now also returns `holdSecondsRemaining` for a `PAYMENT_PENDING` booking and, for every passenger, `concessionType` and a `fare` object (`baseFare`, `concessionDiscount`, `reservationCharge`, `superfastCharge`, `tatkalCharge`, `dynamicSurcharge`, `gst`, `insurance`, `totalFare`). Staff and admin also get a `verification` object per passenger (`result`, `remarks`, `verifiedAt`, or `null`).

### 4.3 Razorpay TEST Mode Payment Endpoints (BR-B7)

**How payments are protected (MySQL is the source of truth):** the order is saved in MySQL (`PAYMENT_ORDER`) right after Razorpay creates it; MongoDB only keeps an optional audit copy, so a MongoDB problem never fails order creation or verification. A payment made at Razorpay always ends as a confirmed ticket (inside the hold) or an automatic refund (after the hold), even if the browser closes before `/verify`: the reconcile job, the webhook and the "check payment status" call all use the same confirm path (`sp_confirm_payment`), and a payment id is never confirmed twice.

#### 4.3.1 Create Gateway Order
- **Method / Endpoint**: `POST /api/payments/razorpay/order`
- **Role**: Passenger
- **Request Body**:
```json
{
  "pnr": "2849102841"
}
```
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "orderId": "order_test_9921048",
    "amount": 407960,
    "currency": "INR",
    "keyId": "rzp_test_51Abc9921",
    "pnr": "2849102841"
  }
}
```

- **One open order per booking:** pressing Pay twice does NOT create a second order. If the booking already has an open order (`CREATED`, same amount), that order is returned with `"reused": true` (the hold is still running, so it is still valid). Before reusing it the server asks Razorpay once whether it was already paid; if so the ticket is finished at once and the answer is `{ "alreadyPaid": true, "pnr": "...", "bookingStatus": "CONFIRMED" }` (nothing to pay).
- **Abandoned orders are closed.** An order that is still `CREATED` while its booking is no longer `PAYMENT_PENDING` (the hold ended, the passenger cancelled it, or another order paid) is checked at Razorpay and, if nothing was paid, set to `EXPIRED`. This runs when holds are released and in the one-minute background job. Razorpay cannot cancel an order and a payment window can still be open in a browser, so an `EXPIRED` order is still checked for 24 hours (reconcile job, "check payment status", webhook): a payment that still arrives becomes `LATE_PAID` and is refunded automatically.

#### 4.3.2 Verify Gateway Payment Signature & Issue Ticket
- **Payment method:** `PAYMENT.method` stores what the customer really used, read from Razorpay (`payments.fetch`): `UPI`, `NET_BANKING`, `CREDIT_CARD` or `DEBIT_CARD` (card type), otherwise `UNKNOWN` (wallet, EMI, or no answer from Razorpay). It was always `UPI` before.
- **Method / Endpoint**: `POST /api/payments/razorpay/verify`
- **Role**: Passenger
- **Request Body**:
```json
{
  "pnr": "2849102841",
  "razorpayOrderId": "order_test_9921048",
  "razorpayPaymentId": "pay_test_8829104",
  "razorpaySignature": "9a38f420b923184..."
}
```
- **Response (200 OK - Successful Payment within Hold Timer)**:
```json
{
  "success": true,
  "data": {
    "paymentId": 501,
    "pnr": "2849102841",
    "paymentStatus": "SUCCESS",
    "gatewayPaymentId": "pay_test_8829104",
    "paidAt": "2026-10-18 16:05:22",
    "bookingStatus": "CONFIRMED",
    "passengers": [
      {
        "passengerNo": 1,
        "name": "Sunita Sharma",
        "coachNumber": "B1",
        "seatNumber": 23,
        "berthType": "LOWER",
        "status": "CONFIRMED"
      },
      {
        "passengerNo": 2,
        "name": "Ananya Sharma",
        "coachNumber": "B1",
        "seatNumber": 25,
        "berthType": "MIDDLE",
        "status": "CONFIRMED"
      }
    ]
  }
}
```
- **Errors**: `400 BAD_REQUEST` (order not found in MySQL for this PNR, order amount does not match the booking fare, invalid signature), `400 PAYMENT_AMOUNT_MISMATCH` or `400 PAYMENT_AMOUNT_INVALID` (raised by `sp_confirm_payment`; no ticket is issued), `403`, `404`.
- **Response (200 OK - Late Payment After Hold Expiry, BR-B14)**:
```json
{
  "success": false,
  "error": {
    "code": "HOLD_EXPIRED",
    "message": "Payment arrived after the seat hold expired (HOLD_MINUTES). No seats were assigned. Your payment has been refunded in full automatically."
  },
  "data": {
    "bookingStatus": "FAILED",
    "refund": {
      "refundId": 301,
      "amount": 4079.60,
      "reason": "PAYMENT_AFTER_EXPIRY",
      "status": "PROCESSED",
      "gatewayRefund": "PROCESSED",
      "gatewayPaymentId": "pay_test_8829104"
    }
  }
}
```

#### 4.3.3 Reconcile a Payment (check payment status)
- **Method / Endpoint**: `POST /api/payments/razorpay/reconcile`
- **Role**: Passenger (owner of the PNR only)
- **Request Body**: `{ "pnr": "2849102841" }`
- Asks Razorpay about every `CREATED` order of the PNR. A captured payment (an authorized one is captured first) is confirmed through `sp_confirm_payment` (ticket inside the hold, automatic refund after it). Safe to call repeatedly: a payment id never creates a second `PAYMENT` row. Rate limit: one call per PNR every 10 seconds (`429 TOO_MANY_REQUESTS`).
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "pnr": "2849102841",
    "bookingStatus": "CONFIRMED",
    "paymentReceived": true,
    "paidAfterHoldExpired": false,
    "ordersChecked": 1
  }
}
```
When the payment arrived after the hold, `paidAfterHoldExpired` is `true`, `bookingStatus` is `FAILED` and a `refund` object (same shape as 4.3.2) is added.
- **A background job** does the same every 60 seconds for `CREATED` orders older than 1 minute and newer than 24 hours (at most 20 per run, one run at a time).

#### 4.3.4 Razorpay Webhook
- **Method / Endpoint**: `POST /api/payments/razorpay/webhook` (called by Razorpay, no login)
- Needs the environment variable `RAZORPAY_WEBHOOK_SECRET`. The header `X-Razorpay-Signature` must be the HMAC-SHA256 of the RAW request body with that secret.
- **Answers**: `503` when the secret is not set, `400` for a missing or wrong signature, `200` for every valid signature (also for unknown orders). Repeated deliveries change nothing.
- **Events handled**: `payment.captured` and `order.paid` (the order is reconciled with Razorpay, same as 4.3.3); `refund.processed` and `refund.failed` (the `REFUND` row is found by `notes.refund_id` or `gateway_refund_id` and updated through `sp_set_refund_result`). Other events are ignored.

---

### 4.4 Station Counter Booking API (Section 12, BR-CB1 to BR-CB8)
- **Method / Endpoint**: `POST /api/counter/bookings`
- **Role**: Staff (any logged-in staff member; the code does not check for a `COUNTER_DUTY` shift)
- **Request Body**:
```json
{
  "trainId": 129,
  "journeyDate": "2026-10-20",
  "boardingStationId": 21,
  "destinationStationId": 10,
  "classType": "3A",
  "quota": "GENERAL",
  "isWalkin": true,
  "registeredUserId": null,
  "passengers": [
    {
      "name": "Kishore Kumar",
      "age": 62,
      "gender": "MALE",
      "idProofType": "AADHAAR",
      "idProofReference": "XXXX-XXXX-4811",
      "disabilityType": "NONE",
      "concessionType": "NONE",
      "berthPreference": "LOWER"
    }
  ],
  "payment": {
    "method": "CASH",
    "amountCollected": 2039.80
  }
}
```
- **Response (201 Created)**:
```json
{
  "success": true,
  "data": {
    "pnr": "6810294819",
    "channel": "COUNTER",
    "bookedByStaffId": 1,
    "userAccount": "COUNTER_WALKIN",
    "bookingStatus": "CONFIRMED",
    "totalFare": 2039.80,
    "payment": {
      "method": "CASH",
      "status": "SUCCESS"
    },
    "passengers": [
      {
        "passengerNo": 1,
        "name": "Kishore Kumar",
        "coachNumber": "B2",
        "seatNumber": 12,
        "berthType": "LOWER",
        "status": "CONFIRMED"
      }
    ],
    "printableTicketText": "INDIAN RAILWAYS / PNR: 6810294819 / BCT -> NDLS / COACH: B2 SEAT: 12 (LOWER) / FARE: Rs 2039.80 (CASH PAID)"
  }
}
```
- **Registered user check**: when `isWalkin` is `false` and `registeredUserId` is given, the user must exist (`404 NOT_FOUND`), have role `PASSENGER` and be `ACTIVE` (`400 VALIDATION_ERROR`). A `saved_passenger_id` on a passenger is used only if it belongs to the account being booked for; otherwise it is stored as NULL.

---

### 4.5 Ticket Cancellation & Refund Estimation (Section 8)
- **Method / Endpoint**: `POST /api/bookings/:pnr/cancel`
- **Role**: Passenger / Staff / Admin
- **Request Body**:
```json
{
  "passengerNos": [2]
}
```
*(Empty or omitted `passengerNos` cancels entire PNR)*
- **Allowed booking statuses**: `CONFIRMED`, `RAC` and `WAITING_LIST`. `PAYMENT_PENDING`, `FAILED` and `CANCELLED` bookings are refused with `400 BAD_REQUEST`. Refund amounts for RAC and waiting-list passengers (full fare minus clerkage) are calculated by the database function, not by the API.
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "cancelId": 401,
    "pnr": "2849102841",
    "cancelledPassengers": [2],
    "hoursBeforeOriginDeparture": 46.5,
    "deductionPercentage": 25.0,
    "cancellationCharge": 509.84,
    "refundAmount": 1529.51,
    "refund": {
      "refundId": 302,
      "reason": "CANCELLATION",
      "status": "PROCESSED"
    },
    "promotionTriggered": true,
    "cancelIds": [401],
    "refundIds": [302],
    "gatewayRefund": "PROCESSED"
  }
}
```
- **Refund status:** SQL writes the refund as `PENDING`. The backend then calls the gateway for each new refund row and records the result. `refund.status` is the status after that call. `gatewayRefund` is `PROCESSED` (money sent), `SKIPPED` (cash, seeded or simulated payment: no real money moves, the row is still marked `PROCESSED` with a note), `PENDING` (still being processed) or `FAILED`. When `FAILED` or `PENDING` the request still succeeds (the cancellation is done) and an extra `refundMessage` says the refund will be retried. Failed refunds are retried every minute (older than 5 minutes, at most 3 attempts) and can be retried by an admin. Clients must say "processed" only when the status is `PROCESSED`.
- **Errors**: `CHART_PREPARED` (less than 8 hours before origin departure), `REFUND_EXCEEDS_PAYMENT`, `BAD_REQUEST` (booking not cancellable, passenger not on the PNR, already cancelled), `FORBIDDEN` (not your PNR), `NOT_FOUND`. Passengers are cancelled one by one in one database transaction; if any step fails nothing is saved.

#### 4.5.1 Refund Estimate Preview (Section 8)
- **Method / Endpoint**: `GET /api/bookings/:pnr/refund-estimate`
- **Role**: Passenger (own PNR only) / Staff / Admin
- **Query Parameters**:
  - `passengerNos` (optional): Comma-separated passenger numbers to preview (e.g., `?passengerNos=1,2`). If omitted or empty, estimates refund for all active passengers on the PNR.
- **Behavior**: Strictly read-only preview using database function `fn_calculate_cancellation_refund(pnr, passenger_no, NULL)`. Modifies no database rows and records no charges or refunds.
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "pnr": "2849102841",
    "hoursBeforeOriginDeparture": 46.5,
    "passengers": [
      {
        "passengerNo": 1,
        "name": "Sunita Sharma",
        "reservationStatus": "CONFIRMED",
        "fare": 1400.00,
        "charge": 350.00,
        "refundAmount": 1050.00
      }
    ],
    "totalCancellationCharge": 350.00,
    "totalRefundAmount": 1050.00
  }
}
```
- **Errors**: `404 Not Found` (Booking not found), `403 Forbidden` (Not booking owner and not staff/admin), `400 Bad Request` (Invalid passenger numbers, or a booking that is not CONFIRMED, RAC or WAITING_LIST).

#### 4.5.2 My Bookings List
- **Method / Endpoint**: `GET /api/bookings`
- **Role**: Passenger only (STAFF and ADMIN receive 403 Forbidden; logged-in passenger sees only their own bookings, newest first, then PNR descending)
- **Query Parameters**:
  - `status` (optional): Filter bookings by status (`CONFIRMED`, `RAC`, `WAITING_LIST`, `CANCELLED`, `FAILED`, `PAYMENT_PENDING`).
  - `limit` (optional): Maximum number of bookings to return (default: `50`, maximum: `200`).
- Bookings with status `PAYMENT_PENDING` also carry `holdSecondsRemaining` (seconds left in the seat hold, worked out by MySQL). The passenger portal shows **Check payment status** only while it is above 0.
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "pnr": "2849100161",
      "bookingStatus": "CONFIRMED",
      "trainNumber": "12301",
      "trainName": "Howrah Rajdhani Express (12301)",
      "journeyDate": "2026-10-18",
      "classType": "3A",
      "quota": "GENERAL",
      "totalFare": 4225.94,
      "passengerCount": 2,
      "createdAt": "2026-10-17 12:00:00",
      "boardingStation": {
        "stationCode": "HWH",
        "stationName": "HOWRAH JN."
      },
      "destinationStation": {
        "stationCode": "NDLS",
        "stationName": "NEW DELHI"
      }
    }
  ]
}
```
- **Errors**: `401 Unauthorized` (Token missing, invalid, or expired), `403 Forbidden` (Only passengers can access booking list).

#### 4.5.3 PNR Status Lookup
- **Method / Endpoint**: `GET /api/bookings/:pnr`
- **Role**: Passenger (own PNR only) / Staff / Admin (may read any PNR)
- **Parameters**:
  - `pnr` (path parameter, required): 10-digit PNR string.
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "pnr": "2849100001",
    "bookingStatus": "CONFIRMED",
    "trainNumber": "12301",
    "trainName": "Howrah Rajdhani Express (12301)",
    "journeyDate": "2026-10-18",
    "classType": "1A",
    "quota": "GENERAL",
    "totalFare": 15374.61,
    "passengerCount": 3,
    "createdAt": "2026-10-17 12:00:00",
    "boardingStation": {
      "stationCode": "HWH",
      "stationName": "HOWRAH JN."
    },
    "destinationStation": {
      "stationCode": "NDLS",
      "stationName": "NEW DELHI"
    },
    "passengers": [
      {
        "passengerNo": 1,
        "name": "Ekapad Dhingra",
        "age": 79,
        "gender": "MALE",
        "status": "CONFIRMED",
        "queuePosition": null,
        "coachNumber": "H1",
        "seatNumber": 3,
        "berthType": "LOWER"
      },
      {
        "passengerNo": 2,
        "name": "Advaith Tata",
        "age": 77,
        "gender": "MALE",
        "status": "CONFIRMED",
        "queuePosition": null,
        "coachNumber": "H1",
        "seatNumber": 4,
        "berthType": "UPPER"
      }
    ]
  }
}
```
- **Errors**: `404 Not Found` (Booking not found), `403 Forbidden` (Not booking owner and not staff/admin), `401 Unauthorized` (Token missing, invalid, or expired), `400 Bad Request` (Invalid PNR parameter).

---

### 4.6 File and Track TDR (Ticket Deposit Receipt, Section 9)

**Which reason is valid when** (the rules of `sp_file_tdr`): `TRAIN_DELAYED_OVER_3_HOURS` needs a CONFIRMED or RAC passenger, a schedule delay of 180 minutes or more and a train that has not left the boarding station; `TRAIN_DIVERTED` needs a CONFIRMED or RAC passenger and a train that has not left (there is no "diverted" flag in the data, the admin checks the claim); `CLASS_DOWNGRADED`, `AC_FAILURE`, `COACH_NOT_ATTACHED` and `TRAIN_TERMINATED_SHORT` need a CONFIRMED, RAC or BOARDED passenger, a train that HAS left, an evidence reference, and filing within 72 hours of the destination arrival plus delay. One open TDR per passenger.

#### 4.6.0 TDR eligibility (for the form, read only)
- **Method / Endpoint**: `GET /api/tdr/eligibility/:pnr` (owner passenger only: `403` for another passenger's PNR, `404` unknown PNR)
- **Response (200 OK)**: `pnr`, `trainNumber`, `trainName`, `journeyDate`, `from`, `to`, `delayMinutes`, `departed`, `expectedDeparture`, `asOf`, `reasons[]` (`code`, `label`, `description`, `deadlineHours`, `evidenceRequired`, `refundPct`) and `passengers[]` (`passengerNo`, `name`, `age`, `gender`, `reservationStatus`, and per reason `{ code, eligible, why }`; `why` is one plain sentence such as "The train is not delayed. At least 3 hours (180 minutes) of delay are needed.").
- When `POST /api/tdr` is refused because the passenger is not eligible or the deadline passed, the error message now says exactly why and names the passenger (it used to be one generic sentence).
- `GET /api/tdr` now also returns `passengerName`, `trainNumber`, `trainName`, `journeyDate`, `reasonLabel`, `reviewedAt` and `refundStatus` (`PENDING`, `PROCESSED`, `FAILED` or `null`; the status of the REFUND row of the TDR) next to `status` and `refundAmount`.

#### 4.6.1 File a TDR
- **Method / Endpoint**: `POST /api/tdr`
- **Role**: Passenger
- **Request Body**:
```json
{
  "pnr": "2849102841",
  "passengerNos": [1],
  "reason": "TRAIN_DELAYED_OVER_3_HOURS",
  "evidenceReference": "DELAY_LOG_STATION_BCT"
}
```
- **Response (201 Created)**:
```json
{
  "success": true,
  "data": {
    "tdrRefNo": "TDR-2849102841-1-1",
    "pnr": "2849102841",
    "reason": "TRAIN_DELAYED_OVER_3_HOURS",
    "status": "FILED",
    "filedAt": "2026-10-18 16:15:00",
    "tdrRefNos": [
      "TDR-2849102841-1-1"
    ],
    "tdrs": [
      {
        "tdrRefNo": "TDR-2849102841-1-1",
        "passengerNo": 1,
        "status": "FILED"
      }
    ]
  }
}
```
- **All-or-nothing**: when `passengerNos` has several passengers, all TDRs are filed in one database transaction. If any passenger fails (for example not found or not eligible), none are saved and the error for that passenger is returned.
- **Errors**: `400 Bad Request` (Invalid reason code, deadline exceeded, missing evidence, duplicate TDR, or passenger already marked `BOARDED`), `401 Unauthorized` (Token missing or invalid), `403 Forbidden` (Not PNR owner or non-passenger token), `404 Not Found` (Booking or passenger not found).

- **Method / Endpoint**: `GET /api/tdr`
- **Role**: Passenger
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "tdrRefNo": "TDR-2849102841-1-1",
      "pnr": "2849102841",
      "passengerNo": 1,
      "reason": "TRAIN_DELAYED_OVER_3_HOURS",
      "status": "FILED",
      "filedAt": "2026-10-18 16:15:00",
      "refundAmount": null,
      "remarks": null
    }
  ]
}
```
- **Errors**: `401 Unauthorized` (Token missing or invalid), `403 Forbidden` (Non-passenger role).

- **Method / Endpoint**: `GET /api/tdr/:tdrRefNo`
- **Role**: Passenger (own filings only)
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "tdrRefNo": "TDR-2849102841-1-1",
    "pnr": "2849102841",
    "passengerNo": 1,
    "reason": "TRAIN_DELAYED_OVER_3_HOURS",
    "status": "FILED",
    "filedAt": "2026-10-18 16:15:00",
    "refundAmount": null,
    "remarks": null
  }
}
```
- **Errors**: `401 Unauthorized` (Token missing or invalid), `403 Forbidden` (Not owner of filing or non-passenger role), `404 Not Found` (TDR not found).

---

## 5. Staff & Operations APIs

### 5.1 Staff Duty & Passenger Chart Manifest

#### 5.1.1 Current Staff Duty Assignment
- **Method / Endpoint**: `GET /api/staff/assignments/current`
- **Role**: `STAFF` (staff ID extracted from JWT token)
- **Behavior**: Returns the assignment active now (`NOW() BETWEEN shift_start AND shift_end`), otherwise the most recent one with `isActive: false` (since seed shifts are in the past).
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "assignId": 1,
    "staffId": 1,
    "scheduleId": 1001,
    "stationId": 21,
    "dutyType": "TRAIN_DUTY",
    "shiftStart": "2026-10-18 06:00:00",
    "shiftEnd": "2026-10-18 14:00:00",
    "isActive": false,
    "station": {
      "stationId": 21,
      "stationCode": "BCT",
      "stationName": "MUMBAI CENTRAL"
    },
    "schedule": {
      "scheduleId": 1001,
      "trainId": 101,
      "trainNumber": "12951",
      "trainName": "Mumbai Tejas Rajdhani Express",
      "journeyDate": "2026-10-18"
    }
  }
}
```
- **Errors**: `401 Unauthorized` (Token missing or invalid), `403 Forbidden` (Non-staff role), `404 Not Found` (No duty assignment found).

#### 5.1.2 Passenger Chart Manifest View
- Each chart row now also carries the LIVE state from the database (the chart itself is a frozen snapshot): `reservationStatus` (`BOARDED` and `NO_SHOW` are saved on the reservation), `verificationResult`, `verificationRemarks` and `verifiedAt` (the latest `TICKET_VERIFICATION` of the passenger). The staff portal reads boarding and verification from these fields, so they survive a page reload.
- **Method / Endpoint**: `GET /api/staff/schedules/:scheduleId/chart`
- **Role**: `STAFF` (must have assignment for that run) or `ADMIN`
- **Behavior**: Returns immutable `CHART_SNAPSHOT` rows for the schedule. Refuses with `400 Bad Request` if the chart has not been prepared yet.
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "snapshotId": 1,
      "scheduleId": 1111,
      "pnr": "2849100001",
      "passengerNo": 1,
      "passengerName": "Ekapad Dhingra",
      "passengerAge": 34,
      "passengerGender": "MALE",
      "classType": "3A",
      "quota": "GENERAL",
      "journeyDate": "2026-10-23",
      "trainId": 129,
      "coachNo": "H1",
      "seatNo": 3,
      "berthType": "LOWER",
      "status": "CONFIRMED",
      "fromStationId": 69,
      "fromStationCode": "HWH",
      "toStationId": 10,
      "toStationCode": "NDLS",
      "concessionFlag": false,
      "generatedAt": "2026-10-23 12:00:00"
    }
  ]
}
```
- **Errors**: `400 Bad Request` (Chart not prepared yet or invalid scheduleId), `401 Unauthorized` (Token missing or invalid), `403 Forbidden` (Staff not assigned to this schedule, or non-staff/non-admin token), `404 Not Found` (Schedule not found).

- **`GET /api/staff/pnr/:pnr`**: Instant lookup of passenger status and allocated berth.

### 5.2 Ticket Verification & Boarding (BR-ST3, BR-ST4)
- **`POST /api/staff/verification`**:
  - **Role**: `STAFF` (staff ID extracted from JWT token)
  - **Request Body**:
    ```json
    {
      "pnr": "2849102841",
      "passengerNo": 1,
      "idChecked": true,
      "concessionChecked": false,
      "result": "VALID",
      "remarks": "ID verified"
    }
    ```
  - **Response (200 OK)**:
    ```json
    {
      "success": true,
      "data": {
        "verifyId": 801,
        "result": "VALID"
      }
    }
    ```
  - **Errors**: `400 Bad Request` (Validation error or idChecked false), `401 Unauthorized` (Token missing or invalid), `403 Forbidden` (Staff not assigned on TRAIN_DUTY for this train schedule, or non-staff token), `404 Not Found` (Booking or passenger not found).

- **`POST /api/staff/boarding`**:
  - **Role**: `STAFF` (staff ID extracted from JWT token)
  - **Request Body**:
    ```json
    {
      "pnr": "2849102841",
      "passengerNo": 1
    }
    ```
  - **Response (200 OK)**:
    ```json
    {
      "success": true,
      "data": {
        "pnr": "2849102841",
        "passengerNo": 1,
        "status": "BOARDED"
      }
    }
    ```
  - **Errors**: `400 Bad Request` (Passenger has open delay TDR [BR-ST4, BR-T6] or status not eligible), `401 Unauthorized` (Token missing or invalid), `403 Forbidden` (Staff not assigned on TRAIN_DUTY for this train schedule, or non-staff token), `404 Not Found` (Booking or passenger not found).

- **`POST /api/staff/no-show`**:
  - **Role**: `STAFF` (staff ID extracted from JWT token)
  - **Request Body**:
    ```json
    {
      "pnr": "2849102841",
      "passengerNo": 1
    }
    ```
  - **Response (200 OK)**:
    ```json
    {
      "success": true,
      "data": {
        "pnr": "2849102841",
        "passengerNo": 1,
        "status": "NO_SHOW"
      }
    }
    ```
  - **Errors**: `400 Bad Request` (Passenger status not eligible for no-show [BR-ST4]), `401 Unauthorized` (Token missing or invalid), `403 Forbidden` (Staff not assigned on TRAIN_DUTY for this train schedule, or non-staff token), `404 Not Found` (Booking or passenger not found).

- **The promote route (`/api/staff/promote`)**: **removed.** The route no longer exists and returns `404 NOT_FOUND`. Promotion happens only inside the database (`sp_promote_passenger`), called by cancellation, no-show, hold release, chart preparation and TDR approval. The API must not let a user free an arbitrary seat.

### 5.3 On-Spot Fines & Incident Reports

#### 5.3.1 Issue On-Spot Fine (BR-ST7)
- **Method / Endpoint**: `POST /api/staff/fines`
- **Role**: `STAFF` (staff ID extracted from JWT token)
- **Validation**:
  - `passengerName`, `idProofReference`, `trainId` are required.
  - `amount` must be greater than 0.
  - `reason` must be a valid FINE ENUM (`TICKETLESS_TRAVEL`, `UNAUTHORIZED_CLASS`, `SMOKING_NUISANCE`, `UNBOOKED_LUGGAGE`).
  - `paymentStatus` must be `PAID` or `UNPAID`.
  - ID generated as `MAX(fine_id) + 1` inside transaction.
- **Request Body**:
```json
{
  "passengerName": "Ajay Kumar",
  "idProofReference": "VOTER-88491",
  "trainId": 129,
  "amount": 550.00,
  "reason": "TICKETLESS_TRAVEL",
  "paymentStatus": "PAID"
}
```
- **Response (201 Created)**:
```json
{
  "success": true,
  "data": {
    "fineId": 101,
    "verifyId": null,
    "staffId": 1,
    "passengerName": "Ajay Kumar",
    "idProofReference": "VOTER-88491",
    "trainId": 129,
    "amount": 550.00,
    "reason": "TICKETLESS_TRAVEL",
    "paymentStatus": "PAID",
    "issuedAt": "2026-10-23 19:35:46"
  }
}
```
- **Errors**: `400 Bad Request` (Missing required field, negative/zero amount, invalid reason or status), `401 Unauthorized`, `403 Forbidden` (Non-staff token), `404 Not Found` (Train not found).

#### 5.3.2 Report Operational Incident (BR-ST8, BR-ST9)
- **Method / Endpoint**: `POST /api/staff/incidents`
- **Role**: `STAFF` (staff ID extracted from JWT token)
- **Validation**:
  - Staff member must have active or scheduled assignment for the train schedule or station.
  - `severity` must be `LOW`, `MEDIUM`, `HIGH`, or `CRITICAL`.
  - Status starts as `REPORTED`.
  - ID generated as `MAX(incident_id) + 1` inside transaction.
- **Request Body**:
```json
{
  "scheduleId": 1001,
  "stationId": 21,
  "type": "MEDICAL_EMERGENCY",
  "severity": "HIGH"
}
```
- **Response (201 Created)**:
```json
{
  "success": true,
  "data": {
    "incidentId": 101,
    "staffId": 1,
    "scheduleId": 1001,
    "stationId": 21,
    "type": "MEDICAL_EMERGENCY",
    "severity": "HIGH",
    "status": "REPORTED",
    "reportedAt": "2026-10-23 19:35:46"
  }
}
```
- **Errors**: `400 Bad Request` (Missing type, invalid severity, neither scheduleId nor stationId provided), `401 Unauthorized`, `403 Forbidden` (Staff not assigned to schedule/station, or non-staff token).

### 5.4 Live Operations, Crowds & Cleanliness

#### 5.4.1 Log Train Delay (BR-ST8)
- **Method / Endpoint**: `POST /api/staff/delays`
- **Role**: `STAFF` (must have `TRAIN_DUTY` assignment on that schedule)
- **Validation**:
  - `delayMinutes` must be an integer between 0 and 1,440.
  - Updates `TRAIN_SCHEDULE.delay_minutes` and status (`DELAYED` if > 0, `ON_TIME` if 0, preserves `CANCELLED`).
- **Request Body**:
```json
{
  "scheduleId": 1001,
  "delayMinutes": 35
}
```
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "scheduleId": 1001,
    "delayMinutes": 35,
    "status": "DELAYED"
  }
}
```
- **Errors**: `400 Bad Request` (delayMinutes out of 0..1440 range or invalid scheduleId), `401 Unauthorized`, `403 Forbidden` (Staff not on TRAIN_DUTY for schedule), `404 Not Found` (Schedule not found).

#### 5.4.2 Report Platform Crowd Density (BR-ST8)
- **Method / Endpoint**: `POST /api/staff/crowd-reports`
- **Role**: `STAFF` (station inferred from staff assignment or validated against it)
- **Validation**:
  - `crowdLevel` must be `LOW`, `MODERATE`, `HIGH`, or `OVERCROWDED`.
  - Platform number must exist at the assigned station.
  - ID generated as `MAX(crowd_report_id) + 1` inside transaction.
- **Request Body**:
```json
{
  "stationId": 21,
  "platformNo": 2,
  "crowdLevel": "HIGH",
  "headCount": 150
}
```
- **Response (201 Created)**:
```json
{
  "success": true,
  "data": {
    "crowdReportId": 101,
    "stationId": 21,
    "platformNo": 2,
    "crowdLevel": "HIGH",
    "headCount": 150,
    "staffId": 1,
    "recordedAt": "2026-10-23 19:35:46"
  }
}
```
- **Errors**: `400 Bad Request` (Invalid crowdLevel, invalid platform number for station), `401 Unauthorized`, `403 Forbidden` (Staff not assigned to station, or non-staff token).

#### 5.4.3 Report Cleanliness Defect (BR-ST8)
- **Method / Endpoint**: `POST /api/staff/cleanliness-reports`
- **Role**: `STAFF` (staff ID extracted from JWT token)
- **Validation**:
  - `issueType` must be one of: `TOILET_DIRTY`, `LITTER`, `WATER_SHORTAGE`, `LINEN_SOILED`, `PESTS`, `SPILLAGE`.
  - `description` is required.
  - Optional targets: `trainId`, `coachId`, `stationId`, `platformNo`.
  - ID generated as `MAX(cleanliness_report_id) + 1` inside transaction.
- **Request Body**:
```json
{
  "issueType": "TOILET_DIRTY",
  "description": "Coach B1 toilet requires immediate sanitation",
  "trainId": 129,
  "coachId": 301
}
```
- **Response (201 Created)**:
```json
{
  "success": true,
  "data": {
    "cleanlinessReportId": 101,
    "staffId": 1,
    "trainId": 129,
    "coachId": 301,
    "stationId": null,
    "platformNo": null,
    "issueType": "TOILET_DIRTY",
    "description": "Coach B1 toilet requires immediate sanitation",
    "status": "REPORTED",
    "recordedAt": "2026-10-23 19:35:46"
  }
}
```
- **Errors**: `400 Bad Request` (Invalid issueType, missing description), `401 Unauthorized`, `403 Forbidden` (Non-staff token).

---

## 6. Maintenance Management APIs (Section 13)

### 6.1 Create Maintenance Task (BR-M1, BR-M2)
- **Method / Endpoint**: `POST /api/maintenance/tasks`
- **Role**: Staff (`MAINTENANCE_DUTY`) / Admin
- **Request Body**:
```json
{
  "coachId": 301,
  "platformId": null,
  "type": "AC_SERVICE",
  "description": "AC compressor unit in Coach B1 experiencing intermittent trip."
}
```
*(Enforces CHECK: exactly one of `coachId` or `platformId` must be non-null)*
- **Response (201 Created)**:
```json
{
  "success": true,
  "data": {
    "maintId": 901,
    "coachId": 301,
    "type": "AC_SERVICE",
    "status": "OPEN",
    "createdAt": "2026-10-18 16:20:00"
  }
}
```

### 6.2 Update Maintenance Task Status (BR-M4)
- **Method / Endpoint**: `PUT /api/maintenance/tasks/:maintId/status`
- **Role**: Staff / Admin
- **Request Body**:
```json
{
  "status": "COMPLETED",
  "completionRemarks": "Compressor motor serviced and refrigerant refilled. Tested functional."
}
```
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "maintId": 901,
    "status": "COMPLETED",
    "completedAt": "2026-10-18 18:00:00"
  }
}
```

---

## 7. Administrator Master Data & Settings APIs

### 7.1 System Settings Management (Section 15)

#### 7.1.1 List System Settings
- **Method / Endpoint**: `GET /api/admin/settings`
- **Role**: `ADMIN`
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "settingKey": "BOOKING_WINDOW_DAYS",
      "settingValue": "7",
      "description": "Advance booking window in days",
      "updatedAt": "2026-10-18 00:00:00"
    }
  ]
}
```
- **Errors**: `401 Unauthorized` (Token missing or invalid), `403 Forbidden` (Non-admin token).

#### 7.1.2 Update System Setting
- **Method / Endpoint**: `PUT /api/admin/settings/:key`
- **Role**: `ADMIN`
- **Validation**:
  - Key must exist in SETTING table (18 supported configuration keys).
  - Numeric settings must be strictly positive (> 0), except these keys which have their own range (the database refuses other values too, through `fn_setting_value_valid` and the SETTING triggers):
    `GST_RATE_AC` a number from 0 to 1 (0.05 = 5%), `INSURANCE_PREMIUM_PER_PASSENGER` and `CLERKAGE_PER_PASSENGER` a number from 0 to 10000, `MIN_CHARGEABLE_DISTANCE_KM` a whole number from 0 to 10000, `BOOKING_WINDOW_DAYS` a whole number from 0 to 365, `HOLD_MINUTES` a whole number from 1 to 1440.
  - `SENIOR_AGE_MALE` and `SENIOR_AGE_FEMALE` (minimum age of a senior citizen, default 60 and 45) are whole numbers from 1 to 120 and are read by `sp_create_booking` (Senior citizen quota and the automatic lower berth) and by `GET /api/booking-rules`.
  - `CONTACT_HELPLINE`, `CONTACT_EMAIL` and `CONTACT_ADDRESS` are plain text of 3 to 200 characters (no angle brackets). They are the Contact Us panel details read through `GET /api/contact-info` (demo values).
  - Boolean flag settings (`CONCESSION_SENIOR_ENABLED`, `DYNAMIC_FARE_ENABLED`) must be `'true'` or `'false'`.
  - **These settings now drive the money maths:** `GST_RATE_AC`, `INSURANCE_PREMIUM_PER_PASSENGER`, `CLERKAGE_PER_PASSENGER`, `MIN_CHARGEABLE_DISTANCE_KM`, `DYNAMIC_FARE_ENABLED` (BR-F11), `CONCESSION_SENIOR_ENABLED` and `BOOKING_WINDOW_DAYS`. A change applies to the next fare, booking or refund. A fare already issued keeps the amounts it was charged (BR-A2). `MAX_PASSENGERS_PER_PNR` and `MAX_PASSENGERS_PER_PNR_TATKAL` are now enforced by the booking and counter-booking APIs (see 3.8.1); `CHART_HOURS_BEFORE_ORIGIN_DEPARTURE` is still reference only.
  - Trigger `trg_audit_setting_change` automatically records audit trail into `AUDIT_LOG`.
- **Request Body**:
```json
{
  "value": "7"
}
```
*(Accepts either `"value"` or `"settingValue"`)*
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "settingKey": "BOOKING_WINDOW_DAYS",
    "settingValue": "7",
    "updatedAt": "2026-10-18 16:22:00"
  }
}
```
- **Errors**: `400 Bad Request` (Unknown setting key, negative or zero numeric value, or invalid boolean value), `401 Unauthorized`, `403 Forbidden`.

### 7.2 Chart Preparation Execution (BR-B12a, BR-B16)
- **Method / Endpoint**: `POST /api/admin/schedules/:scheduleId/chart-preparation`
- **Role**: Admin (or scheduled job at chart time: 8 hours prior to origin departure per BR-B12 / settings table)
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "scheduleId": 1001,
    "trainNumber": "12951",
    "journeyDate": "2026-10-20",
    "chartPreparedAt": "2026-10-20 09:00:00",
    "summary": {
      "activeHoldsCancelled": 3,
      "waitlistedPassengersCancelled": 12,
      "totalRefundsDisbursed": 24480.00,
      "totalRefundsPending": 0.00,
      "totalRefundsFailed": 0.00,
      "chartSnapshotRowsPersisted": 842
    }
  }
}
```

### 7.2.1 List Dated Train Schedules
- **Method / Endpoint**: `GET /api/admin/schedules`
- **Role**: Admin (`requireAdminRole`)
- **Query Parameters**:
  - `from_date` (optional, string `YYYY-MM-DD`): Filter schedules on or after journey date.
  - `to_date` (optional, string `YYYY-MM-DD`): Filter schedules on or before journey date.
  - `train_no` (optional, string): Filter by train number.
  - `limit` (optional, integer): Maximum schedules to return (default 50, max 200).
- **Request Example**:
  `GET /api/admin/schedules?from_date=2026-10-27&to_date=2026-11-02&train_no=12951&limit=50`
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "schedule_id": 1001,
      "scheduleId": 1001,
      "train_id": 101,
      "trainId": 101,
      "train_number": "12951",
      "trainNumber": "12951",
      "train_name": "MUMBAI TEJAS RAJDHANI",
      "trainName": "MUMBAI TEJAS RAJDHANI",
      "journey_date": "2026-10-27",
      "journeyDate": "2026-10-27",
      "departure_time": "16:30:00",
      "departureTime": "16:30:00",
      "arrival_time": "08:32:00",
      "arrivalTime": "08:32:00",
      "chart_prepared_at": null,
      "chartPreparedAt": null,
      "status": "ON_TIME",
      "delay_minutes": 0,
      "delayMinutes": 0,
      "classes": [
        {
          "class_id": 1,
          "classId": 1,
          "class_code": "1A",
          "classCode": "1A",
          "class_name": "First AC",
          "className": "First AC",
          "available_seats": 24,
          "availableSeats": 24,
          "total_seats": 24,
          "totalSeats": 24,
          "rac_count": 0,
          "racCount": 0,
          "rac_capacity": 0,
          "racCapacity": 0,
          "wl_count": 0,
          "wlCount": 0,
          "wl_capacity": 6,
          "wlCapacity": 6
        },
        {
          "class_id": 2,
          "classId": 2,
          "class_code": "2A",
          "classCode": "2A",
          "class_name": "AC 2 Tier",
          "className": "AC 2 Tier",
          "available_seats": 96,
          "availableSeats": 96,
          "total_seats": 96,
          "totalSeats": 96,
          "rac_count": 0,
          "racCount": 0,
          "rac_capacity": 10,
          "racCapacity": 10,
          "wl_count": 0,
          "wlCount": 0,
          "wl_capacity": 24,
          "wlCapacity": 24
        }
      ],
      "total_available_seats": 120,
      "totalAvailableSeats": 120,
      "total_rac_count": 0,
      "totalRacCount": 0,
      "total_wl_count": 0,
      "totalWlCount": 0
    }
  ]
}
```

### 7.3 TDR Review & Adjudication (Section 9)
- **`GET /api/admin/tdr`**:
  - **Role**: Admin (admin ID extracted from token)
  - **Query Parameters**: `?status=` (optional; defaults to `FILED` and `UNDER_REVIEW`)
  - **Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "tdrRefNo": "TDR-2849102841-1-1",
      "pnr": "2849102841",
      "passengerNo": 1,
      "reason": "TRAIN_DELAYED_OVER_3_HOURS",
      "status": "FILED",
      "filedAt": "2026-10-18 16:15:00",
      "evidenceRef": "DELAY_LOG_STATION_BCT",
      "refundAmount": null,
      "remarks": null,
      "reviewedBy": null,
      "reviewedAt": null
    }
  ]
}
```
  - **Errors**: `401 Unauthorized` (Token missing or invalid), `403 Forbidden` (Non-admin token).

- **`PUT /api/admin/tdr/:tdrRefNo`**:
  - **Aliases**: `PUT /api/admin/tdr/:id`, `PUT /api/tdr/admin/:id`
  - **Role**: Admin (admin ID extracted from token)
  - **Request Body (Approval)**:
```json
{
  "status": "APPROVED",
  "refundAmount": 2039.80,
  "remarks": "Train delay exceeded 180 min at boarding stop confirmed via schedule log."
}
```
  - **Request Body (Rejection)**:
```json
{
  "status": "REJECTED",
  "remarks": "Claim rejected: train arrived with less than 3 hours delay."
}
```
  - **Response (200 OK - Approved)**:
```json
{
  "success": true,
  "data": {
    "tdrRefNo": "TDR-2849102841-1-1",
    "status": "APPROVED",
    "refundAmount": 2039.80,
    "refund": {
      "refundId": 303,
      "reason": "TDR_APPROVED",
      "status": "PROCESSED"
    },
    "gatewayRefund": "SKIPPED"
  }
}
```
  - **Response (200 OK - Rejected)**:
```json
{
  "success": true,
  "data": {
    "tdrRefNo": "TDR-2849102841-1-1",
    "status": "REJECTED",
    "refundAmount": 0,
    "refund": null
  }
}
```
  - `refund.status` is the status after the gateway call (SQL writes `PENDING`); a `refundMessage` is added when the gateway is still pending or failed. In the database an approved TDR ends as `REFUND_PROCESSED`; the API answers `APPROVED`. Approval also cancels the passenger and promotes the next RAC and waiting-list passengers (inside `sp_review_tdr`).
  - **Errors**: `400 BAD_REQUEST` (Invalid decision, refundAmount exceeds passenger fare line, TDR already reviewed), `400 REFUND_EXCEEDS_PAYMENT` (the seat was already refunded), `401 Unauthorized` (Token missing or invalid), `403 Forbidden` (Non-admin token), `404 Not Found` (TDR record not found).

### 7.4 Forensic Audit Logs (BR-A7)
- **Method / Endpoint**: `GET /api/admin/audit-logs`
- **Role**: `ADMIN`
- **Query Parameters**:
  - `page` (optional, default: 1)
  - `limit` (optional, default: 50, maximum: 200)
  - `tableName` (optional): Filter by table name (e.g. `SETTING`, `STAFF`)
  - `recordId` (optional): Filter by entity primary key
  - `userId` (optional): Filter by acting user ID
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "logId": 1,
      "userId": 2,
      "action": "UPDATE_SETTING",
      "tableName": "SETTING",
      "recordId": "HOLD_MINUTES",
      "oldValue": {
        "setting_value": "10"
      },
      "newValue": {
        "setting_value": "15"
      },
      "loggedAt": "2026-10-23 19:35:46"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 1,
    "totalPages": 1
  }
}
```
- **Errors**: `401 Unauthorized`, `403 Forbidden` (Non-admin token).

### 7.5 Analytical RANK Reports (06_reports.sql)

#### 7.5.1 List Analytical Reports
- **Method / Endpoint**: `GET /api/admin/reports`
- **Role**: `ADMIN`
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "reportKey": "busiest-trains",
      "reportType": "BUSIEST_TRAINS",
      "name": "Top Busiest Trains Ranked by Passenger Count",
      "description": "Ranks trains by total passengers booked and revenue using RANK() and DENSE_RANK()."
    },
    {
      "reportKey": "top-routes",
      "reportType": "TOP_ROUTES",
      "name": "Top Routes Ranked by Gross Revenue",
      "description": "Ranks route origin-destination pairs by gross revenue using DENSE_RANK()."
    },
    {
      "reportKey": "station-ranking",
      "reportType": "STATION_RANKING",
      "name": "Rank of Stations by Total Passenger Boardings",
      "description": "Ranks stations by total boarding passengers and originating revenue using RANK()."
    },
    {
      "reportKey": "class-revenue",
      "reportType": "CLASS_REVENUE",
      "name": "Class-wise Revenue, Volume and Cumulative Share",
      "description": "Calculates running cumulative revenue and percentage share across coach classes."
    },
    {
      "reportKey": "quota-utilization",
      "reportType": "QUOTA_UTILIZATION",
      "name": "Quota Utilization and Demand Spread",
      "description": "Ranks booking quotas by popularity and total fare collected using RANK()."
    }
  ]
}
```
- **Errors**: `401 Unauthorized`, `403 Forbidden` (Non-admin token).

#### 7.5.2 Execute Analytical Report
- **Method / Endpoint**: `GET /api/admin/reports/:reportKey`
- **Role**: `ADMIN`
- **Behavior**: Runs the report's read-only SQL and records each execution as an audit entry in the `REPORT` table (`report_id = MAX+1` inside a transaction).
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "reportId": 101,
    "reportKey": "busiest-trains",
    "reportType": "BUSIEST_TRAINS",
    "generatedAt": "2026-10-23 19:35:46",
    "rowCount": 15,
    "rows": [
      {
        "rank_pos": 1,
        "dense_rank_pos": 1,
        "train_id": 111,
        "train_number": "12301",
        "train_name": "Howrah Rajdhani Express (12301)",
        "train_type": "RAJDHANI",
        "total_runs_conducted": 6,
        "total_passengers_booked": 850,
        "total_revenue": 1733650.00
      }
    ]
  }
}
```
- **Errors**: `400 Bad Request` (Unknown reportKey), `401 Unauthorized`, `403 Forbidden` (Non-admin token).

### 7.6 Staff Account Management (BR-ST1)

#### 7.6.1 List Staff Accounts
- **Method / Endpoint**: `GET /api/admin/staff`
- **Role**: `ADMIN`
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "staffId": 1,
      "employeeNo": "EMP-TC-101",
      "designation": "TRAIN_TICKET_EXAMINER",
      "status": "ACTIVE",
      "userId": 50002,
      "name": "Vikram Singh",
      "email": "vikram.singh@railways.gov.in",
      "phone": "+91-9876543211",
      "accountStatus": "ACTIVE",
      "createdAt": "2026-10-18 00:00:00"
    }
  ]
}
```
- **Errors**: `401 Unauthorized`, `403 Forbidden` (Non-admin token).

#### 7.6.2 Create Staff Account
- **Method / Endpoint**: `POST /api/admin/staff`
- **Role**: `ADMIN`
- **Validation**:
  - `employeeNo`, `name`, `email`, `phone`, `designation`, and initial `password` are required.
  - Password is hashed with bcrypt like registration; never returned or logged.
  - `user_id` and `staff_id` generated via `MAX+1` inside transaction.
  - Duplicate `employeeNo` or `email` refused.
  - Automatically writes an `AUDIT_LOG` row (`action: 'CREATE_STAFF'`).
- **Request Body**:
```json
{
  "employeeNo": "EMP-TC-104",
  "name": "Amit Patel",
  "email": "amit.patel@railways.gov.in",
  "phone": "+91-9876543219",
  "designation": "TRAIN_TICKET_EXAMINER",
  "password": "Password123!"
}
```
- **Response (201 Created)**:
```json
{
  "success": true,
  "data": {
    "staffId": 4,
    "userId": 50009,
    "employeeNo": "EMP-TC-104",
    "name": "Amit Patel",
    "email": "amit.patel@railways.gov.in",
    "phone": "+91-9876543219",
    "designation": "TRAIN_TICKET_EXAMINER",
    "status": "ACTIVE"
  }
}
```
- **Errors**: `400 Bad Request` (Validation error or duplicate employeeNo/email), `401 Unauthorized`, `403 Forbidden` (Non-admin token).

#### 7.6.3 Update Staff Status
- **Method / Endpoint**: `PUT /api/admin/staff/:staffId/status`
- **Role**: `ADMIN`
- **Validation**:
  - `status` must be `ACTIVE`, `ON_LEAVE`, or `SUSPENDED`.
  - Automatically synchronizes `USER_ACCOUNT.account_status` (`SUSPENDED` prevents login across all portals).
  - Automatically writes an `AUDIT_LOG` row (`action: 'UPDATE_STAFF_STATUS'`).
- **Request Body**:
```json
{
  "status": "SUSPENDED"
}
```
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "staffId": 4,
    "employeeNo": "EMP-TC-104",
    "status": "SUSPENDED"
  }
}
```
- **Errors**: `400 Bad Request` (Invalid status), `401 Unauthorized`, `403 Forbidden` (Non-admin token), `404 Not Found` (Staff not found).

### 7.7 Master Data Management (Stations, Trains, Routes, Coaches, Seats, Fares, Concessions, Refunds)

Role: `ADMIN` only. All entities support full CRUD: `GET` (list), `GET :id` (one), `POST` (create), `PUT :id` (update), and `DELETE :id` (delete).
Safe rules:
- `DELETE` is refused (`409 Conflict` / `400 Bad Request`) when the row is referenced by other records or active schedules exist.
- No change is permitted that breaks existing runs (e.g. altering a train's coaches, seats, or route stops when schedules or bookings exist).
- Inserts use `MAX(primary_key) + 1` inside an exclusive transaction lock.
- Fare, concession, and refund-rule changes are audited by MySQL triggers (Node writes no audit row). For stations, trains, routes, coaches, and seats, Node writes an `AUDIT_LOG` row.

#### 7.7.1 Stations (`/api/admin/stations`)
- `GET /api/admin/stations`: List stations.
- `GET /api/admin/stations/:id`: Get station by ID or code.
- `POST /api/admin/stations`: Create station (`stationCode`, `stationName`, `displayName`, `city`, `state`, `platformCount`).
- `PUT /api/admin/stations/:id`: Update station attributes.
- `DELETE /api/admin/stations/:id`: Delete station. Refused if referenced by trains, route stops, or staff assignments.

#### 7.7.2 Trains (`/api/admin/trains`)
- `GET /api/admin/trains`: List trains.
- `GET /api/admin/trains/:id`: Get train by ID or number.
- `POST /api/admin/trains`: Create train (`trainNumber`, `shortName`, `displayName`, `trainType`, `sourceStationId`, `destinationStationId`, `runningDays`, `status`).
- `PUT /api/admin/trains/:id`: Update train. Refused if altering route endpoints when schedules exist.
- `DELETE /api/admin/trains/:id`: Delete train. Refused if schedules exist.

#### 7.7.3 Route Stops (`/api/admin/routes` & `/api/admin/route-stops`)
- `GET /api/admin/routes`: List stops (optional `?trainId=`).
- `GET /api/admin/routes/:id`: Get stop by ID.
- `POST /api/admin/routes`: Create route stop (`trainId`, `stationId`, `stopSequence`, `arrivalTime`, `departureTime`, `dayOffset`, `distanceFromOrigin`, `platformNumber`). Refused if schedules exist for train.
- `PUT /api/admin/routes/:id`: Update route stop. Refused if schedules exist for train.
- `DELETE /api/admin/routes/:id`: Delete route stop. Refused if schedules or bookings exist.

#### 7.7.4 Coaches (`/api/admin/coaches`)
- `GET /api/admin/coaches`: List coaches (optional `?trainId=`).
- `GET /api/admin/coaches/:id`: Get coach by ID.
- `POST /api/admin/coaches`: Create coach (`trainId`, `classId`, `coachCode`, `sequenceNumber`, `totalSeats`). Refused if schedules exist for train.
- `PUT /api/admin/coaches/:id`: Update coach. Refused if schedules exist for train.
- `DELETE /api/admin/coaches/:id`: Delete coach. Refused if schedules or seats exist.

#### 7.7.5 Seats (`/api/admin/seats`)
- `GET /api/admin/seats`: List physical seats (optional `?coachId=`, `page`, `limit`).
- `GET /api/admin/seats/:id`: Get seat by ID.
- `POST /api/admin/seats`: Create seat (`coachId`, `seatNumber`, `berthType`). Refused if schedules exist for coach's train.
- `PUT /api/admin/seats/:id`: Update seat. Refused if reserved or schedules exist.
- `DELETE /api/admin/seats/:id`: Delete seat. Refused if reserved or schedules exist.

#### 7.7.6 Fares (`/api/admin/fares`)
- `GET /api/admin/fares`: List distance slab rates (optional `?classId=`).
- `GET /api/admin/fares/:id`: Get fare slab by ID.
- `POST /api/admin/fares`: Create distance slab (`classId`, `minDistanceKm`, `maxDistanceKm`, `ratePerKm`).
- `PUT /api/admin/fares/:id`: Update distance slab. Audited via `trg_audit_fare_change`.
- `DELETE /api/admin/fares/:id`: Delete fare slab.

#### 7.7.7 Concession Rules (`/api/admin/concession-rules` & `/api/admin/concessions`)
- `GET /api/admin/concession-rules`: List rules (optional `?concessionType=`).
- `GET /api/admin/concession-rules/:id`: Get rule by ID.
- `POST /api/admin/concession-rules`: Create rule (`concessionType`, `classId`, `trainGroup`, `discountPct`, `proofTypes`, `isActive`).
- `PUT /api/admin/concession-rules/:id`: Update rule. Audited via `trg_audit_concession_change`.
- `DELETE /api/admin/concession-rules/:id`: Delete rule.

#### 7.7.8 Refund Rules (`/api/admin/refund-rules` & `/api/admin/refunds`)
- `GET /api/admin/refund-rules`: List cancellation refund slabs.
- `GET /api/admin/refund-rules/:id`: Get rule by ID.
- `POST /api/admin/refund-rules`: Create refund slab (`minHours`, `maxHours`, `deductionPct`, `flatMinCharge`, `clerkage`).
- `PUT /api/admin/refund-rules/:id`: Update refund slab. Audited via `trg_audit_refund_rule_change`.
- `DELETE /api/admin/refund-rules/:id`: Delete refund slab.

---

### 7.8 Admin Complaints & Activity Logs (MongoDB)

#### 7.8.1 List Complaints
- **Method / Endpoint**: `GET /api/admin/complaints`
- **Role**: `ADMIN`
- **Query Parameters**: `status` (optional: `OPEN`, `IN_PROGRESS`, `RESOLVED`, `REJECTED`)
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "grievanceId": "cmp_901",
      "userId": 50001,
      "category": "TRAIN_CLEANLINESS",
      "subject": "Unhygienic washrooms in coach B1",
      "description": "Washrooms in coach B1 of train 12951 were not sanitized prior to departure from Mumbai Central.",
      "status": "RESOLVED",
      "response": "Housekeeping on board (OBHS) was dispatched and sanitization was completed at Surat station halt.",
      "createdAt": "2026-10-01 23:30:00"
    }
  ]
}
```

#### 7.8.2 Review Complaint
- **Method / Endpoint**: `PUT /api/admin/complaints/:grievanceId`
- **Role**: `ADMIN`
- **Request Body**:
```json
{
  "response": "Refund processed to bank account.",
  "status": "RESOLVED"
}
```
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "grievanceId": "cmp_902",
    "userId": 50002,
    "category": "REFUND",
    "subject": "Delay in cancellation refund for PNR 1938472910",
    "description": "Cancelled ticket on 2026-10-05 but refund of Rs 555 is not yet credited to bank account.",
    "status": "RESOLVED",
    "response": "Refund processed to bank account.",
    "createdAt": "2026-10-06 15:45:00"
  }
}
```

#### 7.8.3 Activity Logs
- **Method / Endpoint**: `GET /api/admin/activity-logs`
- **Role**: `ADMIN`
- **Query Parameters**: `page` (default 1), `limit` (default 50), `userId` (optional), `action` (optional)
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "logId": "act_1001",
      "userId": 50001,
      "action": "USER_LOGIN",
      "tableName": null,
      "recordId": null,
      "oldValue": null,
      "newValue": null,
      "loggedAt": "2026-10-18 14:00:00"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 3,
    "totalPages": 1
  }
}
```

---

### 7.9 Admin Operations & Query Endpoints

#### 7.9.1 List Reservations
- **Method / Endpoint**: `GET /api/admin/bookings`
- **Role**: `ADMIN`
- **Query Parameters**:
  - `pnr` (optional, string)
  - `status` or `bookingStatus` (optional: `CONFIRMED`, `RAC`, `WAITING_LIST`, `CANCELLED`, `PAYMENT_PENDING`, `FAILED`)
  - `trainId` (optional, number)
  - `journeyDate` (optional, YYYY-MM-DD)
  - `from_date` (optional, YYYY-MM-DD)
  - `to_date` (optional, YYYY-MM-DD)
  - `limit` (optional, integer: default 50, maximum 200)
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "pnr": "2849102841",
      "userId": 50001,
      "userName": "Rahul Sharma",
      "trainId": 129,
      "trainNumber": "12951",
      "trainName": "Mumbai Tejas Rajdhani Express",
      "journeyDate": "2026-10-20",
      "boardingStationId": 21,
      "destinationStationId": 10,
      "boardingStationCode": "BCT",
      "destinationStationCode": "NDLS",
      "classType": "3A",
      "quota": "GENERAL",
      "bookingStatus": "CONFIRMED",
      "status": "CONFIRMED",
      "totalFare": 2039.80,
      "createdAt": "2026-10-18 16:05:22",
      "channel": "ONLINE",
      "passengerCount": 1
    }
  ]
}
```

#### 7.9.1a Change a User's Account Status
- **Method / Endpoint**: `PUT /api/admin/users/:id/status`
- **Role**: `ADMIN`
- **Request Body**: `{ "status": "SUSPENDED", "reason": "optional text" }` (`accountStatus` is accepted instead of `status`). Allowed: `ACTIVE`, `INACTIVE`, `SUSPENDED`, `PENDING`.
- **Response (200 OK)**: the updated user, same shape as one row of `GET /api/admin/users`.
- **Errors**: `400 BAD_REQUEST` (bad status), `403 FORBIDDEN` (own account, or an ADMIN account), `404 NOT_FOUND`. A suspended user cannot log in. Written to AUDIT_LOG (`UPDATE_USER_STATUS`).

#### 7.9.1d Refund rules and concession rules
- `GET/POST /api/admin/refund-rules`, `PUT/DELETE /api/admin/refund-rules/:id` and `GET/POST /api/admin/concession-rules`, `PUT/DELETE /api/admin/concession-rules/:id` (role `ADMIN`). Every change is audited by a database trigger.
- **Refund rule fields:** `classId` (new: a seat class id, or empty = general rule for all classes), `minHours` (whole number, 0 or more), `maxHours` (empty or above `minHours`), `deductionPct` (0 to 100), `flatMinCharge` (0 to 100000), `clerkage` (0 to 100000). The cancellation function reads these rows: the slab is the rule with the highest `minHours` the time has reached, a class rule beats a general rule of the same slab, and the charge is the larger of the percentage and the flat minimum (never more than the fare). Saving a second rule with the same `classId` and `minHours` returns `409 CONFLICT`.
- **Concession rule fields:** `trainGroup` must be `STANDARD` or `PREMIUM` (default `STANDARD`), `discountPct` 0 to 100. The fare function reads these rows (an inactive rule is ignored).
- Values outside these ranges return `400 VALIDATION_ERROR`; the database has CHECK constraints as a second line of defence (reported as `400 VALIDATION_ERROR` "The value is outside the allowed range.").

#### 7.9.1c Refund Transactions (refund money, not refund rules)
These routes list and retry `REFUND` rows. They are not the same as `/api/admin/refunds`, which is about refund RULES.
- `GET /api/admin/refund-transactions?status=&pnr=&limit=` (role `ADMIN`). `status` is `PENDING`, `PROCESSED` or `FAILED`; `limit` defaults to 200 (maximum 500). Newest first.
```json
{
  "success": true,
  "data": [
    {
      "refundId": 444, "pnr": "1033831532", "passengerNo": 1, "passengerName": "Nitesh Chawla",
      "amount": 2123.99, "reason": "CANCELLATION", "status": "PROCESSED", "attempts": 1,
      "failureReason": "SIMULATED_PAYMENT", "gatewayRefundId": null,
      "createdAt": "2026-11-19 19:39:40", "lastAttemptAt": "2026-11-19 19:39:40", "processedAt": "2026-11-19 19:39:40"
    }
  ]
}
```
- `POST /api/admin/refund-transactions/:refundId/retry` (role `ADMIN`). Only `PENDING` or `FAILED` rows. Returns `{ refundId, status, gatewayRefund, message, refund }`. Errors: `400 BAD_REQUEST` (row is `PROCESSED`, or bad id), `404 NOT_FOUND`. The amount and the payment come from the `REFUND` row.

#### 7.9.1b Platforms
- `POST /api/admin/platforms` body `{ "stationId", "platformNumber" }` → 201; `404` unknown station; `409` duplicate number at the station.
- `PUT /api/admin/platforms/:id` body `{ "platformNumber" }`.
- `DELETE /api/admin/platforms/:id` → `409 CONFLICT` if a maintenance task or a route stop still uses it.
- Only station and platform number are stored. `status` is always `ACTIVE` and `facilities` is always `[]`. All three write to AUDIT_LOG.

#### 7.9.2 Consolidated RANK Analytical Reports
- **Method / Endpoint**: `GET /api/admin/reports/rank`
- **Role**: `ADMIN`
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "busiestTrains": [
      {
        "rank_pos": 1,
        "dense_rank_pos": 1,
        "train_id": 129,
        "train_number": "12951",
        "train_name": "Mumbai Tejas Rajdhani Express",
        "train_type": "RAJDHANI",
        "total_runs_conducted": 14,
        "total_passengers_booked": 482,
        "total_revenue": 982140.00
      }
    ],
    "topRoutes": [
      {
        "revenue_rank": 1,
        "origin_code": "BCT",
        "origin_station": "MUMBAI CENTRAL",
        "destination_code": "NDLS",
        "destination_station": "NEW DELHI",
        "total_bookings_count": 210,
        "gross_route_revenue": 452100.00,
        "avg_fare_per_passenger": 2152.86
      }
    ],
    "stationRanking": [
      {
        "station_rank": 1,
        "station_id": 21,
        "station_code": "BCT",
        "station_name": "MUMBAI CENTRAL",
        "city": "Mumbai",
        "state": "Maharashtra",
        "total_boarding_passengers": 1240,
        "originating_revenue": 2154300.00
      }
    ],
    "classRevenue": [
      {
        "class_code": "3A",
        "class_name": "AC 3 Tier",
        "total_passengers": 1820,
        "class_revenue": 3712800.00,
        "running_cumulative_revenue": 3712800.00,
        "revenue_pct_share": 42.15
      }
    ],
    "quotaUtilization": [
      {
        "quota": "GENERAL",
        "total_bookings": 1420,
        "total_passengers": 2840,
        "total_fare_collected": 5892100.00,
        "avg_passenger_fare": 2074.68,
        "quota_popularity_rank": 1
      }
    ]
  }
}
```

#### 7.9.3 User Accounts List
- **Method / Endpoint**: `GET /api/admin/users`
- **Role**: `ADMIN`
- **Query Parameters**: `search` (optional), `status` (optional), `role` (optional)
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "userId": 50001,
      "name": "Rahul Sharma",
      "email": "rahul.sharma@example.com",
      "phone": "+91-9876543210",
      "role": "PASSENGER",
      "accountStatus": "ACTIVE",
      "createdAt": "2026-10-18 10:00:00"
    }
  ]
}
```

#### 7.9.4 Station Platforms List
- **Method / Endpoint**: `GET /api/admin/platforms`
- **Role**: `ADMIN`
- **Query Parameters**: `stationId` (optional)
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "platformId": 1,
      "stationId": 1,
      "platformNumber": 1,
      "status": "ACTIVE",
      "facilities": []
    }
  ]
}
```

#### 7.9.5 Recorded Fines List
- **Method / Endpoint**: `GET /api/admin/fines`
- **Role**: `ADMIN`
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "fineId": 1,
      "staffId": 1,
      "passengerName": "Ajay Kumar",
      "idProofReference": "VOTER-88491",
      "trainId": 129,
      "amount": 550.00,
      "reason": "TICKETLESS_TRAVEL",
      "paymentStatus": "PAID",
      "issuedAt": "2026-10-23 19:35:46"
    }
  ]
}
```

#### 7.9.6 Reported Incidents List
- **Method / Endpoint**: `GET /api/admin/incidents`
- **Role**: `ADMIN`
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "incidentId": 1,
      "reportedBy": 1,
      "type": "AC_FAILURE",
      "severity": "MEDIUM",
      "locationType": "TRAIN",
      "stationId": null,
      "trainId": 1001,
      "description": "AC_FAILURE",
      "status": "REPORTED",
      "createdAt": "2026-10-23 19:35:46"
    }
  ]
}
```

---

### 7.9 Contact Messages, Fare Calculator and Quotas (admin)

#### 7.9.1 Contact Us messages
- `GET /api/admin/contact-messages?status=NEW|DONE` returns `[{ "messageId", "name", "email", "message", "createdAt", "status", "handledAt", "handledBy" }]`, newest first (at most 200). `PATCH /api/admin/contact-messages/:id` with `{ "status": "DONE" }` (or `"NEW"` to open it again) marks it and records who handled it. Messages live in MongoDB: `503 SERVICE_UNAVAILABLE` when MongoDB is down; `404` for an unknown id; `400` for a bad status.

#### 7.9.2 Fare calculator
- `GET /api/admin/fares/calculate?classCode=3A&distanceKm=1384&trainType=RAJDHANI&quota=GENERAL&concession=NONE` returns the real fare of one passenger (insurance included) from `fn_calculate_fare`: `baseFare`, `concessionDiscount`, `reservationCharge`, `superfastCharge`, `tatkalCharge`, `dynamicSurcharge`, `gst`, `insurance`, `totalFare`. The function needs a train (superfast charge, premium concession group), so a real train of the chosen type is used. A fare in this system is a list of distance slabs (`FARE`: class, min km, max km, rate per km); the other parts are added by the database.

#### 7.9.3 Quotas
- `GET /api/admin/quotas` returns the five quotas (`quota`, `label`, `seatShare`, `rule`, `maxPassengers`, `concession`, `queue`) with real usage on the upcoming runs (`confirmedPassengers`, `racPassengers`, `waitingListPassengers`). Read only: the seat shares are built into `sp_create_booking` (BR-Q10).

## 8. Passenger & Public MongoDB APIs

### 8.0 Saved Passengers (MySQL `SAVED_PASSENGER`)
All routes need a logged-in `PASSENGER` token. Every row is checked against the token's user: another user's id returns `404 NOT_FOUND`, never the data. Concession is **not** stored on a saved passenger; it is chosen per booking. Save the id and send it as `savedPassengerId` on a passenger in `POST /api/bookings` (the booking API checks ownership and returns `403` for someone else's id). A passenger in a booking needs no ID proof fields: `idProofType`/`idProofReference` may be left out.

- `GET /api/saved-passengers`: list own saved passengers.
- `POST /api/saved-passengers`: add one. Response `201`.
- `PUT /api/saved-passengers/:id`: replace all fields of an own saved passenger.
- `DELETE /api/saved-passengers/:id`: delete an own saved passenger. Refused with `409 CONFLICT` if any booking still points to it.

Request body (POST and PUT):
```json
{
  "name": "Aadhya Deshpande",
  "age": 20,
  "gender": "FEMALE",
  "idProofType": "PAN",
  "idProofReference": "ABCDE1234F",
  "disabilityType": "NONE",
  "berthPreference": "LOWER"
}
```
- Rules: `name` 2 to 128 characters; `age` whole number 1 to 120; `gender` MALE, FEMALE or OTHER; `idProofType` one of SYNTHETIC_TEST_ID, AADHAAR, PAN, PASSPORT, VOTER_ID, DRIVING_LICENSE, GOVT_ID; `idProofReference` 1 to 64 characters; `disabilityType` (optional, default NONE) one of NONE, ORTHOPEDIC, VISUAL, HEARING, MENTAL; `berthPreference` (optional, default NO_BERTH) one of LOWER, MIDDLE, UPPER, SIDE_LOWER, SIDE_UPPER, WINDOW, AISLE, NO_BERTH.

Response item (same for list, add and edit):
```json
{
  "success": true,
  "data": {
    "passengerId": 75007,
    "name": "Aadhya Deshpande",
    "age": 20,
    "gender": "FEMALE",
    "idProofType": "PAN",
    "idProofReference": "ABCDE1234F",
    "disabilityType": "NONE",
    "berthPreference": "LOWER"
  }
}
```
`DELETE` returns `{ "success": true, "data": { "passengerId": 75007, "deleted": true } }`.
- **Errors**: `400 VALIDATION_ERROR` (bad field), `401`, `403 FORBIDDEN` (not a passenger token), `404 NOT_FOUND` (not found or not owned), `409 CONFLICT` (used in a booking).

### 8.1 Notifications

#### 8.1.1 Get Notifications
- **Method / Endpoint**: `GET /api/notifications`
- **Role**: Authenticated (own notifications only, newest first)
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "notificationId": "ntf_1001",
      "userId": 50001,
      "type": "BOOKING_CONFIRMATION",
      "title": "Booking Confirmation",
      "message": "Your booking for PNR 2849100000 is CONFIRMED.",
      "referenceId": "2849100000",
      "isRead": true,
      "createdAt": "2026-10-18 14:30:00"
    }
  ]
}
```

#### 8.1.2 Mark Notification as Read
- **Method / Endpoint**: `PUT /api/notifications/:id/read`
- **Role**: Authenticated (own notification only)
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "notificationId": "ntf_1002",
    "userId": 50001,
    "type": "STATUS_UPDATE",
    "title": "Booking Status Update",
    "message": "Chart preparation completed for your scheduled departure.",
    "referenceId": "2849100000",
    "isRead": true,
    "createdAt": "2026-10-18 15:30:00"
  }
}
```
- **Errors**: `403 Forbidden` (User does not own notification), `404 Not Found`.

### 8.2 Complaints

#### 8.2.1 File Passenger Complaint
- **Method / Endpoint**: `POST /api/complaints`
- **Role**: `PASSENGER` (own)
- **Request Body**:
```json
{
  "category": "TRAIN_CLEANLINESS",
  "subject": "Unhygienic coach washroom",
  "description": "Coach B2 washroom was not cleaned before departure."
}
```
- **Response (201 Created)**:
```json
{
  "success": true,
  "data": {
    "grievanceId": "cmp_1730000000_123",
    "userId": 50001,
    "category": "TRAIN_CLEANLINESS",
    "subject": "Unhygienic coach washroom",
    "description": "Coach B2 washroom was not cleaned before departure.",
    "status": "OPEN",
    "response": null,
    "createdAt": "2026-10-24 02:40:00"
  }
}
```

#### 8.2.2 List Own Complaints
- **Method / Endpoint**: `GET /api/complaints`
- **Role**: `PASSENGER` (own)
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "grievanceId": "cmp_901",
      "userId": 50001,
      "category": "TRAIN_CLEANLINESS",
      "subject": "Unhygienic washrooms in coach B1",
      "description": "Washrooms in coach B1 of train 12951 were not sanitized prior to departure from Mumbai Central.",
      "status": "RESOLVED",
      "response": "Housekeeping on board (OBHS) was dispatched and sanitization was completed at Surat station halt.",
      "createdAt": "2026-10-01 23:30:00"
    }
  ]
}
```

### 8.3 Live Train Status

#### 8.3.1 Schedule Live Status
- **Method / Endpoint**: `GET /api/schedules/:scheduleId/live-status`
- **Role**: Any authenticated user
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "scheduleId": 1001,
    "trainId": 129,
    "journeyDate": "2026-10-18",
    "status": "ON_TIME",
    "delayMinutes": 0,
    "platformNumber": 3
  }
}
```

#### 8.3.2 Train Live Status
- **Method / Endpoint**: `GET /api/trains/:trainId/live-status`
- **Role**: Any authenticated user
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "scheduleId": 1001,
    "trainId": 129,
    "journeyDate": "2026-10-18",
    "status": "ON_TIME",
    "delayMinutes": 0,
    "platformNumber": 3
  }
}
```

