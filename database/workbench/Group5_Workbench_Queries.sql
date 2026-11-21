-- =====================================================================================
-- RAILWAY RESERVATION & MANAGEMENT SYSTEM - GROUP 5 WORKBENCH QUERIES
-- Module: Cancellation, RAC Promotion & TDR  (CANCELLATION, TDR_FILING, REFUND)
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
-- G5-1  |  Paste under chapter 2.3  |  Data dictionary of the group tables
-- RUN: click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT
FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='railway_db' AND TABLE_NAME IN ('CANCELLATION','TDR_FILING','REFUND')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- -------------------------------------------------------------------------------------
-- G5-2  |  Paste under chapter 2.4.3  |  User-defined function: fn_calculate_cancellation_refund
-- RUN: select the block, Ctrl+Shift+Enter
-- -------------------------------------------------------------------------------------
SET @as_of_time = '2026-10-17 19:15:00';
SELECT '2849100146' AS pnr, 1 AS passenger_no, fn_calculate_cancellation_refund('2849100146', 1, @as_of_time) AS refund_preview;
SET @as_of_time = NULL;

-- -------------------------------------------------------------------------------------
-- G5-3  |  Paste under chapter 2.4.1 and 2.4.2  |  Cancel a ticket: RAC -> CONFIRMED and WL -> RAC (trigger trg_after_cancellation_promote), refund row, soft delete
-- RUN: select the block, Ctrl+Shift+Enter
-- -------------------------------------------------------------------------------------
-- Story: one cancellation moves the whole chain: RAC -> CONFIRMED and WL -> RAC. The refund starts PENDING (the gateway step makes it PROCESSED).
START TRANSACTION;
SET @as_of_time = '2026-10-17 19:15:00';
SELECT CONCAT(status, IFNULL(CONCAT(' (', queue_position, ')'), '')) INTO @c_before FROM RESERVATION WHERE pnr = '2849100146' AND passenger_no = 1;
SELECT CONCAT(status, IFNULL(CONCAT(' (', queue_position, ')'), '')) INTO @r_before FROM RESERVATION WHERE pnr = '2849100410' AND passenger_no = 1;
SELECT CONCAT(status, IFNULL(CONCAT(' (', queue_position, ')'), '')) INTO @w_before FROM RESERVATION WHERE pnr = '2849100474' AND passenger_no = 1;
CALL sp_cancel_passenger_ticket('2849100146', 1, 'PLANS_CHANGED', 0, @charge, @refund, @cstatus);
SELECT 'Passenger who cancels' AS who, '2849100146' AS pnr, @c_before AS before_cancel,
       (SELECT CONCAT(status, IFNULL(CONCAT(' (', queue_position, ')'), '')) FROM RESERVATION WHERE pnr = '2849100146' AND passenger_no = 1) AS after_cancel
UNION ALL
SELECT 'Next in line: RAC passenger', '2849100410', @r_before,
       (SELECT CONCAT(status, IFNULL(CONCAT(' (', queue_position, ')'), '')) FROM RESERVATION WHERE pnr = '2849100410' AND passenger_no = 1)
UNION ALL
SELECT 'Next in line: Waiting-list passenger', '2849100474', @w_before,
       (SELECT CONCAT(status, IFNULL(CONCAT(' (', queue_position, ')'), '')) FROM RESERVATION WHERE pnr = '2849100474' AND passenger_no = 1);
SELECT c.cancel_id, c.pnr, c.passenger_no, c.reason, c.charge, r.refund_id, r.amount AS refund_amount, r.reason AS refund_reason, r.status AS refund_status
FROM CANCELLATION c LEFT JOIN REFUND r ON r.cancel_id = c.cancel_id WHERE c.pnr = '2849100146';
-- Soft delete: the cancelled passenger's row is KEPT (status CANCELLED, seat released), never DELETEd
SELECT pnr, passenger_no, status, seat_id FROM RESERVATION WHERE pnr = '2849100146' AND passenger_no = 1;
ROLLBACK;
SET @as_of_time = NULL;

