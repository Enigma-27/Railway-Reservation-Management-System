# Change report 13: Live Trains, who is travelling, TDR, payments, leftovers

Date: 2026-11-20. Branch: `final-few-changes`. Nothing was committed or pushed, no branch was created or switched. No `.env` file, key or password hash was opened or printed.

## 1. Live Trains

**Nav item** "Live Trains" next to Home and Train Info (route `/live-trains`, public, same page for passenger, staff, admin and signed-out visitors).

**Endpoints** (documented in `docs/API_CONTRACT.md` 3.7):
- `GET /api/live-trains?date=&from=&to=&type=&class=&status=&q=&page=&pageSize=` : one SQL query per page (the class inventory of every run comes in the same query as a JSON list, no query per train).
- `GET /api/live-trains/:scheduleId[?from=&to=]` : one run in detail.

**Filters:** date (default today by the test clock `COALESCE(@as_of_time, NOW())`), from station, to station (both must be stops of the train, `from` before `to`), train type, class, running status (not started / running / delayed / completed, plus cancelled), search by number or name. The delay is `TRAIN_SCHEDULE.delay_minutes`, the same source as the Alerts strip (a test checks both give the same number).

**List row:** train number and name, route and times, run status badge, delay minutes, and one chip per class with free seats and, when people are queued, `RAC x/y` and `WL x/y`. Staff and admin also see "Chart prepared / not prepared" and "% full".

**Detail panel:** per class: total seats, available, confirmed (booked), RAC count and capacity, waiting-list count and capacity, current fare, a plain status (AVAILABLE / RAC / WL / NOT AVAILABLE) and an occupancy bar. "Show quotas" opens the five quota rows (General, Tatkal, Ladies, Senior citizen, Divyaang) with seats, booked, available, RAC, WL, fare and status. **"Book this train"** opens the booking flow with train, date and class chosen (a signed-out visitor is asked to sign in as Passenger first and the choice is kept).

**Auto refresh:** every 15 seconds (list and open panel), "Last updated" time, manual Refresh button.

**How I checked the numbers against the database**
- Automated (`test-d5`): for a run, every class of the list is compared with `SCHEDULE_CLASS_INVENTORY` (total, available, booked = total - available, RAC, WL): all equal. Filters, paging, bad date and bad status are tested too.
- Live, on the demo chain run (train 12221, 21 Nov 2026, class 2A): the API answered total 96, available 26, confirmed 70, RAC 10/10, WL 24/24; the database inventory row says 96 / 26 / rac_count 10 / wl_count 24 and `RESERVATION` grouped by status gives CONFIRMED 70, RAC 10, WAITING_LIST 24. Same numbers.
- One thing to know (it is how the existing quota system works, not new): `SCHEDULE_CLASS_INVENTORY` has no quota column. On the chain run 26 seats are free but belong to other quotas, so a General passenger would get RAC or waiting list. The list shows `26 AVL · RAC 10/10 · WL 24/24` and the quota table shows General as full. The quota rows are worked out in the API from the reservations with the same seat-share rules as `sp_create_booking` (documented).

Browser checks (Playwright, Chromium): list and detail at 1366 and 390 px wide, axe contrast 0 violations, no sideways scroll, "Book this train" lands in the booking results with the card and class selected.

## 2. Booking step: who is travelling

**What changed** (`frontend/public/user/passenger-step.js` new, `index.html`, `app.js`, `styles.css`): heading "Who is travelling?" and "You are booking as <account name>. Add one row per traveller." Saved passengers show full name, age, gender, berth preference and a concession label; tick to add. A visible "Add new passenger" form: name, age, gender, berth preference, concession category (the real list from `CONCESSION_RULE` through the new `GET /api/booking-rules`, each with a one-line plain explanation), ID proof type and number when a concession needs it, and "Save for next time" (asks for a general ID when the concession proof cannot be saved). Each traveller on the booking has their own concession and proof fields.

