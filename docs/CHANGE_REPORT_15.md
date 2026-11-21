# Change report 15: the final round

Branch `final-few-changes`. Nothing was committed or pushed. Test commands used the real database, so they changed data (section 11).

## 1. Staff and admin redesign
- **Shared components rebuilt** (every staff and admin page uses them): `DataTable` (sticky header, hover rows, sortable headers with `aria-sort`, skeleton rows while loading, illustrated empty state, error state with retry), `PageHeader` (serif title), `StatCard`, `StatusBadge` (admin and staff now map to the ONE status chip set), `Modal` and `ConfirmDialog` (animated, `role=dialog`, focus in, focus trap, Escape, focus back), new `RealStats` strip. The component classes (`btn-primary`, `form-input`, `form-label`, `text-body`, `cell-*` ...) were defined in an old CSS file that was never loaded; they are now in `src/admin/admin-components.css` on the shared tokens.
- **Older inline pages** (staff Overview, Manifest, Scanner, Vacancies, Fines, Operations, Crowd, Emergency, Counter, Maintenance; admin Dashboard and the rest): white cards become glass cards, serif headings, inline tables get a sticky header, hover rows and scroll inside their card (rules in `layout/shell.css`). I did not rewrite each page's markup one by one; the redesign of these pages is component level plus those rules.
- **Custom inputs everywhere**: `src/ui/enhance.ts` upgrades every native `<select>` and `<input type="date">` in the portals (booking forms, staff and admin forms and modals) to the accessible listbox and calendar of the landing page. The native field stays hidden as the source of truth and receives `input` + `change` events, so React forms and the passenger page controller keep working. The accessible name is "label: value". Verified in the browser: keyboard (arrows, Enter), the booking search and concession form still work, and the 94-page axe sweep stays at 0.
- **Widths tested** (landing, Live Trains, booking, one staff page, one admin page): 320, 390, 768, 1366, 1920. No page-level sideways scroll (320 px initially had three overflows, on passenger Home, admin Notifications and admin Settings; fixed). Wide tables scroll inside their card. Screenshots: `docs/screenshots/redesign/w*.png`.
- **Staff chart 400 fixed**: `GET /api/staff/schedules/:id/chart` answers `200` with `chartPrepared: false` and an empty list; the manifest page shows a friendly notice. The console no longer shows any 4xx on the staff pages.
- **Sidebars**: same positions in all three portals; admin has the amber bar, "ADMIN MODE" label, amber badge, "PNR search" button and amber tab icon.

## 2. Public PNR status endpoint
`GET /api/pnr-status/:pnr` (no login). Returns `pnr`, overall booking status, train number and name, journey date, class, run status and delay, boarding and destination station (code and name), and for each passenger only `passengerNo`, `status`, `shortStatus` (CNF, RAC, WL, CAN) and `queuePosition`. It never returns names, ages, genders, ID proofs, contact data, the owner, fares or seats (a test checks the JSON for those keys and for the real passenger name). Rate limit: 15 lookups per minute per address in memory (`429 TOO_MANY_REQUESTS` with `Retry-After`). `400` for a PNR that is not 10 digits, `404` unknown. Used by the landing page and Train Info. Documented in `docs/API_CONTRACT.md` section 3.8.

