# Frontend: Railway Reservation & Management System (RRMS)

One website for all three roles. React + Vite + TypeScript + Tailwind, port **5173**. The signed-in passenger area is a plain HTML/JS app in `public/user/` that lives on the same site and uses the same login, theme and name.

```
cd frontend
npm install
npm run dev        # http://localhost:5173   (the backend must run on port 5000)
npm run build      # type-check + production build into dist/
```

## 1. Pages and routes

| Address | Page | Who |
| :--- | :--- | :--- |
| `/` | **Landing page**: header (logo, name, Home, Train Info, Live Trains, alerts bell), service-alerts strip, train search, the ONE sign-in card | everyone |
| `/train-info` | **Train Info**: Train schedule, Track your train, PNR enquiry (real API data) | everyone (PNR needs a sign-in) |
| `/live-trains` | **Live Trains**: every train run of a date with live seats, RAC and waiting list (filters: date, from, to, type, class, running status, search). Click a train for the class and quota detail. Refreshes every 15 seconds. Staff and admin also see chart state and occupancy. "Book this train" opens the booking flow with the train, date and class chosen. Data: `GET /api/live-trains` and `GET /api/live-trains/:scheduleId`. | everyone |
| `/passenger` | Opens the passenger area (`/user/index.html`) when signed in as a passenger; otherwise goes to `/` | passenger |
| `/user/index.html` | Passenger area: Home, Book Tickets (6 steps, Razorpay), My Bookings, PNR Enquiry, Profile, Saved Passengers, TDR / Refunds, Grievances, Alerts | passenger |
| `/staff` | Staff / TC terminal (10 tabs; fits a phone) | staff |
| `/admin`, `/admin/...` | Admin portal (23 pages, including Refund Transactions and Contact Messages) | admin |
| anything else, `/admin/login` | goes to `/` | |

Opening a protected address while signed out (or with the wrong role) always goes to `/`.

## 2. One login, one session

- The sign-in card on `/` is the only login on the site. The role tab (**Passenger**, **Staff / TC**, **Admin**) decides which backend login route is called: `/api/auth/passenger/login`, `/api/auth/staff/login`, `/api/auth/admin/login`.
- The result is stored under two keys for every role: `rrms_token` (the JWT) and `rrms_user` (the user, with `role`). Code: `src/auth/session.ts`. The passenger area reads the same keys.
- **Sign out** (in every portal) removes both keys and returns to `/`. Refreshing keeps you signed in. Opening `/` while signed in shows "Go to my portal" instead of the card.
- **Use demo account** (per role tab) fills in a demo login from the seed data. Nothing is pre-filled on its own. Demo accounts: passenger `rahul.sharma@example.com` / `Password123!`, staff `EMP-TC-101` / `StaffPassword123!`, admin `admin@railways.gov.in` / `AdminPassword123!`.
- A search typed on the landing page is kept in `sessionStorage` (`rrms_pending_search`). A signed-out visitor is asked to sign in as Passenger and then lands in the booking flow with the results. A signed-in passenger goes straight there.

## 3. Theme and name

- One set of tokens: `public/rrms-theme.css` (colours, fonts, spacing, radius, shadows, buttons, inputs, cards, badges, tables, modal, toast). It is loaded by `index.html` and by `public/user/index.html`. Tailwind pages read the same values through `tailwind.config.js` (`rrms` colours). The reference look is the landing page: white header, blue primary buttons.
- Every text/background pair in the tokens is WCAG AA or better. Three Tailwind shades that were too light for text (`slate-400`, `slate-500`, `gray-400`, plus `emerald-600` and `orange-600` for white-on-colour) are darkened in `tailwind.config.js`, so every use on the staff and admin pages is fixed at once.
- One name: "Railway Reservation & Management System", short form **RRMS**. One logo: a white train on a blue rounded square.

## 4. Shared pieces

| File | What it does |
| :--- | :--- |
| `public/rrms-contact.js` | The floating **Contact Us** button (bottom-right, every page of the React app and the passenger area) with a panel and a short message form. Posts to `POST /api/contact`. The helpline, e-mail and address come from `GET /api/contact-info` (SETTING keys `CONTACT_HELPLINE`, `CONTACT_EMAIL`, `CONTACT_ADDRESS`; change them in Admin, Settings). The contact details in it are demo placeholders. |
| `public/rrms-config.js` | `window.RRMS_CONFIG.API_BASE_URL` for the plain scripts (default `http://localhost:5000`). The React app uses `VITE_API_BASE_URL`. |
| `src/components/PublicLayout.tsx` | Header navigation (**Home**, **Train Info**, **Live Trains**; the list `PUBLIC_NAV`) and the alerts strip (`GET /api/alerts`). |
| `src/services/publicApi.ts` | Client for the public routes: stations, trains, run status, alerts, PNR. |

## 5. Source layout

```
index.html                 loads rrms-theme.css, rrms-config.js, the React app, rrms-contact.js
public/
  rrms-theme.css  rrms-contact.js  rrms-config.js  train-sunset.jpg
  user/                    passenger area (index.html, app.js, styles.css, services/apiService.js)
src/
  main.tsx  router.tsx     one router for the site
  auth/                    session.ts (the one session), RoleRoute.tsx (the one route guard)
  pages/                   LandingPage, TrainInfoPage, LiveTrainsPage, and the staff pages
  components/              PublicLayout, SignInCard, staff components
  admin/                   admin portal (layout, 22 pages, services)
  context/ services/       staff state and API client
```

## 6. Checks that were run

A real-browser check (Playwright + axe-core) signs in through the landing card as each role, visits every page, runs the contrast rule and takes screenshots: `docs/screenshots/frontend-check/`. The result is in `docs/CHANGE_REPORT_12.md`. The browser scripts are not part of the repository.

## 7. Known limits

See `docs/KNOWN_GAPS_AND_DECISIONS.md`. Short version: the passenger area is not a React page (it is a separate document on the same site), the staff portal does not fit a phone screen, and the admin pages Quotas, Notifications, Grievances and the Reports tabs still use demo data.
