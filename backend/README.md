# Backend Architecture & Integration Guide

Welcome to the backend directory of the **Railway Reservation & Management System**.

> **Current Stage Note**:
> Backend implementation is scheduled for **Phase 3** after the three frontend teams complete their interface implementations against the common mock dataset.

---

## 1. Planned Backend Architecture

The backend will serve as the RESTful API bridge between the frontends and the relational MySQL database:

```
┌────────────────────────────────────────────────────────┐
│               Frontend Portals (React / Vite)          │
│         (Passenger, Staff/TC, Admin Dashboards)        │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTP / JSON (REST)
                           ▼
┌────────────────────────────────────────────────────────┐
│                  Backend API Engine                    │
│      (Express.js / Node.js OR Python FastAPI)         │
│  ├── Auth Middleware (JWT Token Verification & RBAC)   │
│  ├── Controllers matching docs/API_CONTRACT.md         │
│  ├── Business Logic (Seat Integrity, Fare Matrix)      │
│  └── Data Access Layer (Connection Pool to MySQL)      │
└──────────────────────────┬─────────────────────────────┘
                           │ SQL Queries & Stored Procedures
                           ▼
┌────────────────────────────────────────────────────────┐
│                   MySQL Relational DB                  │
│               (Normalized 3NF / BCNF)                  │
└────────────────────────────────────────────────────────┘
```

---

## 2. Core Responsibilities & Business Logic

When backend development commences, it must implement:

1. **Authentication & Authorization**:
   - `bcrypt` password hashing for user accounts.
   - Role-Based Access Control (RBAC) middleware verifying roles (`PASSENGER`, `STAFF`, `ADMIN`).
2. **Segmented Seat Integrity Verification**:
   - Enforce segment validation before seat booking:
     A seat $[s_{\text{board}}, s_{\text{dest}})$ is available only if no confirmed booking overlaps the same stop sequence on that date.
3. **Seat Hold Engine**:
   - In-memory or database-backed temporary lock with a 10-minute time-to-live (TTL).
   - Automatic expiry and seat release upon timeout or payment abandonment.
4. **Canonical Fare Calculation Engine**:
   - Dynamic calculation based on route segment distance and class rate tables:
     $$\text{Total Fare} = \text{Base} + \text{Reservation} + \text{Tatkal} + \text{Insurance} + \text{GST} - \text{Concession}$$
5. **Chart Finalization & RAC Promotion**:
   - Trigger automated promotion from `WAITING_LIST` to `RAC` and `RAC` to `CONFIRMED` upon passenger cancellation or no-show marks.

---

## 3. API Contract Adherence

The backend must match every endpoint defined in [docs/API_CONTRACT.md](../docs/API_CONTRACT.md) without deviating in URL path, request body fields, or response schema.

---

## 4. Live Trains, booking rules, payment and TDR code (Prompt 13)

| File | What it does |
| :--- | :--- |
| `src/controllers/liveTrainsController.js` | `GET /api/live-trains` (one SQL query per page) and `GET /api/live-trains/:scheduleId` (per class and per quota). Seat numbers come from `SCHEDULE_CLASS_INVENTORY`. |
| `src/services/bookingRulesService.js` | Reads the booking rules from SETTING and CONCESSION_RULE; `assertPassengerLimit` (6, and 4 for Tatkal) used by the booking and counter-booking controllers; `checkPassengers` repeats the booking checks for the fare preview. |
| `src/controllers/bookingPreviewController.js` | `GET /api/booking-rules`, `POST /api/bookings/fare-preview` (fare lines from `fn_calculate_fare`), `POST /api/bookings/:pnr/cancel-unpaid` (`sp_cancel_unpaid_booking`). |
| `src/services/paymentOrderService.js` | Payment confirm path. Now stores the real payment method (`methodFromGatewayPayment`), and `expireAbandonedOrders` closes unpaid orders as `EXPIRED` (still checked for 24 hours). |
| `src/controllers/paymentController.js` | `createOrder` reuses the open order of a booking (`reused: true`) and finishes an already-paid one (`alreadyPaid: true`). |
| `src/services/tdrEligibilityService.js` | `GET /api/tdr/eligibility/:pnr` and the plain refusal messages of `POST /api/tdr` (same rules as `sp_file_tdr`). |
| `src/controllers/adminContactController.js`, `adminFareCalcController.js`, `adminQuotaController.js` | Admin: Contact Us messages, the real fare calculator, quota overview. |

Tests: `npm run test:d5` (Live Trains, rules, fare preview, cancel unpaid, real method, one open order, expired orders, signed webhook, reconcile, "backend down while paying", TDR eligibility). It is part of `npm run test:all`.
