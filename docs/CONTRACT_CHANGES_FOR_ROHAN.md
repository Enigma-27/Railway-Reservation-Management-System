# API changes since the first contract (for the frontend)

Written on 2026-11-19. The first contract was committed on 2026-10-06 and re-written for the final business rules on 2026-10-18. This list covers everything that changed in the API after that, up to today. The full, checked description of every route is `docs/API_CONTRACT.md` (its section 1.0 lists all 135 routes).

How to read a line: **what changed** then **what the frontend must do**.

## 1. Removed routes and fields

| What was removed | What the frontend must do |
| :--- | :--- |
| `POST /api/staff/promote` (answers `404 NOT_FOUND` now) | Remove the "Promote" button and any call to it. Promotion happens by itself in the database after a cancellation, a no-show, a hold release, chart preparation or an approved TDR. |
| `POST /api/bookings/hold` (it never existed in the code) | Do not call it. Send `POST /api/bookings` straight away. That call starts the 10-minute hold. |
| `holdToken` in the create-booking body | Stop sending it. It is ignored. |
| `preferences.autoUpgrade`, `bookOnlyIfConfirmed`, `travelInsurance` in the create-booking body | The server ignores them today. Only `preferences.berthCondition` is read. Do not rely on the other three. |
| Fake tokens such as `mock-token-passenger-1` | Tokens are real signed JWTs. Send them as `Authorization: Bearer <token>`. |
| `currentDuty` and `assignedStationId` in the staff login answer | Read the duty with `GET /api/staff/assignments/current`. |

## 2. New routes

| Area | New route | What the frontend must do |
| :--- | :--- | :--- |
| Login | `POST /api/auth/login`, `GET /api/auth/me` (also `GET /api/me`, `GET /me`) | Optional. One login call for every role; `me` gives the profile. |
| Login | `POST /api/auth/change-password` | Add a "Change password" form. Send `currentPassword` and `newPassword` (8 characters or more). A wrong current password answers HTTP 400 `WRONG_CURRENT_PASSWORD`, not 401, so do not log the user out. |
| Booking | `GET /api/bookings/:pnr/hold` | Use it to show the countdown of an unpaid booking (`secondsRemaining`). |
| Payment | `POST /api/payments/razorpay/reconcile` | Add a **Check payment status** button for a `PAYMENT_PENDING` booking whose `holdSecondsRemaining` is above 0. If the passenger paid but the browser closed, this finishes the order. HTTP 429 means "try again in 10 seconds". |
| Payment | `POST /api/payments/razorpay/webhook` | Not for the frontend. Razorpay calls it. |
| Saved passengers | `GET/POST /api/saved-passengers`, `PUT/DELETE /api/saved-passengers/:id` | Use them for the "My passengers" page. Another user's id answers 404. Delete answers 409 if a booking still uses it. Send the id as `savedPassengerId` when booking. |
| Admin refunds | `GET /api/admin/refund-transactions`, `POST /api/admin/refund-transactions/:refundId/retry` | Add the **Refund Transactions** page. Filter by `status` (`PENDING`, `PROCESSED`, `FAILED`). The retry button only works for `PENDING` and `FAILED`. |
| Admin users | `PUT /api/admin/users/:id/status` | Activate, suspend or deactivate an account. |
| Admin platforms | `POST/PUT/DELETE /api/admin/platforms` | Platform maintenance. Delete answers 409 if a maintenance task or route stop uses it. |
| Admin master data | `/api/admin/route-stops`, `/api/admin/concessions`, `/api/admin/refunds` | These are aliases of `/routes`, `/concession-rules` and `/refund-rules`. Use the long names. `/refunds` is the refund RULE, not refund money. |

## 3. Changed behaviour

