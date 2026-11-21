# Passenger area (`/user/index.html`)

The signed-in passenger pages of the Railway Reservation & Management System (RRMS). Plain HTML, CSS and JavaScript (no build step), served by Vite from `frontend/public/user/` on the same site as the React app.

This folder has **no login and no public landing page any more**. Sign-in happens on the landing page (`/`). Opening `/user/index.html` without a passenger session goes to `/`.

## How it fits the site

- **Session:** reads `rrms_token` and `rrms_user` from `localStorage` (written by the landing sign-in card, see `frontend/src/auth/session.ts`). Sign Out removes both and goes to `/`.
- **Theme:** `/rrms-theme.css` (shared tokens) plus `styles.css` (this area's layout). `styles.css` maps its old `--clr-*` variables to the shared light tokens.
- **Name and logo:** RRMS, the same blue train tile as the other portals.
- **Contact Us:** the floating button comes from `/rrms-contact.js`.
- **Landing search hand-off:** a search typed on the landing page, or "Book this train" on Live Trains (which also carries `trainId` and the class), is read from `sessionStorage` (`rrms_pending_search`) on start-up and run in the booking flow; with a `trainId` that train and class are selected in the results.
- **API address:** `window.RRMS_CONFIG.API_BASE_URL` from `/rrms-config.js`.

## Pages

Home, Book Tickets (6 steps: search, select, passengers, summary, payment with Razorpay test mode, confirmation), My Bookings (cancel with refund estimate; for an unpaid booking: hold countdown, Pay now, Cancel unpaid booking, Check payment status), PNR Enquiry, Profile, Saved Passengers, TDR / Refunds, Grievances, Alerts. All of them call the real backend (`services/apiService.js`).

## Files

| File | Purpose |
| :--- | :--- |
| `index.html` | The signed-in layout (sidebar, top bar), the page sections, the modals |
| `app.js` | All page logic, the booking flow (steps 1, 2, 4, 5, 6), My Bookings, TDR and the Razorpay checkout |
| `passenger-step.js` | Booking step 3 "Who is travelling?": saved passengers, the add form, the real rules in plain words (`GET /api/booking-rules`), the problem list and the per-passenger fare lines (`POST /api/bookings/fare-preview`) |
| `styles.css` | Layout and components of this area (light theme) |
| `services/apiService.js` | API client (reads the token from the shared session) |
| `mock-data/` | **Unused leftover** from the old mock phase (nothing loads it). Safe to delete. |

## Rules for changes

- Do not add a login here. Add it to the landing page card only.
- Change colours in `/rrms-theme.css`, not in this folder.
- Keep payment code (`processPaymentFlow`, `checkPaymentStatus`) unchanged unless the payment flow itself changes. (Prompt 13 added only: the "already paid" answer of the order call, the Pay now / Cancel unpaid buttons, `resumePayment` and the test-mode note.)
