# Railway Reservation & Management System

> **A Comprehensive Academic DBMS Project**  
> *A three-portal railway platform (passenger, staff, admin) backed by a relational MySQL database, stored procedures, triggers, MongoDB and Razorpay test payments.*

---

## 1. Project Objective

The **Railway Reservation & Management System** is a full-featured web-based platform catering to both passenger ticketing and operational railway administration. Built to demonstrate enterprise-grade Database Management System (DBMS) concepts, the project emphasizes Third Normal Form (3NF) relational design, segmented seat integrity, role-based workflows, and standardized REST API contracts.

---

## 2. Project Status

| Stage | Status | Description |
| :--- | :--- | :--- |
| Phase 1 & 2: Foundation and Frontend | **DONE** | Common data schema, REST API contract, relational model, mock dataset, three frontends |
| Phase 3: Backend and Database | **DONE** | Express backend, MySQL 8.0 (38 tables, 6 views, 9 functions, 15 stored procedures, 9 triggers, 5 RANK reports), MongoDB, Razorpay test-mode payments, daily operations simulator |

**Data used by the live system:** 158 stations, 60 trains, 536 route stops, 50,008 users, 75,000 passengers, and 350 train runs per 7-day window. Screens now read from the backend and database. Pages with no backend table (Quotas, Notifications, Reports in the admin portal) are marked **Demo data**. The list of known gaps and limits is in [docs/KNOWN_GAPS_AND_DECISIONS.md](docs/KNOWN_GAPS_AND_DECISIONS.md).

---

## 3. The Three User Roles & Dashboards

The application is architected around three role-based portals with distinct entry points:

### 3.1 Passenger area
- **Public Entry & Lookups** (no login for the first two): the landing page (train search, service alerts, sign-in), the **Train Info** page (schedule, track your train, PNR enquiry; the PNR needs a sign-in), the **Live Trains** page (every run of a day with live seats, RAC and waiting-list counts, per class and quota; public and read only; refreshes every 15 seconds; "Book this train" opens the booking flow with the train, date and class chosen), and the floating **Contact Us** button on every page (its helpline, e-mail and address are read from Settings).
- **Self-Registration & Login**: the sign-in card on the landing page has a "New passenger? Create an account" form. The same card signs in all three roles.
- **6-Step Ticket Booking Flow**:
  1. Train Search (From, To, Date, Class, Quota, Inclusivity)
  2. Search Results (Train listing, fares, availability filters)
  3. **Who is travelling?** Saved passengers (full name, age, gender, berth preference, concession label) or an "Add new passenger" form (concession category with a one-line explanation of each from `CONCESSION_RULE`, proof type and number when a concession needs it, "Save for next time"). The rules are shown in plain words from the database (at most 6 passengers, 4 for Tatkal; one adult needed; senior ages; Tatkal and quota rules; there is no child fare), problems are listed before you continue, and a per-passenger fare line (base, concession, reservation/superfast, GST, insurance) comes from the server's fare preview. Once seats are on hold the passenger list is read-only; use "Start over" to change it.
  4. Booking Summary (every traveller by name with their own fare line and the status they got, plus the itemized fare breakdown)
  5. Payment (Razorpay test mode: use Netbanking or UPI, international cards are not accepted). The hold countdown, **Pay now** and **Cancel unpaid booking** are also on every unpaid booking in My Bookings; paying again reuses the open Razorpay order.
  6. Booking Confirmation & Printable E-Ticket
- **Passenger Account Management**: Profile (view only), Saved Passengers (add, edit, delete), Booking History, Ticket Cancellation (with refund estimation), TDR (Ticket Deposit Receipt) filing, real Notifications, and Grievance tracking. In the passenger portal the public "Connecting train search" and "Travel alerts" still use sample data and carry a **Demo data** badge.

