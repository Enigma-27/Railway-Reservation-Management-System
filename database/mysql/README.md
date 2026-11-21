# MySQL Database Setup & Execution Guide

This document outlines the execution order for the SQL files in MySQL Workbench, testing workflows, master data reload procedures, and transaction conventions for backend developers.

---

## 1. File Execution Order in MySQL Workbench

When executing the SQL scripts manually in MySQL Workbench (or CLI), run them in the following sequence:

1. **`01_schema.sql`**
   - Creates the database `railway_db` and all 38 relational tables with primary keys, foreign keys, CHECK constraints, and indexes. The ids of `RESERVATION`, `PAYMENT`, `REFUND`, `CANCELLATION`, `TICKET_VERIFICATION` and `CHART_SNAPSHOT` are `AUTO_INCREMENT`.
2. **`02_functions.sql`**
   - Installs deterministic user-defined functions:
     - `fn_calculate_distance` (route stop distance calculation with 100km minimum per BR-F1)
     - `fn_calculate_fare` (itemized fare breakdown; reads `FARE`, `CONCESSION_RULE` and the `SETTING` keys `GST_RATE_AC`, `INSURANCE_PREMIUM_PER_PASSENGER`, `DYNAMIC_FARE_ENABLED`, `CONCESSION_SENIOR_ENABLED`; reservation, superfast and Tatkal percent are still built into the function)
     - `fn_check_monthly_ticket_limit` & `fn_get_user_monthly_ticket_count` (monthly PNR limits per BR-B15)
     - `fn_calculate_cancellation_refund` (refund slab calculations based on origin departure per BR-R1, BR-R2, BR-R5, BR-R6; reads `REFUND_RULE` per class and `SETTING.CLERKAGE_PER_PASSENGER`)
     - `fn_get_setting`, `fn_setting_value_valid` (read a setting; refuse values that would break the money maths), `fn_pick_refund_payment`, `fn_refund_room` (refund cap)
3. **`03_procedures.sql`**
   - Installs the 15 stored procedures for booking, payment, cancellation, TDR, chart preparation, ticket collector operations, and promotions:
     - `sp_create_booking` / `sp_create_counter_booking`
     - `sp_confirm_payment`
     - `sp_release_expired_holds`
     - `sp_cancel_passenger_ticket`
     - `sp_prepare_chart`
     - `sp_verify_ticket`, `sp_board_passenger`, `sp_mark_passenger_noshow` (ticket collector actions; staff must have a `TRAIN_DUTY` row for the run)
     - `sp_file_tdr`, `sp_review_tdr` (file a TDR; approve with refund, cancellation and promotion, or reject)
     - `sp_promote_passenger`
     - `sp_process_late_payment_refund`
     - `sp_set_refund_result`, `sp_set_payment_order_result` (the only ways a refund or a payment order changes status; an order can now also be `EXPIRED`)
     - `sp_cancel_unpaid_booking` (the passenger gives up a booking that is still `PAYMENT_PENDING`: seats released and promoted, booking `FAILED`)
     - `sp_release_expired_holds` takes the lock `release_expired_holds`, so only one release run works at a time
4. **`04_triggers.sql`**
   - Attaches triggers for seat segment overlap prevention (`trg_check_seat_overlap`), automated cancellation promotion (`trg_after_cancellation_promote`), audit logging (`trg_audit_fare_change`, `trg_audit_concession_change`, `trg_audit_refund_rule_change`, `trg_audit_setting_change`), the refund cap (`trg_refund_cap`) and setting validation (`trg_validate_setting_insert`, `trg_validate_setting_update`).
5. **`05_views.sql`**
   - Creates the 6 analytical and operational views (the sixth is `vw_refund_payout_summary`):
     - `vw_available_seats_per_run`
     - `vw_booking_summary`
     - `vw_run_occupancy`
     - `vw_tdr_refund_summary`
     - `vw_train_master_schedule`
6. **`06_reports.sql`**
   - Contains the 5 window-function analytical queries (Top Busiest Trains, Top Routes, Station Boardings, Class Revenue Share, Quota Utilization).

---

## 2. Automated Master Pipeline & Test Suite Execution

All seed loading, schema migrations, and test harness routines are orchestrated via Node.js scripts in `database/load/`.

### 2.1 Complete Master Reload (Clean Database + Tests Cleaned Up)
To reload MySQL tables, load seed data, run the test suite, drop test harness objects, and load MongoDB collections:
```bash
node database/load/run-all.js
```
*Guarantees: Drops test procedures and `test_results` table at the end, leaving exactly 44 database objects (38 base tables + 6 views). The `AUTO_INCREMENT` counters are put back to MAX + 1 after the tests.*

### 2.2 Running with Test Harness Preserved
To run the master pipeline and keep the test procedures and `test_results` table available for inspection in Workbench:
```bash
node database/load/run-all.js --with-tests
```
After running this, execute:
```sql
CALL sp_run_all_tests();
SELECT * FROM test_results;
```

---

### 2.3 Changing only the database code, and migrations
```bash
node database/load/apply-sql.js 02_functions 03_procedures 04_triggers 05_views
node database/load/apply-sql.js 07_tests --run-tests     # 66 tests; they roll back their own changes
```
The 66 tests are the 53 older ones plus 13 new ones: `sp_verify_ticket` (valid, not on duty, ID not checked), `sp_board_passenger` (CONFIRMED, RAC with inventory, blocked by an open delay TDR), `sp_mark_passenger_noshow` (seat freed and RAC promoted, second mark refused), `sp_prepare_chart` (snapshot contents, waiting-list purge with full PENDING refunds), a DIVYAANG and a SENIOR_CITIZEN fare with exact numbers, and the four audit triggers (one UPDATE each writes one `AUDIT_LOG` row).
`apply-sql.js` replaces functions, procedures, triggers, views and test objects. It never drops tables or reloads data. The tests expect the plain seed (fixed PNRs and run ids), so run them on a freshly loaded database.