## 3. Backend and database changes
| Change | What was done |
| :--- | :--- |
| **Admin delay control** | `POST /api/admin/schedules/:id/delay` (minutes 1 to 1440, 0 clears, optional reason). Writes the same `TRAIN_SCHEDULE` row and MongoDB live status as staff, notifies passengers with a CONFIRMED or RAC ticket, writes an `AUDIT_LOG` row (`UPDATE_SCHEDULE_DELAY` / `CLEAR_SCHEDULE_DELAY`). Admin, Schedules has a **Delay** button and modal (the page lists runs from today by default). Seen in the browser: the alerts strip showed "12951 ... is running 45 minutes late" at once; API test proves Alerts and Live Trains. |
| **BR-Q3 (Tatkal Aadhaar)** | BUSINESS_RULES says Tatkal needs an Aadhaar-verified account and an OTP (BR-Q3, BR-Q6) and, at the counter, an Aadhaar ID proof for one passenger (BR-CB5). Enforced in `sp_create_booking` step 2f: online needs `aadhaar_verified = 1`, counter needs an AADHAAR proof on one passenger, else `AADHAAR_REQUIRED` (HTTP 400). The OTP is only simulated; the opening time (BR-Q7) is NOT enforced (listed in the gaps). `chain@rrms.in` is now Aadhaar verified. |
| **Counter duty** | Counter booking answers 403 unless the staff member has a `COUNTER_DUTY` shift covering now. The seed got three standing counter duty rows (2026 to 2036). The staff "current duty" ignores a counter duty when the person has another duty (otherwise it hid the train duty). |
| **Monthly limit clock** | `sp_create_booking` uses `v_as_of = COALESCE(@as_of_time, NOW())`. The old SQL test now creates its rows on the test-clock date. |
| **Reports (real)** | `GET /api/admin/analytics/:tab` (revenue, bookings per day, cancellations with refunds, occupancy, delays, complaints from MongoDB, notifications from MongoDB, summary). All six Reports tabs read it, plus a live totals strip. Notifications shows real counters; its list and the broadcast composer still use sample data and say **Sample data** on screen. Dashboard and the RANK reports were already real. |
| **Earlier small gaps** | `MAX_PASSENGERS_PER_PNR` / `_TATKAL`: already enforced by the booking and counter APIs from SETTING (re-checked, listed as fixed). `INVALID_STOPS`: refused by the procedure, mapped to HTTP 400 with a message, SQL test exists (listed as fixed). New open items: Tatkal opening time, simulated OTP, in-memory rate limit, UPI not offered. All in `docs/KNOWN_GAPS_AND_DECISIONS.md`. |
| **Tests added** | SQL: `test_tatkal_aadhaar_rule`, `test_monthly_limit_test_clock_month` (07_tests.sql, now 70). API: `backend/scripts/test-d6.js` (57 assertions), added to `test:all`. |
| **demo:clear fix** | The script did not exit (MongoDB client kept it alive); now it exits explicitly. |

## 4. New logins
Password rule: `Demo@123` passes (login only needs a non-empty password; registration needs 6 characters, change-password 8). No rejection, so no fallback password.

| Role | Login | Password | Notes |
| :--- | :--- | :--- | :--- |
| Passenger | `passenger@rrms.in` (user 50001) | `Demo@123` | Aadhaar verified, **0 bookings** in the final state |
| Chain owner | `chain@rrms.in` (user 50002) | `Demo@123` | Owns all 104 bookings of the chain run, Aadhaar verified |
| Staff | `TC101` (alias of stored `EMP-TC-101`; the long id and `tc101` also work) | `Demo@123` | on duty for the chain run |
| Other staff | `EMP-TC-102`, `EMP-TC-103` | `Demo@123` | |
| Admin | `admin@rrms.in` (user 50007) | `Demo@123` | |
| All 50,000 seeded passengers | `userN_xxxx@example.com` | `Demo@123` | |

Done with scripts (no hash printed): the seed CSV `USER_ACCOUNT.csv` was re-hashed (scrypt, salt `salt_user_<id>`) and `database/seed/step1_clean.js` writes the same accounts, so `demo:refresh` keeps them. The old logins were replaced everywhere (seed, scripts, 13 test files, landing "Use demo account", docs); only the long staff id keeps working because it costs nothing. The first full `test:all` after the change failed 4 suites because tests logged in seeded users with the old password; fixed by giving every seeded passenger the new password.

