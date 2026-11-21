# Known gaps and decisions

Written on 2026-11-19 from the real code. Each line says what is true now, not what was planned. Status words: **open** (not done), **decided differently** (built another way on purpose), **done** (checked and finished), **limit** (works, but with a known limit).

## 1. Points from the old BUSINESS_RULES sections 16 to 18 that were not done as written

Those three sections (needs from the ER diagram, data and demo plan, documents to update) were removed from `docs/BUSINESS_RULES.md`. Every point was checked. All 22 table changes and the data fixes are in the schema and the seed. These points are the exceptions:

| Item | Status | Where in code | Note |
| :--- | :--- | :--- | :--- |
| Table `SEAT_HOLD` (old item 4) | decided differently | `database/mysql/01_schema.sql`; deleted only by `sp_prepare_chart` | The hold is the `BOOKING` row in `PAYMENT_PENDING` plus a release job (`sp_release_expired_holds`). The table exists, has 5 seed rows (`HOLD-TEST-TOKEN-1..5`) and no procedure or backend code writes to it. It is safe to ignore. |
| `REFUND_RULE.clerkage` (old item 6) | decided differently | `REFUND_RULE` column; value read from `SETTING.CLERKAGE_PER_PASSENGER` | The column is kept but the database never reads it. Change the setting instead. |
| Mock JSON field names mapped to the new tables (old section 18) | done | frontends call the real API | The folder `mock-data/` and the admin file `frontend/src/admin/services/mock.client.ts` are leftovers. See section 4. |
| Links to a personal laptop path (old section 18) | done | docs and READMEs | Replaced by relative links. |
| Train type review list approved by the leaders (old section 17) | done | `database/seed-data/mysql/TRAIN.csv` | The seed holds the corrected types and display names. |
| Four demo stories plus the ladies-quota story (old section 17) | done | `database/workbench/` and `database/mysql/07_tests.sql` | Story 4 (chart time) is in `Story_D_Chart_Preparation_Workbench.sql`. |

## 2. Rules that are hard-coded in the SQL functions (an admin cannot change them in a table)

| Rule | Where | Note |
| :--- | :--- | :--- |
| Reservation charge and superfast charge per class | `fn_calculate_fare` | Not in `FARE`. |
| Tatkal charge percent: 30 for AC classes, 10 for non-AC | `fn_calculate_fare` | |
| GST applies to AC classes only | `fn_calculate_fare` | The rate itself is a setting (`GST_RATE_AC`). |
| Dynamic Tatkal surcharge: switch is a setting, but the 80 percent threshold and the 1.5 multiplier are fixed | `fn_calculate_fare` | `DYNAMIC_FARE_ENABLED` is off in the seed. |
| Tatkal tickets get no refund | `fn_calculate_cancellation_refund` | |
| Clerkage rule for RAC and waiting-list cancellations (only the amount is a setting) | `fn_calculate_cancellation_refund` | |
| Seat shares (Tatkal 10 percent, ladies 10 percent, RAC 10 percent, waiting list 25 percent) | seed inventory and `sp_create_booking` | Fixed when the inventory rows are made. |
| Maximum passengers per PNR | decided | `bookingRulesService.assertPassengerLimit` | Fixed in the Live Trains / booking-rules change: the API reads `MAX_PASSENGERS_PER_PNR` (6) and `MAX_PASSENGERS_PER_PNR_TATKAL` (4) from SETTING for online and counter bookings, and the screen reads the same values from `GET /api/booking-rules`. |
| Senior citizen age rules (60 men and OTHER, 45 women) | `sp_create_booking` | |

## 3. Known gaps and limits