### Booking and availability
- A booking is always created as `PAYMENT_PENDING` with `projectedStatus` (`CONFIRMED`, `RAC` or `WAITING_LIST`) and `secondsRemaining`. Show "you will get ..." from `projectedStatus`, and do not call it a ticket until payment is confirmed.
- `GET /api/bookings` (My Bookings) rows with `PAYMENT_PENDING` carry `holdSecondsRemaining`.
- A train that already left is refused with `JOURNEY_PAST`. A date too far away is refused with `OUTSIDE_BOOKING_WINDOW` (default 7 days). Show these texts to the user.
- Quota rules are checked by the database: LADIES needs women (age 12 and over), SENIOR_CITIZEN has age rules, DIVYAANG needs a proof type and reference (`QUOTA_NOT_ELIGIBLE`, `CONCESSION_PROOF_REQUIRED`). The availability call answers `fallbackOffered: true` with a notice when the quota is full; send `continueWithGeneralQuota: true` after the passenger agrees.
- The monthly ticket limit (12, or 24 if Aadhaar verified) is checked on booking (`MONTHLY_LIMIT_EXCEEDED`).
- The passenger portal limits Tatkal to 4 passengers; the API accepts 6 for every quota. See `docs/KNOWN_GAPS_AND_DECISIONS.md`.

### Payment
- The Razorpay order is saved in MySQL. MongoDB is optional.
- `POST /api/payments/razorpay/verify` answers HTTP 200 with `success: false` and code `HOLD_EXPIRED` when the payment came after the hold. The money is refunded by itself. Show "your payment is being refunded" and read `data.refund`.
- A payment with a wrong amount answers `PAYMENT_AMOUNT_MISMATCH` or `PAYMENT_AMOUNT_INVALID`. No ticket is issued.

### Cancellation and refunds
- Refunds start as `PENDING`. After the gateway call the row is `PROCESSED` or `FAILED`. Say "refund processed" only when `refund.status` is `PROCESSED`. `gatewayRefund` can be `PROCESSED`, `SKIPPED` (cash or seeded payment, no real money moves), `PENDING` or `FAILED`. When it is `PENDING` or `FAILED` the cancellation still succeeded and `refundMessage` explains that the refund is retried.
- The cancel answer has `cancelIds` and `refundIds` (arrays) next to `cancelId` and `refund` (first row).
- Cancelling is refused with `CHART_PREPARED` from 8 hours before departure and with `REFUND_EXCEEDS_PAYMENT` when the seat was refunded before.
- A second cancel of the same PNR answers 400 `BAD_REQUEST`.
- Admin and staff can cancel any PNR (`POST /api/bookings/:pnr/cancel` with their own token).

### TDR
- File with `passengerNos` (an array). All passengers are filed together or not at all.
- A TDR for a late train needs a delay of more than 3 hours. Other reasons need the train to have left. Details: `docs/KNOWN_GAPS_AND_DECISIONS.md` (TDR filing conditions).
- Approving a TDR (`PUT /api/admin/tdr/:tdrRefNo`) answers `APPROVED` with a `refund` object, cancels the passenger and promotes the next ones. In the database the TDR ends as `REFUND_PROCESSED`.

### Staff
- Verification, boarding and no-show need a `TRAIN_DUTY` row for that run. Without it the answer is 403. The `demo:chain` script creates this duty for `EMP-TC-101`.
- `GET /api/staff/schedules/:id/chart` answers 400 `BAD_REQUEST` until the chart is prepared.
- Counter booking works for any logged-in staff member. It does not check for a counter duty.

### Admin
- Concession rules: `trainGroup` must be `STANDARD` or `PREMIUM`, `discountPct` must be 0 to 100 (HTTP 400 otherwise).
- Refund rules: `classId` is optional (general rule when empty), a second rule for the same class and slab answers 409, `deductionPct` must be 0 to 100.
- Settings: a bad value answers 400 `INVALID_SETTING_VALUE`.

### General
- All times are India time as `YYYY-MM-DD HH:MM:SS` (no `Z`).
- Any server or database error answers `INTERNAL_SERVER_ERROR` with a fixed message. Do not show raw error text.
- When MongoDB is down, notifications, complaints and the activity log answer `503 SERVICE_UNAVAILABLE`. Booking, payment, cancel and refunds keep working. `GET /api/health` shows MongoDB `DOWN`.

## 4. New error codes (all listed in section 1.2 of the contract)

`JOURNEY_PAST`, `OUTSIDE_BOOKING_WINDOW`, `INVALID_STOPS` (database only, the API answers `VALIDATION_ERROR` first), `TRANSACTION_FAILED`, `PAYMENT_AMOUNT_MISMATCH`, `PAYMENT_AMOUNT_INVALID`, `REFUND_EXCEEDS_PAYMENT`, `INVALID_SETTING_VALUE`, `WRONG_CURRENT_PASSWORD`, `TOO_MANY_REQUESTS`, `SERVICE_UNAVAILABLE`, `CONFLICT`.

