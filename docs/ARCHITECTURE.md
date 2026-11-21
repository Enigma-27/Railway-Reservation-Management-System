# Architecture and flows

Six diagrams, written in Mermaid (GitHub draws them). They describe the code as it is today. Details: `docs/API_CONTRACT.md` (routes), `docs/DATA_SCHEMA.md` (tables), `docs/BUSINESS_RULES.md` (rules).

## 1. System overview

```mermaid
flowchart LR
    subgraph Browser
        L["Landing page + the one sign-in<br/>Train Info, Live Trains, Contact drawer<br/>(React)"]
        P["Passenger portal<br/>(React shell + page controller)"]
        S["Staff portal<br/>(React)"]
        A["Admin portal<br/>(React)"]
    end
    subgraph Server["Backend (Express, port 5000)"]
        API["REST API<br/>/api/..."]
        J["Background jobs<br/>every 60 seconds"]
    end
    MY[("MySQL 8<br/>tables, procedures,<br/>triggers, views")]
    MG[("MongoDB<br/>optional")]
    RZ["Razorpay<br/>(test mode)"]
    L --> API
    P --> API
    S --> API
    A --> API
    API --> MY
    API --> MG
    API --> RZ
    RZ -. webhook .-> API
    J --> MY
    J --> RZ
```

The landing page is the only place to sign in; it stores one session (`rrms_token` and `rrms_user`) that the passenger area, the staff portal and the admin portal all read, and every role shares one theme and one name (RRMS). The three portals only talk to the backend. The backend asks MySQL for everything that moves money or seats, and the rules (quota, promotion, refund) live in MySQL procedures and triggers. MongoDB holds notifications, complaints, live train status, the activity log and raw gateway replies; the system keeps working without it. Razorpay runs in test mode, so no real money moves.

## 2. Booking and payment

```mermaid
sequenceDiagram
    actor U as Passenger
    participant API as Backend
    participant DB as MySQL
    participant RZ as Razorpay
    U->>API: GET /api/trains/search, /availability
    API->>DB: views and fn_calculate_fare
    U->>API: POST /api/bookings
    API->>DB: sp_create_booking (hold, 10 minutes)
    DB-->>API: PNR, PAYMENT_PENDING, fare
    U->>API: POST /api/payments/razorpay/order
    API->>RZ: create order for the database fare
    API->>DB: save PAYMENT_ORDER (CREATED)
    U->>RZ: pay in the checkout window
    U->>API: POST /api/payments/razorpay/verify
    API->>API: check the signature
    API->>DB: sp_confirm_payment
    DB-->>API: CONFIRMED, RAC or WAITING_LIST (or late: refund)
    Note over API,RZ: If the browser closes, reconcile (button or 60 second job)<br/>and the webhook ask Razorpay and call the same sp_confirm_payment
```

The fare always comes from the database, never from the browser. A payment is confirmed only through `sp_confirm_payment`, and one payment id never makes a second ticket. If the payment arrives after the hold, the booking is `FAILED` and the money is refunded in full automatically. The reconcile job, the "Check payment status" button and the webhook all finish an order that `/verify` did not.

## 3. Cancellation and promotion

```mermaid
flowchart TD
    C["Cancel (passenger, staff or admin)<br/>POST /api/bookings/:pnr/cancel"] --> SP["sp_cancel_passenger_ticket<br/>CANCELLATION row + PENDING REFUND row"]
    SP --> TR["trigger trg_after_cancellation_promote"]
    TR --> PR["sp_promote_passenger"]
    PR --> R1["first RAC passenger becomes CONFIRMED<br/>(takes the freed seat)"]
    PR --> R2["first waiting-list passenger becomes RAC"]
    SP --> GW["Backend calls Razorpay for the refund<br/>(see flow 4)"]
    NS["No-show"] --> PR
    TD["Approved TDR"] --> PR
    HR["Expired hold released"] --> PR
```

Promotion has one path: `sp_promote_passenger`. Cancellation, no-show, an approved TDR, a released hold and chart preparation all end there. The website never promotes anybody itself (the old promote route was removed).

