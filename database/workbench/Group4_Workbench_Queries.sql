-- =====================================================================================
-- RAILWAY RESERVATION & MANAGEMENT SYSTEM - GROUP 4 WORKBENCH QUERIES
-- Module: Booking Engine & Payment Ledger  (BOOKING, PASSENGER_BOOKING, PAYMENT)
--
-- BEFORE YOU START (once, by whoever has the project laptop):
--   node database/load/run-all.js      (clean seed data; the fixed PNRs below only exist there)
-- IN WORKBENCH: open Local instance MySQL80, run  USE railway_db;
--
-- HOW TO RUN: run ONE block at a time.
--   * "RUN: select the block, Ctrl+Shift+Enter"  -> drag-select the whole block and press Ctrl+Shift+Enter
--   * "RUN ALONE (error demo)"                   -> click inside that single statement, Ctrl+Enter.
--                                                  Screenshot the Output pane too (the error text is there).
--   * Blocks that start with START TRANSACTION and end with ROLLBACK must be selected completely.
--     If one stops half-way, run  ROLLBACK;  and  SET @as_of_time = NULL;
--   * Nothing here changes your data: read-only, fails on purpose, or rolled back.
--
-- Each block says which chapter of the report the screenshot goes under.
-- =====================================================================================
USE railway_db;

-- -------------------------------------------------------------------------------------
-- G4-1  |  Paste under chapter 2.3  |  Data dictionary of the group tables (long: screenshot in two parts)
-- RUN: click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT
FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='railway_db' AND TABLE_NAME IN ('BOOKING','PASSENGER_BOOKING','PAYMENT')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- -------------------------------------------------------------------------------------
-- G4-2  |  Paste under chapter 2.4.3  |  User-defined functions: fn_calculate_fare and fn_calculate_distance
-- RUN: click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
SELECT pb.pnr, pb.passenger_no, pb.total_fare AS fare_stored_in_db,
       JSON_UNQUOTE(JSON_EXTRACT(fn_calculate_fare(b.class_id, ts.train_id, fn_calculate_distance(b.from_stop_id, b.to_stop_id), b.quota, pb.concession_type, IF(pb.insurance > 0, 1, 0), b.schedule_id), '$.total_fare')) AS fare_from_function,
       fn_calculate_fare(b.class_id, ts.train_id, fn_calculate_distance(b.from_stop_id, b.to_stop_id), b.quota, pb.concession_type, IF(pb.insurance > 0, 1, 0), b.schedule_id) AS breakdown
FROM PASSENGER_BOOKING pb JOIN BOOKING b ON b.pnr = pb.pnr JOIN TRAIN_SCHEDULE ts ON ts.schedule_id = b.schedule_id
WHERE b.status = 'CONFIRMED' ORDER BY pb.pnr LIMIT 3;

-- -------------------------------------------------------------------------------------
-- G4-3  |  Paste under chapter 2.4.1  |  ACID booking transaction: hold -> payment -> CONFIRMED, then ROLLBACK
-- RUN: select the block, Ctrl+Shift+Enter
-- -------------------------------------------------------------------------------------
-- Story: book a seat, hold it, pay, see it CONFIRMED, then undo everything with ROLLBACK
START TRANSACTION;
SET @as_of_time = '2026-10-17 19:15:00';   -- seed clock: without it the run is in the past (JOURNEY_PAST)
SELECT available_seats INTO @seats_before FROM SCHEDULE_CLASS_INVENTORY WHERE schedule_id = 1254 AND class_id = 5;
SET @pass = JSON_ARRAY(JSON_OBJECT('saved_passenger_id', 7, 'name', 'Pooja Verma', 'age', 25, 'gender', 'FEMALE', 'concession_type', 'NONE', 'berth_preference', 'WINDOW'));
CALL sp_create_booking(50001, 1254, 5, 1069, 1076, 'GENERAL', 0, 0, 1, @pass, 'ONLINE', NULL, 0, @pnr, @bk_status, @fare, @err);
SELECT status INTO @status_after_create FROM BOOKING WHERE pnr = @pnr;
SELECT available_seats INTO @seats_held FROM SCHEDULE_CLASS_INVENTORY WHERE schedule_id = 1254 AND class_id = 5;
CALL sp_confirm_payment(@pnr, @fare, 'UPI', CONCAT('pay_demo_', @pnr), 0, @pay_status, @pay_id);
SELECT @pnr AS pnr, @status_after_create AS after_create, (SELECT status FROM BOOKING WHERE pnr = @pnr) AS after_payment,
       @fare AS fare, @pay_status AS payment_result, @pay_id AS payment_id,
       @seats_before AS seats_before, @seats_held AS seats_after_hold,
       (SELECT available_seats FROM SCHEDULE_CLASS_INVENTORY WHERE schedule_id = 1254 AND class_id = 5) AS seats_final,
       (SELECT COUNT(*) FROM RESERVATION WHERE pnr = @pnr) AS reservations;
ROLLBACK;
SET @as_of_time = NULL;
SELECT COUNT(*) AS booking_rows_left_after_rollback FROM BOOKING WHERE pnr = @pnr;

-- -------------------------------------------------------------------------------------
-- G4-4  |  Paste under chapter 3.2  |  Edge case: LADIES quota sold out, error without consent and fallback with consent
-- RUN: select the block, Ctrl+Shift+Enter
-- -------------------------------------------------------------------------------------
-- Story: LADIES quota is full; without consent the booking is refused, with consent it falls back to GENERAL
START TRANSACTION;
SET @as_of_time = '2026-10-17 19:15:00';   -- seed clock: without it the run is in the past (JOURNEY_PAST)
SET @pass = JSON_ARRAY(JSON_OBJECT('saved_passenger_id', 7, 'name', 'Pooja Verma', 'age', 25, 'gender', 'FEMALE', 'concession_type', 'NONE', 'berth_preference', 'WINDOW'));
CALL sp_create_booking(50001, 1254, 5, 1069, 1076, 'LADIES', 0, 0, 0, @pass, 'ONLINE', NULL, 0, @pnr1, @st1, @fare1, @err1);
CALL sp_create_booking(50001, 1254, 5, 1069, 1076, 'LADIES', 1, 0, 0, @pass, 'ONLINE', NULL, 0, @pnr2, @st2, @fare2, @err2);
SELECT 'LADIES full, no consent' AS attempt, @pnr1 AS pnr, @st1 AS status, @err1 AS error_code, NULL AS quota_given
UNION ALL
SELECT 'LADIES full, consent to fallback', @pnr2, @st2, @err2, (SELECT quota FROM BOOKING WHERE pnr = @pnr2);
ROLLBACK;
SET @as_of_time = NULL;

-- NOTE: Group 4 has no trigger of its own; trg_check_seat_overlap (Group 3) fires on every reservation row that G4-3 creates.
