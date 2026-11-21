-- =====================================================================================
-- RAILWAY RESERVATION & MANAGEMENT SYSTEM - GROUP 7 WORKBENCH QUERIES
-- Module: Operational Analytics, CRM & Audit  (AUDIT_LOG, REPORT; MongoDB: complaints, notifications)
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
-- G7-1  |  Paste under chapter 2.3  |  Data dictionary of the group tables (grievances and notifications are MongoDB: screenshot them from MongoDB Compass)
-- RUN: click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT
FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='railway_db' AND TABLE_NAME IN ('AUDIT_LOG','REPORT')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- -------------------------------------------------------------------------------------
-- G7-2  |  Paste under chapter 2.5  |  Monthly revenue by train type and class with RANK() OVER (PARTITION BY ...)
-- RUN: click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
SELECT DATE_FORMAT(b.created_at, '%Y-%m') AS month, t.train_type, sc.class_code,
       COUNT(DISTINCT b.pnr) AS bookings, ROUND(SUM(pb.total_fare), 2) AS revenue,
       RANK() OVER (PARTITION BY DATE_FORMAT(b.created_at, '%Y-%m') ORDER BY SUM(pb.total_fare) DESC) AS rank_in_month
FROM BOOKING b JOIN PASSENGER_BOOKING pb ON pb.pnr = b.pnr
JOIN TRAIN_SCHEDULE ts ON ts.schedule_id = b.schedule_id
JOIN TRAIN t ON t.train_id = ts.train_id JOIN SEAT_CLASS sc ON sc.class_id = b.class_id
WHERE b.status IN ('CONFIRMED','RAC','WAITING_LIST')
GROUP BY month, t.train_type, sc.class_code
ORDER BY month, rank_in_month LIMIT 12;

-- -------------------------------------------------------------------------------------
-- G7-3  |  Paste under chapter 2.5  |  Occupancy % per run, ranked
-- RUN: click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
SELECT RANK() OVER (ORDER BY occupancy_pct DESC) AS busiest_rank, train_number, train_name, journey_date,
       total_train_capacity, total_seats_booked, occupancy_pct
FROM vw_run_occupancy ORDER BY busiest_rank, schedule_id LIMIT 8;

-- -------------------------------------------------------------------------------------
-- G7-4  |  Paste under chapter 2.5  |  Top busiest trains with RANK and DENSE_RANK
-- RUN: click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
SELECT RANK() OVER (ORDER BY COUNT(pb.passenger_no) DESC) AS rank_pos,
       DENSE_RANK() OVER (ORDER BY COUNT(pb.passenger_no) DESC) AS dense_rank_pos,
       t.train_number, t.display_name AS train_name, t.train_type,
       COUNT(pb.passenger_no) AS total_passengers_booked, ROUND(SUM(pb.total_fare), 2) AS total_revenue
FROM TRAIN t JOIN TRAIN_SCHEDULE ts ON t.train_id = ts.train_id
JOIN BOOKING b ON ts.schedule_id = b.schedule_id JOIN PASSENGER_BOOKING pb ON b.pnr = pb.pnr
JOIN RESERVATION r ON pb.pnr = r.pnr AND pb.passenger_no = r.passenger_no
WHERE r.status IN ('CONFIRMED', 'RAC', 'BOARDED')
GROUP BY t.train_id, t.train_number, t.display_name, t.train_type
ORDER BY rank_pos LIMIT 10;

-- -------------------------------------------------------------------------------------
-- G7-5  |  Paste under chapter 2.4.2 and 3.2  |  Audit trigger: a fare change writes BEFORE/AFTER JSON to AUDIT_LOG, then ROLLBACK
-- RUN: select the block, Ctrl+Shift+Enter
-- -------------------------------------------------------------------------------------
START TRANSACTION;
SELECT rate_per_km INTO @old_rate FROM FARE WHERE fare_id = 1;
UPDATE FARE SET rate_per_km = rate_per_km + 0.10 WHERE fare_id = 1;
SELECT log_id, action, table_name, record_id, old_value, new_value, logged_at FROM AUDIT_LOG ORDER BY log_id DESC LIMIT 1;
ROLLBACK;
SELECT rate_per_km AS rate_after_rollback, @old_rate AS original_rate FROM FARE WHERE fare_id = 1;

-- NOTE: Group 7 has no stored procedure of its own in the database, so chapter 2.4.1 has no screenshot from this file.