## 5. demo:clear
- **Removes** (one transaction, foreign-key order, no checks switched off): REFUND, CHART_SNAPSHOT, SEAT_HOLD, TICKET_VERIFICATION, TDR_FILING, CANCELLATION, PAYMENT, PAYMENT_ORDER, RESERVATION, PASSENGER_BOOKING, BOOKING; MongoDB booking notifications and raw gateway replies. **Resets** every `SCHEDULE_CLASS_INVENTORY` row (available = total, RAC 0, WL 0) and `chart_prepared_at`. **Keeps** users, saved passengers, staff, trains, routes, schedules and delays, stations, fares, rules, settings, fines, incidents, complaints, contact messages, audit and activity logs.
- **Safety**: runs the inventory audit and fails (exit code 1) unless 0 mismatches and 0 bookings. Repeatable (second run removes 0 rows; verified, 4 s). Test `test:d6` runs it twice.
- **Result**: 2030 inventories, 0 mismatches. On the empty database Live Trains shows all seats free, Alerts is empty, the analytics summary is all zeros, revenue is an empty list (tests).
- **Final state of the demo accounts** (queried): `passenger@rrms.in` 0 bookings; `chain@rrms.in` 104 bookings = 70 CONFIRMED, 10 RAC, 24 WL on run 1401 (train 12221 Pune-Howrah Duronto, 2A, 2026-11-22), confirmed PNR 1044052743, first RAC 4620420870, first WL 6034786465; TC101 on TRAIN_DUTY for run 1401; audit 0 mismatches.

## 6. Razorpay test payment methods (verified in the real checkout, test mode)
Driven with Playwright through the passenger booking flow. A mobile number is asked first: `9876543210` is rejected ("Please enter a valid mobile number"), `9123498765` works. Card list from the Razorpay docs (razorpay.com/docs/payments/payments/test-card-details); each was tried, none invented.

| Method | Tried | Result | Exact text / notes |
| :--- | :--- | :--- | :--- |
| Visa `4100 2800 0000 1007`, 12/30, CVV 123 | yes | **works** | mock bank page, **Success**, booking confirmed |
| Mastercard `5500 6700 0000 1002` | yes | **works** | same |
| RuPay `6527 6589 0000 1005` | yes | **works** | OTP screen "Enter OTP to complete payment": press **Pay on bank's page**, then Success (no OTP typed) |
| Netbanking, Canara Bank | yes | **works** | bank pick goes to the mock page, Success |
| UPI `success@razorpay` | yes | **not offered** | checkout shows only Cards, Netbanking, Wallet, Pay Later (needs enabling in the Razorpay dashboard) |
| Card `4111 1111 1111 1111` | yes | **fails** | "Payment could not be completed. International cards are not supported. Please contact our support team for help" |
| Wallet, Pay Later | no | unknown | |

Cancel and refund were also run: cancelling a confirmed Rs 4,899.65 net-banking ticket showed "Cancellation successful! Refund of Rs 2,449.60 processed." and the refund row is `PROCESSED`. The README payment box lists exactly this.

**A real bug was found and fixed during this check**: the Razorpay script tag was lost when the passenger area moved into React in the last round, so "Pay now" showed "Payment window could not load". The passenger portal now loads `checkout.razorpay.com/v1/checkout.js` itself.

## 7. Tests (final numbers)
| Check | Result |
| :--- | :--- |
| SQL tests (`apply-sql.js ... 07_tests --run-tests`) | **70 passed, 0 failed** |
| `npm run test:all` | **12 suites, 1114/1114 assertions** (an earlier run had 1 flaky timing failure in `test:d5` "Reconcile" that passed on rerun and in the full run) |
| `npm run test:smoke` | **28 passed, 0 failed** (against a backend on port 5001 running the new code, after `demo:clear` + `demo:chain`) |
| `npm run test:d6` after the last code change | 57/57 |
| Route-vs-contract (`npm run check:routes`) | **151 routes served, 152 table rows (one is the `/me` alias), 0 missing either way** |
| Passenger flow in the browser | Live Trains > Book this train > results; search; add traveller with Divyaang concession; summary; payment (4 successful payments); cancel and refund; My Bookings, PNR, TDR, Alerts, Grievances, Profile; theme toggle; Ctrl+K; sign-out |
| axe (wcag2a, 2aa, 21a, 21aa), every page, both themes (94 combinations) | **0 violations at 1366x768, 390x844 and 320x640**; no console errors; no page-level overflow |
| Hero text contrast over the photo | 6.2 or higher (worst pixel), both themes (measured in the previous round, hero unchanged) |
| Build | `npm run build`: no errors; landing JS 320 kB (101 kB gzip), CSS 77 kB (16 kB gzip); `dist` 2.0 MB |
| Lighthouse landing | Desktop 99 / 100 / 100 / 91 (performance, accessibility, best practices, SEO). Mobile: accessibility 100, best practices 100, SEO 91; **performance 82 in the previous round, 47 to 50 in the final runs, but the machine was about 6x slower at that time (Lighthouse CPU benchmark 567 versus about 3400 before)**, so the final mobile performance number is not trustworthy. Not re-measured on a quiet machine. |

