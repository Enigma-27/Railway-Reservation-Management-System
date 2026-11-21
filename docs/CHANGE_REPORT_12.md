# Change report 12: one coherent site

Date: 2026-11-20. Branch: `final-few-changes`. Nothing was committed or pushed.

## 1. Decision

**Hybrid, not a full React merge.** React now owns everything that decides how the site feels (one router, one login, one session, one theme, one name, the landing page, Train Info, the guards, the staff and admin portals). The signed-in passenger area stays a plain HTML/JS document at `/user/index.html` on the same site, but it no longer has anything of its own: no landing page, no login, no wrapper, no iframe, no dark theme, no "RailConnect".

Why not a full React rewrite of the passenger area:
- It is about 2,500 lines of booking, payment (Razorpay), cancellation, TDR and saved-passenger logic. You told me not to touch payment or refund logic, and a rewrite cannot guarantee that.
- Everything that made the site inconsistent (three logins, three sessions, a dark theme, two names) is fixed without a rewrite. The pieces that cannot be shared by import (theme, session keys, contact button, config) are shared through plain files in `frontend/public/` that both worlds load.
- It can still be moved into React later, one page at a time.

## 2. Route map, before and after

| Address | Before | After |
| :--- | :--- | :--- |
| `/` | Landing page (extra "Sign In" button in the header, "Book Tickets" and "Train Info" links that jumped into the passenger portal; it logged everybody out on every visit) | Landing page: header with logo and name, Home and Train Info only, alerts bell and strip, train search, ONE sign-in card. Stays signed in |
| `/admin/login` | A second copy of the landing page (and an unused admin LoginPage.tsx) | Redirects to `/` |
| `/passenger` | A wrapper page ("Back to Home / Passenger Portal / RailConnect v1.0 / Open in Tab") with an iframe | Signed-in passenger: opens `/user/index.html`. Everyone else: `/` |
| `/user/index.html` | The portal's OWN landing page, OWN login/register overlay, own dark app | Only the signed-in passenger app (light theme). No session: goes to `/` |
| `/train-info` | did not exist (a section inside the portal's landing page) | Train Info: Train schedule, Track your train, PNR enquiry (real data) |
| `/staff` | Staff guard read its own session | Role guard (STAFF), same session |
| `/admin`, `/admin/*` | Admin guard read its own session. `/admin/refund-transactions` had **no route** (fell back to the landing page) | Role guard (ADMIN). Refund Transactions route added |
| anything else | `/` | `/` |
| Sessions | three: admin `localStorage` keys, staff `localStorage` keys, passenger `sessionStorage` | one: `rrms_token` + `rrms_user` (with `role`) |

## 3. Files

**Created**
- Backend: `backend/src/controllers/publicInfoController.js`, `backend/src/routes/publicInfoRoutes.js`
- Frontend shared files: `frontend/public/rrms-theme.css`, `rrms-contact.js`, `rrms-config.js`
- Frontend React: `src/auth/session.ts`, `src/auth/RoleRoute.tsx`, `src/components/PublicLayout.tsx`, `src/components/public.css`, `src/components/SignInCard.tsx`, `src/pages/LandingPage.tsx`, `src/pages/TrainInfoPage.tsx`, `src/services/publicApi.ts`
- Docs: `docs/CHANGE_REPORT_12.md`, `docs/screenshots/frontend-check/` (about 140 screenshots, 17 MB)

**Changed**
- Backend: `src/routes/index.js`, `src/routes/trainRoutes.js` (3 small public routes, see section 6)
- Frontend: `index.html`, `tailwind.config.js`, `src/index.css`, `src/router.tsx`, `src/admin/auth/AuthContext.tsx`, `src/admin/config/api.config.ts`, `src/admin/services/authService.ts`, `src/admin/layouts/AdminLayout.tsx`, `src/admin/pages/fares/FaresPage.tsx`, `src/admin/pages/dashboard/DashboardPage.tsx`, `src/StaffPortalApp.tsx`, `src/components/Header.tsx`
- Passenger area: `public/user/index.html`, `app.js`, `styles.css`, `services/apiService.js`, `README.md`
- Docs: `README.md`, `frontend/README.md`, `docs/API_CONTRACT.md`, `docs/ARCHITECTURE.md`, `docs/CONTRACT_CHANGES_FOR_ROHAN.md`, `docs/KNOWN_GAPS_AND_DECISIONS.md`

**Deleted**
- `src/admin/pages/HomePage.tsx` (old landing + login), `src/admin/pages/auth/LoginPage.tsx` (admin login page), `src/pages/PassengerPortalPage.tsx` (wrapper + iframe), `src/admin/routes/ProtectedRoute.tsx`, `StaffProtectedRoute.tsx`, `src/admin/routes/router.tsx`, `src/admin/main.tsx` (old duplicate entry point)
- `public/user/config.js`, `public/user/services/mockService.js` (unused). About 650 lines of dead CSS (the portal's own landing and login styles) were cut from `public/user/styles.css`; its public landing and login HTML and JS were removed from `index.html` and `app.js`.

**Not deleted (delete was blocked): `frontend/public/user/mock-data/`** (22 unused JSON files). Safe to delete by hand.

## 4. Login

One sign-in card on `/`; the role tab picks the backend route. Accounts used (all through the real UI in Chromium, and the same routes by API):

| Role | Account | Result |
| :--- | :--- | :--- |
| Passenger | `rahul.sharma@example.com` / `Password123!` (seed account, userId 50001; verified; this replaces nothing, the old prefill was already valid) | signs in, lands in `/user/index.html` |
| Passenger (API) | the demo-chain owner and `user95_...` / `Password123!` | 200 |
| Staff | `EMP-TC-101` / `StaffPassword123!` | signs in, lands in `/staff` |
| Admin | `admin@railways.gov.in` / `AdminPassword123!` | signs in, lands in `/admin` |

Checks that passed (26 of the 27 browser checks; the rest are in sections 5 and 6): sign-in per role; refresh keeps the session; `/` while signed in shows "Go to my portal" and no form; Sign Out returns to `/` and clears both keys; `/admin`, `/staff`, `/passenger`, `/user/index.html` signed out all go to `/`; wrong password, admin credentials on the Staff tab, passenger credentials on the Admin tab, and an empty form each show a plain message under the form. No role fails.

## 5. Theme, name and contrast

- Tokens: `frontend/public/rrms-theme.css`, loaded by the React app and by the passenger area; Tailwind reads the same values (`tailwind.config.js`, `rrms` colours). Every pair in the tokens is WCAG AA or better (calculated: text 17.9, muted 7.6, white on primary 6.4, success 5.5, danger 6.5, warning 5.6).
- One name: "Railway Reservation & Management System", short form **RRMS**. "RailConnect" is gone (landing, portal title, sidebar, even the name shown in the Razorpay window, which is a text label only). One logo: white train on a blue rounded square, now also in the passenger sidebar.
- Light theme everywhere. The passenger portal was dark navy; staff and admin were already light.

**Contrast, measured in a real browser with axe-core (color-contrast rule), 1366x768, every page of the three portals:**

| | Before | After |
| :--- | :--- | :--- |
| Pages audited | 43 | 44 |
| Violations (all pages) | **184** | **0** |
| Lowest ratio | **1.02** (passenger "Recent Bookings", "Book Tickets", names on cards) | none below 4.5 |
| Passenger pages | 57 violations, lowest 1.02 | 0 |
| Staff pages (8 tab views) | 88, lowest 2.45 | 0 |
| Admin pages | 31, lowest 1.65 | 0 |
| Landing and public | 8, lowest 2.40 | 0 |

**Root causes of the unreadable text**
- Passenger portal: its CSS kept DARK-theme text colours (`--clr-text: #e8eaf6`, a near-white) while a late patch gave the page a LIGHT background (`#f5f7fb`). That is light text on a light page (ratio 1.02 to 1.11), for every title ("Recent Bookings", "Book Tickets", "My Bookings", "Good morning, Isaac", the TDR modal title...). Fix: replaced the whole palette with the shared light tokens, so text is dark on light. The greeting is now 15.7:1.
- Hidden for years by gradients: the active menu item had white text on a pale background (axe cannot measure gradients). Found and fixed by replacing all 12 blue-purple gradients with solid theme colours.
- Staff and admin: Tailwind shades used for TEXT on white were too light (`slate-400` 2.6:1, `slate-500` 4.4:1 on the grey page, `gray-400` 2.5:1, `emerald-600` 3.6:1, white on `orange-600` 3.6:1). Fixed at the root in `tailwind.config.js`, so every use changed at once.
- Landing: "Demo: credentials prefilled" text in light grey (removed with the old card).

**Things axe cannot measure (26 on the landing page, a few on pages with gradients, selects, arrows):** I measured the important ones by hand. Hero text over the photo, from real screenshot pixels (brightest 1% behind the text): desktop headline 5.4:1, paragraph 6.5:1; phone headline 10.9, paragraph 8.5 (these were 3.0 and 2.3 before I darkened the overlay on narrow screens); the pill label sits on a solid dark pill (about 8.7:1 worst case). The passenger greeting and active menu item were measured from computed styles (15.7 and 5.65). The rest are decorative arrows, `select` arrows, one avatar on a blue gradient, and a pale info box with dark text.

**Responsive:** at 390x844, landing, sign-in, Train Info, the booking search page and every passenger page have no sideways scroll. At 1366x768 there is none either. The staff portal does NOT fit a phone (about 460 px too wide); it was not in scope.

## 6. Landing, Train Info, Contact Us, Alerts

- **Landing (`/`)**: white header with logo, the full name and "RRMS"; nav is only **Home** and **Train Info** (the list `PUBLIC_NAV` in `PublicLayout.tsx` has a comment where Prompt 13 adds **Live Trains**); a bell with a count; a visible alerts strip; hero photo with the train-search box (real station list, date today to +7, class) and ONE sign-in card with three role tabs, "Use demo account", and "New passenger? Create an account". No second Sign In button. A search while signed out asks for Passenger sign-in, then opens the booking flow with the results (the search is kept in `sessionStorage`; I found and fixed my own bug where the sign-in deleted it). A signed-in passenger goes straight to the results.
- **Train Info (`/train-info`)**: Train schedule (real stops and running days), Track your train (real run status and delay; no live GPS, the last stop is worked out from the timetable), PNR enquiry (needs a sign-in; a passenger sees their own PNR, staff and admin see any). **Removed:** the "Connecting train search (Demo data)" mock section and the "Travel alerts (Demo data)" mock list. There is no real data behind connecting trains, so I did not keep it.
- **Contact Us**: a floating button, bottom-right, on every page of the React app and the passenger area (`rrms-contact.js`), opening a panel with the contact details and a short form. The details are demo placeholders. Messages are really saved (MongoDB `contact_messages`); a test message went through.
- **Alerts**: a strip under the header (and a bell with a count), not floating. Real data: new `GET /api/alerts` (delayed or cancelled runs of the next 7 days). Tested live: a 200 minute delay on the chain run showed "12221 ... is running 200 minutes late" and bell 1, then cleared to 0 after the delay was reset.
- **API additions (listed in `docs/API_CONTRACT.md` section 3.6, route comparison still 138 = 138):** `GET /api/alerts`, `GET /api/trains/:trainId/run-status?journeyDate=`, `POST /api/contact`. No business rule, payment or refund code was changed.

## 7. Pages you should still check by hand, and what is not verified

Checked by me in a real browser: every page of the three portals opens with no page error and no contrast violation (44 pages); all 27 flow checks pass. Please still look at:
- **Admin pages that use demo data** (Quotas, Notifications, Grievances, Reports tabs): they open and are readable, but the numbers are demo.
- **Admin Fares page:** it was crashing (it expected old mock field names). It now shows the real distance slabs, but the edit form and the fare calculator still use the old mock shape.
- **Staff portal screens with a prepared chart** (manifest, scanner, verify, boarding, no-show): the demo run's chart is not prepared, so these show "chart not prepared". Not exercised by clicking.
- **Staff portal on a phone** (not responsive).
- **Passenger "Saved Passengers" page:** the page works, but its sidebar entry is hidden in the old HTML (`display:none !important`, already like that before this prompt). I did not change it. Show it if you want it reachable.
- **Real payment:** I did not press Pay (as agreed). I checked that the Pay button, the payment step, My Bookings and "Check payment status" are still there and work up to the payment step.
- **Tab/keyboard focus order and screen readers:** not tested.
- The staff mock-credential fallback inside `authService.ts` (used only when `VITE_USE_MOCK=true`) is still there.

## 8. Commands that changed data

- `npm run test:all` (reloads the seed many times), `npm run demo:refresh` and `npm run demo:chain` (3 times in total; the last one at the end), `npm run test:smoke` (creates a throwaway user, a hold and a counter booking, cancels one RAC and boards one passenger).
- The browser checks: a 10-minute hold booking for the demo passenger, two Contact Us test messages in MongoDB, and a 200 minute delay on the chain run that was reset to 0 in the same test.
- The data was left fresh after the last step (`demo:refresh` then `demo:chain`).
- Tools I installed only in my scratch folder (not in the repo): Playwright, Chromium, axe-core, mermaid.

## 9. Docs updated

`README.md` (portals, structure, one login, demo logins, docs table), `frontend/README.md` (rewritten: it still described an offline mock terminal in a folder that does not exist), `frontend/public/user/README.md` (rewritten), `docs/API_CONTRACT.md` (3 routes), `docs/ARCHITECTURE.md` (overview diagram), `docs/CONTRACT_CHANGES_FOR_ROHAN.md` (new section 5), `docs/KNOWN_GAPS_AND_DECISIONS.md` (new rows).

## 10. Known gaps left for Prompt 13

- **Live Trains** page and nav item (room is left in `PUBLIC_NAV`).
- Payments, refunds and the "backend down while paying" test (not touched here).
- Move the passenger area into React, page by page (optional).
- Staff portal responsive layout for phones.
- Admin screen for the Contact Us messages, and the demo-data admin pages.
- Admin Fares page: edit form and calculator for the real slab shape.
- Delete `frontend/public/user/mock-data/`.
- The 17 MB of screenshots: keep, or keep only `flows/` and `before/`.