### 3.2 Staff / Ticket Collector (TC) Portal
- **Duty Dashboard**: Live duty assignment (assigned train/date/coach or station/platform).
- **Chart & Verification**: Passenger chart inspection, PNR enquiry, ID proof verification (`VALID`, `INVALID`, `MISMATCH`).
- **Boarding Tracking**: The scanner lists every passenger of a PNR, each with their own verify / board / no-show buttons. Boarding and verification are saved in the database and read back, so they are still there after a page reload. A no-show promotes the next RAC passenger automatically in the database. The portal fits a phone (390 px wide).
- **Vacancy View**: Vacant berth tracking. Promotion is done by the database only, so the Promote button is disabled.
- **Counter Booking and Fines**: Counter tickets and on-spot penalty receipts.
- **Operations & Ground Reporting**: Train delay logging (the server sets ON_TIME or DELAYED), crowd and cleanliness reports, incident escalation.
- **Data source**: The staff portal shows only what the server returns (your duty, route, live status and the frozen chart). Nothing is kept in the browser. Fines, crowd, cleanliness, incident and maintenance records are saved on the server, but there is no list route for staff, so the pages show a success message (and the last item you created) instead of a history. Boarding results are kept in memory for the session because the chart is a frozen snapshot.

### 3.3 Administrator Portal
- **Refund Transactions**: List of every refund with status chips (PENDING, PROCESSED, FAILED), failure reasons and a Retry button.
- **Master Data Management**: Stations, Platforms (add, rename, delete; only station and number are stored), Trains, Routes, Schedules, Coaches, Seats, Fares.
- **Settings**: Change settings (the database refuses values that would break the money maths, and every change is audited) and change your own password (`POST /api/auth/change-password`). Three keys are reference only (see section 7.1).
- **Contact Messages**: the messages sent from the Contact Us button (list, mark done, open again). **Fares**: distance slabs per class (edit min km, max km and rate per km) and a calculator that asks the database for the real fare. **Quotas**: the five quotas with their real rules and usage (read only).
- **Not available yet in the admin UI**: schedule delay edit, schedule delete, "Schedule Run", and booking override are disabled with a reason. The Notifications page and all tabs of the Reports page still show demo data (Quotas is now real) and are marked as such. The Dashboard shows real counts and the five RANK reports.
- **User & Staff Management**: Passenger account inspection, staff and duty scheduling. Suspend or reactivate non-admin accounts (`PUT /api/admin/users/:id/status`); a suspended user cannot log in.
- **Reservation Oversight**: Global PNR search and administrative cancellations.
- **TDR Adjudication**: Approve or reject refund claims. Approval runs the same seat-promotion chain as a cancellation.
- **Schedules & Chart Preparation**: Chart preparation removes remaining waiting-list passengers and refunds them fully.
- **Analytics & Reports**: Five RANK reports from `06_reports.sql`.
- **Forensic Audit Logs**: Timestamped audit trail of administrative changes.

> **Scope Note**:  
> Food Ordering / Pantry Management is strictly **OUT OF SCOPE** and omitted across all data models and UI flows.

---

## 4. Repository Structure

```
/
├── README.md                    # This guide
├── docs/                        # Specifications and guides (see section 9)
├── datasets/                    # Source data: stations, trains, routes, users, passengers
├── database/                    # MySQL scripts (01_schema ... 07_tests, optional 08_pdf_aliases),
│                                #   seed loaders (load/), seed generator (seed/), seed CSVs (seed-data/),
│                                #   MongoDB loader, Workbench query files (workbench/)
├── backend/                     # Express API (port 5000); scripts: demo:refresh, demo:chain, test:all, test:smoke
├── frontend/                    # React + Vite (port 5173): landing, Train Info, staff and admin portals;
│                                #   the signed-in passenger area is public/user/ (same site, same login and theme)
└── mock-data/                   # Original mock JSON from Phase 1 and 2 (leftover, not used by the live system)
```

---

## 5. How the System Works (short version)

