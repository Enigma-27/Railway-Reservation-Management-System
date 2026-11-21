-- =====================================================================================
-- RAILWAY RESERVATION & MANAGEMENT SYSTEM - STORY D: CHART PREPARATION
-- Story: at chart time every passenger still on the waiting list is cancelled and refunded
--        (fare minus insurance), the seat counters are fixed, the run is locked, and the
--        chart snapshot is written. Train 119 (Mumbai Tejas Rajdhani) on 2026-10-19,
--        run (schedule) 1111, has a full waiting list in the clean seed.
--
-- BEFORE YOU START:
--   node database/load/run-all.js      (clean seed data; run 1111 exists only there)
-- IN WORKBENCH: open Local instance MySQL80, run  USE railway_db;
--
-- HOW TO RUN: run ONE block at a time, drag-select the whole block, Ctrl+Shift+Enter.
--   D-2 starts a transaction and D-3 ends it with ROLLBACK, so select D-2 and D-3 in one go
--   (or run them one after the other without closing the Workbench tab). If it stops half-way
--   run  ROLLBACK;  and  SET @as_of_time = NULL;
--   Nothing here changes your data: every block is read-only or rolled back.
--
-- This story is NOT for the website. The website demo uses  npm run demo:refresh  and
-- npm run demo:chain  instead (see database/workbench/README.md).
-- =====================================================================================
USE railway_db;

-- Seed clock: the seed is frozen at 2026-10-17 19:15 (the chart of run 1111 is due on 2026-10-19 11:15)
SET @as_of_time = '2026-10-17 19:15:00';

-- -------------------------------------------------------------------------------------
-- D-1  |  BEFORE chart preparation: the run is open, the waiting list is full, nothing is purged yet
-- RUN: select the block, Ctrl+Shift+Enter
-- -------------------------------------------------------------------------------------
SELECT ts.schedule_id, t.train_number, ts.journey_date, ts.departure_time,
       ts.chart_prepared_at AS chart_prepared_at_before
FROM TRAIN_SCHEDULE ts JOIN TRAIN t ON t.train_id = ts.train_id WHERE ts.schedule_id = 1111;

SELECT r.status AS reservation_status, COUNT(*) AS passengers
FROM RESERVATION r WHERE r.schedule_id = 1111 GROUP BY r.status ORDER BY r.status;

SELECT sc.class_code, i.total_seats, i.available_seats, i.rac_capacity, i.rac_count, i.wl_capacity, i.wl_count
FROM SCHEDULE_CLASS_INVENTORY i JOIN SEAT_CLASS sc ON sc.class_id = i.class_id WHERE i.schedule_id = 1111;

SELECT (SELECT COUNT(*) FROM CHART_SNAPSHOT WHERE schedule_id = 1111) AS snapshot_rows_before,
       (SELECT COUNT(*) FROM REFUND WHERE reason = 'WAITLIST_PURGE') AS purge_refunds_before;

-- -------------------------------------------------------------------------------------
-- D-2  |  Run chart preparation (sp_prepare_chart) and see the waiting list purged
-- RUN: select D-2 and D-3 together, Ctrl+Shift+Enter
-- -------------------------------------------------------------------------------------
START TRANSACTION;

-- remember who is on the waiting list now, and what they paid (insurance is never refunded)
DROP TEMPORARY TABLE IF EXISTS tmp_story_d_wl;
CREATE TEMPORARY TABLE tmp_story_d_wl AS
SELECT r.pnr, r.passenger_no, r.queue_position, pb.total_fare, pb.insurance, (pb.total_fare - pb.insurance) AS refundable_fare
FROM RESERVATION r JOIN PASSENGER_BOOKING pb ON pb.pnr = r.pnr AND pb.passenger_no = r.passenger_no
WHERE r.schedule_id = 1111 AND r.status = 'WAITING_LIST';

CALL sp_prepare_chart(1111, 0, @snapshot_rows);

