-- =====================================================================================
-- RAILWAY RESERVATION & MANAGEMENT SYSTEM - GROUP 6 WORKBENCH QUERIES
-- Module: TC Operations & Ground Reports  (FINE, CROWD_REPORT, CLEANLINESS_REPORT, INCIDENT)
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
-- G6-1  |  Paste under chapter 2.3  |  Data dictionary of the group tables
-- RUN: click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT
FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='railway_db' AND TABLE_NAME IN ('FINE','CROWD_REPORT','CLEANLINESS_REPORT','INCIDENT')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- -------------------------------------------------------------------------------------
-- G6-2  |  Paste under chapter 2.5  |  TC reservation chart (manifest) sorted by coach and seat
-- RUN: click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
SELECT c.coach_code, se.seat_number, se.berth_type, pb.name AS passenger, pb.age, pb.gender, r.status, b.pnr
FROM RESERVATION r JOIN BOOKING b ON b.pnr = r.pnr
JOIN PASSENGER_BOOKING pb ON pb.pnr = r.pnr AND pb.passenger_no = r.passenger_no
JOIN SEAT se ON se.seat_id = r.seat_id JOIN COACH c ON c.coach_id = se.coach_id
WHERE r.schedule_id = 1137 AND r.status IN ('CONFIRMED','BOARDED','NO_SHOW')
ORDER BY c.sequence_number, se.seat_number LIMIT 12;

-- -------------------------------------------------------------------------------------
-- G6-3  |  Paste under chapter 2.4.1  |  Verify ticket -> NO_SHOW (seat released, next RAC promoted) -> boarding refused
-- RUN: select the block, Ctrl+Shift+Enter
-- -------------------------------------------------------------------------------------
-- Story: a no-show on boarding frees the seat and the next RAC passenger becomes CONFIRMED; boarding the no-show is then refused.
START TRANSACTION;
INSERT INTO STAFF_ASSIGNMENT (assign_id, staff_id, schedule_id, station_id, duty_type, shift_start, shift_end)
VALUES (9999, 1, 1137, 10, 'TRAIN_DUTY', '2026-10-19 00:00:00', '2026-10-19 23:59:59');
SELECT status INTO @rac_before FROM RESERVATION WHERE pnr = '2849100985' AND passenger_no = 1;
CALL sp_verify_ticket('2849100701', 1, 1, 1, 0, 'VALID', 'ID checked by TC', 0, @verify_id, @verify_status);
CALL sp_mark_passenger_noshow('2849100701', 1, 1, 0, @ns_status);
CALL sp_board_passenger('2849100701', 1, 1, 0, @board_status);
SELECT @verify_status AS ticket_verification, @ns_status AS no_show_result, @board_status AS board_after_no_show_attempt,
       (SELECT status FROM RESERVATION WHERE pnr = '2849100701' AND passenger_no = 1) AS passenger_state_now,
       (SELECT seat_id FROM RESERVATION WHERE pnr = '2849100701' AND passenger_no = 1) AS seat_id_now,
       @rac_before AS next_rac_before, (SELECT status FROM RESERVATION WHERE pnr = '2849100985' AND passenger_no = 1) AS next_rac_after;
ROLLBACK;

-- -------------------------------------------------------------------------------------
-- G6-4  |  Paste under chapter 2.5  |  Fines, incidents, crowd and cleanliness reports in one list
-- RUN: click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
SELECT 'FINE' AS record_type, fine_id AS id, reason AS detail, CAST(amount AS CHAR) AS value_, issued_at AS at_time FROM FINE
UNION ALL SELECT 'INCIDENT', incident_id, CONCAT(type, ' / ', severity), status, reported_at FROM INCIDENT
UNION ALL SELECT 'CROWD_REPORT', crowd_report_id, CONCAT('Station ', station_id, ' platform ', platform_no), CONCAT(crowd_level, ' (', head_count, ')'), recorded_at FROM CROWD_REPORT
UNION ALL SELECT 'CLEANLINESS', cleanliness_report_id, issue_type, status, recorded_at FROM CLEANLINESS_REPORT;

-- -------------------------------------------------------------------------------------
-- G6-5  |  Paste under chapter 3.2  |  Staff who is not on duty for the train is refused
-- RUN: select the block, Ctrl+Shift+Enter
-- -------------------------------------------------------------------------------------
-- Story: a staff member with no train duty on this run cannot verify tickets or mark no-shows (NOT_ON_DUTY).
START TRANSACTION;
CALL sp_verify_ticket('2849100701', 1, 1, 1, 0, 'VALID', 'x', 0, @v1, @vs1);
CALL sp_mark_passenger_noshow('2849100701', 1, 2, 0, @n2);
SELECT @vs1 AS verify_by_staff_without_train_duty, @n2 AS noshow_by_staff_without_train_duty;
ROLLBACK;

-- NOTE: Group 6 has no trigger of its own in the database, so chapter 2.4.2 has no screenshot from this file.