`NOT_ALL_CONFIRMED` is in the error map but nothing raises it. Do not build a screen for it.

## 5. Frontend unification (one site)

Written 2026-11-20.

| What changed | What the frontend must do |
| :--- | :--- |
| New public routes: `GET /api/alerts`, `GET /api/trains/:trainId/run-status?journeyDate=`, `POST /api/contact` | Landing alerts strip and bell, Train Info "Track your train", the Contact Us panel. See section 3.6 of the contract. |
| ONE session for all roles: `rrms_token` and `rrms_user` in `localStorage` (the user has `role`). The old keys `rrms_admin_token`, `rrms_admin_user`, `rrms_staff_token`, `rrms_staff_user` and the passenger `sessionStorage` key `railconnect_user` are gone | Read the token from `rrms_token` only. Never write the old keys. |
| The only login screen is the landing page card. `/admin/login` is gone (redirects to `/`) | Do not add other login forms. |
| `/passenger` opens the passenger area `/user/index.html` | Link to `/passenger`, not to the file. |
| The wrapper page around the passenger area (Back to Home, Open in Tab, iframe) is removed | Nothing to do. |
| The admin menu entry Refund Transactions now has a route (`/admin/refund-transactions`) | It used to fall back to the landing page. |

### 5b. Live Trains, booking rules, payment and TDR (Prompt 13)

| What changed | What the frontend must do |
| :--- | :--- |
| New public routes `GET /api/live-trains`, `GET /api/live-trains/:scheduleId`, `GET /api/booking-rules`, `GET /api/contact-info` | Live Trains page; the passenger step reads limits, senior ages, Tatkal rules and the concession list from `booking-rules`; the Contact Us panel reads `contact-info`. |
| New `POST /api/bookings/fare-preview` (read only) and `POST /api/bookings/:pnr/cancel-unpaid` | Show per-passenger fare lines and rule problems before the hold; a "Cancel unpaid booking" button. |
| `POST /api/payments/razorpay/order` may answer `reused: true` (same open order) or `alreadyPaid: true` (nothing to pay) | Handle `alreadyPaid` (go to My Bookings); otherwise open Razorpay with the returned order as before. |
| `PAYMENT.method` is the real method (`UPI`, `NET_BANKING`, `CREDIT_CARD`, `DEBIT_CARD`) or `UNKNOWN`; `PAYMENT_ORDER.status` can be `EXPIRED` | Admin filters that list payment methods or order states need the new values. |
| `POST /api/bookings` and `/api/counter/bookings` refuse more passengers than the setting allows (6; 4 for Tatkal) with `400 VALIDATION_ERROR` | The Tatkal limit is now a real API rule. |
| `GET /api/bookings/:pnr` adds `holdSecondsRemaining`, per passenger `concessionType` and `fare` (staff and admin also `verification`) | Optional: show them. |
| New `GET /api/tdr/eligibility/:pnr`; `GET /api/tdr` adds names, train, reason label and `refundStatus`; the not-eligible refusal of `POST /api/tdr` now names the passenger and the reason | The TDR form offers only valid reasons and shows why the others are not. |
| `GET /api/staff/schedules/:id/chart` rows add `reservationStatus`, `verificationResult`, `verificationRemarks`, `verifiedAt` | Boarding and verification survive a reload. |
| New admin routes `GET /api/admin/contact-messages`, `PATCH /api/admin/contact-messages/:id`, `GET /api/admin/quotas`, `GET /api/admin/fares/calculate`; new settings `SENIOR_AGE_MALE`, `SENIOR_AGE_FEMALE`, `CONTACT_HELPLINE`, `CONTACT_EMAIL`, `CONTACT_ADDRESS` | Contact Messages, Quotas (now real, read only) and Fares (slab form and real calculator) pages. |
| Database: run `database/mysql/migrations/07_live_trains_payment_contact.sql`, then `node database/load/apply-sql.js 02_functions 03_procedures 04_triggers 05_views` | On an existing database. A fresh `run-all.js` already contains everything. |

## 6. Quick test for the frontend

Run `npm run test:smoke` in `backend` with the backend running (after `npm run demo:refresh` and `npm run demo:chain`). It calls 28 routes the way a frontend does and prints a PASS or FAIL table.