SELECT @snapshot_rows AS snapshot_rows_written, ts.chart_prepared_at AS chart_prepared_at_after
FROM TRAIN_SCHEDULE ts WHERE ts.schedule_id = 1111;

-- Note: chart_prepared_at and the snapshot time show the clock of the computer (sp_prepare_chart uses NOW()); everything else is the seed state.

-- (a) the waiting-list passengers are cancelled, nobody waits any more
SELECT r.status AS reservation_status, COUNT(*) AS passengers
FROM RESERVATION r WHERE r.schedule_id = 1111 GROUP BY r.status ORDER BY r.status;

SELECT COUNT(*) AS waiting_list_passengers_purged,
       SUM(r.status = 'CANCELLED') AS now_cancelled,
       SUM(r.status = 'WAITING_LIST') AS still_waiting
FROM tmp_story_d_wl w JOIN RESERVATION r ON r.pnr = w.pnr AND r.passenger_no = w.passenger_no;

-- (b) one PENDING refund per purged passenger, the total equals fare minus insurance
SELECT COUNT(*) AS purge_refund_rows, SUM(rf.status = 'PENDING') AS pending_rows,
       SUM(rf.amount) AS refunded_total,
       MAX(t.fare_minus_insurance_total) AS fare_minus_insurance_total, MAX(t.insurance_not_refunded) AS insurance_not_refunded
FROM REFUND rf
CROSS JOIN (SELECT SUM(refundable_fare) AS fare_minus_insurance_total, SUM(insurance) AS insurance_not_refunded FROM tmp_story_d_wl) t
WHERE rf.reason = 'WAITLIST_PURGE';

SELECT rf.refund_id, p.pnr, rf.amount AS refund_amount, rf.status AS refund_status, rf.reason
FROM REFUND rf JOIN PAYMENT p ON p.payment_id = rf.payment_id
WHERE rf.reason = 'WAITLIST_PURGE' ORDER BY rf.refund_id LIMIT 5;

-- (c) the seat counters after the purge (waiting list 0, and they agree with the real reservations)
SELECT sc.class_code, i.available_seats, i.rac_count, i.wl_count AS wl_count_after,
       (SELECT COUNT(*) FROM RESERVATION r WHERE r.schedule_id = i.schedule_id AND r.status = 'WAITING_LIST') AS real_waiting_list
FROM SCHEDULE_CLASS_INVENTORY i JOIN SEAT_CLASS sc ON sc.class_id = i.class_id WHERE i.schedule_id = 1111;

-- (d) the chart snapshot: one row per passenger who still travels
SELECT s.status AS snapshot_status, COUNT(*) AS rows_in_snapshot FROM CHART_SNAPSHOT s WHERE s.schedule_id = 1111 GROUP BY s.status;
SELECT s.snapshot_id, s.pnr, s.passenger_no, s.coach_no, s.seat_no, s.berth_type, s.status, s.concession_flag, s.generated_at
FROM CHART_SNAPSHOT s WHERE s.schedule_id = 1111 ORDER BY s.snapshot_id LIMIT 5;

-- (e) new bookings are locked for this run from now on
SELECT 'chart prepared: new bookings and online cancellations on run 1111 are refused (CHART_PREPARED)' AS lock_note;

-- -------------------------------------------------------------------------------------
-- D-3  |  Undo everything (select together with D-2, or run alone if D-2 was run first)
-- RUN: select the block, Ctrl+Shift+Enter
-- -------------------------------------------------------------------------------------
ROLLBACK;
DROP TEMPORARY TABLE IF EXISTS tmp_story_d_wl;
SELECT ts.chart_prepared_at AS chart_prepared_at_after_rollback,
       (SELECT COUNT(*) FROM RESERVATION WHERE schedule_id = 1111 AND status = 'WAITING_LIST') AS waiting_list_after_rollback,
       (SELECT COUNT(*) FROM CHART_SNAPSHOT WHERE schedule_id = 1111) AS snapshot_rows_after_rollback
FROM TRAIN_SCHEDULE ts WHERE ts.schedule_id = 1111;
SET @as_of_time = NULL;