## 4. Refund life

```mermaid
stateDiagram-v2
    [*] --> PENDING: SQL writes the refund row
    PENDING --> PROCESSED: gateway done (or cash / seeded / simulated payment)
    PENDING --> FAILED: gateway error
    FAILED --> PROCESSED: retry works
    FAILED --> FAILED: retry fails again
    PROCESSED --> [*]
```

Only `sp_set_refund_result` changes a refund status. A `FAILED` or `PENDING` refund older than 5 minutes is retried every 60 seconds, at most 3 times, and an admin can retry it by hand on the Refund Transactions page. The refund cap counts `PENDING`, `PROCESSED` and `FAILED` rows, so a payment can never be refunded for more than it paid. Money counts as paid out only when the status is `PROCESSED`.

## 5. TDR (Ticket Deposit Receipt)

```mermaid
flowchart TD
    F["Passenger files a TDR<br/>POST /api/tdr"] --> V{"sp_file_tdr checks<br/>owner, reason, no duplicate,<br/>delay or departure, evidence, deadline"}
    V -- refused --> E["400 / 403 / 404 with a plain message"]
    V -- ok --> FILED["TDR status FILED"]
    FILED --> REV["Admin reviews<br/>PUT /api/admin/tdr/:ref"]
    REV -- reject --> REJ["REJECTED, no refund<br/>(the passenger may file again)"]
    REV -- approve --> RV["sp_review_tdr: PENDING refund,<br/>passenger cancelled, queue promoted"]
    RV --> GW["Backend calls Razorpay"]
    GW --> DONE["REFUND_PROCESSED"]
```

A late train (3 hours or more) or a diverted train must be claimed before the train leaves; the other reasons (class downgraded, AC failure, coach not attached, terminated short) need the train to have left and a deadline of 72 hours after arrival. A seat with a TDR refund cannot also be cancelled normally (`REFUND_EXCEEDS_PAYMENT`).

## 6. The 10-minute hold and its release

```mermaid
sequenceDiagram
    participant U as Passenger
    participant DB as MySQL
    participant J as Release job (60 s)
    U->>DB: sp_create_booking (booking PAYMENT_PENDING, seats held)
    Note over DB: HOLD_MINUTES = 10
    alt paid inside 10 minutes
        U->>DB: sp_confirm_payment
        DB-->>U: ticket (CONFIRMED, RAC or WAITING_LIST)
    else not paid
        J->>DB: sp_release_expired_holds
        DB-->>DB: booking FAILED, seats freed, queue promoted
        U->>DB: a payment arrives later
        DB-->>U: automatic full refund (sp_process_late_payment_refund)
    end
```

The hold is the `BOOKING` row itself in `PAYMENT_PENDING`; the table `SEAT_HOLD` exists but no code uses it. `sp_release_expired_holds` takes a database lock, so only one release run works at a time. `GET /api/bookings/:pnr/hold` gives the seconds left for the countdown on screen.

## Final round additions

### Admin delay control

```mermaid
sequenceDiagram
    participant A as Admin (Schedules, Delay)
    participant API as POST /api/admin/schedules/:id/delay
    participant D as TRAIN_SCHEDULE + AUDIT_LOG
    participant P as Public pages
    A->>API: delayMinutes (0 clears), reason
    API->>D: update delay and status, write the audit row
    API-->>A: DELAYED / ON_TIME, passengers notified
    P->>D: GET /api/alerts, GET /api/live-trains (same row)
```

### Public PNR status

`GET /api/pnr-status/:pnr` has no login and returns only the ticket status (never names or contact data). An in-memory limiter allows 15 lookups per minute per address. The landing page and Train Info call it; the full ticket still needs the sign-in.

### demo:clear

`backend/scripts/demo-clear.js` deletes every booking and its dependants in foreign-key order inside one transaction, resets the inventory counters, removes booking notifications from MongoDB and stops with an error unless the inventory audit shows 0 mismatches. `demo:chain` then rebuilds the chain under `chain@rrms.in`.