**Rules shown in plain words (all read from the database):** at most 6 passengers per PNR (4 for Tatkal), one adult needed, senior ages (women 45+, men 60+, from `SETTING`; the senior concession is currently switched off and the screen says so), Tatkal rules, Ladies and Divyaang quota rules. Problems are listed live with the same checks the API makes, "Proceed" stays disabled until they are fixed, and when the API still refuses, its error code is shown in plain words.

**Children under 5:** the prompt describes a rule "no seat, not counted". **The project has no such rule**: `docs/BUSINESS_RULES.md` says children are booked as normal passengers at full fare, and the procedure counts every passenger. I did not invent the rule. The screen says so (from `GET /api/booking-rules`).

**Passenger-limit mismatch, result:** it was real. The screen allowed 4 only for Tatkal while the API (and the procedure) accepted 6 for every quota; `MAX_PASSENGERS_PER_PNR_TATKAL` was reference only. Now the API (online and counter booking) reads both settings and refuses a 5th Tatkal passenger or a 7th passenger with `VALIDATION_ERROR`; the screen reads the same numbers from `GET /api/booking-rules`. Tested.

**Fare lines:** `POST /api/bookings/fare-preview` (new, read only, nothing held) returns, per passenger, base fare, concession discount, reservation, superfast, Tatkal, dynamic surcharge, GST, insurance and total from `fn_calculate_fare`, plus an estimated status. A test creates the real booking afterwards and the preview equals the real fare line by line. The summary step lists every passenger by name with their own fare line and the status they got (read from the PNR after the hold).