-- -------------------------------------------------------------------------------------
-- G5-4  |  Paste under chapter 2.4.1  |  TDR filed and approved by admin: refund row and promotion chain
-- RUN: select the block, Ctrl+Shift+Enter
-- -------------------------------------------------------------------------------------
-- Story: an approved TDR (train late over 3 hours) cancels the passenger, writes a PENDING refund and moves the same RAC -> CONFIRMED and WL -> RAC chain.
START TRANSACTION;
SET @as_of_time = '2026-10-18 10:00:00';
UPDATE TRAIN_SCHEDULE SET delay_minutes = 200 WHERE schedule_id = 1147;
SELECT CONCAT(status, IFNULL(CONCAT(' (', queue_position, ')'), '')) INTO @c_before FROM RESERVATION WHERE pnr = '2849101269' AND passenger_no = 1;
SELECT CONCAT(status, IFNULL(CONCAT(' (', queue_position, ')'), '')) INTO @r_before FROM RESERVATION WHERE pnr = '2849101529' AND passenger_no = 1;
SELECT CONCAT(status, IFNULL(CONCAT(' (', queue_position, ')'), '')) INTO @w_before FROM RESERVATION WHERE pnr = '2849101593' AND passenger_no = 1;
CALL sp_file_tdr('2849101269', 1, 9625, 'TRAIN_DELAYED_OVER_3_HOURS', 'DELAY-NOTICE', 'Train delayed over 3 hours', 0, @tdr_ref, @file_status);
CALL sp_review_tdr(@tdr_ref, 1, 'APPROVED', 600.00, 'Approved by admin', 0, @refund_id, @review_status);
SELECT t.tdr_ref_no, @file_status AS filing_result, @review_status AS review_result, t.status AS tdr_status,
       r.refund_id, r.reason AS refund_reason, r.amount AS refund_amount, r.status AS refund_status
FROM TDR_FILING t LEFT JOIN REFUND r ON r.tdr_ref_no = t.tdr_ref_no WHERE t.tdr_ref_no = @tdr_ref;
SELECT 'Passenger with approved TDR' AS who, '2849101269' AS pnr, @c_before AS before_tdr,
       (SELECT CONCAT(status, IFNULL(CONCAT(' (', queue_position, ')'), '')) FROM RESERVATION WHERE pnr = '2849101269' AND passenger_no = 1) AS after_tdr
UNION ALL SELECT 'Next in line: RAC passenger', '2849101529', @r_before, (SELECT CONCAT(status, IFNULL(CONCAT(' (', queue_position, ')'), '')) FROM RESERVATION WHERE pnr = '2849101529' AND passenger_no = 1)
UNION ALL SELECT 'Next in line: Waiting-list passenger', '2849101593', @w_before, (SELECT CONCAT(status, IFNULL(CONCAT(' (', queue_position, ')'), '')) FROM RESERVATION WHERE pnr = '2849101593' AND passenger_no = 1);
ROLLBACK;
SET @as_of_time = NULL;

-- -------------------------------------------------------------------------------------
-- G5-5  |  Paste under chapter 3.2  |  Edge cases: cancel too late, cancel twice, TDR not eligible, TDR by another user
-- RUN: select the block, Ctrl+Shift+Enter
-- -------------------------------------------------------------------------------------
-- Story: five refusals in one block (the first one is CHART_PREPARED because the clock is 6 hours before departure).
START TRANSACTION;
SET @as_of_time = '2026-10-18 12:00:00';
CALL sp_cancel_passenger_ticket('2849100146', 1, 'PLANS_CHANGED', 0, @c1, @r1, @s1);
SET @as_of_time = '2026-10-17 19:15:00';
CALL sp_cancel_passenger_ticket('2849100146', 1, 'PLANS_CHANGED', 0, @c2, @r2, @s2);
CALL sp_cancel_passenger_ticket('2849100146', 1, 'PLANS_CHANGED', 0, @c3, @r3, @s3);
CALL sp_file_tdr('2849101269', 1, 9625, 'TRAIN_DELAYED_OVER_3_HOURS', 'X', 'delay not enough', 0, @t4, @s4);
CALL sp_file_tdr('2849101269', 1, 1, 'TRAIN_DELAYED_OVER_3_HOURS', 'X', 'wrong owner', 0, @t5, @s5);
SELECT 'Cancel 6 hours before departure' AS test_case, @s1 AS result UNION ALL
SELECT 'Cancel 24 hours before departure', @s2 UNION ALL
SELECT 'Cancel the same passenger again', @s3 UNION ALL
SELECT 'TDR for a train that is not delayed', @s4 UNION ALL
SELECT 'TDR filed by a different user', @s5;
ROLLBACK;
SET @as_of_time = NULL;