- **Booking:** the passenger searches a train. The backend asks MySQL. The stored procedure `sp_create_booking` checks quota and rules and holds seats for 10 minutes.
- **Payment (Razorpay, test mode):** the backend reads the fare from the database, never from the browser, and creates a Razorpay order for exactly that amount. After payment, the backend verifies Razorpay's signature. Only then does the database confirm the ticket (`sp_confirm_payment` rejects zero, negative and wrong amounts).
- **Cancellation:** works for CONFIRMED, RAC and waiting-list bookings. A procedure frees the seat and works out the refund. A trigger then runs `sp_promote_passenger`: first RAC becomes CONFIRMED, first waiting-list passenger becomes RAC.
- **TDR:** the passenger files it, the admin reviews it, and approval refunds and promotes through the same chain.
- **Staff:** a no-show is marked in the database and promotes the next RAC passenger. Chart preparation removes remaining waiting-list passengers and refunds them.
- **Where the rules live:** quota, promotion and refund logic are in SQL (procedures and triggers), not in Node or React.
- **Mock data replaced:** screens used to show made-up data from `mock-data/`. They now call the backend, so they show what is stored in the database. The few pages still marked **Demo data** are listed in [docs/KNOWN_GAPS_AND_DECISIONS.md](docs/KNOWN_GAPS_AND_DECISIONS.md).
- **Diagrams:** the system, booking and payment, cancellation and promotion, refund life, TDR and hold flows are drawn in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Rules used everywhere: all date-times are India time strings (`YYYY-MM-DD HH:MM:SS`, never a `Z`), and the API follows `docs/API_CONTRACT.md` exactly.

---

## 6. Development Rules

1. **Never rename fields.** Use the property names in [docs/DATA_SCHEMA.md](docs/DATA_SCHEMA.md) and [docs/API_CONTRACT.md](docs/API_CONTRACT.md).
2. **Never change enums.** Use exact uppercase values (`CONFIRMED`, `WAITING_LIST`, `ACTIVE`, `GENERAL`, etc.).
3. **Keep API calls in service files** so screens never talk to the network directly.
4. **Seat integrity:** a seat can be booked twice on the same date only if the travel segments do not overlap: max(StartA, StartB) < min(EndA, EndB).
5. **Fare formula (per passenger):**
   - Base Fare = Segment Distance (min 100 km) x Class Slab Rate
   - Taxable Amount = (Base Fare - Concession) + Reservation + Superfast + Tatkal + Dynamic Surcharge
   - Total Fare = Taxable Amount + GST + Insurance
   - GST: 5% for AC classes, 0% for non-AC. Insurance: flat 0.45 per passenger, always added (the passenger cannot opt out). Insurance is never refunded on a normal cancellation. Rounded to 2 decimals, half-up.

---

## 7. Running the Project (Local Setup)

**Requirements:** Windows, Node v24, MySQL 8.0 (service `MySQL80`, port 3306), MongoDB (port 27017), and `.env` files in `backend/` and `database/` (never commit them).

**Environment variables** (names only; put the values in `backend/.env` and `database/.env`, never commit them):

| Name | Used by | Note |
| :--- | :--- | :--- |
| `DB_HOST`, `DB_PORT`, `DB_USER` (or `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`) | backend and database scripts | The backend uses the first one that is set. Defaults: localhost, 3306, root |
| `MYSQL_PASSWORD` | backend and database scripts | MySQL password |
| `MYSQL_DATABASE` | backend | Default `railway_db` |
| `MONGODB_URI`, `MONGODB_DB_NAME` | backend and loader | MongoDB is optional at run time |
| `JWT_SECRET` | backend | Required: the server refuses to start without a real secret |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | backend | Razorpay test keys; without them order creation answers 503 |
| `RAZORPAY_WEBHOOK_SECRET` | backend | Optional; without it the webhook answers 503 |
| `PORT` | backend | Default 5000 |
| `NODE_ENV` | backend | `development` shows raw error text; leave empty otherwise |
| `VITE_API_BASE_URL` | frontend | Default `http://localhost:5000` |

### 7.1 Start order (every time)

1. **Check the databases are running** (PowerShell):
   ```
   Get-Service MySQL80
   Get-Service *mongo*
   ```
   Both must say `Running`. If not: `Start-Service <name>` (as administrator).
2. **Stop old servers:**
   ```
   Get-Process node | Stop-Process -Force
   ```