| Item | Status | Where in code | Note |
| :--- | :--- | :--- | :--- |
| Tatkal needs an Aadhaar-verified account (BR-Q3) | open | `sp_create_booking`; no check | Anyone can book Tatkal. Aadhaar only changes the monthly limit (12 or 24). The counter booking rule BR-CB5 (Aadhaar proof and OTP) is not built either. |
| Tatkal limit of 4 passengers | fixed | `bookingRulesService.js` | The old mismatch (screen 4, API 6) is gone: the API refuses a 5th Tatkal passenger with `VALIDATION_ERROR`. The Tatkal opening time (BR-Q7) and the Aadhaar-verified-account check (BR-Q3, BR-Q6) are written in the business rules but are NOT checked by the database or the API, so the screen does not claim them. |
| Monthly ticket limit uses the current time | limit | `sp_create_booking` calls `fn_check_monthly_ticket_limit(p_user_id, NOW())` | It cannot be tested with a fixed date unless `@as_of_time` is added to that call. The function itself takes any time. |
| "Book only if confirmed" (`bookOnlyIfConfirmed`) | open | error `NOT_ALL_CONFIRMED` is never raised | The API ignores `preferences.bookOnlyIfConfirmed`. |
| Auto-upgrade and insurance choice in the booking body (`autoUpgrade`, `travelInsurance`) | open | `bookingController.js` reads only `preferences.berthCondition`; `sp_create_booking` always calls `fn_calculate_fare` with insurance on | Every passenger is charged the insurance premium (0.45) and cannot opt out. Auto-upgrade is not passed to the database. Do not promise either in a demo. |
| Counter booking does not check for a counter duty | open | `counterController.js` | Any logged-in staff member can use it. The contract used to say "active COUNTER_DUTY shift". |
| Mock-data pages in the admin portal | limit | `frontend/src/admin/pages/notifications`, `reports` (marked **Demo data**) | Quotas is now real (read only, see `GET /api/admin/quotas`). Notifications (no admin-level table) and the seven Reports tabs still show demo data; the real RANK reports are on the Dashboard. |
| Admin file `frontend/src/admin/services/mock.client.ts` | limit | still used for the pages above | |
| Passenger area is not a React page | decided differently | `frontend/public/user/` (about 2,500 lines of plain JS) | It was kept as a separate document on the same site instead of being rewritten in React, because the booking flow with the Razorpay checkout must not change. It shares the one login, session, theme, name and Contact Us button. Moving it into React is possible later. |
| Staff portal on a phone | fixed | `frontend/src/StaffPortalApp.tsx` | The navigation wraps and its menus open full width; every staff page was checked at 390 x 844 with no sideways scroll. |
| Unused passenger mock files | limit | `frontend/public/user/mock-data/` (22 JSON files) | Nothing loads them any more. The delete was blocked in the session, so the folder is still there. Safe to delete. |
| Contact Us details are demo values | limit | SETTING `CONTACT_HELPLINE`, `CONTACT_EMAIL`, `CONTACT_ADDRESS` | The panel reads them from `GET /api/contact-info`; change them in Admin, Settings (one place). The shipped values are obviously fake. Messages are real (MongoDB) and the admin reads them in Contact Messages. |
| PNR enquiry on Train Info needs a sign-in | decided differently | `frontend/src/pages/TrainInfoPage.tsx` | A PNR shows a private ticket. Passengers see their own PNR; staff and admin see any. |
| Track your train has no live GPS | limit | `GET /api/trains/:trainId/run-status` | Status and delay come from the database; the last stop is estimated from the timetable. |
| Chart snapshot is empty in the seed | decided differently | `database/seed-data/mysql/CHART_SNAPSHOT.csv` (header only) | The seed is frozen at 2026-10-17 19:15 and no chart is prepared yet. `sp_prepare_chart` writes the snapshot. |
| `docs/DEVELOPMENT_RULES.md` section 5 and `docs/PROJECT_OVERVIEW.md` still describe the "mock layer" phase | open | docs | Frontends now use the real API. Left as history. |
| Seed users share one password (`Password123!`) | limit | seed data | Staff and admin have their own passwords (see README). Change them before any real use. |
| Test clock | limit | `@as_of_time` in SQL only | The website cannot set it. Seed runs (October 2026) are in the past on the real clock, so website stories use `demo:refresh` and `demo:chain`. |
| `test:all` resets the data | limit | `backend/scripts/test-all.js` | Run `demo:refresh` and `demo:chain` again afterwards. |
| Children and the "under 5" rule | decided | `docs/BUSINESS_RULES.md` scope note | There is NO child fare and no free child seat: a child is a normal passenger with a seat and the full fare. The passenger screen says so (from `GET /api/booking-rules`); it does not show an invented under-5 rule. |
| Payment orders cannot be cancelled at Razorpay | limit | `paymentOrderService.expireAbandonedOrders` | An unpaid order is closed as `EXPIRED` when its hold ends, but it is still checked for 24 hours because the payment window can stay open in a browser. A late payment is refunded. |
| Booking cancelled by the passenger before payment ends as FAILED | decided | `sp_cancel_unpaid_booking` | Same end state as an expired hold. |
| Delay of a run is set by on-duty staff only | limit | `POST /api/staff/delays` | There is no admin route to set a delay (the delay button in Admin, Schedules is disabled). The TDR demo sets the delay as staff `EMP-TC-101`. |
| Quota seat split on Live Trains | decided | `liveTrainsController.js` | `SCHEDULE_CLASS_INVENTORY` has no quota column, so the quota rows are worked out in the API from the reservations with the seat-share rules of `sp_create_booking`. Seats can be free in a class while the General quota is full (the free seats belong to other quotas). |
| The PBL PDF object names are not all real objects | decided differently | see `docs/PBL_NAME_MAPPING.md` | Optional alias file `database/mysql/08_pdf_aliases.sql`. |

## 4. Suspected leftover folders (nothing was deleted)

See the report of the documentation pass: `mock-data/` (repo root), `frontend/user/`, `frontend/admin/`, `frontend/dist`, `.vite`. The evidence for each is in section 5 of the change report; delete them only after checking with the team.

## 5. TDR filing conditions (what `sp_file_tdr` checks)

1. The passenger number is required, and the booking must belong to the logged-in user.
2. The reason must be one of the six codes in `TDR_RULE`.
3. No second TDR for the same passenger while one is `FILED`, `UNDER_REVIEW`, `APPROVED` or `REFUND_PROCESSED`.
4. Late train (`TRAIN_DELAYED_OVER_3_HOURS`) and diverted train: the passenger must be CONFIRMED or RAC, the recorded delay must be 180 minutes or more (late train only), and the claim must be filed before the delayed departure from the boarding station.
5. Class downgraded, AC failure, coach not attached, train terminated short: the passenger must be CONFIRMED, RAC or BOARDED, the train must have already left, an evidence reference is required, and the claim must be filed within 72 hours after the (delayed) arrival at the destination.