## 8. README
Rewritten from scratch (table of contents, 12 sections): what the project is; theory (classes, quotas, berths, inventory and CNF / RAC / WL with a promotion diagram, 10-minute hold with a sequence diagram, Tatkal, fares, concessions, refund slabs, TDR, chart, test clock and simulator); architecture diagram; run from zero on Windows (install, `.env` keys in words, load, start, reset commands with "changes data" marks, tests); one login table; the payment demo box with the verified results; guides for the passenger, staff and admin portals (page, what it does, what it changes); a can-do table including the public endpoint; Live Trains and Train Info explained; troubleshooting; folder map, tech, team from the git history, known gaps, document list; videos. Screenshots from `docs/screenshots/redesign/` are embedded. Not covered: Wallet and Pay Later test payments; the real helpline.
Other docs updated: `API_CONTRACT`, `DATA_SCHEMA`, `ARCHITECTURE`, `KNOWN_GAPS_AND_DECISIONS`, `CONTRACT_CHANGES_FOR_ROHAN`, `database/mysql/README`, `database/seed-data/README`, `database/workbench/README`, `PBL_SCREENSHOT_CHECKLIST`, `frontend/README`; `DEVELOPMENT_RULES` and `PROJECT_OVERVIEW` have a status banner at the top (partly archived / early-phase history).

**`.env.example` files**: I could not open them (reading `.env*` paths is blocked in this session), so I did not edit them. They should contain placeholders only, one line each:
`backend/.env.example`: `PORT=5000`, `NODE_ENV=development`, `JWT_SECRET=change-me-to-a-long-random-text`, `MYSQL_HOST=localhost`, `MYSQL_PORT=3306`, `MYSQL_USER=root`, `MYSQL_PASSWORD=your-mysql-password`, `MYSQL_DATABASE=railway_db`, `MONGODB_URI=mongodb://localhost:27017`, `MONGODB_DB_NAME=railway_db`, `RAZORPAY_KEY_ID=rzp_test_xxxxxxxx`, `RAZORPAY_KEY_SECRET=your-test-secret`, `RAZORPAY_WEBHOOK_SECRET=optional`.
`database/.env.example`: `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MONGODB_URI`, `MONGODB_DB_NAME` with the same placeholders. (The keys are the ones the code reads: JWT_SECRET, MONGODB_DB_NAME, MONGODB_URI, MYSQL_DATABASE, MYSQL_HOST, MYSQL_PASSWORD, MYSQL_PORT, MYSQL_USER, PORT, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET.)

## 9. Videos
- **Tool**: the `brag` plugin (latent-spaces/brag v0.5.0) is installed; I read its SKILL.md and references. Its workflow makes 15 to 25 second launch videos with HyperFrames. I used **HyperFrames** (the engine brag uses; CLI 0.9.77: `check` passed with 0 errors and 7 structure warnings because it is one file, `render` to mp4) with brag's bundled music for the **40 second intro**, since brag's 15 to 25 second limit does not fit a 40 second request. I did not run the brag planning steps (plan, storyboard files) literally.
- **Walkthrough**: no tool in brag records a real app, so it is a **Playwright screen recording** of the running app with injected captions, then ffmpeg (waiting time sped up, captions at normal speed, music bed).
- Files: `docs/media/rrms-walkthrough.mp4` (2:40, 6.4 MB, 1280x720) and `docs/media/rrms-intro.mp4` (0:40, 10.3 MB, 1920x1080). Both are small; they are **not committed** (you commit). Music: Sascha Ende (ende.app), CC BY 4.0, credited in the README.
- Recorded against a database made clean with `demo:clear` then `demo:chain` (the booking in the video was made by `passenger@rrms.in`). Afterwards `demo:clear` and `demo:chain` were run again (section 5, final state). The Razorpay bank mock page opens in a popup that the screen recording does not capture; the recording shows the card form and then the confirmed ticket.