3. **Refresh the demo data** (full reset, then the simulator creates runs for today to today + 6 days):
   ```
   cd backend
   npm run demo:refresh
   npm run demo:chain
   ```
   `demo:chain` builds one train run (from tomorrow onward) with a full RAC and waiting-list chain for the cancellation demo. It **prints the real values**: train number, schedule id, travel date, class, the PNRs and the passenger login email. **Write them down.** It also puts staff `EMP-TC-101` on duty for that run, so ticket verification, boarding and no-show work in the staff portal (safe to run twice).
4. **Start the backend** (leave the window open; it should say "Server started on port 5000"). It will refuse to start if `JWT_SECRET` is missing in `backend/.env`:
   ```
   cd backend
   npm start
   ```
5. **Start the frontend** (second window). The port is fixed to 5173 in `vite.config.ts`:
   ```
   cd frontend
   npm run dev
   ```
6. Open **http://localhost:5173**.

> Do **not** run `npm run test:all` or `node database/load/run-all.js` after step 3. Both reset the data to the plain seed. If you do, repeat steps 1 to 3.

**Changing only the database code (functions, procedures, triggers, tests) without resetting data:**
```
node database/load/apply-sql.js 02_functions 03_procedures 04_triggers
node database/load/apply-sql.js 02_functions 03_procedures 04_triggers 07_tests --run-tests
```
`apply-sql.js` only replaces functions, procedures, triggers, views and test objects. It never drops tables or reloads data. With `--run-tests` it runs all automated tests (they roll back their own changes), prints the result and removes the test objects again. The tests expect the plain seed (fixed PNRs and run ids), so run them on a freshly loaded database, not after other scripts changed those runs.

**Tests.**

| Command | What it checks | Result today | Notes |
| :--- | :--- | :--- | :--- |
| `npm run test:all` (in `backend`) | 11 API suites against the database, with a mock Razorpay | 11 suites, 1057 assertions, all pass | About 5 minutes. It reloads the seed before every suite and at the end, so afterwards repeat `demo:refresh` and `demo:chain`. It pins the database clock to the seed clock (2026-10-17 19:15) |
| `node database/load/apply-sql.js 07_tests --run-tests` | 67 SQL tests (rolled back) | 67 passed | Needs the plain seed |
| `npm run test:smoke` (in `backend`) | 28 checks over the live API with a PASS / FAIL table | 28 passed | Backend must be running; run it after `demo:refresh` and `demo:chain`. It may create test data (a throwaway passenger, a held booking, a counter booking; it cancels one RAC booking and boards one passenger on the chain run), so run `demo:refresh` and `demo:chain` again before presenting. Other address: `npm run test:smoke -- http://host:5000` |

**Refund life.** SQL writes every refund as `PENDING`. The backend then calls Razorpay for each refund row and records the result through `sp_set_refund_result`: `PROCESSED` (gateway done) or `FAILED` (retried every minute when older than 5 minutes, at most 3 attempts; an admin can also retry). Seeded, simulated and cash payments never move real money: their refunds go to `PROCESSED` with a note (`SIMULATED_PAYMENT` or `CASH_PAYMENT_NO_GATEWAY`). The admin portal has a **Refund Transactions** page (menu: Operations) to see every refund and retry `PENDING` or `FAILED` ones. Money counts as paid out only when `PROCESSED`. After pulling this change on an existing database run `database/mysql/migrations/02_refund_status_columns.sql`, then `node database/load/apply-sql.js 02_functions 03_procedures 04_triggers 05_views` (or reload with `demo:refresh`).