**Pay now / Cancel unpaid:**
- My Bookings: every `PAYMENT_PENDING` booking shows "Not paid yet", a ticking countdown, **Pay now** and **Cancel unpaid booking**, and the note "Test mode: use Netbanking or UPI. International cards are not accepted." When the countdown ends the card says the hold ended.
- The payment page has the countdown, the same note, Pay now and Cancel unpaid booking. **Pay now** on My Bookings rebuilds the payment step from the booking (read from the server) and reuses the booking's open Razorpay order.
- **Cancel unpaid booking** (`POST /api/bookings/:pnr/cancel-unpaid`, new procedure `sp_cancel_unpaid_booking`): reservations cancelled, freed seats promoted, inventory re-synced, booking ends `FAILED` (same as an expired hold), its open payment order is checked at Razorpay and closed. Tested: another passenger gets 403, a second call 409, the seats come back.
- I replaced the decorative "Select Payment Method" radios and the UPI id box (no code read them; Razorpay's own window chooses) with one honest line.

## 3. TDR

**Was the original error correct?** The screenshot case: reason "Train Delayed Over 3 Hours" on PNR 4990886448 gave "Passenger reservation status or train delay is not eligible for this TDR reason". That PNR no longer exists in the database (it was reset), so I reproduced the situation: a CONFIRMED passenger on a train with 0 delay gets exactly that message. **The refusal was correct** (the train was not delayed; `sp_file_tdr` needs `delay_minutes >= 180`). What was wrong was the form: it offered every reason and the message did not say why.

**Every reason against the SQL rules (`sp_file_tdr`) and the API (`tdrController`):**

| Reason | Valid when |
| :--- | :--- |
| TRAIN_DELAYED_OVER_3_HOURS | passenger CONFIRMED or RAC; schedule delay 180 min or more; train not yet left the boarding station |
| TRAIN_DIVERTED | passenger CONFIRMED or RAC; train not yet left. There is no "diverted" flag anywhere in the data, so the SQL cannot verify it; the admin checks the claim when reviewing |
| CLASS_DOWNGRADED, AC_FAILURE, COACH_NOT_ATTACHED, TRAIN_TERMINATED_SHORT | passenger CONFIRMED, RAC or BOARDED; train HAS left; evidence reference given; filed within 72 hours of destination arrival plus delay |
| all | no open TDR (FILED, UNDER_REVIEW, APPROVED, REFUND_PROCESSED) for that passenger |

The API and SQL agree. The only vague part was the error text (all three refusal causes shared one sentence).

**The form now:** `GET /api/tdr/eligibility/:pnr` (new) gives the train's delay, whether it left, every passenger by NAME with ticket status, and for every passenger and reason whether it can be used and a one-line why. The modal shows the train and its current delay, passengers by name (tick), and the reasons: valid ones selectable, the others greyed out with the reason ("Not available: The train is not delayed. At least 3 hours (180 minutes) of delay are needed."). Evidence is asked only when a reason needs it. A refused filing now says why and names the passenger. **My TDRs / Refunds** shows passenger name, train, reason, status, refund amount and the refund status (Refund is being sent / sent to your payment method / failed).

**End to end on the demo chain (browser + API):** staff `EMP-TC-101` set a 200 minute delay on the chain run; the chain owner opened the form (delay reason greyed out with the reason while the train was on time; usable after the delay), filed the TDR for the CONFIRMED passenger (TDR-1138895729-1-1), the admin approved it in the portal (refund Rs 1,850.00 recorded), and My TDRs showed APPROVED, "Approved and refunded", Rs 1,850.00, "Refund sent to your payment method". The delay was reset to 0. Also in `test-d5`. Note: the admin portal has no delay control (the Schedules delay button is disabled); the delay is set by on-duty staff (`POST /api/staff/delays`).

## 4. Payment

**Fixes**
1. **Method:** `PAYMENT.method` is read from Razorpay (`payments.fetch`; the reconcile path already has the payment object). UPI, NET_BANKING, CREDIT_CARD or DEBIT_CARD (card type), anything else or no answer is `UNKNOWN` (added to the ENUM). It was hard-coded `UPI`.
2. **Duplicate orders:** pressing Pay twice returns the existing open order (same amount, hold still running, `reused: true`); before reusing it, Razorpay is asked once whether it was already paid (then the ticket is finished and `alreadyPaid: true` comes back). When a hold is released, when the passenger cancels, and in the one-minute job, unpaid `CREATED` orders of bookings that are no longer waiting for payment are checked at Razorpay and, if nothing was paid, set to **`EXPIRED`** (new status).
   - **Why `EXPIRED` and not a final state:** Razorpay cannot cancel an order and its payment window can stay open in a browser. If a closed order were final, a payment made later would be lost. So an `EXPIRED` order is still checked for 24 hours (job, "check payment status", webhook); a payment that arrives becomes `LATE_PAID` and is refunded automatically. `FAILED` stays final (the existing SQL test of that rule still passes).
3. All the payment tests below.

**Test table** (mock = `test-d5` with the mock gateway; real = Razorpay TEST keys, real network)

| Test | Expected | Actual |
| :--- | :--- | :--- |
| Real payment through the UI (real checkout, Netbanking, bank "Success") | ticket confirmed, method NET_BANKING | CONFIRMED, `PAYMENT.method = NET_BANKING`, order PAID (real) |
| Methods upi / credit card / debit card / wallet / no method | UPI / CREDIT_CARD / DEBIT_CARD / UNKNOWN / UNKNOWN | as expected (mock) |
| Pay pressed twice, same booking | one order | same `orderId`, `reused: true`, one `PAYMENT_ORDER` row (mock and real) |
| Cancel unpaid booking with an open order | booking FAILED, seats back, order closed | as expected, order `EXPIRED` (mock and real) |
| Hold released, order unpaid | order closed | `EXPIRED` (mock) |
| Payment still arrives on an `EXPIRED` order | not lost | found by the job, `LATE_PAID`, refund (mock) |
| Webhook without secret configured | 503 | 503 |
| Webhook, bad signature | rejected, nothing changes | 400, booking still PAYMENT_PENDING |
| Webhook `payment.captured`, valid signature | booking confirmed once | 200, CONFIRMED, one PAYMENT row (method UPI) (mock) |
| Same webhook delivered 3 times | no double payment | still one PAYMENT row (mock) |
| Valid-signature webhook for the REAL paid order, replayed twice, plus a bad signature (real keys, test secret) | no second payment, bad one refused | 200, 200, 400, one PAYMENT row (real) |
| Webhook for an unknown order | 200, nothing to do | 200 |
| "Check payment status" route, order paid at gateway, `/verify` never called | ticket confirmed | `paymentReceived: true`, CONFIRMED; a second call within 10 s answers 429; another passenger 403 (mock) |
| **Backend was down while the user paid, real:** real checkout paid, the browser's `/verify` and `/reconcile` calls blocked | booking waits, later confirmed | UI showed "We are confirming your payment. Please do not pay again."; booking stayed PAYMENT_PENDING with the money taken; "Check payment status" then answered CONFIRMED, method NET_BANKING (real) |
| Backend down, background job later (inside the hold) | ticket confirmed | `reconcileDueOrders` confirmed it, one payment (mock) |
| Backend down, hold already ended | automatic refund | order `LATE_PAID`, `REFUND` reason `PAYMENT_AFTER_EXPIRY` (mock) |

**Not tested with real Razorpay:** a webhook delivered by Razorpay itself (needs a public address and `RAZORPAY_WEBHOOK_SECRET` in `backend/.env`, which you add yourself). The webhook code path was tested with locally signed events, mock and real keys.

## 5. Staff and admin leftovers

| Item | Status |
| :--- | :--- |
| Staff portal usable on a phone | **Done.** The navigation row wraps and its menus open full width. All 10 staff tabs checked at 390x844: no sideways scroll, axe 0. A hover colour (white on orange-500, 2.8:1) found on the way was fixed in 5 staff pages. |
| Scanner shows ALL passengers of a PNR | **Done.** Every passenger is listed with their own remarks box and verify / board / no-show buttons. Tested on a 2-passenger PNR. |
| Boarding results survive a reload | **Done.** The chart endpoint and the PNR lookup now return the live reservation status and the latest verification (read from the database). Tested: board one passenger, mark the other "ID mismatch", reload, both read back; the chart shows BOARDED. |
| Staff pages with a prepared chart tested on a SPARE run | **Done** on run 1453 (train 12245, 22 Nov). The demo chain run's chart was NOT prepared. Clean-up: the spare run, its chart, its duty row and the boarding changes are removed by the data reset at the end (`demo:refresh` / `test:all`). |
| Admin: Contact Us messages (list, mark done) | **Done** (`/admin/contact-messages`, `GET` and `PATCH /api/admin/contact-messages`). Tested end to end: message sent from the phone-width panel, listed, marked done. |
| Admin: Fares edit form and calculator, real slab shape | **Done.** The form edits min km, max km and rate per km (the real `FARE` columns); the calculator calls `GET /api/admin/fares/calculate`, i.e. the real `fn_calculate_fare`. The old mock-shape calculator and its test file were deleted. |
| Quotas | **Now real (read only):** the five quotas with their rules and real usage on the upcoming runs (`GET /api/admin/quotas`). The seat shares are built into `sp_create_booking`, so they cannot be edited. Passenger limits and senior ages are real settings. |
| Notifications, Reports | **Still demo data** (marked so on the pages): Notifications has no admin-level table; the 7 Reports tabs use the mock store. The real RANK reports are on the Dashboard. I did not make these real: each needs several new report queries, not an easy change. |
| Contact panel from SETTING | **Done.** `CONTACT_HELPLINE`, `CONTACT_EMAIL`, `CONTACT_ADDRESS` (obviously fake demo values) are read through `GET /api/contact-info`; change them in Admin, Settings (tested). |
| `mock-data/` | Skipped as asked (not touched). `frontend/public/user/mock-data/` also still exists. |

**Real or demo, honestly:** real = Live Trains, booking rules and fare preview, concession list, TDR eligibility, Contact messages, Fares slabs and calculator, Quotas, Settings, staff boarding. Demo = admin Notifications and the 7 Reports tabs.

Other small fixes found while testing: React pages called a staff-only route (`/api/staff/assignments/current`) for every signed-in role and got a 403 in the console (the staff context now reads only a STAFF session); status badges in My Bookings (CONFIRMED, RAC, WL, CANCELLED) were below 4.5:1 and are darker now.

## 6. Files

**Created**
- Backend: `src/controllers/liveTrainsController.js`, `bookingPreviewController.js`, `adminContactController.js`, `adminFareCalcController.js`, `adminQuotaController.js`; `src/services/bookingRulesService.js`, `tdrEligibilityService.js`; `src/routes/liveTrainsRoutes.js`; `scripts/test-d5.js`
- Database: `mysql/migrations/07_live_trains_payment_contact.sql`
- Frontend: `src/pages/LiveTrainsPage.tsx`; admin `pages/contactMessages/ContactMessagesPage.tsx`, `services/contactMessageService.ts`; passenger `public/user/passenger-step.js`
- Docs: `docs/CHANGE_REPORT_13.md`, screenshots in `docs/screenshots/frontend-check/` (`live`, `booking`, `tdr`, `staff`, `admin`, `final` = 50-page audit)

**Changed**
- Backend: `routes/index.js`, `bookingRoutes.js`, `publicInfoRoutes.js`, `tdrRoutes.js`, `adminRoutes.js`; `controllers/bookingController.js`, `counterController.js`, `paymentController.js`, `tdrController.js`, `publicInfoController.js`, `staffController.js`, `adminController.js`; `services/paymentOrderService.js`, `holdCleanupService.js`; `scripts/demo-chain.js`, `test-all.js`, `helpers/mockRazorpay.js`; `package.json` (`test:d5`)
- Database: `mysql/01_schema.sql`, `02_functions.sql`, `03_procedures.sql`, `07_tests.sql`; `seed-data/mysql/SETTING.csv`, `seed/step3_generate.js`
- Frontend: `src/router.tsx`, `PublicLayout.tsx`, `public.css`, `publicApi.ts`, `LandingPage.tsx`, `StaffPortalApp.tsx`, `ScannerPage.tsx`, `StaffContext.tsx`, `staffApiService.ts`, 4 staff pages (hover colour), admin `FaresPage.tsx`, `QuotasPage.tsx`, `quotaService.ts`, `fareService.ts`, `fare.ts`, `quota.ts`, `AdminLayout.tsx`, `routes.ts`, `api.config.ts`; `public/rrms-contact.js`; passenger `app.js`, `index.html`, `styles.css`, `services/apiService.js`
- Docs: see section 9

**Deleted:** `frontend/src/admin/utils/fareCalculator.ts` and `fareCalculator.test.ts` (the old mock-shape calculator, no longer used).

## 7. Tests

| Run | Result |
| :--- | :--- |
| `npm run test:all` (backend, mock Razorpay) | **11 of 11 suites passed, 1057 of 1057 assertions** (d1 94, d2 106, d3a 87, d3b1 99, d3b2 64, d3b3 92, d3c1 116, d3c2 156, d3c3 133, d4 5, **d5 105 new**) |
| `node database/load/apply-sql.js 02_functions 03_procedures 04_triggers 05_views 07_tests --run-tests` | **67 of 67 SQL tests passed** (66 before, plus the new EXPIRED order test) |
| `npm run test:smoke` (live API, after `demo:refresh` and `demo:chain`) | **28 of 28 passed** |
| `npm run build` (frontend, `tsc` and Vite) | built with no errors |

The first `test:all` run had **one failure that my change caused**: `test:d3c1` asserted "exactly 13 settings" and I added 5 settings (`SENIOR_AGE_MALE`, `SENIOR_AGE_FEMALE`, `CONTACT_HELPLINE`, `CONTACT_EMAIL`, `CONTACT_ADDRESS`). I changed that one assertion to 18 and added the 5 keys to its required-key list (a stricter check, not a weaker one), then re-ran the whole of `test:all`: all green. Nothing else in an existing test was changed.

**Contrast (axe, color-contrast rule), 1366x768:** **0 violations on 50 pages** (landing, Train Info, Live Trains list and detail, signed in and out, 11 passenger pages and modals, 10 staff tabs, 23 admin pages including the new Contact Messages), plus 0 on booking steps 3, 4 and 5 (desktop and phone), My Bookings with an unpaid booking, the TDR form and the TDR list (desktop and phone). Two contrast problems found and fixed on the way: the My Bookings status badges (3.28:1) and a hover colour in the staff pages (2.8:1). axe cannot measure some gradients and text over images; those were checked by hand in the previous report and not changed. Pages checked at 390x844 for sideways scroll: Live Trains (list and detail), booking steps 3 to 5, My Bookings with an unpaid booking, the TDR form and list, all 10 staff tabs. None scrolls sideways (the step bar of the booking flow is clipped inside its own box, as before).

## 8. Commands that changed data

- `node database/mysql/migrations/07_live_trains_payment_contact.sql` (through a small runner) and `node database/load/apply-sql.js 02_functions 03_procedures 04_triggers 05_views`: widened two ENUMs, added 5 SETTING rows, replaced routines.
- `node database/load/run-all.js` (full seed reload) several times, `npm run test:d5` (creates bookings, orders, a TDR, contact message), `npm run test:all` (reloads the seed before every suite and at the end), `npm run demo:refresh`, `npm run demo:chain`, `npm run test:smoke`.
- Browser and API checks: real Razorpay TEST payments (3 real orders, 2 paid with Netbanking), bookings and unpaid bookings for the chain owner and the demo passengers, a 200 minute delay on the chain run (reset to 0), a TDR filed and approved, a duty row and a prepared chart on spare run 1453, boarding of one passenger, Contact Us test messages, one setting changed and changed back (`CONTACT_HELPLINE`).
- All of it was wiped by the final `demo:refresh` and `demo:chain`.

## 9. Docs updated

`README.md` (public entry, step 3, summary, payment, staff, admin, demo steps incl. Live Trains and the TDR demo, payment and TDR paragraphs), `docs/API_CONTRACT.md` (route index, 3.7, 3.8, 4.2.1, 4.2.2, 4.3 reuse/EXPIRED/method, 4.6 eligibility, 5.1.2, 7.1, 7.9), `docs/DATA_SCHEMA.md`, `docs/BUSINESS_RULES.md`, `docs/KNOWN_GAPS_AND_DECISIONS.md`, `docs/CONTRACT_CHANGES_FOR_ROHAN.md`, `docs/PBL_SCREENSHOT_CHECKLIST.md` (button name), `backend/README.md`, `database/README.md`, `database/mysql/README.md`, `frontend/README.md`, `frontend/public/user/README.md`.

## 10. Please still check by hand, and what is not verified

- **A webhook delivered by Razorpay itself** (needs `RAZORPAY_WEBHOOK_SECRET` in `backend/.env` and a public address). Everything else about the webhook was tested with locally signed events.
- The booking flow with a **signed-in staff or admin account** on Live Trains "Book this train" shows a plain message; not clicked through.
- **Notifications and Reports tabs** in the admin portal are still demo data.
- The Razorpay window's own screens (card, wallet) were not exercised; only Netbanking.
- The admin portal on a phone (not requested; checked only at desktop width). Tab order and screen readers were not tested.
- The two old `mock-data` folders are still there (you delete them by hand).
- `frontend/dist` was rebuilt by `npm run build` (it is git-ignored).
- TDR "diverted" cannot be verified by the database (no data for it); the admin decides.
- Tatkal opening time and the Aadhaar-verified account rule are in the business rules but are not enforced by the database or the API; the screen does not claim them.

## 11. Final demo chain

Printed by `npm run demo:chain` after the final `npm run demo:refresh` (and the data was not touched afterwards):

| | |
| :--- | :--- |
| Train | **12221 Pune–Howrah Duronto Express** |
| Schedule (run) id | **1399** |
| Travel date | **2026-11-21** |
| Class | **AC 2 Tier (2A)** |
| Owner login | **user1_7858@example.com** / `Password123!` |
| Confirmed PNR (to cancel) | **1013819989** |
| First RAC PNR | **8937436090** (RAC/1) |
| First WL PNR | **9830846001** (WL/1) |
| Staff duty | EMP-TC-101 on TRAIN_DUTY for this run |
| Inventory audit | 0 mismatches |

Live Trains (`/live-trains`, date 2026-11-21, search 12221) shows for 2A: total 96, free 26, **confirmed 70, RAC 10/10, waiting list 24/24**. The backend (port 5000) and the Vite dev server (port 5173) are running.