Migrations for an existing database (run once, in order, then apply the routines): `migrations/01_make_saved_passenger_id_nullable.sql`, `02_refund_status_columns.sql`, `03_payment_order.sql`, `04_auto_increment_ids.sql` (ids from MAX+1 to `AUTO_INCREMENT`), `05_refund_rule_class.sql` (per-class refund rules), `06_rule_table_checks.sql` (CHECK constraints on the rule tables).

### 2.3a Workbench guide: the per-group query files
The Group 1 to Group 7 query files are in `database/workbench/` (`Group1_Workbench_Queries.sql` to `Group7_Workbench_Queries.sql`). **Run the Workbench stories on a freshly loaded seed (`node database/load/run-all.js`); the website stories need `demo:refresh` + `demo:chain` instead.** The stories that need the seed clock set `@as_of_time` themselves (and reset it to NULL at the end), so they work on any real date. Group 5 holds the cancellation chain (RAC to CONFIRMED, WL to RAC) and the approved-TDR chain, Group 6 the no-show on boarding, Group 4 the ladies quota full with GENERAL fallback. Chart preparation with the waiting-list purge is shown by the SQL test `test_story_4` (Train 119, run 1111), not by a Workbench file.

### 2.4 Admin-editable rule tables now drive the numbers
Changing `FARE`, `CONCESSION_RULE`, `REFUND_RULE` or the `SETTING` keys listed above changes the next fare or refund (the seed values reproduce the old built-in numbers exactly). Still built into the functions: reservation charge and superfast charge per class, the Tatkal percent (30 AC, 10 non-AC), the GST rule "AC classes only", the dynamic-fare threshold (80 percent) and multiplier (1.5), the Tatkal no-refund rule, and the clerkage rule for RAC/WL (only the amount is a setting).

---

## 3. Important Transaction Calling Convention for Backend Developers

All core stored procedures feature an explicit transaction control parameter:
```sql
IN p_manage_tx TINYINT(1)
```

### Backend Usage Rule:
- When calling stored procedures directly from an application backend (e.g., Express.js, NestJS, FastAPI) with **autocommit enabled** (no external `START TRANSACTION`), the backend **MUST pass `p_manage_tx = 1`**.
  - Example: `CALL sp_create_booking(..., 1, @out_pnr, @out_stat, @out_fare, @out_err);`
  - When `p_manage_tx = 1`, the procedure starts its own transaction and commits on success or rolls back on exception.
- When calling stored procedures inside an outer transaction managed by the caller (or within test suites), pass **`p_manage_tx = 0`**.
  - This ensures the procedure participates safely in the caller's transaction without issuing unintended `COMMIT` or `ROLLBACK` commands.

---

## 4. Quota Allocation & Capacity Rules (BR-Q10, BR-Q11)

For every train run and travel class, capacity is partitioned across quotas per `BR-Q10`:
- **`LADIES`**: 10% of class total seats (rounded to nearest whole integer).
- **`TATKAL`**: 10% of class total seats (rounded to nearest whole integer).
- **`DIVYAANG`**: Dedicated 4-seat block per train for classes 3A (class 3), Sleeper (class 4), CC (class 5), and 2S (class 7); 0 for other classes.
- **`SENIOR_CITIZEN`**: Dedicated lower-berth block based on coach count:
  - Sleeper (SL, class 4): 6 berths per coach
  - AC 3 Tier (3A, class 3): 4 berths per coach
  - AC 2 Tier (2A, class 2): 3 berths per coach
  - Other classes: 0 berths
- **`GENERAL`**: Remainder seats = `total_seats - (TATKAL + LADIES + DIVYAANG + SENIOR_CITIZEN)`.

### Operational Rule on Quota Free Seats:
Prior to chart preparation, unsold seats in reserved quotas (TATKAL, LADIES, SENIOR_CITIZEN, DIVYAANG) remain strictly reserved for those quotas. A `GENERAL` booking is validated and counted against GENERAL's own free seats (`GENERAL capacity - GENERAL booked confirmed`), not the aggregate class `available_seats`. If GENERAL free confirmed seats reach 0, new GENERAL bookings automatically flow to RAC (or Waiting List if RAC is full) per `BR-Q12`, `BR-W1`. Unsold reserved quota seats merge into `GENERAL` only at chart preparation time per `BR-Q11` and `BR-B16`.

---

## 5. Dates & Timestamp Handling (Backend Rule)

### Critical Backend Requirement:
When connecting to MySQL, the backend application driver (e.g., `mysql2`, TypeORM, Prisma, Sequelize, Knex, or raw connection pools) **MUST configure `dateStrings: true`** (or equivalent custom type-casting for `DATE` and `DATETIME` columns).

### Rationale:
By default, JavaScript database drivers convert MySQL `DATE` and `DATETIME` columns into JavaScript `Date` objects in UTC. Because Indian Standard Time (IST) is UTC+05:30, converting a date string like `'2026-10-18'` (stored as `2026-10-18 00:00:00`) into a JavaScript `Date` causes the driver to subtract 5 hours 30 minutes, producing `'2026-10-17T18:30:00.000Z'` and shifting the date backwards by one day.
- **Rule**: Always retrieve `DATE`, `DATETIME`, and `TIMESTAMP` columns as raw strings (e.g., `'2026-10-18'` and `'2026-10-18 12:45:00'`), never as native JavaScript `Date` objects.