**Payments never get lost.** The Razorpay order is saved in MySQL (`PAYMENT_ORDER`), and MongoDB is optional: with Mongo stopped, booking, payment, cancel and refunds still work (the server starts anyway, retries Mongo every 30 seconds, and `/api/health` shows MongoDB DOWN; notifications, complaints and the activity log list answer 503 "MongoDB unavailable"). If the browser closes after paying, the money is still matched: a background job (every 60 seconds), the **Check payment status** button in My Bookings, and the Razorpay webhook all ask Razorpay and finish the order (ticket inside the hold, automatic refund after it). To use the webhook add `RAZORPAY_WEBHOOK_SECRET=<the secret you set in the Razorpay dashboard>` to `backend/.env` yourself and point the dashboard webhook at `https://<your public address>/api/payments/razorpay/webhook` (events: payment.captured, order.paid, refund.processed, refund.failed). Without the secret the webhook answers 503 and everything else works. After pulling this change on an existing database run `database/mysql/migrations/03_payment_order.sql`, then `node database/load/apply-sql.js 02_functions 03_procedures 04_triggers 05_views` (or reload with `demo:refresh`).

**Payment details (Prompt 13).** `PAYMENT.method` stores what the customer really used, read from Razorpay (`UPI`, `NET_BANKING`, `CREDIT_CARD`, `DEBIT_CARD`, otherwise `UNKNOWN`). Pressing Pay twice reuses the open order of the booking (no second order). When a hold ends, or the passenger presses **Cancel unpaid booking** (`POST /api/bookings/:pnr/cancel-unpaid`), the booking's unpaid orders are checked at Razorpay and closed as `EXPIRED`; because a payment window can still be open, an `EXPIRED` order is checked for 24 hours and a late payment is refunded automatically. After pulling this change on an existing database run `database/mysql/migrations/07_live_trains_payment_contact.sql`, then `node database/load/apply-sql.js 02_functions 03_procedures 04_triggers 05_views`.

**TDR rules in plain words.** `GET /api/tdr/eligibility/:pnr` tells the TDR form, per passenger, which of the six reasons can be used right now and why not (for example "The train is not delayed. At least 3 hours (180 minutes) of delay are needed."). "Train delayed over 3 hours" needs a CONFIRMED or RAC passenger, a delay of 180 minutes or more and a train that has not left; the four journey reasons need a train that HAS left and an evidence reference. The delay of a run is set by on-duty staff (`POST /api/staff/delays`, staff portal "Delays & Platform").

**Ids and the rule tables.** Booking, payment, refund, cancellation, verification and chart ids are made by the database (`AUTO_INCREMENT`), so many bookings at the same time no longer fail with `TRANSACTION_FAILED`, and only one hold-release run works at a time. The admin-editable rule tables now drive the money maths: `FARE`, `CONCESSION_RULE`, `REFUND_RULE` (one row per class and slab) and the settings GST_RATE_AC, INSURANCE_PREMIUM_PER_PASSENGER, CLERKAGE_PER_PASSENGER, MIN_CHARGEABLE_DISTANCE_KM, DYNAMIC_FARE_ENABLED, CONCESSION_SENIOR_ENABLED and BOOKING_WINDOW_DAYS. To try it: Admin portal, Settings, change GST_RATE_AC (for example 0.05 to 0.12); the next fare in the passenger portal uses it. Values that would break the maths (GST above 1, a negative percent, text) are refused. Still built into the functions: reservation and superfast charge per class, the Tatkal percent, and the three settings marked "Reference only" (MAX_PASSENGERS_PER_PNR, MAX_PASSENGERS_PER_PNR_TATKAL, CHART_HOURS_BEFORE_ORIGIN_DEPARTURE). For an existing database run `database/mysql/migrations/04`, `05` and `06` in order, then `node database/load/apply-sql.js 02_functions 03_procedures 04_triggers 05_views`.

**Booking and refund rules enforced in MySQL** (the backend only passes the error code on): a train that has already left (`JOURNEY_PAST`), a date beyond the booking window (`OUTSIDE_BOOKING_WINDOW`), stops that do not belong to the train (`INVALID_STOPS`), a cancelled run (`TRAIN_NOT_RUNNING`), quota and concession checks (`QUOTA_NOT_ELIGIBLE`, `CONCESSION_PROOF_REQUIRED`), and a refund cap (`REFUND_EXCEEDS_PAYMENT`: never refund more than was paid; a seat with a TDR refund cannot also be cancelled normally). A passenger with an open or refunded TDR cannot file another one; after a rejection they may file again.

### 7.2 Troubleshooting

