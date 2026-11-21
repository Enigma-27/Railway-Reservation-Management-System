-- =====================================================================================
-- RAILWAY RESERVATION & MANAGEMENT SYSTEM - GROUP 3 WORKBENCH QUERIES
-- Module: Coach Layout & Seat Inventory  (COACH, SEAT, SCHEDULE_CLASS_INVENTORY)
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
-- G3-1  |  Paste under chapter 2.3  |  Data dictionary of the group tables
-- RUN: click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT
FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='railway_db' AND TABLE_NAME IN ('COACH','SEAT','SCHEDULE_CLASS_INVENTORY')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- -------------------------------------------------------------------------------------
-- G3-2  |  Paste under chapter 2.3 / 2.5  |  Hierarchy TRAIN -> COACH -> SEAT
-- RUN: click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
SELECT t.train_id, t.train_number, sc.class_code, COUNT(DISTINCT c.coach_id) AS coaches, COUNT(s.seat_id) AS physical_seats
FROM TRAIN t JOIN COACH c ON c.train_id = t.train_id
JOIN SEAT_CLASS sc ON sc.class_id = c.class_id JOIN SEAT s ON s.coach_id = c.coach_id
WHERE t.train_id = 111
GROUP BY t.train_id, t.train_number, sc.class_code ORDER BY sc.class_code;

-- -------------------------------------------------------------------------------------
-- G3-3  |  Paste under chapter 2.5  |  Live availability per run and class (view)
-- RUN: click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
SELECT schedule_id, train_number, journey_date, class_code, total_seats, available_seats,
       rac_count, rac_capacity, wl_count, wl_capacity, seat_booked_pct
FROM vw_available_seats_per_run WHERE train_id = 111 AND journey_date = '2026-10-18';

-- -------------------------------------------------------------------------------------
-- G3-4  |  Paste under chapter 2.4.1  |  Row-level locking: procedures that use SELECT ... FOR UPDATE
-- RUN: click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
SELECT ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.ROUTINES
WHERE ROUTINE_SCHEMA='railway_db' AND ROUTINE_DEFINITION LIKE '%FOR UPDATE%' ORDER BY ROUTINE_NAME;

-- -------------------------------------------------------------------------------------
-- G3-5  |  Paste under chapter 2.4.2 and 3.2  |  Trigger trg_check_seat_overlap blocks an overlapping seat allocation
-- RUN ALONE (error demo): click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
INSERT INTO RESERVATION (res_id, pnr, passenger_no, schedule_id, seat_id, status, queue_position)
SELECT 99999999, pnr, passenger_no, schedule_id, seat_id, 'CONFIRMED', NULL
FROM RESERVATION WHERE status = 'CONFIRMED' AND seat_id IS NOT NULL ORDER BY res_id LIMIT 1;

-- -------------------------------------------------------------------------------------
-- G3-6  |  Paste under chapter 2.4.2 and 3.2  |  Trigger blocks a RAC passenger on a non-side-lower berth
-- RUN ALONE (error demo): click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
INSERT INTO RESERVATION (res_id, pnr, passenger_no, schedule_id, seat_id, status, queue_position)
SELECT 99999998, r.pnr, r.passenger_no, r.schedule_id, (SELECT seat_id FROM SEAT WHERE berth_type='LOWER' LIMIT 1), 'RAC', 'RAC/99'
FROM RESERVATION r WHERE r.status='RAC' LIMIT 1;