## 10. Files
- **Created**: backend `scripts/demo-clear.js`, `scripts/test-d6.js`, `scripts/check-routes.js`, `src/controllers/adminOpsController.js`, `src/controllers/publicPnrController.js`; frontend `src/ui/enhance.ts`, `src/admin/admin-components.css`, `src/admin/components/RealStats.tsx`, `src/components/PnrQuickCheck.tsx`; `docs/CHANGE_REPORT_15.md`, `docs/media/*`.
- **Changed**: `database/mysql/03_procedures.sql`, `07_tests.sql`, seed CSVs (`USER_ACCOUNT`, `STAFF_ASSIGNMENT`), `database/seed/step1_clean.js`; backend `authController` (TC101), `counterController`, `staffController`, `errorHandler`, `adminRoutes`, `publicInfoRoutes`, `demo-chain.js`, `test-all.js`, `package.json`, all test files and `smoke-test.js` (logins); frontend `PassengerPortal` (Razorpay script, nav), `PortalShell`, `StaffPortalApp`-related files, `AdminLayout`, DataTable, PageHeader, StatCard, StatusBadge, Modal, ConfirmDialog, SchedulesPage, ReportsPage, NotificationsPage, reportService, scheduleService, staffApiService, StaffContext, LandingPage/TrainInfo (PNR), `session.ts` and `SignInCard` (logins), CSS files, README and the docs listed in section 8.
- **Deleted**: none in this round (the leftover `frontend/public/user/mock-data/` could not be deleted, see section 13).

## 11. Commands that changed data
`npm run demo:refresh` (several times), `npm run demo:chain` (several times), `npm run demo:clear` (several times; deletes all bookings), `npm run test:all` (reloads the seed after every suite), `npm run test:d6` (ends with `demo:clear`), `npm run test:smoke` (creates throwaway users and bookings), `node database/load/apply-sql.js ... --run-tests` (replaces procedures; its tests roll back), the browser payment runs (created about 10 test bookings and 4 successful payments with test money, one cancelled with refund), the admin delay set and clear in the browser. Seed files and generator changed by scripts (`USER_ACCOUNT.csv`, `STAFF_ASSIGNMENT.csv`, `step1_clean.js`). The final state is the clean one in section 5.

## 12. Docs updated
See section 8.

## 13. Check by eye, not verified, still rough
- **Not verified**: UPI, Wallet and Pay Later test payments; `.env.example` completeness (blocked); mobile Lighthouse performance on a quiet machine; the Razorpay bank popup in the video.
- **Process note**: the backend you may already have running on port 5000 still runs OLD code. Restart it (`npm start` in `backend`) to get the new routes (public PNR status, admin delay, analytics, AADHAAR rule) and the new logins; also restart `npm run dev`. I tested against my own copy on port 5001 and stopped it afterwards. I was not allowed to stop your process.
- **Rough**: the older staff and admin inline pages got the component-level design pass and the CSS rules, not a hand-made layout each; the Notifications list and broadcast are still sample data; hero text over the photo was last measured in the previous round; the intro video's first scene has the landing screenshot text faintly behind the title.
- **Leftovers**: `frontend/public/user/mock-data/` (untracked JSON) could not be deleted (permission); dead files `src/App.tsx`, `components/Header.tsx`, `components/Sidebar.tsx`, `admin/index.css` are unused. `docs/screenshots/redesign/` is about 25 MB: delete the width screenshots (`w*.png`) if you want the repo smaller.
- **Look at**: the admin Schedules Delay modal, Reports and Notifications strips, the landing PNR box, `/passenger/book` steps 3 to 5 in the light theme, and both videos.

## 14. Final demo state
`passenger@rrms.in`: 0 bookings. `chain@rrms.in`: 104 bookings on run 1401 (70 CNF, 10 RAC, 24 WL), confirmed PNR 1044052743 to cancel, first RAC 4620420870, first WL 6034786465. Staff TC101 on TRAIN_DUTY for run 1401. Inventory audit: 2030 inventories, 0 mismatches. Backends: yours on port 5000 (old code, restart it); my port 5001 copy and the preview server are stopped.