| Problem | Fix |
| :--- | :--- |
| "Cannot reach the server" / "Failed to fetch" | Backend not running, or frontend not on port 5173. Redo steps 2, 4, 5. |
| `EADDRINUSE port 5000` | `Get-Process node \| Stop-Process -Force`, then start the backend again. |
| "No trains found" | Use a date from today to +6 days. Try BCT to NDLS or HWH to NDLS. |
| Page looks old after a code change | Hard refresh: Ctrl+Shift+R. |
| Booking or cancellation says `CHART_PREPARED` | That run departs within 8 hours. Choose a train 2 or more days ahead. |

### 7.3 Demo Logins

| Portal | Login | Password |
| :--- | :--- | :--- |
| Passenger (general) | `rahul.sharma@example.com` | `Password123!` |
| Passenger for the cancellation demo | the "Owner Login Email" printed by `demo:chain` (different every time) | `Password123!` |
| Staff / TC | `EMP-TC-101` | `StaffPassword123!` |
| Admin | `admin@railways.gov.in` | `AdminPassword123!` |

All seeded passengers share the password `Password123!`. These are demo accounts for a school project; change them before any real use. The login boxes may be prefilled.

There is ONE login: the sign-in card on the landing page (`http://localhost:5173`). Pick the **Passenger / Staff / Admin** tab, or press **Use demo account** under the form. Switching role: **Sign Out** (you return to the landing page), then sign in with another tab. Opening a portal address while signed out also returns to the landing page.

---

## 8. Live Demo Walkthrough (about 8 to 10 minutes)

**Say first:** *"All three portals use one backend and one MySQL database. The rules (quota, promotion, refund) live in stored procedures and triggers, not in the website code."*

### Step 1: Passenger books a ticket (2 min)
1. Sign in as the passenger. Click **Book Tickets**.
2. Search **BCT to NDLS**, a date 2 or more days ahead, then pick a train and class.
3. Add a passenger, **Reserve & Hold Seats (10 min)**, then **Pay now** (Razorpay test mode, no real money).
4. Say: *"The backend reads the fare from the database, creates the Razorpay order for exactly that amount, verifies the signature, and only then the database confirms the ticket."*
5. Click **My Bookings** and show the new PNR as CONFIRMED.

### Step 2: Cancellation with RAC and waiting-list chain (2 min)

Prepared by `npm run demo:chain`. The train, schedule id, travel date, class and PNRs are **different each time**, so use the values printed by the script (the "DEMO PROMOTION CHAIN SUMMARY"). The chosen class is full: every seat confirmed, RAC full, waiting list with at least 3 passengers.

| What | PNR | Before | After cancelling the CONFIRMED PNR |
| :--- | :--- | :--- | :--- |
| Passenger to cancel (owner = "Owner Login Email" in the printout) | "Confirmed PNR" in the printout | CONFIRMED | CANCELLED, refund calculated |
| First RAC passenger | "First RAC PNR" in the printout | RAC/1 | CONFIRMED |
| First waiting-list passenger | "First WL PNR" in the printout | WL/1 | RAC |

1. Sign in as the "Owner Login Email" from the printout. **My Bookings**, open the Confirmed PNR, **Cancel Ticket**, **Confirm Cancellation**. Show the refund estimate. The Confirmed PNR from the printout must appear in My Bookings for that e-mail; if it does not, run `demo:chain` again.
2. Say: *"A stored procedure frees the seat and calculates the refund. A trigger then calls `sp_promote_passenger`: the first RAC passenger becomes CONFIRMED and the first waiting-list passenger becomes RAC. The website only displays the result."*
3. Open **PNR Enquiry** and enter the First RAC PNR, then the First WL PNR from the printout. Show the new statuses (CONFIRMED and RAC). (A passenger can only look up their own PNR; sign in as staff or admin to look up another user's PNR.)
4. In Workbench, run the inventory check to show 0 mismatches after the promotion.

**Live Trains (30 seconds, before or after Step 2).** Open **Live Trains** in the header (no login needed), set the date printed by `demo:chain`, search the train number, click the train: the class of the chain shows the confirmed passengers, `RAC 10/10` and `WL 24/24`, and after the cancellation of Step 2 the numbers change by themselves within 15 seconds (or press Refresh).

### Step 3: TDR (1 min)
1. As staff `EMP-TC-101` (**Delays & Platform**) log a delay of 200 minutes on the chain run (the delay is set by on-duty staff; the admin portal has no delay button). Passenger (owner of a CONFIRMED PNR of the chain): **TDR / Refunds**, **+ File TDR**, type the PNR, **Check this PNR**. The form shows the train's delay, the passengers by name and which reasons can be used (without the delay "Train delayed over 3 hours" is greyed out with the reason). Tick the passenger, choose **Train delayed over 3 hours**, **File TDR**.
2. Admin: **Operations, TDR Adjudication**, Approve. Say: *"Approval releases the seat and runs the same promotion chain."* **My TDRs / Refunds** then shows the status, the refund amount and the refund status. Reset the delay to 0 afterwards.

### Step 4: Staff portal (2 min)
1. Sign in as staff (`EMP-TC-101`). **Overview**, **Go On Duty**. Staff duty on the chain run is created by `demo:chain`; without it the verify, board and no-show actions return `NOT_ON_DUTY`.
2. **Passenger Manifest**: show **Board Passenger** and **Mark No-Show**. Say: *"A no-show is marked in the database and the next RAC passenger is promoted automatically."*
3. **Ticket Scanner**, **Counter Booking**, **Fines & Penalties**: one line each.
4. **Vacancies & RAC**: the Promote button is disabled on purpose, because only the database promotes passengers.

### Step 5: Admin portal (2 min)
1. **Dashboard**: the 5 RANK reports (from `06_reports.sql`).
2. **Operations, Reservations & PNR**: search a PNR.
3. **Trains & Routes, Schedules**: find the schedule id printed by `demo:chain` and click **Prepare Chart**. Say: *"Chart preparation removes the remaining waiting-list passengers and refunds them fully."* Show the purged count and refund total. Do this **after** Step 2, because it ends the chain.
4. Pages marked **Demo data** (admin Quotas, Notifications, Grievances and the Reports tabs) have no backend table. Say so honestly if asked. The passenger area's own Alerts page and the landing page alerts strip are real (`GET /api/notifications`, `GET /api/alerts`).

### Stories to show in MySQL Workbench (clean seed)
**Run the Workbench stories on a freshly loaded seed (`node database/load/run-all.js`); the website stories need `demo:refresh` + `demo:chain` instead.** The query files are in `database/workbench/` and are explained in [database/workbench/README.md](database/workbench/README.md).
The website cannot set the test clock (`@as_of_time`), so show these in Workbench:
- **Cancellation chain** (`G5-3`), **approved TDR chain** (`G5-4`), **no-show on boarding** (`G6-3`), **ladies quota full with GENERAL fallback** (`G4-4`, train 146, schedule 1254) and **chart preparation with the waiting-list purge** (`Story_D_Chart_Preparation_Workbench.sql`).
- If a Workbench query fails after `demo:refresh`, run `node database/load/run-all.js`, rerun the query, then run `demo:refresh` and `demo:chain` again and use the new PNRs printed in Step 2.

### Demo day checklist
- [ ] **The day before:** run `npm run demo:refresh` and `npm run demo:chain` (in `backend`). The chain run is for tomorrow and cancellation closes 8 hours before departure, so a chain made earlier than the day before may already be closed on the day. If the demo is in the morning, run both again that morning, and write down the PNRs and the passenger e-mail the script prints.
- [ ] MySQL80 and MongoDB services running (`Get-Service MySQL80`, `Get-Service *mongo*`)
- [ ] `backend/.env` has `JWT_SECRET`; backend says "Server started on port 5000"
- [ ] Frontend open on `localhost:5173`; passenger (chain owner), staff (`EMP-TC-101`) and admin logins tested
- [ ] `npm run test:smoke` in `backend` shows 28 passed (run it once, then run `demo:refresh` and `demo:chain` again, because the smoke test cancels one RAC booking and boards one passenger on the chain run)
- [ ] **Do not run `npm run test:all` or `node database/load/run-all.js` after that.** Both reset the data to the plain seed
- [ ] The Confirmed PNR from the printout is visible in My Bookings for the Owner Login Email
- [ ] The chain schedule (id from the printout) shows RAC full and WL 3 or more in the admin Schedules page
- [ ] Workbench open with `USE railway_db;` run (the Workbench stories need a clean seed, so do them in a separate session before the website demo)
- [ ] Screenshots ready as a backup if the live demo fails (list: [docs/PBL_SCREENSHOT_CHECKLIST.md](docs/PBL_SCREENSHOT_CHECKLIST.md))

---

## 9. Documents

| Document | What it is for |
| :--- | :--- |
| [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md) | Project scope and goals |
| [docs/BUSINESS_RULES.md](docs/BUSINESS_RULES.md) | The business rules (BR-...) |
| [docs/SYSTEM_FLOW.md](docs/SYSTEM_FLOW.md) | User flows per portal |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Mermaid diagrams: system, booking and payment, cancellation and promotion, refund life, TDR, hold |
| [docs/API_CONTRACT.md](docs/API_CONTRACT.md) | Every route (section 1.0 is the full index), request and response fields, error codes |
| [docs/CONTRACT_CHANGES_FOR_ROHAN.md](docs/CONTRACT_CHANGES_FOR_ROHAN.md) | What changed in the API and what the frontend must do |
| [docs/DATA_SCHEMA.md](docs/DATA_SCHEMA.md) | Tables, columns, views, functions, procedures, triggers |
| [docs/DATA_RELATIONSHIPS.md](docs/DATA_RELATIONSHIPS.md) | Keys and relationships |
| [docs/DEVELOPMENT_RULES.md](docs/DEVELOPMENT_RULES.md) | Rules for the team |
| [docs/SIMULATOR.md](docs/SIMULATOR.md) | The daily operations simulator |
| [docs/KNOWN_GAPS_AND_DECISIONS.md](docs/KNOWN_GAPS_AND_DECISIONS.md) | What is not done, what was decided differently, hard-coded rules, TDR conditions |
| [docs/PBL_NAME_MAPPING.md](docs/PBL_NAME_MAPPING.md) | The 12 PBL PDF names and the real objects, plus a slide text |
| [docs/PBL_SCREENSHOT_CHECKLIST.md](docs/PBL_SCREENSHOT_CHECKLIST.md) | Numbered list of screenshots to take |
| [frontend/README.md](frontend/README.md) | The one-site frontend: routes, the one login and session, theme tokens, Contact Us, Train Info, Live Trains |
| [docs/CHANGE_REPORT_12.md](docs/CHANGE_REPORT_12.md) | Frontend unification report with contrast numbers before and after |
| [docs/screenshots/frontend-check/](docs/screenshots/frontend-check/) | Screenshots of every page of the three portals, plus phone width and before pictures |
| [database/mysql/README.md](database/mysql/README.md) | SQL files, load and test commands, migrations |
| [database/workbench/README.md](database/workbench/README.md) | The Workbench query files and the five stories |
| [database/seed-data/README.md](database/seed-data/README.md) | The seed files and their row counts |

---

## 10. Known Limits

Short version (the full list with places in the code is [docs/KNOWN_GAPS_AND_DECISIONS.md](docs/KNOWN_GAPS_AND_DECISIONS.md)):
- Tatkal does not check for an Aadhaar-verified account, and the passenger screen allows 4 Tatkal passengers while the API allows 6.
- The booking options `autoUpgrade`, `bookOnlyIfConfirmed` and `travelInsurance` are ignored; insurance is always added.
- Table `SEAT_HOLD` exists but nothing uses it; the hold is the `PAYMENT_PENDING` booking.
- Some admin and passenger pages show demo data (marked), and `mock-data/` is a leftover folder.
- The seed is frozen at 2026-10-17; website demos use `demo:refresh` and `demo:chain`, and `npm run test:all` resets the data.
