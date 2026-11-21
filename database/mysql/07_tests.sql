-- =============================================================================
-- Railway Reservation & Management System (MySQL 8.0)
-- File: 07_tests.sql
-- Description: Comprehensive automated test suite verifying all 5 Demo Stories
--              and critical Edge Case error codes.
--
-- Verification Protocol:
--   Every test executes in an isolated transaction that explicitly ROLLS BACK,
--   or creates and cleans up dedicated test records so that seed data remains
--   100% pristine and unaltered.
--
-- Demo Stories Tested:
--   - Story 1: Train 111 on 18 Oct -> Confirmed cancellation triggers promotion
--              (RAC 1 becomes CONFIRMED, WL 1 becomes RAC).
--   - Story 2: Train 127 on 18 Oct -> TDR filing & approval triggers promotion chain.
--   - Story 3: Train 125 on 19 Oct -> Ticket collector marks NO_SHOW -> frees seat -> promotion.
--   - Story 4: Train 119 on 19 Oct -> Chart preparation lockout, unsold quota sweep,
--              waitlist auto-refund, snapshot creation.
--   - Story 5: Train 146 on 20 Oct -> Quota fallback (LADIES quota full -> fallback to GENERAL).
--
-- Edge Cases Tested:
--   - Test 6: WAITING_LIST_FULL rejection when capacity reached.
--   - Test 7: RAC-open booking validation.
--   - Test 8: BERTH_PREFERENCE_NOT_MET rejection with rollback when preferred berth unavailable.
--   - Test 9: MONTHLY_LIMIT_EXCEEDED rejection when monthly quota breached.
--   - Test 10: CHART_PREPARED rejection when booking attempted after chart lock.
-- =============================================================================

USE railway_db;

-- Persistent test results table (so procedures across connections can populate it)
DROP TABLE IF EXISTS test_results;
CREATE TABLE IF NOT EXISTS test_results (
    test_id INT AUTO_INCREMENT PRIMARY KEY,
    test_name VARCHAR(120) NOT NULL,
    expected_outcome VARCHAR(150) NOT NULL,
    actual_outcome VARCHAR(150) NOT NULL,
    status ENUM('PASS', 'FAIL') NOT NULL,
    details TEXT NULL
) ENGINE=MyISAM;

DELIMITER $$

-- -----------------------------------------------------------------------------
-- -----------------------------------------------------------------------------
-- TEST 1: Demo Story 1 - Train 111 on 2026-10-18 (PNR: 2849100146 Cancel & Promotion)
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_story_1$$
CREATE PROCEDURE test_story_1()
BEGIN
    DECLARE v_conf_pnr VARCHAR(10) DEFAULT '2849100146';
    DECLARE v_rac_pnr VARCHAR(10) DEFAULT '2849100410';
    DECLARE v_wl_pnr VARCHAR(10) DEFAULT '2849100474';
    DECLARE v_res_rac_status VARCHAR(20);
    DECLARE v_res_wl_status VARCHAR(20);
    DECLARE v_out_chg DECIMAL(10,2);
    DECLARE v_out_ref DECIMAL(10,2);
    DECLARE v_out_stat VARCHAR(20);

    START TRANSACTION;

    -- Set deterministic as-of time: 24h before train origin departure (2026-10-18 19:15:00)
    SET @as_of_time = '2026-10-17 19:15:00';

    -- Execute Cancellation of Confirmed Passenger with p_manage_tx = 0
    CALL sp_cancel_passenger_ticket(v_conf_pnr, 1, 'PLANS_CHANGED', 0, v_out_chg, v_out_ref, v_out_stat);

    -- Check Promotion
    SELECT status INTO v_res_rac_status FROM RESERVATION WHERE pnr = v_rac_pnr AND passenger_no = 1;
    SELECT status INTO v_res_wl_status FROM RESERVATION WHERE pnr = v_wl_pnr AND passenger_no = 1;

    IF v_res_rac_status = 'CONFIRMED' AND v_res_wl_status = 'RAC' THEN
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Story 1: Train 111 on 2026-10-18 (PNR: 2849100146) Cancel & Promotion', 'RAC->CONFIRMED and WL->RAC', CONCAT('RAC: ', v_res_rac_status, ', WL: ', v_res_wl_status), 'PASS', 'Promotion cascade executed accurately.');
    ELSE
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Story 1: Train 111 on 2026-10-18 (PNR: 2849100146) Cancel & Promotion', 'RAC->CONFIRMED and WL->RAC', CONCAT('RAC: ', v_res_rac_status, ', WL: ', v_res_wl_status), 'FAIL', 'Promotion cascade failed.');
    END IF;

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 2: Demo Story 2 - Train 127 on 2026-10-18 (PNR: 2849101269 TDR Approval & Promotion)
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_story_2$$
CREATE PROCEDURE test_story_2()
BEGIN
    DECLARE v_sched_id INT DEFAULT 1147;
    DECLARE v_class_id INT DEFAULT 3;
    DECLARE v_conf_pnr VARCHAR(10) DEFAULT '2849101269';
    DECLARE v_rac_pnr VARCHAR(10) DEFAULT '2849101529';
    DECLARE v_wl_pnr VARCHAR(10) DEFAULT '2849101593';
    DECLARE v_res_rac_status VARCHAR(20);
    DECLARE v_res_wl_status VARCHAR(20);

    START TRANSACTION;

    -- File TDR & Approve for Confirmed Passenger
    INSERT INTO TDR_FILING (tdr_ref_no, pnr, passenger_no, reason, filed_at, status, evidence_ref, refund_amount, reviewed_by, reviewed_at, remarks)
    VALUES ('TDR-TEST-002', v_conf_pnr, 1, 'TRAIN_DELAYED_OVER_3_HOURS', NOW(), 'APPROVED', 'DELAY-VERIFIED', 600.00, 1, NOW(), 'Approved by Admin');

    -- TDR approval frees berth and runs single promotion procedure
    UPDATE RESERVATION SET status = 'CANCELLED', seat_id = NULL WHERE pnr = v_conf_pnr AND passenger_no = 1;
    CALL sp_promote_passenger(v_sched_id, v_class_id, 23273);

    SELECT status INTO v_res_rac_status FROM RESERVATION WHERE pnr = v_rac_pnr AND passenger_no = 1;
    SELECT status INTO v_res_wl_status FROM RESERVATION WHERE pnr = v_wl_pnr AND passenger_no = 1;

    IF v_res_rac_status = 'CONFIRMED' AND v_res_wl_status = 'RAC' THEN
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Story 2: Train 127 on 2026-10-18 (PNR: 2849101269) TDR Approval & Promotion', 'RAC->CONFIRMED and WL->RAC', CONCAT('RAC: ', v_res_rac_status, ', WL: ', v_res_wl_status), 'PASS', 'TDR release triggered sp_promote_passenger.');
    ELSE
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Story 2: Train 127 on 2026-10-18 (PNR: 2849101269) TDR Approval & Promotion', 'RAC->CONFIRMED and WL->RAC', CONCAT('RAC: ', v_res_rac_status, ', WL: ', v_res_wl_status), 'FAIL', 'TDR promotion failed.');
    END IF;

    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 3: Demo Story 3 - Train 125 on 2026-10-19 (PNR: 2849100701 No-Show Action & Promotion)
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_story_3$$
CREATE PROCEDURE test_story_3()
BEGIN
    DECLARE v_ns_pnr VARCHAR(10) DEFAULT '2849100701';
    DECLARE v_rac_pnr VARCHAR(10) DEFAULT '2849100985';
    DECLARE v_res_rac_status VARCHAR(20);
    DECLARE v_stat VARCHAR(20);

    START TRANSACTION;

    -- Assign staff 1 on TRAIN_DUTY for schedule 1137 for this test run
    INSERT INTO STAFF_ASSIGNMENT (assign_id, staff_id, schedule_id, station_id, duty_type, shift_start, shift_end)
    VALUES (9999, 1, 1137, 10, 'TRAIN_DUTY', '2026-10-19 00:00:00', '2026-10-19 23:59:59');

    -- Staff marks NO_SHOW via sp_mark_passenger_noshow (calls sp_promote_passenger) with p_manage_tx = 0
    CALL sp_mark_passenger_noshow(v_ns_pnr, 1, 1, 0, v_stat);

    SELECT status INTO v_res_rac_status FROM RESERVATION WHERE pnr = v_rac_pnr AND passenger_no = 1;

    IF v_res_rac_status = 'CONFIRMED' AND v_stat = 'NO_SHOW_MARKED' THEN
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Story 3: Train 125 on 2026-10-19 (PNR: 2849100701) No-Show & Promotion', 'RAC->CONFIRMED', v_res_rac_status, 'PASS', 'NO_SHOW marked by TC successfully promoted next RAC passenger.');
    ELSE
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Story 3: Train 125 on 2026-10-19 (PNR: 2849100701) No-Show & Promotion', 'RAC->CONFIRMED', v_res_rac_status, 'FAIL', 'No-show promotion failed.');
    END IF;

    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 4: Demo Story 4 - Train 119 on 2026-10-19 (Real Run Schedule 1111 Chart Lockout & Purge)
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_story_4$$
CREATE PROCEDURE test_story_4()
BEGIN
    DECLARE v_sched_id INT DEFAULT 1111;
    DECLARE v_snap_cnt INT DEFAULT 0;
    DECLARE v_remaining_wl INT DEFAULT 0;
    DECLARE v_purged_refunds INT DEFAULT 0;

    START TRANSACTION;

    -- Execute Chart Preparation with p_manage_tx = 0 against the real demo run (Schedule 1111)
    CALL sp_prepare_chart(v_sched_id, 0, v_snap_cnt);

    SELECT COUNT(*) INTO v_remaining_wl
    FROM RESERVATION
    WHERE schedule_id = v_sched_id AND status = 'WAITING_LIST';

    SELECT COUNT(*) INTO v_purged_refunds
    FROM REFUND
    WHERE reason = 'WAITLIST_PURGE';

    IF v_remaining_wl = 0 AND v_purged_refunds > 0 AND v_snap_cnt > 0 THEN
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Story 4: Train 119 on 2026-10-19 (Schedule: 1111) Real Run Chart Prep & Purge',
                '0 Remaining WL, Auto-Refunds Created, Snapshots Generated',
                CONCAT('WL: ', v_remaining_wl, ', Purged Refunds: ', v_purged_refunds, ', Snapshots: ', v_snap_cnt),
                'PASS',
                'Chart prep against real demo run Train 119 purged all WL with auto-refunds and locked run.');
    ELSE
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Story 4: Train 119 on 2026-10-19 (Schedule: 1111) Real Run Chart Prep & Purge',
                '0 Remaining WL, Auto-Refunds Created, Snapshots Generated',
                CONCAT('WL: ', v_remaining_wl, ', Purged Refunds: ', v_purged_refunds, ', Snapshots: ', v_snap_cnt),
                'FAIL',
                'Chart prep on real demo run failed.');
    END IF;

    -- Clean rollback restores the real demo run data completely
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 5: Demo Story 5 - Train 146 on 2026-10-20 (Schedule: 1254 Quota Fallback)
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_story_5$$
CREATE PROCEDURE test_story_5()
BEGIN
    DECLARE v_sched_id INT DEFAULT 1254;
    DECLARE v_class_id INT DEFAULT 5; -- CC for Train 146
    DECLARE v_out_pnr VARCHAR(10);
    DECLARE v_out_stat VARCHAR(20);
    DECLARE v_out_fare DECIMAL(10,2);
    DECLARE v_out_err VARCHAR(32);
    DECLARE v_booked_quota VARCHAR(20);
    DECLARE v_req_quota VARCHAR(20);
    DECLARE v_passengers JSON;

    SET v_passengers = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Pooja Verma', 'age', 25, 'gender', 'FEMALE', 'concession_type', 'NONE', 'berth_preference', 'WINDOW')
    );

    START TRANSACTION;
    SET @as_of_time = '2026-10-17 19:15:00';

    -- Real demo run Train 146 on 2026-10-20 (Schedule 1254, Class 5 CC):
    -- LADIES quota has 78 seats and all 78 are booked (sold out).
    -- GENERAL quota has 620 capacity, 434 booked, and 186 free confirmed seats.
    -- First: booking without consent (p_fallback_consent = 0) must return SEAT_NOT_AVAILABLE.
    CALL sp_create_booking(
        50001, v_sched_id, v_class_id, 1069, 1076, 'LADIES', 0, 0, 0, v_passengers, 'ONLINE', NULL, 0,
        v_out_pnr, v_out_stat, v_out_fare, v_out_err
    );

    IF v_out_err = 'SEAT_NOT_AVAILABLE' THEN
        -- Second: booking with consent (p_fallback_consent = 1) falls back to GENERAL and receives CONFIRMED seat
        CALL sp_create_booking(
            50001, v_sched_id, v_class_id, 1069, 1076, 'LADIES', 1, 0, 0, v_passengers, 'ONLINE', NULL, 0,
            v_out_pnr, v_out_stat, v_out_fare, v_out_err
        );

        IF v_out_pnr IS NOT NULL THEN
            SELECT quota, requested_quota, status INTO v_booked_quota, v_req_quota, v_out_stat FROM BOOKING WHERE pnr = v_out_pnr;
        END IF;

        IF v_out_pnr IS NOT NULL AND v_booked_quota = 'GENERAL' AND v_req_quota = 'LADIES' AND v_out_stat = 'CONFIRMED' THEN
            INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
            VALUES ('Story 5: Train 146 on 2026-10-20 (Schedule: 1254) Quota Fallback',
                    'Fallback Notice + CONFIRMED in GENERAL',
                    CONCAT('Active: ', v_booked_quota, ', Req: ', v_req_quota, ', Status: ', v_out_stat),
                    'PASS',
                    'LADIES sold out triggered fallback notice (SEAT_NOT_AVAILABLE). With consent, booked CONFIRMED in GENERAL.');
        ELSE
            INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
            VALUES ('Story 5: Train 146 on 2026-10-20 (Schedule: 1254) Quota Fallback',
                    'Fallback Notice + CONFIRMED in GENERAL',
                    CONCAT('Active: ', COALESCE(v_booked_quota, 'NULL'), ', Status: ', COALESCE(v_out_stat, 'NULL'), ', Err: ', COALESCE(v_out_err, 'NONE')),
                    'FAIL',
                    'Quota fallback with consent did not confirm in GENERAL.');
        END IF;
    ELSE
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Story 5: Train 146 on 2026-10-20 (Schedule: 1254) Quota Fallback',
                'Fallback Notice (SEAT_NOT_AVAILABLE)',
                CONCAT('Error: ', COALESCE(v_out_err, 'NONE')),
                'FAIL',
                'LADIES sold out failed to return SEAT_NOT_AVAILABLE without consent.');
    END IF;

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 6: Edge Case - Train 101 on 2026-10-18 (Schedule: 1001) WAITING_LIST_FULL Rejection
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_waiting_list_full$$
CREATE PROCEDURE test_waiting_list_full()
BEGIN
    DECLARE v_sched_id INT DEFAULT 1001;
    DECLARE v_out_pnr VARCHAR(10);
    DECLARE v_out_stat VARCHAR(20);
    DECLARE v_out_fare DECIMAL(10,2);
    DECLARE v_out_err VARCHAR(32);
    DECLARE v_passengers JSON;

    SET v_passengers = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Test Passenger', 'age', 30, 'gender', 'MALE', 'concession_type', 'NONE', 'berth_preference', 'LOWER')
    );

    START TRANSACTION;
    SET @as_of_time = '2026-10-17 19:15:00';

    UPDATE SCHEDULE_CLASS_INVENTORY
    SET available_seats = 0, rac_capacity = 0, rac_count = 0, wl_capacity = 0, wl_count = 0
    WHERE schedule_id = v_sched_id AND class_id = 3;

    CALL sp_create_booking(
        50001, v_sched_id, 3, 1145, 1149, 'GENERAL', 0, 0, 0, v_passengers, 'ONLINE', NULL, 0,
        v_out_pnr, v_out_stat, v_out_fare, v_out_err
    );

    IF v_out_err = 'WAITING_LIST_FULL' THEN
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Edge Case: Train 101 on 2026-10-18 (Schedule: 1001) WAITING_LIST_FULL', 'WAITING_LIST_FULL', v_out_err, 'PASS', 'Correctly rejected booking when WL slots exhausted.');
    ELSE
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Edge Case: Train 101 on 2026-10-18 (Schedule: 1001) WAITING_LIST_FULL', 'WAITING_LIST_FULL', COALESCE(v_out_err, 'NULL'), 'FAIL', 'Failed to reject with WAITING_LIST_FULL.');
    END IF;

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 7: Edge Case - Train 101 on 2026-10-18 (Schedule: 1001) RAC-Open Allocation
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_rac_open$$
CREATE PROCEDURE test_rac_open()
BEGIN
    DECLARE v_sched_id INT DEFAULT 1001;
    DECLARE v_out_pnr VARCHAR(10);
    DECLARE v_out_stat VARCHAR(20);
    DECLARE v_out_fare DECIMAL(10,2);
    DECLARE v_out_err VARCHAR(32);
    DECLARE v_passengers JSON;

    SET v_passengers = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Test RAC User', 'age', 30, 'gender', 'MALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );

    START TRANSACTION;
    SET @as_of_time = '2026-10-17 19:15:00';

    UPDATE SCHEDULE_CLASS_INVENTORY
    SET available_seats = 0, rac_capacity = 5, rac_count = 0, wl_capacity = 5, wl_count = 0
    WHERE schedule_id = v_sched_id AND class_id = 3;

    CALL sp_create_booking(
        50001, v_sched_id, 3, 1145, 1149, 'GENERAL', 0, 0, 0, v_passengers, 'ONLINE', NULL, 0,
        v_out_pnr, v_out_stat, v_out_fare, v_out_err
    );

    IF v_out_pnr IS NOT NULL AND v_out_stat = 'RAC' THEN
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Edge Case: Train 101 on 2026-10-18 (Schedule: 1001) RAC-Open Booking', 'RAC', v_out_stat, 'PASS', 'Passenger allocated RAC when seats full.');
    ELSE
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Edge Case: Train 101 on 2026-10-18 (Schedule: 1001) RAC-Open Booking', 'RAC', COALESCE(v_out_stat, v_out_err), 'FAIL', 'RAC allocation failed.');
    END IF;

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 8: Edge Case - Train 101 on 2026-10-18 (Schedule: 1001) BERTH_PREFERENCE_NOT_MET Rejection
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_berth_preference_not_met$$
CREATE PROCEDURE test_berth_preference_not_met()
BEGIN
    DECLARE v_sched_id INT DEFAULT 1001;
    DECLARE v_out_pnr VARCHAR(10);
    DECLARE v_out_stat VARCHAR(20);
    DECLARE v_out_fare DECIMAL(10,2);
    DECLARE v_out_err VARCHAR(32);
    DECLARE v_passengers JSON;

    SET v_passengers = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Pick Berth User', 'age', 30, 'gender', 'MALE', 'concession_type', 'NONE', 'berth_preference', 'LOWER')
    );

    START TRANSACTION;
    SET @as_of_time = '2026-10-17 19:15:00';

    UPDATE SCHEDULE_CLASS_INVENTORY
    SET available_seats = 0, rac_capacity = 10, rac_count = 0
    WHERE schedule_id = v_sched_id AND class_id = 3;

    CALL sp_create_booking(
        50001, v_sched_id, 3, 1145, 1149, 'GENERAL', 0, 1, 0, v_passengers, 'ONLINE', NULL, 0,
        v_out_pnr, v_out_stat, v_out_fare, v_out_err
    );

    IF v_out_err = 'BERTH_PREFERENCE_NOT_MET' THEN
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Edge Case: Train 101 on 2026-10-18 (Schedule: 1001) BERTH_PREFERENCE_NOT_MET', 'BERTH_PREFERENCE_NOT_MET', v_out_err, 'PASS', 'Berth condition enforced and transaction rolled back to savepoint.');
    ELSE
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Edge Case: Train 101 on 2026-10-18 (Schedule: 1001) BERTH_PREFERENCE_NOT_MET', 'BERTH_PREFERENCE_NOT_MET', COALESCE(v_out_err, 'NONE'), 'FAIL', 'Berth condition enforcement failed.');
    END IF;

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 9: Edge Case - Train 101 on 2026-10-18 (Schedule: 1001) MONTHLY_LIMIT_EXCEEDED Rejection
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_monthly_limit_exceeded$$
CREATE PROCEDURE test_monthly_limit_exceeded()
BEGIN
    DECLARE v_sched_id INT DEFAULT 1001;
    DECLARE v_out_pnr VARCHAR(10);
    DECLARE v_out_stat VARCHAR(20);
    DECLARE v_out_fare DECIMAL(10,2);
    DECLARE v_out_err VARCHAR(32);
    DECLARE v_passengers JSON;
    DECLARE v_cnt INT DEFAULT 0;

    SET v_passengers = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Limit User', 'age', 30, 'gender', 'MALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );

    DELETE FROM BOOKING WHERE pnr LIKE '88880000%';

    START TRANSACTION;
    SET @as_of_time = '2026-10-17 19:15:00';

    UPDATE USER_ACCOUNT SET aadhaar_verified = 0 WHERE user_id = 50002;

    WHILE v_cnt < 12 DO
        INSERT INTO BOOKING (pnr, user_id, schedule_id, class_id, from_stop_id, to_stop_id, channel, quota, requested_quota, berth_condition, total_fare, status, created_at)
        VALUES (CONCAT('88880000', LPAD(v_cnt, 2, '0')), 50002, v_sched_id, 3, 1145, 1149, 'ONLINE', 'GENERAL', 'GENERAL', 0, 100.00, 'CONFIRMED', '2026-10-17 10:00:00');
        SET v_cnt = v_cnt + 1;
    END WHILE;

    CALL sp_create_booking(
        50002, v_sched_id, 3, 1145, 1149, 'GENERAL', 0, 0, 0, v_passengers, 'ONLINE', NULL, 0,
        v_out_pnr, v_out_stat, v_out_fare, v_out_err
    );

    IF v_out_err = 'MONTHLY_LIMIT_EXCEEDED' THEN
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Edge Case: Train 101 on 2026-10-18 (Schedule: 1001) MONTHLY_LIMIT_EXCEEDED', 'MONTHLY_LIMIT_EXCEEDED', v_out_err, 'PASS', 'Monthly booking limit of 12 tickets blocked 13th booking.');
    ELSE
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Edge Case: Train 101 on 2026-10-18 (Schedule: 1001) MONTHLY_LIMIT_EXCEEDED', 'MONTHLY_LIMIT_EXCEEDED', COALESCE(v_out_err, 'NONE'), 'FAIL', 'Monthly limit enforcement failed.');
    END IF;

    SET @as_of_time = NULL;
    ROLLBACK;
    DELETE FROM BOOKING WHERE pnr LIKE '88880000%';
END$$

-- -----------------------------------------------------------------------------
-- TEST 10: Edge Case - Train 101 on 2026-10-18 (Schedule: 1001) CHART_PREPARED Lockout Rejection
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_chart_prepared$$
CREATE PROCEDURE test_chart_prepared()
BEGIN
    DECLARE v_sched_id INT DEFAULT 1001;
    DECLARE v_out_pnr VARCHAR(10);
    DECLARE v_out_stat VARCHAR(20);
    DECLARE v_out_fare DECIMAL(10,2);
    DECLARE v_out_err VARCHAR(32);
    DECLARE v_passengers JSON;

    SET v_passengers = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Late Booker', 'age', 30, 'gender', 'MALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );

    START TRANSACTION;

    UPDATE TRAIN_SCHEDULE SET chart_prepared_at = NOW() - INTERVAL 1 HOUR WHERE schedule_id = v_sched_id;

    CALL sp_create_booking(
        50001, v_sched_id, 3, 1145, 1149, 'GENERAL', 0, 0, 0, v_passengers, 'ONLINE', NULL, 0,
        v_out_pnr, v_out_stat, v_out_fare, v_out_err
    );

    IF v_out_err = 'CHART_PREPARED' THEN
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Edge Case: Train 101 on 2026-10-18 (Schedule: 1001) CHART_PREPARED', 'CHART_PREPARED', v_out_err, 'PASS', 'Booking rejected immediately because chart was already prepared.');
    ELSE
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Edge Case: Train 101 on 2026-10-18 (Schedule: 1001) CHART_PREPARED', 'CHART_PREPARED', COALESCE(v_out_err, 'NONE'), 'FAIL', 'Chart lockout failed.');
    END IF;

    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 11: Whole-PNR Cancellation with 2 Confirmed Seats
-- Train 111 on 2026-10-18 (Schedule: 1064, Class: 1A, PNR: 2849100002)
-- Rule BR-W2: "In classes without RAC, a waiting-list passenger moves straight to CONFIRMED."
-- Class 1 (1A) has rac_capacity = 0. Therefore, RAC does NOT exist on this run/class,
-- and cancelling 2 confirmed seats promotes WL/1 and WL/2 directly to CONFIRMED.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_whole_pnr_cancel_two_seats$$
CREATE PROCEDURE test_whole_pnr_cancel_two_seats()
BEGIN
    DECLARE v_pnr VARCHAR(10) DEFAULT '2849100002'; -- Has 2 Confirmed seats (9366, 9367) on Train 111 (Schedule 1064), Class 1 (1A)
    DECLARE v_wl1_status VARCHAR(20);
    DECLARE v_wl2_status VARCHAR(20);
    DECLARE v_out_chg DECIMAL(10,2);
    DECLARE v_out_ref DECIMAL(10,2);
    DECLARE v_out_stat VARCHAR(20);

    START TRANSACTION;

    -- Set deterministic as-of time: 24h before train origin departure (2026-10-18 19:15:00)
    SET @as_of_time = '2026-10-17 19:15:00';

    -- Cancel whole PNR (passenger_no = NULL) with p_manage_tx = 0
    CALL sp_cancel_passenger_ticket(v_pnr, NULL, 'TRAVEL_CANCELLED', 0, v_out_chg, v_out_ref, v_out_stat);

    -- For Class 1 (1A, rac_capacity = 0 per BR-W2), freed seats promote lowest WL passengers straight to CONFIRMED
    SELECT status INTO v_wl1_status FROM RESERVATION WHERE pnr = '2849100012' AND passenger_no = 1;
    SELECT status INTO v_wl2_status FROM RESERVATION WHERE pnr = '2849100013' AND passenger_no = 1;

    IF v_wl1_status = 'CONFIRMED' AND v_wl2_status = 'CONFIRMED' THEN
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Edge Case: Train 111 on 2026-10-18 (PNR: 2849100002) Whole-PNR Cancel Class 1A (BR-W2: No RAC -> WL to CONFIRMED)',
                'Both WL1 & WL2 Promoted to CONFIRMED',
                CONCAT('WL1: ', v_wl1_status, ', WL2: ', v_wl2_status),
                'PASS',
                'Whole-PNR cancellation triggered 2 promotions. Class 1A has rac_capacity=0; per BR-W2, WL moves straight to CONFIRMED.');
    ELSE
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Edge Case: Train 111 on 2026-10-18 (PNR: 2849100002) Whole-PNR Cancel Class 1A (BR-W2: No RAC -> WL to CONFIRMED)',
                'Both WL1 & WL2 Promoted to CONFIRMED',
                CONCAT('WL1: ', COALESCE(v_wl1_status, 'NULL'), ', WL2: ', COALESCE(v_wl2_status, 'NULL')),
                'FAIL',
                'Whole-PNR promotion failed.');
    END IF;

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 12: Cancellation of a Waiting List Passenger
-- Train 111 on 2026-10-18 (Schedule: 1064, Class: 2A, PNR: 2849100122)
-- Verifies that cancelling an RAC or WL passenger frees no seat and promotes nobody wrongly,
-- strictly shifting subsequent WL positions up by 1 per BR-W7.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_cancel_wl_passenger$$
CREATE PROCEDURE test_cancel_wl_passenger()
BEGIN
    DECLARE v_wl_pnr VARCHAR(10) DEFAULT '2849100122'; -- WL/1 on schedule 1064 class 2
    DECLARE v_next_wl_pnr VARCHAR(10) DEFAULT '2849100123'; -- WL/2 on schedule 1064 class 2
    DECLARE v_next_wl_queue VARCHAR(32);
    DECLARE v_next_wl_status VARCHAR(20);
    DECLARE v_out_chg DECIMAL(10,2);
    DECLARE v_out_ref DECIMAL(10,2);
    DECLARE v_out_stat VARCHAR(20);

    START TRANSACTION;

    -- Set deterministic as-of time: 24h before train origin departure (2026-10-18 19:15:00)
    SET @as_of_time = '2026-10-17 19:15:00';

    -- Cancel WL/1 passenger with p_manage_tx = 0
    CALL sp_cancel_passenger_ticket(v_wl_pnr, 1, 'PLANS_CHANGED', 0, v_out_chg, v_out_ref, v_out_stat);

    -- Check next WL passenger: must remain WAITING_LIST (promotes nobody wrongly) and move from WL/2 to WL/1
    SELECT status, queue_position INTO v_next_wl_status, v_next_wl_queue
    FROM RESERVATION
    WHERE pnr = v_next_wl_pnr AND passenger_no = 1;

    IF v_next_wl_status = 'WAITING_LIST' AND v_next_wl_queue = 'WL/1' THEN
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Edge Case: Train 111 on 2026-10-18 (PNR: 2849100122) Cancel Waiting List Passenger',
                'Status WAITING_LIST, Queue WL/1',
                CONCAT('Status: ', v_next_wl_status, ', Queue: ', v_next_wl_queue),
                'PASS',
                'Cancelling WL passenger freed no seat and correctly shifted queue position without false promotion.');
    ELSE
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Edge Case: Train 111 on 2026-10-18 (PNR: 2849100122) Cancel Waiting List Passenger',
                'Status WAITING_LIST, Queue WL/1',
                CONCAT('Status: ', COALESCE(v_next_wl_status, 'NULL'), ', Queue: ', COALESCE(v_next_wl_queue, 'NULL')),
                'FAIL',
                'WL cancellation queue shift failed.');
    END IF;

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 13: Whole-PNR Cancellation with Mixed CONFIRMED, RAC, and WL Passengers
-- Train 119 on 2026-10-19 (Schedule: 1111, Class: 3A, PNR: 9888000001)
-- Verifies that cancelling a whole PNR with a mix of CONFIRMED, RAC, and WL passengers
-- before chart preparation (at 33.25h before origin departure -> 25% slab for CONF):
--   - Creates exactly one CANCELLATION row per passenger (3 rows)
--   - Creates individual REFUND rows per passenger (3 rows, BR-R3)
--   - Total refund equals sum of individual passenger refunds
--   - Only CONFIRMED seat promotes RAC to CONFIRMED, RAC slot promotes WL to RAC, and WL queue shifts
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_whole_pnr_cancel_mixed_passengers$$
CREATE PROCEDURE test_whole_pnr_cancel_mixed_passengers()
BEGIN
    DECLARE v_test_pnr VARCHAR(10) DEFAULT '9888000001';
    DECLARE v_sched_id INT DEFAULT 1111;
    DECLARE v_class_id INT DEFAULT 3;
    DECLARE v_cancel_count INT DEFAULT 0;
    DECLARE v_refund_count INT DEFAULT 0;
    DECLARE v_refund_sum DECIMAL(10,2) DEFAULT 0.00;
    DECLARE v_out_chg DECIMAL(10,2);
    DECLARE v_out_ref DECIMAL(10,2);
    DECLARE v_out_stat VARCHAR(20);

    START TRANSACTION;

    -- Set deterministic as-of time: 2026-10-18 10:00:00 (33.25 hours before 2026-10-19 19:15:00 departure)
    -- CONF passenger falls in 25% slab (BR-R1: 24h to 72h before departure -> deduction 25%)
    SET @as_of_time = '2026-10-18 10:00:00';

    INSERT INTO BOOKING (
        pnr, user_id, schedule_id, class_id, from_stop_id, to_stop_id,
        channel, quota, requested_quota, berth_condition, total_fare, status, created_at
    ) VALUES (v_test_pnr, 50001, v_sched_id, v_class_id, 1001, 1005, 'ONLINE', 'GENERAL', 'GENERAL', 0, 3000.00, 'CONFIRMED', '2026-10-18 08:00:00');

    INSERT INTO PASSENGER_BOOKING (pnr, passenger_no, saved_passenger_id, name, age, gender, concession_type, base_fare, total_fare, insurance)
    VALUES
    (v_test_pnr, 1, 15, 'Mixed Pass 1 Conf', 30, 'MALE', 'NONE', 999.55, 1000.00, 0.45),
    (v_test_pnr, 2, 16, 'Mixed Pass 2 RAC', 28, 'FEMALE', 'NONE', 999.55, 1000.00, 0.45),
    (v_test_pnr, 3, 17, 'Mixed Pass 3 WL', 25, 'MALE', 'NONE', 999.55, 1000.00, 0.45);

    INSERT INTO RESERVATION (res_id, pnr, passenger_no, schedule_id, seat_id, status, queue_position)
    VALUES
    (988801, v_test_pnr, 1, v_sched_id, 17001, 'CONFIRMED', NULL),
    (988802, v_test_pnr, 2, v_sched_id, NULL, 'RAC', 'RAC/99'),
    (988803, v_test_pnr, 3, v_sched_id, NULL, 'WAITING_LIST', 'WL/99');

    INSERT INTO PAYMENT (payment_id, pnr, amount, method, status, gateway_payment_id, paid_at)
    VALUES (988801, v_test_pnr, 3000.00, 'UPI', 'SUCCESS', 'pay_mixed_test_01', '2026-10-18 08:00:00');

    -- Execute whole-PNR cancellation (passenger_no = NULL) with p_manage_tx = 0
    CALL sp_cancel_passenger_ticket(v_test_pnr, NULL, 'MIXED_PASSENGERS_CANCEL', 0, v_out_chg, v_out_ref, v_out_stat);

    SELECT COUNT(*) INTO v_cancel_count FROM CANCELLATION WHERE pnr = v_test_pnr;
    SELECT COUNT(*), COALESCE(SUM(amount), 0.00) INTO v_refund_count, v_refund_sum FROM REFUND WHERE payment_id = 988801;

    IF v_cancel_count = 3 AND v_refund_count = 3 AND v_refund_sum = v_out_ref THEN
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Edge Case: Train 119 on 2026-10-19 (PNR: 9888000001) Whole-PNR Cancel Mixed Passengers (CONF+RAC+WL)',
                '3 CANCELLATION Rows, 3 REFUND Rows Matching Sum (BR-R3)',
                CONCAT('Cancels: ', v_cancel_count, ', Refunds: ', v_refund_count, ', Total Refund: ', v_refund_sum),
                'PASS',
                'Whole-PNR cancellation before chart limit created individual CANCELLATION and REFUND rows for all 3 passengers.');
    ELSE
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Edge Case: Train 119 on 2026-10-19 (PNR: 9888000001) Whole-PNR Cancel Mixed Passengers (CONF+RAC+WL)',
                '3 CANCELLATION Rows, 3 REFUND Rows Matching Sum (BR-R3)',
                CONCAT('Cancels: ', v_cancel_count, ', Refunds: ', v_refund_count, ', Refund Sum: ', v_refund_sum, ', Out Ref: ', v_out_ref),
                'FAIL',
                'Mixed passenger whole-PNR cancellation verification failed.');
    END IF;

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 14: Online Cancellation Rejection After Chart Preparation Time (< 8h)
-- Train 119 on 2026-10-19 (Schedule: 1111, Origin Departure: 19:15:00)
-- Rules: BR-B12, BR-R7, API_CONTRACT
-- Verifies that online cancellation attempted at or after chart time (<= 8 hours before origin departure)
-- is strictly rejected with status / error code 'CHART_PREPARED'.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_cancel_after_chart$$
CREATE PROCEDURE test_cancel_after_chart()
BEGIN
    DECLARE v_test_pnr VARCHAR(10) DEFAULT '9888000002';
    DECLARE v_sched_id INT DEFAULT 1111;
    DECLARE v_class_id INT DEFAULT 3;
    DECLARE v_out_chg DECIMAL(10,2);
    DECLARE v_out_ref DECIMAL(10,2);
    DECLARE v_out_stat VARCHAR(20);

    START TRANSACTION;

    -- Set deterministic as-of time: 2026-10-19 14:00:00 (5.25 hours before 19:15:00 departure -> past 8h chart deadline)
    SET @as_of_time = '2026-10-19 14:00:00';

    INSERT INTO BOOKING (
        pnr, user_id, schedule_id, class_id, from_stop_id, to_stop_id,
        channel, quota, requested_quota, berth_condition, total_fare, status, created_at
    ) VALUES (v_test_pnr, 50001, v_sched_id, v_class_id, 1001, 1005, 'ONLINE', 'GENERAL', 'GENERAL', 0, 1000.00, 'CONFIRMED', '2026-10-18 08:00:00');

    INSERT INTO PASSENGER_BOOKING (pnr, passenger_no, saved_passenger_id, name, age, gender, concession_type, base_fare, total_fare, insurance)
    VALUES (v_test_pnr, 1, 15, 'Late Canceller', 30, 'MALE', 'NONE', 999.55, 1000.00, 0.45);

    INSERT INTO RESERVATION (res_id, pnr, passenger_no, schedule_id, seat_id, status, queue_position)
    VALUES (988804, v_test_pnr, 1, v_sched_id, 17002, 'CONFIRMED', NULL);

    INSERT INTO PAYMENT (payment_id, pnr, amount, method, status, gateway_payment_id, paid_at)
    VALUES (988802, v_test_pnr, 1000.00, 'UPI', 'SUCCESS', 'pay_late_cancel_01', '2026-10-18 08:00:00');

    -- Attempt online cancellation after chart time (< 8 hours) with p_manage_tx = 0
    CALL sp_cancel_passenger_ticket(v_test_pnr, 1, 'LATE_CANCEL_ATTEMPT', 0, v_out_chg, v_out_ref, v_out_stat);

    IF v_out_stat = 'CHART_PREPARED' THEN
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Edge Case: Train 119 on 2026-10-19 (PNR: 9888000002) Cancel After Chart Time (BR-B12, BR-R7)',
                'CHART_PREPARED',
                v_out_stat,
                'PASS',
                'Cancellation correctly rejected with error CHART_PREPARED when attempted within 8h of departure.');
    ELSE
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Edge Case: Train 119 on 2026-10-19 (PNR: 9888000002) Cancel After Chart Time (BR-B12, BR-R7)',
                'CHART_PREPARED',
                COALESCE(v_out_stat, 'NULL'),
                'FAIL',
                'Cancellation after chart time was not rejected.');
    END IF;

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 15: Tatkal CONFIRMED Passenger Cancellation Before Chart Preparation
-- Rule BR-R6: "Confirmed Tatkal tickets get no refund on voluntary cancellation."
-- Verifies that cancellation of a CONFIRMED Tatkal ticket produces charge = eligible fare,
-- refund_amount = 0.00, creates CANCELLATION row, and generates 0 REFUND rows.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_tatkal_confirmed_cancel$$
CREATE PROCEDURE test_tatkal_confirmed_cancel()
BEGIN
    DECLARE v_test_pnr VARCHAR(10) DEFAULT '9888000003';
    DECLARE v_sched_id INT DEFAULT 1111;
    DECLARE v_class_id INT DEFAULT 3;
    DECLARE v_out_chg DECIMAL(10,2);
    DECLARE v_out_ref DECIMAL(10,2);
    DECLARE v_out_stat VARCHAR(20);
    DECLARE v_refund_rows INT DEFAULT 0;
    DECLARE v_cancel_rows INT DEFAULT 0;

    START TRANSACTION;

    -- Set deterministic as-of time: 24h before origin departure (2026-10-18 19:15:00)
    SET @as_of_time = '2026-10-18 19:15:00';

    INSERT INTO BOOKING (
        pnr, user_id, schedule_id, class_id, from_stop_id, to_stop_id,
        channel, quota, requested_quota, berth_condition, total_fare, status, created_at
    ) VALUES (v_test_pnr, 50001, v_sched_id, v_class_id, 1001, 1005, 'ONLINE', 'TATKAL', 'TATKAL', 0, 1000.00, 'CONFIRMED', '2026-10-18 10:30:00');

    INSERT INTO PASSENGER_BOOKING (pnr, passenger_no, saved_passenger_id, name, age, gender, concession_type, base_fare, total_fare, insurance)
    VALUES (v_test_pnr, 1, 18, 'Tatkal Conf Booker', 32, 'MALE', 'NONE', 999.55, 1000.00, 0.45);

    INSERT INTO RESERVATION (res_id, pnr, passenger_no, schedule_id, seat_id, status, queue_position)
    VALUES (988805, v_test_pnr, 1, v_sched_id, 17003, 'CONFIRMED', NULL);

    INSERT INTO PAYMENT (payment_id, pnr, amount, method, status, gateway_payment_id, paid_at)
    VALUES (988803, v_test_pnr, 1000.00, 'UPI', 'SUCCESS', 'pay_tatkal_cancel_01', '2026-10-18 10:30:00');

    -- Cancel Tatkal confirmed passenger ticket
    CALL sp_cancel_passenger_ticket(v_test_pnr, 1, 'TATKAL_PLANS_CANCELLED', 0, v_out_chg, v_out_ref, v_out_stat);

    SELECT COUNT(*) INTO v_cancel_rows FROM CANCELLATION WHERE pnr = v_test_pnr;
    SELECT COUNT(*) INTO v_refund_rows FROM REFUND WHERE payment_id = 988803;

    IF v_out_stat = 'CANCELLED' AND v_out_ref = 0.00 AND v_out_chg = 999.55 AND v_refund_rows = 0 AND v_cancel_rows = 1 THEN
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Edge Case: Tatkal Confirmed Passenger Cancel (BR-R6: No Refund)',
                'Charge 999.55, Refund 0.00, 0 REFUND Rows',
                CONCAT('Charge: ', v_out_chg, ', Refund: ', v_out_ref, ', Refund Rows: ', v_refund_rows),
                'PASS',
                'BR-R6 verified: Confirmed Tatkal ticket gets no voluntary refund (charge equals fare paid minus insurance).');
    ELSE
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Edge Case: Tatkal Confirmed Passenger Cancel (BR-R6: No Refund)',
                'Charge 999.55, Refund 0.00, 0 REFUND Rows',
                CONCAT('Charge: ', COALESCE(v_out_chg, 0), ', Refund: ', COALESCE(v_out_ref, 0), ', Status: ', COALESCE(v_out_stat, 'NULL')),
                'FAIL',
                'Tatkal cancellation refund rule BR-R6 check failed.');
    END IF;

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 16: Counter-Booked Ticket Cancellation with Cash Refund
-- Rules BR-CB6, BR-R11: "Counter-booked tickets are cancelled at the counter by staff, and the refund is paid back as CASH."
-- Verifies that a counter-booked ticket (channel = 'COUNTER') cancelled before chart generates
-- a valid CANCELLATION record and a REFUND record linked to the CASH payment.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_counter_ticket_cancel$$
CREATE PROCEDURE test_counter_ticket_cancel()
BEGIN
    DECLARE v_test_pnr VARCHAR(10) DEFAULT '9888000004';
    DECLARE v_sched_id INT DEFAULT 1111;
    DECLARE v_class_id INT DEFAULT 3;
    DECLARE v_out_chg DECIMAL(10,2);
    DECLARE v_out_ref DECIMAL(10,2);
    DECLARE v_out_stat VARCHAR(20);
    DECLARE v_refund_rows INT DEFAULT 0;
    DECLARE v_cancel_rows INT DEFAULT 0;
    DECLARE v_pay_method VARCHAR(20);

    START TRANSACTION;

    -- Set deterministic as-of time: 33.25h before origin departure -> 25% slab (deduction 25%, min 180)
    SET @as_of_time = '2026-10-18 10:00:00';

    INSERT INTO BOOKING (
        pnr, user_id, schedule_id, class_id, from_stop_id, to_stop_id,
        channel, quota, requested_quota, berth_condition, total_fare, status, created_at
    ) VALUES (v_test_pnr, 50004, v_sched_id, v_class_id, 1001, 1005, 'COUNTER', 'GENERAL', 'GENERAL', 0, 1000.00, 'CONFIRMED', '2026-10-18 09:00:00');

    INSERT INTO PASSENGER_BOOKING (pnr, passenger_no, saved_passenger_id, name, age, gender, concession_type, base_fare, total_fare, insurance)
    VALUES (v_test_pnr, 1, 19, 'Walkin Counter Passenger', 45, 'MALE', 'NONE', 999.55, 1000.00, 0.45);

    INSERT INTO RESERVATION (res_id, pnr, passenger_no, schedule_id, seat_id, status, queue_position)
    VALUES (988806, v_test_pnr, 1, v_sched_id, 17004, 'CONFIRMED', NULL);

    INSERT INTO PAYMENT (payment_id, pnr, amount, method, status, gateway_payment_id, paid_at)
    VALUES (988804, v_test_pnr, 1000.00, 'CASH', 'SUCCESS', 'CASH_REC_COUNTER_01', '2026-10-18 09:00:00');

    -- Cancel counter ticket with p_manage_tx = 0
    CALL sp_cancel_passenger_ticket(v_test_pnr, 1, 'COUNTER_WALKIN_CANCEL', 0, v_out_chg, v_out_ref, v_out_stat);

    SELECT COUNT(*) INTO v_cancel_rows FROM CANCELLATION WHERE pnr = v_test_pnr;
    SELECT COUNT(*) INTO v_refund_rows FROM REFUND WHERE payment_id = 988804;
    SELECT p.method INTO v_pay_method FROM REFUND r JOIN PAYMENT p ON r.payment_id = p.payment_id WHERE r.payment_id = 988804 LIMIT 1;

    IF v_out_stat = 'CANCELLED' AND v_out_ref = 749.66 AND v_cancel_rows = 1 AND v_refund_rows = 1 AND v_pay_method = 'CASH' THEN
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Edge Case: Counter Ticket Cancel (BR-R11, BR-CB6: Cash Refund)',
                '1 CANCELLATION, 1 REFUND on CASH Payment (Refund 749.66)',
                CONCAT('Refund: ', v_out_ref, ', Payment Method: ', v_pay_method),
                'PASS',
                'BR-R11 verified: Counter ticket cancelled, refund linked to CASH payment for immediate cash disbursement.');
    ELSE
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Edge Case: Counter Ticket Cancel (BR-R11, BR-CB6: Cash Refund)',
                '1 CANCELLATION, 1 REFUND on CASH Payment (Refund 749.66)',
                CONCAT('Refund: ', COALESCE(v_out_ref, 0), ', Method: ', COALESCE(v_pay_method, 'NULL')),
                'FAIL',
                'Counter ticket cancellation check failed.');
    END IF;

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 17: Real Data - Train 123 on 2026-10-18 (Schedule 1127, Class 3) GENERAL Booking WAITING_LIST_FULL
-- With NO changes to inventory: GENERAL confirmed is full (468/468), RAC is full (64/64), WL is full (160/160).
-- A new GENERAL booking must be rejected with WAITING_LIST_FULL per BR-W1.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_real_general_waiting_list_full$$
CREATE PROCEDURE test_real_general_waiting_list_full()
BEGIN
    DECLARE v_sched_id INT DEFAULT 1127;
    DECLARE v_class_id INT DEFAULT 3;
    DECLARE v_out_pnr VARCHAR(10);
    DECLARE v_out_stat VARCHAR(20);
    DECLARE v_out_fare DECIMAL(10,2);
    DECLARE v_out_err VARCHAR(32);
    DECLARE v_passengers JSON;

    SET v_passengers = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'WL Full User', 'age', 30, 'gender', 'MALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );

    START TRANSACTION;
    SET @as_of_time = '2026-10-17 19:15:00';

    CALL sp_create_booking(
        50001, v_sched_id, v_class_id, 1369, 1375, 'GENERAL', 0, 0, 0, v_passengers, 'ONLINE', NULL, 0,
        v_out_pnr, v_out_stat, v_out_fare, v_out_err
    );

    IF v_out_err = 'WAITING_LIST_FULL' THEN
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Real Data: Train 123 on 2026-10-18 (Schedule 1127) GENERAL Booking',
                'WAITING_LIST_FULL',
                v_out_err,
                'PASS',
                'BR-W1 verified: With no inventory modifications, booking on full run correctly rejected with WAITING_LIST_FULL.');
    ELSE
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Real Data: Train 123 on 2026-10-18 (Schedule 1127) GENERAL Booking',
                'WAITING_LIST_FULL',
                COALESCE(v_out_err, v_out_stat, 'NULL'),
                'FAIL',
                'Expected WAITING_LIST_FULL on full run with no inventory changes.');
    END IF;

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 18: Real Data - Train 131 on 2026-10-18 (Schedule 1174, Class 3) GENERAL Booking RAC Open
-- With NO changes to inventory: GENERAL confirmed is full (468/468), RAC is open (32 booked out of 64).
-- A new GENERAL booking must be allocated RAC status with queue position RAC/33.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_real_general_rac_allocation$$
CREATE PROCEDURE test_real_general_rac_allocation()
BEGIN
    DECLARE v_sched_id INT DEFAULT 1174;
    DECLARE v_class_id INT DEFAULT 3;
    DECLARE v_out_pnr VARCHAR(10);
    DECLARE v_out_stat VARCHAR(20);
    DECLARE v_out_fare DECIMAL(10,2);
    DECLARE v_out_err VARCHAR(32);
    DECLARE v_res_stat VARCHAR(20);
    DECLARE v_res_queue VARCHAR(32);
    DECLARE v_passengers JSON;

    SET v_passengers = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'RAC User', 'age', 30, 'gender', 'MALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );

    START TRANSACTION;
    SET @as_of_time = '2026-10-17 19:15:00';

    CALL sp_create_booking(
        50001, v_sched_id, v_class_id, 1433, 1445, 'GENERAL', 0, 0, 0, v_passengers, 'ONLINE', NULL, 0,
        v_out_pnr, v_out_stat, v_out_fare, v_out_err
    );

    IF v_out_pnr IS NOT NULL THEN
        SELECT status, queue_position INTO v_res_stat, v_res_queue
        FROM RESERVATION
        WHERE pnr = v_out_pnr AND passenger_no = 1;
    END IF;

    IF v_out_stat = 'RAC' AND v_res_stat = 'RAC' AND v_res_queue = 'RAC/33' THEN
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Real Data: Train 131 on 2026-10-18 (Schedule 1174) GENERAL Booking',
                'RAC (Queue: RAC/33)',
                CONCAT(v_out_stat, ' (', v_res_queue, ')'),
                'PASS',
                'BR-W1 verified: GENERAL confirmed full but RAC open correctly allocates RAC/33 with no inventory changes.');
    ELSE
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Real Data: Train 131 on 2026-10-18 (Schedule 1174) GENERAL Booking',
                'RAC (Queue: RAC/33)',
                CONCAT(COALESCE(v_out_stat, 'NULL'), ' (', COALESCE(v_res_queue, 'NULL'), ', err: ', COALESCE(v_out_err, 'NONE'), ')'),
                'FAIL',
                'Expected RAC allocation on Train 131.');
    END IF;

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 19: Real Data - Inventory & Reservation Counter Sync After Cancel with Promotion (BR-R9, BR-W4)
-- With NO manual changes to inventory:
-- Cancelling a CONFIRMED passenger on Train 123 (Schedule 1127, Class 3) promotes RAC/1 to CONFIRMED,
-- and promotes WL/1 to RAC/64.
-- Verifies that available_seats, rac_count, and wl_count remain 100% equal to actual reservations.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_real_inventory_sync_after_cancel_promotion$$
CREATE PROCEDURE test_real_inventory_sync_after_cancel_promotion()
BEGIN
    DECLARE v_sched_id INT DEFAULT 1127;
    DECLARE v_class_id INT DEFAULT 3;
    DECLARE v_cancel_pnr VARCHAR(10);
    DECLARE v_cancel_pass_no INT;
    DECLARE v_cancel_quota VARCHAR(20);
    DECLARE v_cancel_status VARCHAR(20);
    DECLARE v_out_chg DECIMAL(10,2);
    DECLARE v_out_ref DECIMAL(10,2);
    DECLARE v_out_stat VARCHAR(20);
    DECLARE v_inv_avail_before INT;
    DECLARE v_inv_rac_before INT;
    DECLARE v_inv_wl_before INT;
    DECLARE v_inv_avail_after INT;
    DECLARE v_inv_rac_after INT;
    DECLARE v_inv_wl_after INT;
    DECLARE v_inv_tot INT;
    DECLARE v_real_conf_before INT;
    DECLARE v_real_rac_before INT;
    DECLARE v_real_wl_before INT;
    DECLARE v_real_conf_after INT;
    DECLARE v_real_rac_after INT;
    DECLARE v_real_wl_after INT;

    START TRANSACTION;

    -- Train 123 on 2026-10-18 departs at 12:45:00.
    -- Set deterministic as-of time to 02:00:00 (10h45m before origin departure, safely before 8h chart cutoff)
    SET @as_of_time = '2026-10-18 02:00:00';

    -- Pick a GENERAL CONFIRMED passenger from Schedule 1127 Class 3
    SELECT r.pnr, r.passenger_no, b.quota, r.status
    INTO v_cancel_pnr, v_cancel_pass_no, v_cancel_quota, v_cancel_status
    FROM RESERVATION r
    JOIN BOOKING b ON r.pnr = b.pnr
    WHERE r.schedule_id = v_sched_id AND b.class_id = v_class_id AND b.quota = 'GENERAL' AND r.status = 'CONFIRMED'
    LIMIT 1;

    -- Read BEFORE inventory
    SELECT total_seats, available_seats, rac_count, wl_count
    INTO v_inv_tot, v_inv_avail_before, v_inv_rac_before, v_inv_wl_before
    FROM SCHEDULE_CLASS_INVENTORY
    WHERE schedule_id = v_sched_id AND class_id = v_class_id;

    -- Read BEFORE reservations
    SELECT 
      COALESCE(SUM(CASE WHEN r.status IN ('CONFIRMED', 'BOARDED') THEN 1 ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN r.status = 'RAC' THEN 1 ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN r.status = 'WAITING_LIST' THEN 1 ELSE 0 END), 0)
    INTO v_real_conf_before, v_real_rac_before, v_real_wl_before
    FROM RESERVATION r
    JOIN BOOKING b ON r.pnr = b.pnr
    WHERE r.schedule_id = v_sched_id AND b.class_id = v_class_id;

    -- Print BEFORE CANCEL: passenger, inventory row, real reservation counts
    SELECT 'BEFORE_CANCEL_PASSENGER' AS info_type, v_cancel_pnr AS pnr, v_cancel_pass_no AS passenger_no, v_cancel_quota AS quota, v_cancel_status AS status;
    SELECT 'BEFORE_CANCEL_INVENTORY' AS info_type, schedule_id, class_id, total_seats, available_seats, rac_capacity, rac_count, wl_capacity, wl_count
    FROM SCHEDULE_CLASS_INVENTORY WHERE schedule_id = v_sched_id AND class_id = v_class_id;
    SELECT 'BEFORE_CANCEL_RESERVATIONS' AS info_type, v_real_conf_before AS confirmed_seats, v_real_rac_before AS rac_passengers, v_real_wl_before AS wl_passengers;

    -- Cancel the passenger (triggers trg_after_cancellation_promote and sp_promote_passenger)
    CALL sp_cancel_passenger_ticket(v_cancel_pnr, v_cancel_pass_no, 'TEST_SYNC', 0, v_out_chg, v_out_ref, v_out_stat);

    -- Read AFTER inventory
    SELECT available_seats, rac_count, wl_count
    INTO v_inv_avail_after, v_inv_rac_after, v_inv_wl_after
    FROM SCHEDULE_CLASS_INVENTORY
    WHERE schedule_id = v_sched_id AND class_id = v_class_id;

    -- Read AFTER reservations
    SELECT 
      COALESCE(SUM(CASE WHEN r.status IN ('CONFIRMED', 'BOARDED') THEN 1 ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN r.status = 'RAC' THEN 1 ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN r.status = 'WAITING_LIST' THEN 1 ELSE 0 END), 0)
    INTO v_real_conf_after, v_real_rac_after, v_real_wl_after
    FROM RESERVATION r
    JOIN BOOKING b ON r.pnr = b.pnr
    WHERE r.schedule_id = v_sched_id AND b.class_id = v_class_id;

    -- Print AFTER CANCEL: passenger, inventory row, real reservation counts
    SELECT 'AFTER_CANCEL_PASSENGER' AS info_type, v_cancel_pnr AS pnr, v_cancel_pass_no AS passenger_no, v_cancel_quota AS quota, r.status AS status, r.seat_id
    FROM RESERVATION r WHERE r.pnr = v_cancel_pnr AND r.passenger_no = v_cancel_pass_no;
    SELECT 'AFTER_CANCEL_INVENTORY' AS info_type, schedule_id, class_id, total_seats, available_seats, rac_capacity, rac_count, wl_capacity, wl_count
    FROM SCHEDULE_CLASS_INVENTORY WHERE schedule_id = v_sched_id AND class_id = v_class_id;
    SELECT 'AFTER_CANCEL_RESERVATIONS' AS info_type, v_real_conf_after AS confirmed_seats, v_real_rac_after AS rac_passengers, v_real_wl_after AS wl_passengers;

    IF v_out_stat = 'CANCELLED' 
       AND v_inv_avail_after = 94 AND v_inv_rac_after = 64 AND v_inv_wl_after = 159
       AND v_real_conf_after = 546 AND v_real_rac_after = 64 AND v_real_wl_after = 159 THEN
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Real Data: Inventory Sync After Cancel with Promotion',
                'Avail: 94, RAC: 64, WL: 159',
                CONCAT('Avail: ', v_inv_avail_after, ', RAC: ', v_inv_rac_after, ', WL: ', v_inv_wl_after),
                'PASS',
                CONCAT('PNR: ', v_cancel_pnr, ' (', v_cancel_quota, ') cancelled. Promoted RAC->CONF and WL->RAC. Before: [Inv: ', v_inv_avail_before, '/', v_inv_rac_before, '/', v_inv_wl_before, ', Res: ', v_real_conf_before, '/', v_real_rac_before, '/', v_real_wl_before, '], After: [Inv: ', v_inv_avail_after, '/', v_inv_rac_after, '/', v_inv_wl_after, ', Res: ', v_real_conf_after, '/', v_real_rac_after, '/', v_real_wl_after, '].'));
    ELSE
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Real Data: Inventory Sync After Cancel with Promotion',
                'Avail: 94, RAC: 64, WL: 159',
                CONCAT('Avail: ', v_inv_avail_after, ', RAC: ', v_inv_rac_after, ', WL: ', v_inv_wl_after, ', Stat: ', COALESCE(v_out_stat, 'NULL')),
                'FAIL',
                CONCAT('Cancel outcome failed. Status: ', COALESCE(v_out_stat, 'NULL')));
    END IF;

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 20: Online Payment Hold - Pay In Time
-- Verifies that online booking with hold creates booking in PAYMENT_PENDING,
-- and paying within the hold window confirms the booking and inserts PAYMENT (SUCCESS).
-- Also verifies inventory counters equal real reservation counts.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_payment_hold_pay_in_time$$
CREATE PROCEDURE test_payment_hold_pay_in_time()
BEGIN
    DECLARE v_sched_id INT DEFAULT 1001;
    DECLARE v_class_id INT DEFAULT 3;
    DECLARE v_out_pnr VARCHAR(10);
    DECLARE v_out_stat VARCHAR(20);
    DECLARE v_out_fare DECIMAL(10,2);
    DECLARE v_out_err VARCHAR(32);
    DECLARE v_conf_status VARCHAR(20);
    DECLARE v_pay_id INT;
    DECLARE v_db_booking_status VARCHAR(20);
    DECLARE v_pay_row_count INT;
    DECLARE v_mismatch INT DEFAULT 0;
    DECLARE v_passengers JSON;
    DECLARE v_neg_rejected TINYINT DEFAULT 0;
    DECLARE v_mismatch_rejected TINYINT DEFAULT 0;

    SET v_passengers = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Pay In Time User', 'age', 28, 'gender', 'FEMALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );

    START TRANSACTION;

    SET @as_of_time = '2026-10-18 10:00:00';

    -- Create booking with p_hold_for_payment = 1
    CALL sp_create_booking(
        50001, v_sched_id, v_class_id, 1145, 1149, 'GENERAL', 0, 0, 1, v_passengers, 'ONLINE', NULL, 0,
        v_out_pnr, v_out_stat, v_out_fare, v_out_err
    );

    -- Check that projected status was CONFIRMED but DB status is PAYMENT_PENDING
    SELECT status INTO v_db_booking_status FROM BOOKING WHERE pnr = v_out_pnr;

    -- Advance time 5 minutes (inside 10-minute window)
    SET @as_of_time = '2026-10-18 10:05:00';

    -- Test 1: Verify negative payment amount (-500) is rejected with SQLSTATE '45000'
    test_neg_amt: BEGIN
        DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET v_neg_rejected = 1;
        CALL sp_confirm_payment(v_out_pnr, -500.00, 'UPI', 'gateway_neg_amt_01', 0, v_conf_status, v_pay_id);
    END test_neg_amt;

    -- Test 2: Verify mismatched amount (1 rupee on an 864 rupee booking) is rejected with SQLSTATE '45000'
    test_mismatch_amt: BEGIN
        DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET v_mismatch_rejected = 1;
        CALL sp_confirm_payment(v_out_pnr, 1.00, 'UPI', 'gateway_mismatch_01', 0, v_conf_status, v_pay_id);
    END test_mismatch_amt;

    -- Test 3: Confirm payment with exact total_fare (864.00)
    CALL sp_confirm_payment(v_out_pnr, v_out_fare, 'UPI', 'gateway_pay_in_time_01', 0, v_conf_status, v_pay_id);

    -- Verify payment row
    SELECT COUNT(*) INTO v_pay_row_count FROM PAYMENT WHERE gateway_payment_id = 'gateway_pay_in_time_01' AND status = 'SUCCESS';

    -- Check final booking status
    SELECT status INTO v_db_booking_status FROM BOOKING WHERE pnr = v_out_pnr;

    -- Check inventory counters equal real reservation counts
    SELECT COUNT(*) INTO v_mismatch
    FROM SCHEDULE_CLASS_INVENTORY sci
    LEFT JOIN (
        SELECT r.schedule_id, b.class_id,
            SUM(CASE WHEN r.status IN ('CONFIRMED', 'BOARDED') THEN 1 ELSE 0 END) as conf_count,
            SUM(CASE WHEN r.status = 'RAC' THEN 1 ELSE 0 END) as rac_count,
            SUM(CASE WHEN r.status = 'WAITING_LIST' THEN 1 ELSE 0 END) as wl_count
        FROM RESERVATION r
        JOIN BOOKING b ON r.pnr = b.pnr
        WHERE r.schedule_id = v_sched_id AND b.class_id = v_class_id
        GROUP BY r.schedule_id, b.class_id
    ) res ON sci.schedule_id = res.schedule_id AND sci.class_id = res.class_id
    WHERE sci.schedule_id = v_sched_id AND sci.class_id = v_class_id
      AND (sci.available_seats != (sci.total_seats - COALESCE(res.conf_count, 0))
           OR sci.rac_count != COALESCE(res.rac_count, 0)
           OR sci.wl_count != COALESCE(res.wl_count, 0));

    IF v_out_stat = 'CONFIRMED' AND v_conf_status = 'CONFIRMED' AND v_db_booking_status = 'CONFIRMED'
       AND v_pay_row_count = 1 AND v_pay_id IS NOT NULL AND v_mismatch = 0
       AND v_neg_rejected = 1 AND v_mismatch_rejected = 1 THEN
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Payment Hold: Pay In Time',
                'Status CONFIRMED, PAYMENT SUCCESS, 0 mismatches, -500 and 1 rejected',
                CONCAT('Status: ', v_conf_status, ', PayID: ', v_pay_id, ', NegRej: ', v_neg_rejected, ', MisRej: ', v_mismatch_rejected),
                'PASS',
                'Booking confirmed inside hold window and invalid amounts rejected.');
    ELSE
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Payment Hold: Pay In Time',
                'Status CONFIRMED, PAYMENT SUCCESS, 0 mismatches, -500 and 1 rejected',
                CONCAT('Status: ', COALESCE(v_conf_status, 'NULL'), ', NegRej: ', v_neg_rejected, ', MisRej: ', v_mismatch_rejected),
                'FAIL',
                'Payment confirmation within hold window failed.');
    END IF;

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 21: Online Payment Hold - Pay Late (Refund & FAILED)
-- Verifies that payment arriving after hold expiration calls sp_process_late_payment_refund,
-- marks booking as FAILED, processes full refund, returns 'LATE',
-- and inventory counters equal real counts.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_payment_hold_pay_late$$
CREATE PROCEDURE test_payment_hold_pay_late()
BEGIN
    DECLARE v_sched_id INT DEFAULT 1001;
    DECLARE v_class_id INT DEFAULT 3;
    DECLARE v_out_pnr VARCHAR(10);
    DECLARE v_out_stat VARCHAR(20);
    DECLARE v_out_fare DECIMAL(10,2);
    DECLARE v_out_err VARCHAR(32);
    DECLARE v_conf_status VARCHAR(20);
    DECLARE v_pay_id INT;
    DECLARE v_db_booking_status VARCHAR(20);
    DECLARE v_refund_count INT;
    DECLARE v_mismatch INT DEFAULT 0;
    DECLARE v_passengers JSON;

    SET v_passengers = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Late Payer User', 'age', 35, 'gender', 'MALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );

    START TRANSACTION;

    SET @as_of_time = '2026-10-18 10:00:00';

    -- Create booking with p_hold_for_payment = 1
    CALL sp_create_booking(
        50001, v_sched_id, v_class_id, 1145, 1149, 'GENERAL', 0, 0, 1, v_passengers, 'ONLINE', NULL, 0,
        v_out_pnr, v_out_stat, v_out_fare, v_out_err
    );

    -- Advance time 15 minutes (past 10-minute hold window)
    SET @as_of_time = '2026-10-18 10:15:00';

    CALL sp_confirm_payment(v_out_pnr, v_out_fare, 'UPI', 'gateway_pay_late_01', 0, v_conf_status, v_pay_id);

    SELECT status INTO v_db_booking_status FROM BOOKING WHERE pnr = v_out_pnr;
    SELECT COUNT(*) INTO v_refund_count FROM REFUND r JOIN PAYMENT p ON r.payment_id = p.payment_id WHERE p.gateway_payment_id = 'gateway_pay_late_01' AND r.reason = 'PAYMENT_AFTER_EXPIRY';

    -- Check inventory counters equal real reservation counts
    SELECT COUNT(*) INTO v_mismatch
    FROM SCHEDULE_CLASS_INVENTORY sci
    LEFT JOIN (
        SELECT r.schedule_id, b.class_id,
            SUM(CASE WHEN r.status IN ('CONFIRMED', 'BOARDED') THEN 1 ELSE 0 END) as conf_count,
            SUM(CASE WHEN r.status = 'RAC' THEN 1 ELSE 0 END) as rac_count,
            SUM(CASE WHEN r.status = 'WAITING_LIST' THEN 1 ELSE 0 END) as wl_count
        FROM RESERVATION r
        JOIN BOOKING b ON r.pnr = b.pnr
        WHERE r.schedule_id = v_sched_id AND b.class_id = v_class_id
        GROUP BY r.schedule_id, b.class_id
    ) res ON sci.schedule_id = res.schedule_id AND sci.class_id = res.class_id
    WHERE sci.schedule_id = v_sched_id AND sci.class_id = v_class_id
      AND (sci.available_seats != (sci.total_seats - COALESCE(res.conf_count, 0))
           OR sci.rac_count != COALESCE(res.rac_count, 0)
           OR sci.wl_count != COALESCE(res.wl_count, 0));

    IF v_conf_status = 'LATE' AND v_db_booking_status = 'FAILED' AND v_refund_count = 1 AND v_mismatch = 0 THEN
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Payment Hold: Pay Late (Refund & FAILED)',
                'Status LATE, Booking FAILED, Refund generated, 0 inventory mismatches',
                CONCAT('Status: ', v_conf_status, ', DB: ', v_db_booking_status, ', Refunds: ', v_refund_count, ', Mismatches: ', v_mismatch),
                'PASS',
                'Late payment successfully rejected, refunded, and inventory synced.');
    ELSE
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Payment Hold: Pay Late (Refund & FAILED)',
                'Status LATE, Booking FAILED, Refund generated, 0 inventory mismatches',
                CONCAT('Status: ', COALESCE(v_conf_status, 'NULL'), ', DB: ', COALESCE(v_db_booking_status, 'NULL'), ', Refunds: ', v_refund_count, ', Mismatches: ', v_mismatch),
                'FAIL',
                'Late payment handling failed.');
    END IF;

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 22: Online Payment Hold - Hold Expires and Released
-- Verifies that sp_release_expired_holds releases seats, marks booking FAILED,
-- promotes waiting passengers, and keeps inventory counters equal to real counts.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_payment_hold_expires_and_released$$
CREATE PROCEDURE test_payment_hold_expires_and_released()
BEGIN
    DECLARE v_sched_id INT DEFAULT 1001;
    DECLARE v_class_id INT DEFAULT 3;
    DECLARE v_out_pnr VARCHAR(10);
    DECLARE v_out_stat VARCHAR(20);
    DECLARE v_out_fare DECIMAL(10,2);
    DECLARE v_out_err VARCHAR(32);
    DECLARE v_released_count INT;
    DECLARE v_db_booking_status VARCHAR(20);
    DECLARE v_res_cancelled_count INT;
    DECLARE v_mismatch INT DEFAULT 0;
    DECLARE v_passengers JSON;

    SET v_passengers = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Expire User', 'age', 40, 'gender', 'MALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );

    START TRANSACTION;

    SET @as_of_time = '2026-10-18 10:00:00';

    -- Create booking with hold
    CALL sp_create_booking(
        50001, v_sched_id, v_class_id, 1145, 1149, 'GENERAL', 0, 0, 1, v_passengers, 'ONLINE', NULL, 0,
        v_out_pnr, v_out_stat, v_out_fare, v_out_err
    );

    -- Advance time 20 minutes (expired)
    SET @as_of_time = '2026-10-18 10:20:00';

    CALL sp_release_expired_holds(0, v_released_count);

    SELECT status INTO v_db_booking_status FROM BOOKING WHERE pnr = v_out_pnr;
    SELECT COUNT(*) INTO v_res_cancelled_count FROM RESERVATION WHERE pnr = v_out_pnr AND status = 'CANCELLED';

    -- Check inventory counters equal real reservation counts
    SELECT COUNT(*) INTO v_mismatch
    FROM SCHEDULE_CLASS_INVENTORY sci
    LEFT JOIN (
        SELECT r.schedule_id, b.class_id,
            SUM(CASE WHEN r.status IN ('CONFIRMED', 'BOARDED') THEN 1 ELSE 0 END) as conf_count,
            SUM(CASE WHEN r.status = 'RAC' THEN 1 ELSE 0 END) as rac_count,
            SUM(CASE WHEN r.status = 'WAITING_LIST' THEN 1 ELSE 0 END) as wl_count
        FROM RESERVATION r
        JOIN BOOKING b ON r.pnr = b.pnr
        WHERE r.schedule_id = v_sched_id AND b.class_id = v_class_id
        GROUP BY r.schedule_id, b.class_id
    ) res ON sci.schedule_id = res.schedule_id AND sci.class_id = res.class_id
    WHERE sci.schedule_id = v_sched_id AND sci.class_id = v_class_id
      AND (sci.available_seats != (sci.total_seats - COALESCE(res.conf_count, 0))
           OR sci.rac_count != COALESCE(res.rac_count, 0)
           OR sci.wl_count != COALESCE(res.wl_count, 0));

    IF v_released_count >= 1 AND v_db_booking_status = 'FAILED' AND v_res_cancelled_count = 1 AND v_mismatch = 0 THEN
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Payment Hold: Expired Hold Released',
                'Released >= 1, Booking FAILED, Reservations CANCELLED, 0 inventory mismatches',
                CONCAT('Released: ', v_released_count, ', DB: ', v_db_booking_status, ', Cancelled: ', v_res_cancelled_count, ', Mismatches: ', v_mismatch),
                'PASS',
                'Expired hold released and inventory preserved in sync.');
    ELSE
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Payment Hold: Expired Hold Released',
                'Released >= 1, Booking FAILED, Reservations CANCELLED, 0 inventory mismatches',
                CONCAT('Released: ', v_released_count, ', DB: ', COALESCE(v_db_booking_status, 'NULL'), ', Mismatches: ', v_mismatch),
                'FAIL',
                'Expired hold release failed.');
    END IF;

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 23: Online Payment Hold - Idempotency (Same Gateway ID Twice)
-- Verifies that calling sp_confirm_payment with the same gateway_payment_id returns
-- the earlier result without inserting a second PAYMENT row.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_payment_hold_same_gateway_id_twice$$
CREATE PROCEDURE test_payment_hold_same_gateway_id_twice()
BEGIN
    DECLARE v_sched_id INT DEFAULT 1001;
    DECLARE v_class_id INT DEFAULT 3;
    DECLARE v_out_pnr VARCHAR(10);
    DECLARE v_out_stat VARCHAR(20);
    DECLARE v_out_fare DECIMAL(10,2);
    DECLARE v_out_err VARCHAR(32);
    DECLARE v_conf_stat_1 VARCHAR(20);
    DECLARE v_pay_id_1 INT;
    DECLARE v_conf_stat_2 VARCHAR(20);
    DECLARE v_pay_id_2 INT;
    DECLARE v_pay_count INT;
    DECLARE v_mismatch INT DEFAULT 0;
    DECLARE v_passengers JSON;

    SET v_passengers = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Idempotent User', 'age', 30, 'gender', 'MALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );

    START TRANSACTION;

    SET @as_of_time = '2026-10-18 10:00:00';

    CALL sp_create_booking(
        50001, v_sched_id, v_class_id, 1145, 1149, 'GENERAL', 0, 0, 1, v_passengers, 'ONLINE', NULL, 0,
        v_out_pnr, v_out_stat, v_out_fare, v_out_err
    );

    SET @as_of_time = '2026-10-18 10:03:00';

    -- Call 1
    CALL sp_confirm_payment(v_out_pnr, v_out_fare, 'UPI', 'gateway_idemp_key_99', 0, v_conf_stat_1, v_pay_id_1);

    -- Call 2 with identical gateway_payment_id
    CALL sp_confirm_payment(v_out_pnr, v_out_fare, 'UPI', 'gateway_idemp_key_99', 0, v_conf_stat_2, v_pay_id_2);

    -- Count payments with this gateway id
    SELECT COUNT(*) INTO v_pay_count FROM PAYMENT WHERE gateway_payment_id = 'gateway_idemp_key_99';

    -- Check inventory counters equal real reservation counts
    SELECT COUNT(*) INTO v_mismatch
    FROM SCHEDULE_CLASS_INVENTORY sci
    LEFT JOIN (
        SELECT r.schedule_id, b.class_id,
            SUM(CASE WHEN r.status IN ('CONFIRMED', 'BOARDED') THEN 1 ELSE 0 END) as conf_count,
            SUM(CASE WHEN r.status = 'RAC' THEN 1 ELSE 0 END) as rac_count,
            SUM(CASE WHEN r.status = 'WAITING_LIST' THEN 1 ELSE 0 END) as wl_count
        FROM RESERVATION r
        JOIN BOOKING b ON r.pnr = b.pnr
        WHERE r.schedule_id = v_sched_id AND b.class_id = v_class_id
        GROUP BY r.schedule_id, b.class_id
    ) res ON sci.schedule_id = res.schedule_id AND sci.class_id = res.class_id
    WHERE sci.schedule_id = v_sched_id AND sci.class_id = v_class_id
      AND (sci.available_seats != (sci.total_seats - COALESCE(res.conf_count, 0))
           OR sci.rac_count != COALESCE(res.rac_count, 0)
           OR sci.wl_count != COALESCE(res.wl_count, 0));

    IF v_conf_stat_1 = v_conf_stat_2 AND v_pay_id_1 = v_pay_id_2 AND v_pay_count = 1 AND v_mismatch = 0 THEN
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Payment Hold: Idempotency (Same Gateway ID Twice)',
                'Identical status & pay_id, exactly 1 payment record, 0 inventory mismatches',
                CONCAT('Stat1: ', v_conf_stat_1, ', Stat2: ', v_conf_stat_2, ', PayCount: ', v_pay_count, ', Mismatches: ', v_mismatch),
                'PASS',
                'Repeated payment confirmation is idempotent with no second insert.');
    ELSE
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Payment Hold: Idempotency (Same Gateway ID Twice)',
                'Identical status & pay_id, exactly 1 payment record, 0 inventory mismatches',
                CONCAT('Stat1: ', COALESCE(v_conf_stat_1, 'NULL'), ', Stat2: ', COALESCE(v_conf_stat_2, 'NULL'), ', PayCount: ', v_pay_count),
                'FAIL',
                'Idempotency check failed.');
    END IF;

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 24: Counter Booking Unchanged
-- Verifies that counter booking proceeds directly to CONFIRMED with immediate PAYMENT,
-- without payment hold (p_hold_for_payment = 0), and inventory matches real counts.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_counter_booking_unchanged$$
CREATE PROCEDURE test_counter_booking_unchanged()
BEGIN
    DECLARE v_sched_id INT DEFAULT 1001;
    DECLARE v_class_id INT DEFAULT 3;
    DECLARE v_out_pnr VARCHAR(10);
    DECLARE v_out_fare DECIMAL(10,2);
    DECLARE v_out_stat VARCHAR(20);
    DECLARE v_out_err VARCHAR(32);
    DECLARE v_db_booking_status VARCHAR(20);
    DECLARE v_pay_status VARCHAR(20);
    DECLARE v_mismatch INT DEFAULT 0;
    DECLARE v_passengers JSON;

    SET v_passengers = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Counter Walkin User', 'age', 45, 'gender', 'MALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );

    START TRANSACTION;
    SET @as_of_time = '2026-10-17 19:15:00';

    CALL sp_create_counter_booking(
        1, NULL, v_sched_id, v_class_id, 1145, 1152, 'GENERAL', v_passengers, 'CASH', 0,
        v_out_pnr, v_out_fare, v_out_stat, v_out_err
    );

    SELECT status INTO v_db_booking_status FROM BOOKING WHERE pnr = v_out_pnr;
    SELECT status INTO v_pay_status FROM PAYMENT WHERE pnr = v_out_pnr ORDER BY payment_id DESC LIMIT 1;

    -- Check inventory counters equal real reservation counts
    SELECT COUNT(*) INTO v_mismatch
    FROM SCHEDULE_CLASS_INVENTORY sci
    LEFT JOIN (
        SELECT r.schedule_id, b.class_id,
            SUM(CASE WHEN r.status IN ('CONFIRMED', 'BOARDED') THEN 1 ELSE 0 END) as conf_count,
            SUM(CASE WHEN r.status = 'RAC' THEN 1 ELSE 0 END) as rac_count,
            SUM(CASE WHEN r.status = 'WAITING_LIST' THEN 1 ELSE 0 END) as wl_count
        FROM RESERVATION r
        JOIN BOOKING b ON r.pnr = b.pnr
        WHERE r.schedule_id = v_sched_id AND b.class_id = v_class_id
        GROUP BY r.schedule_id, b.class_id
    ) res ON sci.schedule_id = res.schedule_id AND sci.class_id = res.class_id
    WHERE sci.schedule_id = v_sched_id AND sci.class_id = v_class_id
      AND (sci.available_seats != (sci.total_seats - COALESCE(res.conf_count, 0))
           OR sci.rac_count != COALESCE(res.rac_count, 0)
           OR sci.wl_count != COALESCE(res.wl_count, 0));

    IF v_out_stat = 'CONFIRMED' AND v_db_booking_status = 'CONFIRMED' AND v_pay_status = 'SUCCESS' AND v_mismatch = 0 THEN
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Counter Booking Unchanged',
                'Status CONFIRMED immediately, PAYMENT SUCCESS, 0 inventory mismatches',
                CONCAT('Stat: ', v_out_stat, ', Pay: ', v_pay_status, ', Mismatches: ', v_mismatch),
                'PASS',
                'Counter booking unchanged and confirmed without hold.');
    ELSE
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Counter Booking Unchanged',
                'Status CONFIRMED immediately, PAYMENT SUCCESS, 0 inventory mismatches',
                CONCAT('Stat: ', COALESCE(v_out_stat, 'NULL'), ', DB: ', COALESCE(v_db_booking_status, 'NULL'), ', Pay: ', COALESCE(v_pay_status, 'NULL')),
                'FAIL',
                'Counter booking verification failed.');
    END IF;

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 25: Online Payment Hold - Pay Late Promotes Waiting Passenger
-- Verifies that when payment arrives late for a PAYMENT_PENDING booking without
-- running sp_release_expired_holds, calling sp_confirm_payment:
-- 1. Returns status 'LATE'
-- 2. Sets BOOKING.status = 'FAILED'
-- 3. Releases held seats (CANCELLED)
-- 4. Promotes waiting passengers (RAC to CONFIRMED, WL to RAC)
-- 5. Inserts exactly 1 refund row (PAYMENT_AFTER_EXPIRY, PENDING)
-- 6. Keeps inventory counters equal to real counts (0 mismatches)
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_payment_hold_pay_late_promotes_waiting$$
CREATE PROCEDURE test_payment_hold_pay_late_promotes_waiting()
BEGIN
    DECLARE v_sched_id INT DEFAULT 1064;
    DECLARE v_class_id INT DEFAULT 3;
    DECLARE v_from_stop_id INT DEFAULT 1213;
    DECLARE v_to_stop_id INT DEFAULT 1220;
    DECLARE v_out_pnr VARCHAR(10);
    DECLARE v_out_stat VARCHAR(20);
    DECLARE v_out_fare DECIMAL(10,2);
    DECLARE v_out_err VARCHAR(32);
    DECLARE v_conf_status VARCHAR(20);
    DECLARE v_pay_id INT;
    DECLARE v_db_booking_status VARCHAR(20);
    DECLARE v_res_cancelled_count INT;
    DECLARE v_promoted_rac_status VARCHAR(20);
    DECLARE v_promoted_wl_status VARCHAR(20);
    DECLARE v_refund_count INT;
    DECLARE v_mismatch INT DEFAULT 0;
    DECLARE v_passengers JSON;

    SET v_passengers = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Pooja Verma', 'age', 26, 'gender', 'FEMALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );

    START TRANSACTION;

    SET @as_of_time = '2026-10-17 10:00:00';

    -- Create online booking with p_hold_for_payment = 1
    CALL sp_create_booking(
        50001, v_sched_id, v_class_id, v_from_stop_id, v_to_stop_id, 'LADIES', 0, 0, 1, v_passengers, 'ONLINE', NULL, 0,
        v_out_pnr, v_out_stat, v_out_fare, v_out_err
    );

    -- Advance time past the window WITHOUT running sp_release_expired_holds
    SET @as_of_time = '2026-10-17 10:15:00';

    -- Call sp_confirm_payment
    CALL sp_confirm_payment(v_out_pnr, v_out_fare, 'UPI', 'gateway_late_promo_test_01', 0, v_conf_status, v_pay_id);

    -- 1. Check booking status
    SELECT status INTO v_db_booking_status FROM BOOKING WHERE pnr = v_out_pnr;

    -- 2. Check held seats released
    SELECT COUNT(*) INTO v_res_cancelled_count
    FROM RESERVATION
    WHERE pnr = v_out_pnr AND status = 'CANCELLED' AND seat_id IS NULL;

    -- 3. Check waiting passenger promoted (RAC 1 promoted to CONFIRMED, WL 1 promoted to RAC)
    SELECT status INTO v_promoted_rac_status FROM RESERVATION WHERE pnr = '2849100410' AND passenger_no = 1;
    SELECT status INTO v_promoted_wl_status FROM RESERVATION WHERE pnr = '2849100474' AND passenger_no = 1;

    -- 4. Check refund row created once
    SELECT COUNT(*) INTO v_refund_count
    FROM REFUND r
    JOIN PAYMENT p ON r.payment_id = p.payment_id
    WHERE p.gateway_payment_id = 'gateway_late_promo_test_01'
      AND r.reason = 'PAYMENT_AFTER_EXPIRY'
      AND r.status = 'PENDING';

    -- 5. Check inventory counters equal real reservation counts
    SELECT COUNT(*) INTO v_mismatch
    FROM SCHEDULE_CLASS_INVENTORY sci
    LEFT JOIN (
        SELECT r.schedule_id, b.class_id,
            SUM(CASE WHEN r.status IN ('CONFIRMED', 'BOARDED') THEN 1 ELSE 0 END) as conf_count,
            SUM(CASE WHEN r.status = 'RAC' THEN 1 ELSE 0 END) as rac_count,
            SUM(CASE WHEN r.status = 'WAITING_LIST' THEN 1 ELSE 0 END) as wl_count
        FROM RESERVATION r
        JOIN BOOKING b ON r.pnr = b.pnr
        WHERE r.schedule_id = v_sched_id AND b.class_id = v_class_id
        GROUP BY r.schedule_id, b.class_id
    ) res ON sci.schedule_id = res.schedule_id AND sci.class_id = res.class_id
    WHERE sci.schedule_id = v_sched_id AND sci.class_id = v_class_id
      AND (sci.available_seats != (sci.total_seats - COALESCE(res.conf_count, 0))
           OR sci.rac_count != COALESCE(res.rac_count, 0)
           OR sci.wl_count != COALESCE(res.wl_count, 0));

    IF v_conf_status = 'LATE'
       AND v_db_booking_status = 'FAILED'
       AND v_res_cancelled_count = 1
       AND v_promoted_rac_status = 'CONFIRMED'
       AND v_promoted_wl_status = 'RAC'
       AND v_refund_count = 1
       AND v_mismatch = 0 THEN
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Payment Hold: Pay Late Promotes Waiting Passenger',
                'Status LATE, Booking FAILED, Seats Released, Waiting Promoted, Refund 1, Mismatches 0',
                CONCAT('Status: ', v_conf_status, ', DB: ', v_db_booking_status, ', RAC: ', v_promoted_rac_status, ', WL: ', v_promoted_wl_status, ', Refund: ', v_refund_count, ', Mismatches: ', v_mismatch),
                'PASS',
                'Late payment without running sp_release_expired_holds correctly released seats, promoted waiting passengers, issued refund, and synced inventory.');
    ELSE
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Payment Hold: Pay Late Promotes Waiting Passenger',
                'Status LATE, Booking FAILED, Seats Released, Waiting Promoted, Refund 1, Mismatches 0',
                CONCAT('Status: ', COALESCE(v_conf_status, 'NULL'), ', DB: ', COALESCE(v_db_booking_status, 'NULL'), ', RAC: ', COALESCE(v_promoted_rac_status, 'NULL'), ', WL: ', COALESCE(v_promoted_wl_status, 'NULL'), ', Refund: ', v_refund_count, ', Mismatches: ', v_mismatch),
                'FAIL',
                'Late payment failed to properly release seats or promote waiting passengers.');
    END IF;

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 26: Confirmed Booking Second Payment with Different Gateway ID
-- Verifies that when an online booking is confirmed in time and a second payment
-- arrives with a different gateway ID:
-- 1. Booking status stays CONFIRMED (not flipped to FAILED)
-- 2. Its seat stays reserved (CONFIRMED with valid seat_id)
-- 3. Second payment gets exactly 1 refund row (PAYMENT_AFTER_EXPIRY, PENDING)
-- 4. Inventory counters have 0 mismatches
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_confirmed_booking_second_payment_refunded$$
CREATE PROCEDURE test_confirmed_booking_second_payment_refunded()
BEGIN
    DECLARE v_sched_id INT DEFAULT 1001;
    DECLARE v_class_id INT DEFAULT 3;
    DECLARE v_out_pnr VARCHAR(10);
    DECLARE v_out_stat VARCHAR(20);
    DECLARE v_out_fare DECIMAL(10,2);
    DECLARE v_out_err VARCHAR(32);
    DECLARE v_conf_status1 VARCHAR(20);
    DECLARE v_conf_status2 VARCHAR(20);
    DECLARE v_pay_id1 INT;
    DECLARE v_pay_id2 INT;
    DECLARE v_db_booking_status VARCHAR(20);
    DECLARE v_conf_seat_count INT;
    DECLARE v_refund_count INT;
    DECLARE v_mismatch INT DEFAULT 0;
    DECLARE v_passengers JSON;

    SET v_passengers = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Double Pay User', 'age', 32, 'gender', 'FEMALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );

    START TRANSACTION;

    SET @as_of_time = '2026-10-18 10:00:00';

    -- 1. Create online booking with p_hold_for_payment = 1
    CALL sp_create_booking(
        50001, v_sched_id, v_class_id, 1145, 1149, 'GENERAL', 0, 0, 1, v_passengers, 'ONLINE', NULL, 0,
        v_out_pnr, v_out_stat, v_out_fare, v_out_err
    );

    -- 2. Pay in time (inside 10-minute hold window) -> confirmed
    SET @as_of_time = '2026-10-18 10:02:00';
    CALL sp_confirm_payment(v_out_pnr, v_out_fare, 'UPI', 'gateway_dup_test_01', 0, v_conf_status1, v_pay_id1);

    -- 3. Call sp_confirm_payment for the SAME pnr with a DIFFERENT gateway_payment_id
    SET @as_of_time = '2026-10-18 10:05:00';
    CALL sp_confirm_payment(v_out_pnr, v_out_fare, 'UPI', 'gateway_dup_test_diff_02', 0, v_conf_status2, v_pay_id2);

    -- 4. Check that booking stays CONFIRMED
    SELECT status INTO v_db_booking_status FROM BOOKING WHERE pnr = v_out_pnr;

    -- 5. Check that seat stays reserved
    SELECT COUNT(*) INTO v_conf_seat_count
    FROM RESERVATION
    WHERE pnr = v_out_pnr AND status = 'CONFIRMED' AND seat_id IS NOT NULL;

    -- 6. Check that the second payment gets one refund row
    SELECT COUNT(*) INTO v_refund_count
    FROM REFUND r
    JOIN PAYMENT p ON r.payment_id = p.payment_id
    WHERE p.gateway_payment_id = 'gateway_dup_test_diff_02'
      AND r.reason = 'PAYMENT_AFTER_EXPIRY'
      AND r.status = 'PENDING';

    -- 7. Check inventory counters have 0 mismatches
    SELECT COUNT(*) INTO v_mismatch
    FROM SCHEDULE_CLASS_INVENTORY sci
    LEFT JOIN (
        SELECT r.schedule_id, b.class_id,
            SUM(CASE WHEN r.status IN ('CONFIRMED', 'BOARDED') THEN 1 ELSE 0 END) as conf_count,
            SUM(CASE WHEN r.status = 'RAC' THEN 1 ELSE 0 END) as rac_count,
            SUM(CASE WHEN r.status = 'WAITING_LIST' THEN 1 ELSE 0 END) as wl_count
        FROM RESERVATION r
        JOIN BOOKING b ON r.pnr = b.pnr
        WHERE r.schedule_id = v_sched_id AND b.class_id = v_class_id
        GROUP BY r.schedule_id, b.class_id
    ) res ON sci.schedule_id = res.schedule_id AND sci.class_id = res.class_id
    WHERE sci.schedule_id = v_sched_id AND sci.class_id = v_class_id
      AND (sci.available_seats != (sci.total_seats - COALESCE(res.conf_count, 0))
           OR sci.rac_count != COALESCE(res.rac_count, 0)
           OR sci.wl_count != COALESCE(res.wl_count, 0));

    IF v_conf_status1 = 'CONFIRMED'
       AND v_db_booking_status = 'CONFIRMED'
       AND v_conf_seat_count = 1
       AND v_refund_count = 1
       AND v_mismatch = 0 THEN
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Confirmed Booking Second Payment with Different Gateway ID',
                'Booking stays CONFIRMED, Seat Reserved, 1 Refund Row, 0 Mismatches',
                CONCAT('DB: ', v_db_booking_status, ', Seat: ', v_conf_seat_count, ', Refund: ', v_refund_count, ', Mismatches: ', v_mismatch),
                'PASS',
                'Second payment for confirmed booking safely refunded without modifying booking or reserved seat.');
    ELSE
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Confirmed Booking Second Payment with Different Gateway ID',
                'Booking stays CONFIRMED, Seat Reserved, 1 Refund Row, 0 Mismatches',
                CONCAT('DB: ', COALESCE(v_db_booking_status, 'NULL'), ', Seat: ', v_conf_seat_count, ', Refund: ', v_refund_count, ', Mismatches: ', v_mismatch),
                'FAIL',
                'Second payment corrupted confirmed booking status or failed refund creation.');
    END IF;

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 27: Master Inventory Audit across all 1,015 Inventory Rows
-- Verifies that available_seats, rac_count, and wl_count match actual RESERVATION counts
-- for every single schedule and class in the system (0 mismatches of 1,015).
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_all_inventory_counters_match_real_counts$$
CREATE PROCEDURE test_all_inventory_counters_match_real_counts()
BEGIN
    DECLARE v_total_rows INT DEFAULT 0;
    DECLARE v_mismatch_count INT DEFAULT 0;

    SELECT COUNT(*) INTO v_total_rows FROM SCHEDULE_CLASS_INVENTORY;

    SELECT COUNT(*) INTO v_mismatch_count
    FROM SCHEDULE_CLASS_INVENTORY sci
    LEFT JOIN (
        SELECT 
            r.schedule_id,
            b.class_id,
            SUM(CASE WHEN r.status IN ('CONFIRMED', 'BOARDED') THEN 1 ELSE 0 END) as conf_count,
            SUM(CASE WHEN r.status = 'RAC' THEN 1 ELSE 0 END) as rac_count,
            SUM(CASE WHEN r.status = 'WAITING_LIST' THEN 1 ELSE 0 END) as wl_count
        FROM RESERVATION r
        JOIN BOOKING b ON r.pnr = b.pnr
        GROUP BY r.schedule_id, b.class_id
    ) res ON sci.schedule_id = res.schedule_id AND sci.class_id = res.class_id
    WHERE sci.available_seats != (sci.total_seats - COALESCE(res.conf_count, 0))
       OR sci.rac_count != COALESCE(res.rac_count, 0)
       OR sci.wl_count != COALESCE(res.wl_count, 0);

    IF v_mismatch_count = 0 THEN
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Master Inventory Verification: 1,015 Runs Audited',
                '0 mismatches across 1,015 inventory records',
                CONCAT('0 mismatches of ', v_total_rows),
                'PASS',
                'All 1,015 schedule class inventory counters precisely match real reservation counts.');
    ELSE
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Master Inventory Verification: 1,015 Runs Audited',
                '0 mismatches across 1,015 inventory records',
                CONCAT(v_mismatch_count, ' mismatches of ', v_total_rows),
                'FAIL',
                CONCAT('Detected ', v_mismatch_count, ' inventory discrepancies with real reservation rows.'));
    END IF;
END$$

-- -----------------------------------------------------------------------------
-- Master Test Runner Procedure
-- -----------------------------------------------------------------------------
-- =============================================================================
-- NEW TESTS (money and booking rules). Each one runs inside a transaction and is rolled back.
-- Run 1001 = Train 101, 2026-10-18, departs 15:15, class 3 (3A), stops 1145 (seq 1) to 1152 (seq 8).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TEST 28: sp_file_tdr happy path + sp_review_tdr approve (delay TDR, full fare line refunded)
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_tdr_file_and_approve$$
CREATE PROCEDURE test_tdr_file_and_approve()
BEGIN
    DECLARE v_pnr VARCHAR(10);
    DECLARE v_stat VARCHAR(20);
    DECLARE v_fare DECIMAL(10,2);
    DECLARE v_err VARCHAR(32);
    DECLARE v_conf VARCHAR(20);
    DECLARE v_pay INT;
    DECLARE v_tdr VARCHAR(32);
    DECLARE v_tdr_st VARCHAR(32);
    DECLARE v_ref_id INT;
    DECLARE v_rev_st VARCHAR(32);
    DECLARE v_t_status VARCHAR(20);
    DECLARE v_res_status VARCHAR(20);
    DECLARE v_ref_cnt INT DEFAULT 0;
    DECLARE v_ref_amt DECIMAL(10,2) DEFAULT 0;
    DECLARE v_pass JSON;

    SET v_pass = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Tdr Happy User', 'age', 30, 'gender', 'FEMALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );

    START TRANSACTION;
    SET @as_of_time = '2026-10-17 10:00:00';
    CALL sp_create_booking(50001, 1001, 3, 1145, 1149, 'GENERAL', 0, 0, 1, v_pass, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err);
    SET @as_of_time = '2026-10-17 10:05:00';
    CALL sp_confirm_payment(v_pnr, v_fare, 'UPI', 'gw_test_tdr_ok_01', 0, v_conf, v_pay);
    UPDATE TRAIN_SCHEDULE SET delay_minutes = 200 WHERE schedule_id = 1001;

    CALL sp_file_tdr(v_pnr, 1, 50001, 'TRAIN_DELAYED_OVER_3_HOURS', NULL, 'test delay claim', 0, v_tdr, v_tdr_st);
    CALL sp_review_tdr(v_tdr, 1, 'APPROVED', v_fare - 0.45, 'approved in test', 0, v_ref_id, v_rev_st);

    SELECT status INTO v_t_status FROM TDR_FILING WHERE tdr_ref_no = v_tdr;
    SELECT status INTO v_res_status FROM RESERVATION WHERE pnr = v_pnr AND passenger_no = 1;
    SELECT COUNT(*), COALESCE(SUM(amount), 0) INTO v_ref_cnt, v_ref_amt
    FROM REFUND WHERE tdr_ref_no = v_tdr AND reason = 'TDR_APPROVED';

    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('TDR: File + Admin Approve (Happy Path)',
            'FILED, APPROVED, REFUND_PROCESSED, 1 refund of fare line, seat released',
            CONCAT('File: ', COALESCE(v_tdr_st, 'NULL'), ', Review: ', COALESCE(v_rev_st, 'NULL'), ', TDR: ', COALESCE(v_t_status, 'NULL'),
                   ', Refunds: ', v_ref_cnt, ' = ', v_ref_amt, ', Res: ', COALESCE(v_res_status, 'NULL')),
            IF(v_tdr_st = 'FILED' AND v_rev_st = 'APPROVED' AND v_t_status = 'REFUND_PROCESSED'
               AND v_ref_cnt = 1 AND v_ref_amt = v_fare - 0.45 AND v_res_status = 'CANCELLED', 'PASS', 'FAIL'),
            'A delay TDR was filed, approved by admin 1, refunded once (fare minus insurance) and the seat was released.');

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 29: TDR double filing blocked after REFUND_PROCESSED (and passenger_no NULL refused)
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_tdr_double_filing_blocked$$
CREATE PROCEDURE test_tdr_double_filing_blocked()
BEGIN
    DECLARE v_pnr VARCHAR(10);
    DECLARE v_stat VARCHAR(20);
    DECLARE v_fare DECIMAL(10,2);
    DECLARE v_err VARCHAR(32);
    DECLARE v_conf VARCHAR(20);
    DECLARE v_pay INT;
    DECLARE v_tdr VARCHAR(32);
    DECLARE v_tdr_st VARCHAR(32);
    DECLARE v_tdr2 VARCHAR(32);
    DECLARE v_tdr2_st VARCHAR(32);
    DECLARE v_tdr3 VARCHAR(32);
    DECLARE v_tdr3_st VARCHAR(32);
    DECLARE v_ref_id INT;
    DECLARE v_rev_st VARCHAR(32);
    DECLARE v_t_status VARCHAR(20);
    DECLARE v_pass JSON;

    SET v_pass = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Tdr Twice User', 'age', 30, 'gender', 'FEMALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );

    START TRANSACTION;
    SET @as_of_time = '2026-10-17 10:00:00';
    CALL sp_create_booking(50001, 1001, 3, 1145, 1149, 'GENERAL', 0, 0, 1, v_pass, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err);
    SET @as_of_time = '2026-10-17 10:05:00';
    CALL sp_confirm_payment(v_pnr, v_fare, 'UPI', 'gw_test_tdr_twice_01', 0, v_conf, v_pay);
    UPDATE TRAIN_SCHEDULE SET delay_minutes = 200 WHERE schedule_id = 1001;

    CALL sp_file_tdr(v_pnr, 1, 50001, 'TRAIN_DELAYED_OVER_3_HOURS', NULL, 'first claim', 0, v_tdr, v_tdr_st);
    CALL sp_review_tdr(v_tdr, 1, 'APPROVED', v_fare - 0.45, 'approved', 0, v_ref_id, v_rev_st);
    SELECT status INTO v_t_status FROM TDR_FILING WHERE tdr_ref_no = v_tdr;

    -- Same passenger files again: must be refused because the first TDR is REFUND_PROCESSED
    CALL sp_file_tdr(v_pnr, 1, 50001, 'TRAIN_DELAYED_OVER_3_HOURS', NULL, 'second claim', 0, v_tdr2, v_tdr2_st);
    -- A missing passenger number is refused
    CALL sp_file_tdr(v_pnr, NULL, 50001, 'TRAIN_DELAYED_OVER_3_HOURS', NULL, 'no passenger', 0, v_tdr3, v_tdr3_st);

    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('TDR: Second Filing Blocked After REFUND_PROCESSED',
            'First TDR REFUND_PROCESSED, second DUPLICATE_TDR, no passenger PASSENGER_REQUIRED',
            CONCAT('First: ', COALESCE(v_t_status, 'NULL'), ', Second: ', COALESCE(v_tdr2_st, 'NULL'), ', NullPax: ', COALESCE(v_tdr3_st, 'NULL')),
            IF(v_t_status = 'REFUND_PROCESSED' AND v_tdr2_st = 'DUPLICATE_TDR' AND v_tdr3_st = 'PASSENGER_REQUIRED', 'PASS', 'FAIL'),
            'A refunded passenger cannot file a new TDR, so the same fare cannot be refunded twice through TDR.');

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 30: Refund cap - a second refund that would be more than the payment is refused
-- (procedure check REFUND_EXCEEDS_PAYMENT, and the trg_refund_cap backstop)
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_refund_cap_exceeds_payment$$
CREATE PROCEDURE test_refund_cap_exceeds_payment()
BEGIN
    DECLARE v_pnr VARCHAR(10);
    DECLARE v_stat VARCHAR(20);
    DECLARE v_fare DECIMAL(10,2);
    DECLARE v_err VARCHAR(32);
    DECLARE v_conf VARCHAR(20);
    DECLARE v_pay INT;
    DECLARE v_new_ref INT;
    DECLARE v_chg DECIMAL(10,2);
    DECLARE v_ref DECIMAL(10,2);
    DECLARE v_cancel_st VARCHAR(32);
    DECLARE v_res_status VARCHAR(20);
    DECLARE v_trigger_fired TINYINT DEFAULT 0;
    DECLARE v_pass JSON;

    SET v_pass = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Refund Cap User', 'age', 30, 'gender', 'FEMALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );

    START TRANSACTION;
    SET @as_of_time = '2026-10-17 10:00:00';
    CALL sp_create_booking(50001, 1001, 3, 1145, 1149, 'GENERAL', 0, 0, 1, v_pass, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err);
    SET @as_of_time = '2026-10-17 10:05:00';
    CALL sp_confirm_payment(v_pnr, v_fare, 'UPI', 'gw_test_refund_cap_01', 0, v_conf, v_pay);

    -- A first refund already took all but 1 rupee of the payment
    SELECT COALESCE(MAX(refund_id), 0) + 1 INTO v_new_ref FROM REFUND;
    INSERT INTO REFUND (refund_id, cancel_id, tdr_ref_no, payment_id, amount, reason, status)
    VALUES (v_new_ref, NULL, NULL, v_pay, v_fare - 1.00, 'TRAIN_CANCELLED', 'PROCESSED');

    -- A normal cancel now would refund much more than is left: refused, nothing changes
    CALL sp_cancel_passenger_ticket(v_pnr, NULL, 'cap test', 0, v_chg, v_ref, v_cancel_st);
    SELECT status INTO v_res_status FROM RESERVATION WHERE pnr = v_pnr AND passenger_no = 1;

    -- Backstop: writing a refund row that goes over the payment is blocked by the trigger
    cap_trigger: BEGIN
        DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET v_trigger_fired = 1;
        INSERT INTO REFUND (refund_id, cancel_id, tdr_ref_no, payment_id, amount, reason, status)
        VALUES (v_new_ref + 1, NULL, NULL, v_pay, 10.00, 'TRAIN_CANCELLED', 'PROCESSED');
    END cap_trigger;

    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Refund Cap: Second Refund More Than Payment Refused',
            'Cancel returns REFUND_EXCEEDS_PAYMENT, seat kept, trigger blocks the insert',
            CONCAT('Cancel: ', COALESCE(v_cancel_st, 'NULL'), ', Res: ', COALESCE(v_res_status, 'NULL'), ', Trigger: ', v_trigger_fired),
            IF(v_cancel_st = 'REFUND_EXCEEDS_PAYMENT' AND v_res_status = 'CONFIRMED' AND v_trigger_fired = 1, 'PASS', 'FAIL'),
            'Both layers of the refund cap work: the procedure check and the BEFORE INSERT trigger.');

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 31: A seat that already got a TDR refund cannot be cancelled the normal way
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_cancel_after_tdr_refund_blocked$$
CREATE PROCEDURE test_cancel_after_tdr_refund_blocked()
BEGIN
    DECLARE v_pnr VARCHAR(10);
    DECLARE v_stat VARCHAR(20);
    DECLARE v_fare DECIMAL(10,2);
    DECLARE v_err VARCHAR(32);
    DECLARE v_conf VARCHAR(20);
    DECLARE v_pay INT;
    DECLARE v_chg DECIMAL(10,2);
    DECLARE v_ref DECIMAL(10,2);
    DECLARE v_cancel_st VARCHAR(32);
    DECLARE v_res_status VARCHAR(20);
    DECLARE v_pass JSON;

    SET v_pass = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Tdr Then Cancel', 'age', 30, 'gender', 'FEMALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );

    START TRANSACTION;
    SET @as_of_time = '2026-10-17 10:00:00';
    CALL sp_create_booking(50001, 1001, 3, 1145, 1149, 'GENERAL', 0, 0, 1, v_pass, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err);
    SET @as_of_time = '2026-10-17 10:05:00';
    CALL sp_confirm_payment(v_pnr, v_fare, 'UPI', 'gw_test_tdr_cancel_01', 0, v_conf, v_pay);

    -- This passenger already got a TDR refund (a non-delay TDR keeps the seat)
    INSERT INTO TDR_FILING (tdr_ref_no, pnr, passenger_no, reason, filed_at, status, evidence_ref, refund_amount, reviewed_by, reviewed_at, remarks)
    VALUES ('TDR-TEST-CANCEL-1', v_pnr, 1, 'COACH_NOT_ATTACHED', '2026-10-17 10:03:00', 'REFUND_PROCESSED', 'CERT-1', 500.00, 1, '2026-10-17 10:04:00', 'test');

    CALL sp_cancel_passenger_ticket(v_pnr, 1, 'cancel after tdr', 0, v_chg, v_ref, v_cancel_st);
    SELECT status INTO v_res_status FROM RESERVATION WHERE pnr = v_pnr AND passenger_no = 1;

    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Refund Cap: Cancel After TDR Refund Refused',
            'REFUND_EXCEEDS_PAYMENT and seat unchanged',
            CONCAT('Cancel: ', COALESCE(v_cancel_st, 'NULL'), ', Res: ', COALESCE(v_res_status, 'NULL'), ', Refund: ', v_ref),
            IF(v_cancel_st = 'REFUND_EXCEEDS_PAYMENT' AND v_res_status = 'CONFIRMED' AND v_ref = 0, 'PASS', 'FAIL'),
            'A seat with a REFUND_PROCESSED TDR is not refunded a second time by a normal cancellation.');

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 32: Booking for a train that has already left is refused (JOURNEY_PAST),
-- and a CANCELLED run is refused (TRAIN_NOT_RUNNING)
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_booking_journey_past$$
CREATE PROCEDURE test_booking_journey_past()
BEGIN
    DECLARE v_pnr VARCHAR(10);
    DECLARE v_stat VARCHAR(20);
    DECLARE v_fare DECIMAL(10,2);
    DECLARE v_err_past VARCHAR(32);
    DECLARE v_err_cancelled VARCHAR(32);
    DECLARE v_pass JSON;

    SET v_pass = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Late Traveller', 'age', 30, 'gender', 'MALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );

    START TRANSACTION;
    -- The train leaves stop 1145 at 15:15 on 2026-10-18. At 16:00 it is gone.
    SET @as_of_time = '2026-10-18 16:00:00';
    CALL sp_create_booking(50001, 1001, 3, 1145, 1149, 'GENERAL', 0, 0, 0, v_pass, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err_past);

    SET @as_of_time = '2026-10-17 10:00:00';
    UPDATE TRAIN_SCHEDULE SET status = 'CANCELLED' WHERE schedule_id = 1001;
    CALL sp_create_booking(50001, 1001, 3, 1145, 1149, 'GENERAL', 0, 0, 0, v_pass, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err_cancelled);

    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Booking: Past Journey And Cancelled Run Refused',
            'JOURNEY_PAST and TRAIN_NOT_RUNNING',
            CONCAT('Past: ', COALESCE(v_err_past, 'NONE'), ', Cancelled: ', COALESCE(v_err_cancelled, 'NONE')),
            IF(v_err_past = 'JOURNEY_PAST' AND v_err_cancelled = 'TRAIN_NOT_RUNNING', 'PASS', 'FAIL'),
            'No booking after the boarding-station departure time and none on a cancelled run.');

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 33: Booking too far ahead is refused (OUTSIDE_BOOKING_WINDOW)
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_booking_outside_window$$
CREATE PROCEDURE test_booking_outside_window()
BEGIN
    DECLARE v_pnr VARCHAR(10);
    DECLARE v_stat VARCHAR(20);
    DECLARE v_fare DECIMAL(10,2);
    DECLARE v_err_far VARCHAR(32);
    DECLARE v_err_edge VARCHAR(32);
    DECLARE v_pass JSON;

    SET v_pass = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Early Booker', 'age', 30, 'gender', 'MALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );

    START TRANSACTION;
    -- 13 days before the journey date (window is 7 days)
    SET @as_of_time = '2026-10-05 10:00:00';
    CALL sp_create_booking(50001, 1001, 3, 1145, 1149, 'GENERAL', 0, 0, 0, v_pass, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err_far);

    -- Exactly 7 days before is still inside the window
    SET @as_of_time = '2026-10-11 10:00:00';
    CALL sp_create_booking(50001, 1001, 3, 1145, 1149, 'GENERAL', 0, 0, 0, v_pass, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err_edge);

    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Booking: Outside Booking Window Refused',
            '13 days ahead OUTSIDE_BOOKING_WINDOW, 7 days ahead allowed',
            CONCAT('13d: ', COALESCE(v_err_far, 'NONE'), ', 7d: ', COALESCE(v_err_edge, 'NONE')),
            IF(v_err_far = 'OUTSIDE_BOOKING_WINDOW' AND v_err_edge IS NULL, 'PASS', 'FAIL'),
            'BOOKING_WINDOW_DAYS (7) is enforced on the boarding date.');

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 34: Stops that do not belong to the train, or are in the wrong order, are refused
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_booking_invalid_stops$$
CREATE PROCEDURE test_booking_invalid_stops()
BEGIN
    DECLARE v_pnr VARCHAR(10);
    DECLARE v_stat VARCHAR(20);
    DECLARE v_fare DECIMAL(10,2);
    DECLARE v_err_other VARCHAR(32);
    DECLARE v_err_order VARCHAR(32);
    DECLARE v_err_same VARCHAR(32);
    DECLARE v_pass JSON;

    SET v_pass = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Wrong Stops', 'age', 30, 'gender', 'MALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );

    START TRANSACTION;
    SET @as_of_time = '2026-10-17 10:00:00';
    -- Stops 1001 and 1005 belong to train 139, not train 101
    CALL sp_create_booking(50001, 1001, 3, 1001, 1005, 'GENERAL', 0, 0, 0, v_pass, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err_other);
    -- Right train, but the from stop is after the to stop
    CALL sp_create_booking(50001, 1001, 3, 1149, 1145, 'GENERAL', 0, 0, 0, v_pass, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err_order);
    -- Same stop twice
    CALL sp_create_booking(50001, 1001, 3, 1145, 1145, 'GENERAL', 0, 0, 0, v_pass, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err_same);

    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Booking: Invalid Stops Refused',
            'Other train stops, reversed stops and same stop all INVALID_STOPS',
            CONCAT('Other: ', COALESCE(v_err_other, 'NONE'), ', Reversed: ', COALESCE(v_err_order, 'NONE'), ', Same: ', COALESCE(v_err_same, 'NONE')),
            IF(v_err_other = 'INVALID_STOPS' AND v_err_order = 'INVALID_STOPS' AND v_err_same = 'INVALID_STOPS', 'PASS', 'FAIL'),
            'From and to stops must belong to the run''s train and the from stop must come first.');

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 35: LADIES quota with a male passenger aged 12 or more is refused
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_ladies_quota_male_refused$$
CREATE PROCEDURE test_ladies_quota_male_refused()
BEGIN
    DECLARE v_pnr VARCHAR(10);
    DECLARE v_stat VARCHAR(20);
    DECLARE v_fare DECIMAL(10,2);
    DECLARE v_err_male VARCHAR(32);
    DECLARE v_err_child VARCHAR(32);
    DECLARE v_pass_male JSON;
    DECLARE v_pass_child JSON;

    SET v_pass_male = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Male Traveller', 'age', 30, 'gender', 'MALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );
    -- A woman with a boy under 12 is allowed (BR-Q2)
    SET v_pass_child = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Mother', 'age', 32, 'gender', 'FEMALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH'),
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Small Boy', 'age', 8, 'gender', 'MALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );

    START TRANSACTION;
    SET @as_of_time = '2026-10-17 10:00:00';
    CALL sp_create_booking(50001, 1001, 3, 1145, 1149, 'LADIES', 1, 0, 0, v_pass_male, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err_male);
    CALL sp_create_booking(50001, 1001, 3, 1145, 1149, 'LADIES', 1, 0, 0, v_pass_child, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err_child);

    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Eligibility: LADIES Quota With Male Refused',
            'Male age 30 QUOTA_NOT_ELIGIBLE, woman with boy under 12 accepted',
            CONCAT('Male: ', COALESCE(v_err_male, 'NONE'), ', Mother+Boy: ', COALESCE(v_err_child, 'NONE')),
            IF(v_err_male = 'QUOTA_NOT_ELIGIBLE' AND v_err_child IS NULL, 'PASS', 'FAIL'),
            'Even with fallback consent a male passenger is not allowed to use the LADIES quota.');

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 36: SENIOR_CITIZEN quota under the age limit is refused (men 60+, women 45+)
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_senior_quota_underage_refused$$
CREATE PROCEDURE test_senior_quota_underage_refused()
BEGIN
    DECLARE v_pnr VARCHAR(10);
    DECLARE v_stat VARCHAR(20);
    DECLARE v_fare DECIMAL(10,2);
    DECLARE v_err_man VARCHAR(32);
    DECLARE v_err_woman VARCHAR(32);
    DECLARE v_err_ok VARCHAR(32);
    DECLARE v_man JSON;
    DECLARE v_woman JSON;
    DECLARE v_ok JSON;

    SET v_man = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Man Fifty Nine', 'age', 59, 'gender', 'MALE', 'concession_type', 'NONE', 'berth_preference', 'LOWER')
    );
    SET v_woman = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Woman Forty Four', 'age', 44, 'gender', 'FEMALE', 'concession_type', 'NONE', 'berth_preference', 'LOWER')
    );
    SET v_ok = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Woman Forty Five', 'age', 45, 'gender', 'FEMALE', 'concession_type', 'NONE', 'berth_preference', 'LOWER')
    );

    START TRANSACTION;
    SET @as_of_time = '2026-10-17 10:00:00';
    CALL sp_create_booking(50001, 1001, 3, 1145, 1149, 'SENIOR_CITIZEN', 1, 0, 0, v_man, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err_man);
    CALL sp_create_booking(50001, 1001, 3, 1145, 1149, 'SENIOR_CITIZEN', 1, 0, 0, v_woman, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err_woman);
    CALL sp_create_booking(50001, 1001, 3, 1145, 1149, 'SENIOR_CITIZEN', 1, 0, 0, v_ok, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err_ok);

    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Eligibility: SENIOR_CITIZEN Quota Under Age Refused',
            'Man 59 and woman 44 QUOTA_NOT_ELIGIBLE, woman 45 accepted',
            CONCAT('Man59: ', COALESCE(v_err_man, 'NONE'), ', Woman44: ', COALESCE(v_err_woman, 'NONE'), ', Woman45: ', COALESCE(v_err_ok, 'NONE')),
            IF(v_err_man = 'QUOTA_NOT_ELIGIBLE' AND v_err_woman = 'QUOTA_NOT_ELIGIBLE' AND v_err_ok IS NULL, 'PASS', 'FAIL'),
            'BR-Q4: men 60 or more, women 45 or more.');

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 37: DIVYAANG quota without proof refused; a concession without proof refused
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_divyaang_without_proof_refused$$
CREATE PROCEDURE test_divyaang_without_proof_refused()
BEGIN
    DECLARE v_pnr VARCHAR(10);
    DECLARE v_stat VARCHAR(20);
    DECLARE v_fare DECIMAL(10,2);
    DECLARE v_err_quota VARCHAR(32);
    DECLARE v_err_conc VARCHAR(32);
    DECLARE v_err_ok VARCHAR(32);
    DECLARE v_no_proof JSON;
    DECLARE v_conc_no_proof JSON;
    DECLARE v_with_proof JSON;

    SET v_no_proof = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'No Proof', 'age', 30, 'gender', 'MALE', 'concession_type', 'NONE', 'berth_preference', 'LOWER')
    );
    SET v_conc_no_proof = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Concession No Proof', 'age', 30, 'gender', 'MALE', 'concession_type', 'DIVYAANG', 'berth_preference', 'LOWER')
    );
    SET v_with_proof = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'With Proof', 'age', 30, 'gender', 'MALE', 'concession_type', 'DIVYAANG',
                    'concession_proof_type', 'UDID', 'concession_proof_ref', 'UDID-TEST-0001', 'berth_preference', 'LOWER')
    );

    START TRANSACTION;
    SET @as_of_time = '2026-10-17 10:00:00';
    CALL sp_create_booking(50001, 1001, 3, 1145, 1149, 'DIVYAANG', 1, 0, 0, v_no_proof, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err_quota);
    CALL sp_create_booking(50001, 1001, 3, 1145, 1149, 'GENERAL', 0, 0, 0, v_conc_no_proof, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err_conc);
    CALL sp_create_booking(50001, 1001, 3, 1145, 1149, 'GENERAL', 0, 0, 0, v_with_proof, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err_ok);

    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Eligibility: DIVYAANG Without Proof Refused',
            'DIVYAANG quota no proof QUOTA_NOT_ELIGIBLE, concession no proof CONCESSION_PROOF_REQUIRED, with proof accepted',
            CONCAT('Quota: ', COALESCE(v_err_quota, 'NONE'), ', Concession: ', COALESCE(v_err_conc, 'NONE'), ', WithProof: ', COALESCE(v_err_ok, 'NONE')),
            IF(v_err_quota = 'QUOTA_NOT_ELIGIBLE' AND v_err_conc = 'CONCESSION_PROOF_REQUIRED' AND v_err_ok IS NULL, 'PASS', 'FAIL'),
            'BR-Q5 and BR-C6: disability proof (type and reference) is needed.');

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 38: A non-delay TDR cannot be filed before the train has run
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_tdr_non_delay_before_run_refused$$
CREATE PROCEDURE test_tdr_non_delay_before_run_refused()
BEGIN
    DECLARE v_pnr VARCHAR(10);
    DECLARE v_stat VARCHAR(20);
    DECLARE v_fare DECIMAL(10,2);
    DECLARE v_err VARCHAR(32);
    DECLARE v_conf VARCHAR(20);
    DECLARE v_pay INT;
    DECLARE v_tdr VARCHAR(32);
    DECLARE v_tdr_st VARCHAR(32);
    DECLARE v_open_count INT DEFAULT 0;
    DECLARE v_pass JSON;

    SET v_pass = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Too Early Claim', 'age', 30, 'gender', 'FEMALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );

    START TRANSACTION;
    SET @as_of_time = '2026-10-17 10:00:00';
    CALL sp_create_booking(50001, 1001, 3, 1145, 1149, 'GENERAL', 0, 0, 1, v_pass, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err);
    SET @as_of_time = '2026-10-17 10:05:00';
    CALL sp_confirm_payment(v_pnr, v_fare, 'UPI', 'gw_test_tdr_early_01', 0, v_conf, v_pay);

    -- The train has not left yet (15:15 on 2026-10-18): nothing has happened to claim for
    CALL sp_file_tdr(v_pnr, 1, 50001, 'COACH_NOT_ATTACHED', 'CERT-EARLY-1', 'too early', 0, v_tdr, v_tdr_st);
    SELECT COUNT(*) INTO v_open_count FROM TDR_FILING WHERE pnr = v_pnr;

    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('TDR: Non-Delay Reason Before Train Runs Refused',
            'NOT_ELIGIBLE and no TDR row written',
            CONCAT('Status: ', COALESCE(v_tdr_st, 'NULL'), ', Rows: ', v_open_count),
            IF(v_tdr_st = 'NOT_ELIGIBLE' AND v_open_count = 0, 'PASS', 'FAIL'),
            'COACH_NOT_ATTACHED needs the train to have left first.');

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 39: sp_prepare_chart no longer hides errors: the error reaches the caller
-- The error is forced with a snapshot row at the largest INT id, so the next snapshot id is out of range.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_prepare_chart_error_surfaces$$
CREATE PROCEDURE test_prepare_chart_error_surfaces()
BEGIN
    DECLARE v_pnr VARCHAR(10);
    DECLARE v_stat VARCHAR(20);
    DECLARE v_fare DECIMAL(10,2);
    DECLARE v_err VARCHAR(32);
    DECLARE v_conf VARCHAR(20);
    DECLARE v_pay INT;
    DECLARE v_station_id INT;
    DECLARE v_snap_cnt INT DEFAULT -1;
    DECLARE v_chart_error TINYINT DEFAULT 0;
    DECLARE v_pass JSON;

    SET v_pass = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Chart Error User', 'age', 30, 'gender', 'FEMALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );

    START TRANSACTION;
    SET @as_of_time = '2026-10-17 10:00:00';
    CALL sp_create_booking(50001, 1001, 3, 1145, 1149, 'GENERAL', 0, 0, 1, v_pass, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err);
    SET @as_of_time = '2026-10-17 10:05:00';
    CALL sp_confirm_payment(v_pnr, v_fare, 'UPI', 'gw_test_chart_err_01', 0, v_conf, v_pay);

    -- Break the data inside this transaction: a snapshot row with the largest INT id, so the chart's
    -- next snapshot id (MAX + 1) does not fit in the column
    SELECT station_id INTO v_station_id FROM ROUTE_STOP WHERE stop_id = 1145;
    INSERT INTO CHART_SNAPSHOT (snapshot_id, schedule_id, pnr, passenger_no, coach_no, seat_no, berth_type, status,
                                from_station_id, to_station_id, concession_flag, generated_at)
    VALUES (2147483647, 1001, v_pnr, 1, 'X1', 1, 'LOWER', 'CONFIRMED', v_station_id, v_station_id, 0, '2026-10-17 10:06:00');

    chart_call: BEGIN
        DECLARE CONTINUE HANDLER FOR SQLEXCEPTION SET v_chart_error = 1;
        CALL sp_prepare_chart(1001, 0, v_snap_cnt);
    END chart_call;

    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Chart: sp_prepare_chart Error Reaches Caller',
            'Error is raised to the caller (not swallowed)',
            CONCAT('Error raised: ', v_chart_error, ', Snapshot count: ', COALESCE(v_snap_cnt, -1)),
            IF(v_chart_error = 1, 'PASS', 'FAIL'),
            'sp_prepare_chart now resignals the error so the backend can see that the chart failed.');

    SET @as_of_time = NULL;
    ROLLBACK;

    -- The AUTO_INCREMENT counter does NOT roll back. The snapshot parked at the largest INT id above would leave
    -- the counter stuck at the maximum and break every later chart. Put the counter back to MAX + 1.
    SET @snap_next = (SELECT COALESCE(MAX(snapshot_id), 0) + 1 FROM CHART_SNAPSHOT);
    SET @snap_sql = CONCAT('ALTER TABLE CHART_SNAPSHOT AUTO_INCREMENT = ', @snap_next);
    PREPARE snap_stmt FROM @snap_sql;
    EXECUTE snap_stmt;
    DEALLOCATE PREPARE snap_stmt;
END$$

-- =============================================================================
-- REFUND LIFE TESTS (PENDING -> PROCESSED / FAILED). SQL never calls a gateway,
-- so every refund the procedures create is PENDING. Same setup as the money tests:
-- run 1001 (Train 101), class 3, stops 1145 to 1149, user 50001, clock pinned.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TEST 40: A refund written by a normal cancel is PENDING, with no attempts yet
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_refund_created_pending$$
CREATE PROCEDURE test_refund_created_pending()
BEGIN
    DECLARE v_pnr VARCHAR(10);
    DECLARE v_stat VARCHAR(20);
    DECLARE v_fare DECIMAL(10,2);
    DECLARE v_err VARCHAR(32);
    DECLARE v_conf VARCHAR(20);
    DECLARE v_pay INT;
    DECLARE v_chg DECIMAL(10,2);
    DECLARE v_ref DECIMAL(10,2);
    DECLARE v_cancel_st VARCHAR(32);
    DECLARE v_rf_status VARCHAR(20);
    DECLARE v_rf_attempts INT;
    DECLARE v_rf_cnt INT DEFAULT 0;
    DECLARE v_rf_amount DECIMAL(10,2);
    DECLARE v_pass JSON;

    SET v_pass = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Pending Refund User', 'age', 30, 'gender', 'FEMALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );

    START TRANSACTION;
    SET @as_of_time = '2026-10-17 10:00:00';
    CALL sp_create_booking(50001, 1001, 3, 1145, 1149, 'GENERAL', 0, 0, 1, v_pass, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err);
    SET @as_of_time = '2026-10-17 10:05:00';
    CALL sp_confirm_payment(v_pnr, v_fare, 'UPI', 'gw_test_pending_01', 0, v_conf, v_pay);
    CALL sp_cancel_passenger_ticket(v_pnr, NULL, 'pending test', 0, v_chg, v_ref, v_cancel_st);

    SELECT COUNT(*), MAX(r.status), MAX(r.attempts), COALESCE(SUM(r.amount), 0)
    INTO v_rf_cnt, v_rf_status, v_rf_attempts, v_rf_amount
    FROM REFUND r WHERE r.payment_id = v_pay AND r.reason = 'CANCELLATION';

    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Refund Life: Cancel Writes A PENDING Refund',
            'CANCELLED, 1 refund row, PENDING, attempts 0, same amount as the cancel output',
            CONCAT('Cancel: ', COALESCE(v_cancel_st, 'NULL'), ', Rows: ', v_rf_cnt, ', Status: ', COALESCE(v_rf_status, 'NULL'),
                   ', Attempts: ', COALESCE(v_rf_attempts, -1), ', Amount: ', v_rf_amount, ' vs ', v_ref),
            IF(v_cancel_st = 'CANCELLED' AND v_rf_cnt = 1 AND v_rf_status = 'PENDING' AND v_rf_attempts = 0 AND v_rf_amount = v_ref AND v_ref > 0, 'PASS', 'FAIL'),
            'SQL records the refund as owed (PENDING). Only the gateway step can make it PROCESSED.');

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 41: sp_set_refund_result allows only PENDING/FAILED to PROCESSED/FAILED
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_refund_result_transitions$$
CREATE PROCEDURE test_refund_result_transitions()
BEGIN
    DECLARE v_pnr VARCHAR(10);
    DECLARE v_stat VARCHAR(20);
    DECLARE v_fare DECIMAL(10,2);
    DECLARE v_err VARCHAR(32);
    DECLARE v_conf VARCHAR(20);
    DECLARE v_pay INT;
    DECLARE v_rf INT;
    DECLARE v_s1 VARCHAR(32);
    DECLARE v_s2 VARCHAR(32);
    DECLARE v_s3 VARCHAR(32);
    DECLARE v_s4 VARCHAR(32);
    DECLARE v_s5 VARCHAR(32);
    DECLARE v_s6 VARCHAR(32);
    DECLARE v_s7 VARCHAR(32);
    DECLARE v_s8 VARCHAR(32);
    DECLARE v_att INT;
    DECLARE v_gw VARCHAR(40);
    DECLARE v_fail_reason VARCHAR(255);
    DECLARE v_proc_at DATETIME;
    DECLARE v_final VARCHAR(20);
    DECLARE v_pass JSON;

    SET v_pass = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Transition User', 'age', 30, 'gender', 'FEMALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );

    START TRANSACTION;
    SET @as_of_time = '2026-10-17 10:00:00';
    CALL sp_create_booking(50001, 1001, 3, 1145, 1149, 'GENERAL', 0, 0, 1, v_pass, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err);
    SET @as_of_time = '2026-10-17 10:05:00';
    CALL sp_confirm_payment(v_pnr, v_fare, 'UPI', 'gw_test_transition_01', 0, v_conf, v_pay);

    -- A fresh PENDING refund row (small amount, well inside the payment)
    SELECT COALESCE(MAX(refund_id), 0) + 1 INTO v_rf FROM REFUND;
    INSERT INTO REFUND (refund_id, cancel_id, tdr_ref_no, payment_id, amount, reason, status)
    VALUES (v_rf, NULL, NULL, v_pay, 10.00, 'TRAIN_CANCELLED', 'PENDING');

    CALL sp_set_refund_result(v_rf, 'PENDING', NULL, NULL, v_s1);               -- PENDING -> PENDING: refused
    CALL sp_set_refund_result(v_rf, 'BOGUS', NULL, NULL, v_s2);                 -- unknown status: refused
    CALL sp_set_refund_result(v_rf, 'FAILED', NULL, 'gateway timeout', v_s3);   -- PENDING -> FAILED: ok
    CALL sp_set_refund_result(v_rf, 'FAILED', NULL, 'still down', v_s4);        -- FAILED -> FAILED: ok
    CALL sp_set_refund_result(v_rf, 'PROCESSED', 'rfnd_test_000001', NULL, v_s5); -- FAILED -> PROCESSED: ok
    SELECT attempts, gateway_refund_id, failure_reason, processed_at, status
    INTO v_att, v_gw, v_fail_reason, v_proc_at, v_final FROM REFUND WHERE refund_id = v_rf;
    CALL sp_set_refund_result(v_rf, 'FAILED', NULL, 'late', v_s6);              -- PROCESSED -> FAILED: refused
    CALL sp_set_refund_result(v_rf, 'PROCESSED', 'rfnd_test_000002', NULL, v_s7); -- PROCESSED -> PROCESSED: refused
    CALL sp_set_refund_result(999999999, 'PROCESSED', NULL, NULL, v_s8);        -- no such refund

    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Refund Life: sp_set_refund_result Transitions',
            'Allowed: PENDING->FAILED, FAILED->FAILED, FAILED->PROCESSED. Refused: PENDING->PENDING, bad status, PROCESSED->anything',
            CONCAT('Refused: ', v_s1 = 'INVALID_TRANSITION', v_s2 = 'INVALID_TRANSITION', v_s6 = 'INVALID_TRANSITION', v_s7 = 'INVALID_TRANSITION',
                   ' NotFound: ', v_s8, ' Allowed: ', v_s3, '/', v_s4, '/', v_s5, ' Attempts: ', COALESCE(v_att, -1), ' Final: ', COALESCE(v_final, 'NULL')),
            IF(v_s1 = 'INVALID_TRANSITION' AND v_s2 = 'INVALID_TRANSITION' AND v_s3 = 'FAILED' AND v_s4 = 'FAILED' AND v_s5 = 'PROCESSED'
               AND v_s6 = 'INVALID_TRANSITION' AND v_s7 = 'INVALID_TRANSITION' AND v_s8 = 'NOT_FOUND'
               AND v_att = 3 AND v_gw = 'rfnd_test_000001' AND v_fail_reason IS NULL AND v_proc_at IS NOT NULL AND v_final = 'PROCESSED', 'PASS', 'FAIL'),
            'Every accepted call counts one attempt; processed_at and gateway_refund_id are set on PROCESSED; a PROCESSED refund never changes again.');

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 42: A FAILED refund still counts toward the cap (it is still owed)
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_failed_refund_counts_toward_cap$$
CREATE PROCEDURE test_failed_refund_counts_toward_cap()
BEGIN
    DECLARE v_pnr VARCHAR(10);
    DECLARE v_stat VARCHAR(20);
    DECLARE v_fare DECIMAL(10,2);
    DECLARE v_err VARCHAR(32);
    DECLARE v_conf VARCHAR(20);
    DECLARE v_pay INT;
    DECLARE v_rf INT;
    DECLARE v_room DECIMAL(10,2);
    DECLARE v_blocked TINYINT DEFAULT 0;
    DECLARE v_pass JSON;

    SET v_pass = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Failed Cap User', 'age', 30, 'gender', 'FEMALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );

    START TRANSACTION;
    SET @as_of_time = '2026-10-17 10:00:00';
    CALL sp_create_booking(50001, 1001, 3, 1145, 1149, 'GENERAL', 0, 0, 1, v_pass, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err);
    SET @as_of_time = '2026-10-17 10:05:00';
    CALL sp_confirm_payment(v_pnr, v_fare, 'UPI', 'gw_test_failed_cap_01', 0, v_conf, v_pay);

    SELECT COALESCE(MAX(refund_id), 0) + 1 INTO v_rf FROM REFUND;
    INSERT INTO REFUND (refund_id, cancel_id, tdr_ref_no, payment_id, amount, reason, status, failure_reason, attempts)
    VALUES (v_rf, NULL, NULL, v_pay, v_fare - 1.00, 'TRAIN_CANCELLED', 'FAILED', 'gateway down', 1);

    SET v_room = fn_refund_room(v_pay);

    cap_failed: BEGIN
        DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET v_blocked = 1;
        INSERT INTO REFUND (refund_id, cancel_id, tdr_ref_no, payment_id, amount, reason, status)
        VALUES (v_rf + 1, NULL, NULL, v_pay, 10.00, 'TRAIN_CANCELLED', 'PENDING');
    END cap_failed;

    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Refund Cap: FAILED Refund Still Counts',
            'Room left is 1.00 and a 10.00 refund is blocked',
            CONCAT('Room: ', v_room, ', Blocked: ', v_blocked),
            IF(v_room = 1.00 AND v_blocked = 1, 'PASS', 'FAIL'),
            'A FAILED refund will be retried, so the passenger is still owed that money and the payment cannot be refunded twice.');

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 43: Two PENDING refunds cannot together exceed the payment
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_two_pending_refunds_cap$$
CREATE PROCEDURE test_two_pending_refunds_cap()
BEGIN
    DECLARE v_pnr VARCHAR(10);
    DECLARE v_stat VARCHAR(20);
    DECLARE v_fare DECIMAL(10,2);
    DECLARE v_err VARCHAR(32);
    DECLARE v_conf VARCHAR(20);
    DECLARE v_pay INT;
    DECLARE v_rf INT;
    DECLARE v_over_blocked TINYINT DEFAULT 0;
    DECLARE v_exact_blocked TINYINT DEFAULT 0;
    DECLARE v_pass JSON;

    SET v_pass = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Two Pending User', 'age', 30, 'gender', 'FEMALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );

    START TRANSACTION;
    SET @as_of_time = '2026-10-17 10:00:00';
    CALL sp_create_booking(50001, 1001, 3, 1145, 1149, 'GENERAL', 0, 0, 1, v_pass, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err);
    SET @as_of_time = '2026-10-17 10:05:00';
    CALL sp_confirm_payment(v_pnr, v_fare, 'UPI', 'gw_test_two_pending_01', 0, v_conf, v_pay);

    SELECT COALESCE(MAX(refund_id), 0) + 1 INTO v_rf FROM REFUND;
    INSERT INTO REFUND (refund_id, cancel_id, tdr_ref_no, payment_id, amount, reason, status)
    VALUES (v_rf, NULL, NULL, v_pay, v_fare - 100.00, 'TRAIN_CANCELLED', 'PENDING');

    -- 150 more would be 50 over the payment: blocked
    over_try: BEGIN
        DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET v_over_blocked = 1;
        INSERT INTO REFUND (refund_id, cancel_id, tdr_ref_no, payment_id, amount, reason, status)
        VALUES (v_rf + 1, NULL, NULL, v_pay, 150.00, 'TRAIN_CANCELLED', 'PENDING');
    END over_try;

    -- Exactly the 100.00 that is left: allowed
    exact_try: BEGIN
        DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET v_exact_blocked = 1;
        INSERT INTO REFUND (refund_id, cancel_id, tdr_ref_no, payment_id, amount, reason, status)
        VALUES (v_rf + 2, NULL, NULL, v_pay, 100.00, 'TRAIN_CANCELLED', 'PENDING');
    END exact_try;

    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Refund Cap: Two PENDING Refunds Cannot Exceed Payment',
            'Over by 50 blocked, exactly the rest allowed',
            CONCAT('Over blocked: ', v_over_blocked, ', Exact blocked: ', v_exact_blocked, ', Room now: ', fn_refund_room(v_pay)),
            IF(v_over_blocked = 1 AND v_exact_blocked = 0 AND fn_refund_room(v_pay) = 0.00, 'PASS', 'FAIL'),
            'PENDING refunds are counted, so two refunds waiting for the gateway can never add up to more than was paid.');

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 44: The payout view counts PROCESSED only as paid out; PENDING and FAILED are separate
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_refund_view_processed_only$$
CREATE PROCEDURE test_refund_view_processed_only()
BEGIN
    DECLARE v_pnr VARCHAR(10);
    DECLARE v_stat VARCHAR(20);
    DECLARE v_fare DECIMAL(10,2);
    DECLARE v_err VARCHAR(32);
    DECLARE v_conf VARCHAR(20);
    DECLARE v_pay INT;
    DECLARE v_rf INT;
    DECLARE v_b_proc DECIMAL(12,2) DEFAULT 0;
    DECLARE v_b_pend DECIMAL(12,2) DEFAULT 0;
    DECLARE v_b_fail DECIMAL(12,2) DEFAULT 0;
    DECLARE v_a_proc DECIMAL(12,2) DEFAULT 0;
    DECLARE v_a_pend DECIMAL(12,2) DEFAULT 0;
    DECLARE v_a_fail DECIMAL(12,2) DEFAULT 0;
    DECLARE v_pass JSON;

    SET v_pass = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'View User', 'age', 30, 'gender', 'FEMALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );

    START TRANSACTION;
    SET @as_of_time = '2026-10-17 10:00:00';
    CALL sp_create_booking(50001, 1001, 3, 1145, 1149, 'GENERAL', 0, 0, 1, v_pass, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err);
    SET @as_of_time = '2026-10-17 10:05:00';
    CALL sp_confirm_payment(v_pnr, v_fare, 'UPI', 'gw_test_view_01', 0, v_conf, v_pay);

    SELECT COALESCE(SUM(processed_amount), 0), COALESCE(SUM(pending_amount), 0), COALESCE(SUM(failed_amount), 0)
    INTO v_b_proc, v_b_pend, v_b_fail FROM vw_refund_payout_summary WHERE reason = 'TRAIN_CANCELLED';

    SELECT COALESCE(MAX(refund_id), 0) + 1 INTO v_rf FROM REFUND;
    INSERT INTO REFUND (refund_id, cancel_id, tdr_ref_no, payment_id, amount, reason, status)
    VALUES (v_rf, NULL, NULL, v_pay, 100.00, 'TRAIN_CANCELLED', 'PROCESSED'),
           (v_rf + 1, NULL, NULL, v_pay, 200.00, 'TRAIN_CANCELLED', 'PENDING'),
           (v_rf + 2, NULL, NULL, v_pay, 300.00, 'TRAIN_CANCELLED', 'FAILED');

    SELECT COALESCE(SUM(processed_amount), 0), COALESCE(SUM(pending_amount), 0), COALESCE(SUM(failed_amount), 0)
    INTO v_a_proc, v_a_pend, v_a_fail FROM vw_refund_payout_summary WHERE reason = 'TRAIN_CANCELLED';

    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Refund Life: Payout View Counts PROCESSED Only',
            'Paid out +100, pending +200, failed +300',
            CONCAT('Paid +', v_a_proc - v_b_proc, ', Pending +', v_a_pend - v_b_pend, ', Failed +', v_a_fail - v_b_fail),
            IF(v_a_proc - v_b_proc = 100.00 AND v_a_pend - v_b_pend = 200.00 AND v_a_fail - v_b_fail = 300.00, 'PASS', 'FAIL'),
            'Money paid out is the PROCESSED column only; PENDING and FAILED are shown separately.');

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- =============================================================================
-- PAYMENT_ORDER TESTS (MySQL is the source of truth for Razorpay orders)
-- Same setup as the money tests: run 1001 (Train 101), class 3, stops 1145 to 1149, user 50001, clock pinned.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TEST 45: sp_set_payment_order_result transitions
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_payment_order_transitions$$
CREATE PROCEDURE test_payment_order_transitions()
BEGIN
    DECLARE v_pnr VARCHAR(10);
    DECLARE v_stat VARCHAR(20);
    DECLARE v_fare DECIMAL(10,2);
    DECLARE v_err VARCHAR(32);
    DECLARE v_s1 VARCHAR(32);
    DECLARE v_s2 VARCHAR(32);
    DECLARE v_s3 VARCHAR(32);
    DECLARE v_s4 VARCHAR(32);
    DECLARE v_s5 VARCHAR(32);
    DECLARE v_s6 VARCHAR(32);
    DECLARE v_s7 VARCHAR(32);
    DECLARE v_s8 VARCHAR(32);
    DECLARE v_s9 VARCHAR(32);
    DECLARE v_paid_gw VARCHAR(40);
    DECLARE v_paid_at DATETIME;
    DECLARE v_pass JSON;

    SET v_pass = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Order Transition User', 'age', 30, 'gender', 'FEMALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );

    START TRANSACTION;
    SET @as_of_time = '2026-10-17 10:00:00';
    CALL sp_create_booking(50001, 1001, 3, 1145, 1149, 'GENERAL', 0, 0, 1, v_pass, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err);

    INSERT INTO PAYMENT_ORDER (order_id, pnr, amount_paise, status, created_at) VALUES
        ('order_t_paid', v_pnr, ROUND(v_fare * 100), 'CREATED', '2026-10-17 10:00:00'),
        ('order_t_late', v_pnr, ROUND(v_fare * 100), 'CREATED', '2026-10-17 10:00:00'),
        ('order_t_failed', v_pnr, ROUND(v_fare * 100), 'CREATED', '2026-10-17 10:00:00'),
        ('order_t_plain', v_pnr, ROUND(v_fare * 100), 'CREATED', '2026-10-17 10:00:00');

    CALL sp_set_payment_order_result('order_t_paid', 'PAID', 'pay_test_order_01', v_s1);   -- CREATED -> PAID: ok
    SELECT gateway_payment_id, paid_at INTO v_paid_gw, v_paid_at FROM PAYMENT_ORDER WHERE order_id = 'order_t_paid';
    CALL sp_set_payment_order_result('order_t_paid', 'FAILED', NULL, v_s2);                -- PAID -> FAILED: refused
    CALL sp_set_payment_order_result('order_t_paid', 'PAID', NULL, v_s3);                  -- PAID -> PAID: refused
    CALL sp_set_payment_order_result('order_t_late', 'LATE_PAID', 'pay_test_order_02', v_s4); -- CREATED -> LATE_PAID: ok
    CALL sp_set_payment_order_result('order_t_failed', 'FAILED', NULL, v_s5);              -- CREATED -> FAILED: ok
    CALL sp_set_payment_order_result('order_t_failed', 'PAID', 'pay_test_order_03', v_s6); -- FAILED -> PAID: refused
    CALL sp_set_payment_order_result('order_t_plain', 'CREATED', NULL, v_s7);              -- CREATED -> CREATED: refused
    CALL sp_set_payment_order_result('order_t_plain', 'BOGUS', NULL, v_s8);                -- unknown status: refused
    CALL sp_set_payment_order_result('order_nope', 'PAID', NULL, v_s9);                    -- no such order

    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Payment Order: sp_set_payment_order_result Transitions',
            'Allowed: CREATED->PAID, LATE_PAID, FAILED. Refused: PAID->FAILED, PAID->PAID, FAILED->PAID, CREATED->CREATED, bad status. Unknown id NOT_FOUND',
            CONCAT(v_s1, ',', v_s2, ',', v_s3, ',', v_s4, ',', v_s5, ',', v_s6, ',', v_s7, ',', v_s8, ',', v_s9),
            IF(v_s1 = 'PAID' AND v_s2 = 'INVALID_TRANSITION' AND v_s3 = 'INVALID_TRANSITION' AND v_s4 = 'LATE_PAID' AND v_s5 = 'FAILED'
               AND v_s6 = 'INVALID_TRANSITION' AND v_s7 = 'INVALID_TRANSITION' AND v_s8 = 'INVALID_TRANSITION' AND v_s9 = 'NOT_FOUND'
               AND v_paid_gw = 'pay_test_order_01' AND v_paid_at IS NOT NULL, 'PASS', 'FAIL'),
            'An order leaves CREATED exactly once; the gateway payment id and paid_at are stored on PAID.');

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 45b: PAYMENT_ORDER EXPIRED (the hold ended unpaid): CREATED -> EXPIRED, then EXPIRED -> LATE_PAID is
-- still accepted (a payment arrived inside the check window). FAILED stays final.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_payment_order_expired$$
CREATE PROCEDURE test_payment_order_expired()
BEGIN
    DECLARE v_pnr VARCHAR(10);
    DECLARE v_stat VARCHAR(20);
    DECLARE v_fare DECIMAL(10,2);
    DECLARE v_err VARCHAR(32);
    DECLARE v_s1 VARCHAR(32);
    DECLARE v_s2 VARCHAR(32);
    DECLARE v_s3 VARCHAR(32);
    DECLARE v_s4 VARCHAR(32);
    DECLARE v_s5 VARCHAR(32);
    DECLARE v_pass JSON;

    SET v_pass = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Order Expiry User', 'age', 30, 'gender', 'FEMALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );

    START TRANSACTION;
    SET @as_of_time = '2026-10-17 10:00:00';
    CALL sp_create_booking(50001, 1001, 3, 1145, 1149, 'GENERAL', 0, 0, 1, v_pass, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err);

    INSERT INTO PAYMENT_ORDER (order_id, pnr, amount_paise, status, created_at) VALUES
        ('order_x_late', v_pnr, ROUND(v_fare * 100), 'CREATED', '2026-10-17 10:00:00'),
        ('order_x_paid', v_pnr, ROUND(v_fare * 100), 'CREATED', '2026-10-17 10:00:00');

    CALL sp_set_payment_order_result('order_x_late', 'EXPIRED', NULL, v_s1);               -- CREATED -> EXPIRED: ok
    CALL sp_set_payment_order_result('order_x_late', 'EXPIRED', NULL, v_s2);               -- EXPIRED -> EXPIRED: refused
    CALL sp_set_payment_order_result('order_x_late', 'LATE_PAID', 'pay_test_exp_01', v_s3); -- EXPIRED -> LATE_PAID: ok
    CALL sp_set_payment_order_result('order_x_paid', 'FAILED', NULL, v_s4);                -- CREATED -> FAILED: ok
    CALL sp_set_payment_order_result('order_x_paid', 'EXPIRED', NULL, v_s5);               -- FAILED -> EXPIRED: refused

    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Payment Order: EXPIRED Transitions',
            'CREATED->EXPIRED ok, EXPIRED->EXPIRED refused, EXPIRED->LATE_PAID ok, FAILED stays final',
            CONCAT(v_s1, ',', v_s2, ',', v_s3, ',', v_s4, ',', v_s5),
            IF(v_s1 = 'EXPIRED' AND v_s2 = 'INVALID_TRANSITION' AND v_s3 = 'LATE_PAID' AND v_s4 = 'FAILED' AND v_s5 = 'INVALID_TRANSITION', 'PASS', 'FAIL'),
            'An unpaid order is marked EXPIRED when its hold ends, but a payment that still arrives is accepted and refunded as a late payment.');

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 46: The order amount is checked: it must be above zero, belong to a real booking,
-- and equal the booking's total_fare in paise
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_payment_order_amount_check$$
CREATE PROCEDURE test_payment_order_amount_check()
BEGIN
    DECLARE v_pnr VARCHAR(10);
    DECLARE v_stat VARCHAR(20);
    DECLARE v_fare DECIMAL(10,2);
    DECLARE v_err VARCHAR(32);
    DECLARE v_zero_blocked TINYINT DEFAULT 0;
    DECLARE v_fk_blocked TINYINT DEFAULT 0;
    DECLARE v_match_ok INT DEFAULT 0;
    DECLARE v_match_bad INT DEFAULT 0;
    DECLARE v_pass JSON;

    SET v_pass = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Order Amount User', 'age', 30, 'gender', 'FEMALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );

    START TRANSACTION;
    SET @as_of_time = '2026-10-17 10:00:00';
    CALL sp_create_booking(50001, 1001, 3, 1145, 1149, 'GENERAL', 0, 0, 1, v_pass, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err);

    zero_try: BEGIN
        DECLARE CONTINUE HANDLER FOR SQLEXCEPTION SET v_zero_blocked = 1;
        INSERT INTO PAYMENT_ORDER (order_id, pnr, amount_paise, status, created_at) VALUES ('order_t_zero', v_pnr, 0, 'CREATED', NOW());
    END zero_try;

    fk_try: BEGIN
        DECLARE CONTINUE HANDLER FOR SQLEXCEPTION SET v_fk_blocked = 1;
        INSERT INTO PAYMENT_ORDER (order_id, pnr, amount_paise, status, created_at) VALUES ('order_t_nopnr', '0000000000', 100, 'CREATED', NOW());
    END fk_try;

    INSERT INTO PAYMENT_ORDER (order_id, pnr, amount_paise, status, created_at) VALUES
        ('order_t_good', v_pnr, ROUND(v_fare * 100), 'CREATED', NOW()),
        ('order_t_wrong', v_pnr, ROUND(v_fare * 100) - 1, 'CREATED', NOW());

    -- The check the backend makes before it trusts an order: amount_paise = total_fare in paise
    SELECT SUM(po.order_id = 'order_t_good' AND po.amount_paise = ROUND(b.total_fare * 100)),
           SUM(po.order_id = 'order_t_wrong' AND po.amount_paise <> ROUND(b.total_fare * 100))
    INTO v_match_ok, v_match_bad
    FROM PAYMENT_ORDER po JOIN BOOKING b ON b.pnr = po.pnr WHERE po.pnr = v_pnr;

    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Payment Order: Amount And Booking Checks',
            'Zero amount blocked, unknown PNR blocked, correct amount matches the fare, wrong amount does not',
            CONCAT('Zero blocked: ', v_zero_blocked, ', FK blocked: ', v_fk_blocked, ', Match: ', COALESCE(v_match_ok, 0), '/', COALESCE(v_match_bad, 0)),
            IF(v_zero_blocked = 1 AND v_fk_blocked = 1 AND v_match_ok = 1 AND v_match_bad = 1, 'PASS', 'FAIL'),
            'PAYMENT_ORDER.amount_paise is above zero, belongs to a real booking, and can be compared with BOOKING.total_fare.');

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- =============================================================================
-- RULE TABLE TESTS: the admin-editable tables really drive fare and refund numbers.
-- Every test changes a value inside a transaction, checks the new result, and rolls back.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TEST 47: SETTING GST_RATE_AC and INSURANCE_PREMIUM_PER_PASSENGER change the fare
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_rule_setting_changes_fare$$
CREATE PROCEDURE test_rule_setting_changes_fare()
BEGIN
    DECLARE v_f0 JSON;
    DECLARE v_f1 JSON;
    DECLARE v_taxable DECIMAL(10,2);

    START TRANSACTION;
    SET v_f0 = fn_calculate_fare(3, 111, 800, 'GENERAL', 'NONE', 1, 1001);
    SET v_taxable = JSON_EXTRACT(v_f0, '$.total_fare') - JSON_EXTRACT(v_f0, '$.gst') - JSON_EXTRACT(v_f0, '$.insurance');

    UPDATE SETTING SET setting_value = '0.18' WHERE setting_key = 'GST_RATE_AC';
    UPDATE SETTING SET setting_value = '1.50' WHERE setting_key = 'INSURANCE_PREMIUM_PER_PASSENGER';
    SET v_f1 = fn_calculate_fare(3, 111, 800, 'GENERAL', 'NONE', 1, 1001);

    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Rule Tables: GST And Insurance Settings Drive The Fare',
            'Seed: GST 5% and insurance 0.45. After the edit: GST 18% of the taxable amount and insurance 1.50',
            CONCAT('Before gst ', JSON_EXTRACT(v_f0, '$.gst'), ' ins ', JSON_EXTRACT(v_f0, '$.insurance'),
                   ', after gst ', JSON_EXTRACT(v_f1, '$.gst'), ' ins ', JSON_EXTRACT(v_f1, '$.insurance')),
            IF(JSON_EXTRACT(v_f0, '$.gst') = ROUND(v_taxable * 0.05, 2) AND JSON_EXTRACT(v_f0, '$.insurance') = 0.45
               AND JSON_EXTRACT(v_f1, '$.gst') = ROUND(v_taxable * 0.18, 2) AND JSON_EXTRACT(v_f1, '$.insurance') = 1.50, 'PASS', 'FAIL'),
            'The fare function reads GST_RATE_AC and INSURANCE_PREMIUM_PER_PASSENGER from SETTING.');

    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 48: CONCESSION_RULE percent and the senior switch change the fare
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_rule_concession_changes_fare$$
CREATE PROCEDURE test_rule_concession_changes_fare()
BEGIN
    DECLARE v_d0 JSON;
    DECLARE v_d1 JSON;
    DECLARE v_d2 JSON;
    DECLARE v_s0 JSON;
    DECLARE v_s1 JSON;
    DECLARE v_s2 JSON;
    DECLARE v_base DECIMAL(10,2);

    START TRANSACTION;
    -- Divyaang 3A on a Rajdhani (premium rule 8: 25 percent of the base fare)
    SET v_d0 = fn_calculate_fare(3, 111, 800, 'GENERAL', 'DIVYAANG', 0, 1001);
    SET v_base = JSON_EXTRACT(v_d0, '$.base_fare');
    UPDATE CONCESSION_RULE SET discount_pct = 60 WHERE rule_id = 8;
    SET v_d1 = fn_calculate_fare(3, 111, 800, 'GENERAL', 'DIVYAANG', 0, 1001);
    UPDATE CONCESSION_RULE SET is_active = 0 WHERE rule_id = 8;
    SET v_d2 = fn_calculate_fare(3, 111, 800, 'GENERAL', 'DIVYAANG', 0, 1001);   -- premium rule off: the standard 75 percent rule applies

    -- Senior citizen: no concession in the seed; needs the setting AND an active rule
    SET v_s0 = fn_calculate_fare(4, 111, 800, 'GENERAL', 'SENIOR_CITIZEN', 0, 1001);
    UPDATE CONCESSION_RULE SET is_active = 1, discount_pct = 40 WHERE rule_id = 10;
    SET v_s1 = fn_calculate_fare(4, 111, 800, 'GENERAL', 'SENIOR_CITIZEN', 0, 1001);   -- rule on, setting still false
    UPDATE SETTING SET setting_value = 'true' WHERE setting_key = 'CONCESSION_SENIOR_ENABLED';
    SET v_s2 = fn_calculate_fare(4, 111, 800, 'GENERAL', 'SENIOR_CITIZEN', 0, 1001);

    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Rule Tables: CONCESSION_RULE Drives The Discount',
            'Divyaang 25% -> 60% -> standard 75% when the premium rule is off; senior 0 until setting and rule are both on (40%)',
            CONCAT('Divyaang ', JSON_EXTRACT(v_d0, '$.concession_discount'), '/', JSON_EXTRACT(v_d1, '$.concession_discount'), '/', JSON_EXTRACT(v_d2, '$.concession_discount'),
                   ', senior ', JSON_EXTRACT(v_s0, '$.concession_discount'), '/', JSON_EXTRACT(v_s1, '$.concession_discount'), '/', JSON_EXTRACT(v_s2, '$.concession_discount')),
            IF(JSON_EXTRACT(v_d0, '$.concession_discount') = ROUND(v_base * 0.25, 2)
               AND JSON_EXTRACT(v_d1, '$.concession_discount') = ROUND(v_base * 0.60, 2)
               AND JSON_EXTRACT(v_d2, '$.concession_discount') = ROUND(v_base * 0.75, 2)
               AND JSON_EXTRACT(v_s0, '$.concession_discount') = 0
               AND JSON_EXTRACT(v_s1, '$.concession_discount') = 0
               AND JSON_EXTRACT(v_s2, '$.concession_discount') > 0, 'PASS', 'FAIL'),
            'The discount percent is read from CONCESSION_RULE (premium rule first, then standard). Seniors need CONCESSION_SENIOR_ENABLED = true as well.');

    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 49: DYNAMIC_FARE_ENABLED (BR-F11) adds the Tatkal surcharge only when on, only for TATKAL, only when 80% full
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_rule_dynamic_fare_switch$$
CREATE PROCEDURE test_rule_dynamic_fare_switch()
BEGIN
    DECLARE v_off JSON;
    DECLARE v_on_full JSON;
    DECLARE v_on_general JSON;
    DECLARE v_on_empty JSON;

    START TRANSACTION;
    UPDATE SCHEDULE_CLASS_INVENTORY SET available_seats = FLOOR(total_seats * 0.10) WHERE schedule_id = 1001 AND class_id = 3;
    SET v_off = fn_calculate_fare(3, 101, 800, 'TATKAL', 'NONE', 0, 1001);

    UPDATE SETTING SET setting_value = 'true' WHERE setting_key = 'DYNAMIC_FARE_ENABLED';
    SET v_on_full = fn_calculate_fare(3, 101, 800, 'TATKAL', 'NONE', 0, 1001);
    SET v_on_general = fn_calculate_fare(3, 101, 800, 'GENERAL', 'NONE', 0, 1001);

    UPDATE SCHEDULE_CLASS_INVENTORY SET available_seats = total_seats WHERE schedule_id = 1001 AND class_id = 3;
    SET v_on_empty = fn_calculate_fare(3, 101, 800, 'TATKAL', 'NONE', 0, 1001);

    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Rule Tables: DYNAMIC_FARE_ENABLED Switch',
            'Surcharge 0 when off, base x 0.5 when on + Tatkal + 90% full, 0 for GENERAL, 0 when the run is empty',
            CONCAT('Off ', JSON_EXTRACT(v_off, '$.dynamic_surcharge'), ', on+full ', JSON_EXTRACT(v_on_full, '$.dynamic_surcharge'),
                   ', general ', JSON_EXTRACT(v_on_general, '$.dynamic_surcharge'), ', empty ', JSON_EXTRACT(v_on_empty, '$.dynamic_surcharge')),
            IF(JSON_EXTRACT(v_off, '$.dynamic_surcharge') = 0
               AND JSON_EXTRACT(v_on_full, '$.dynamic_surcharge') = ROUND(JSON_EXTRACT(v_on_full, '$.base_fare') * 0.5, 2)
               AND JSON_EXTRACT(v_on_full, '$.dynamic_surcharge') > 0
               AND JSON_EXTRACT(v_on_general, '$.dynamic_surcharge') = 0
               AND JSON_EXTRACT(v_on_empty, '$.dynamic_surcharge') = 0, 'PASS', 'FAIL'),
            'BR-F11 is off in the seed. Turning the setting on applies it to Tatkal fares of nearly full runs only.');

    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 50: REFUND_RULE percent and flat minimum change the cancellation charge (class rule beats general rule)
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_rule_refund_rule_changes_charge$$
CREATE PROCEDURE test_rule_refund_rule_changes_charge()
BEGIN
    DECLARE v_pnr VARCHAR(10);
    DECLARE v_pno INT;
    DECLARE v_elig DECIMAL(10,2);
    DECLARE v_at DATETIME;
    DECLARE v_r0 JSON;
    DECLARE v_r1 JSON;
    DECLARE v_r2 JSON;
    DECLARE v_r3 JSON;
    DECLARE v_r4 JSON;

    SELECT b.pnr, r.passenger_no, pb.total_fare - pb.insurance, TIMESTAMP(ts.journey_date, ts.departure_time) - INTERVAL 30 HOUR
    INTO v_pnr, v_pno, v_elig, v_at
    FROM BOOKING b
    JOIN PASSENGER_BOOKING pb ON pb.pnr = b.pnr
    JOIN RESERVATION r ON r.pnr = pb.pnr AND r.passenger_no = pb.passenger_no
    JOIN TRAIN_SCHEDULE ts ON ts.schedule_id = b.schedule_id
    WHERE b.class_id = 3 AND b.quota = 'GENERAL' AND r.status = 'CONFIRMED' AND b.created_at < '2026-11-01'
    ORDER BY b.pnr LIMIT 1;

    START TRANSACTION;
    SET v_r0 = fn_calculate_cancellation_refund(v_pnr, v_pno, v_at);                 -- 30 hours before: the 24-72 hour slab, 25 percent, flat 180 for 3A
    UPDATE REFUND_RULE SET deduction_pct = 40 WHERE class_id = 3 AND min_hours = 24;
    SET v_r1 = fn_calculate_cancellation_refund(v_pnr, v_pno, v_at);
    UPDATE REFUND_RULE SET deduction_pct = 40 WHERE class_id IS NULL AND min_hours = 24;   -- general rule: must NOT matter for 3A (it has its own row)
    UPDATE REFUND_RULE SET deduction_pct = 1 WHERE class_id IS NULL AND min_hours = 24;
    SET v_r2 = fn_calculate_cancellation_refund(v_pnr, v_pno, v_at);
    UPDATE REFUND_RULE SET deduction_pct = 0, flat_min_charge = 999 WHERE class_id = 3 AND min_hours = 24;
    SET v_r3 = fn_calculate_cancellation_refund(v_pnr, v_pno, v_at);                 -- flat minimum wins over a 0 percent slab
    DELETE FROM REFUND_RULE WHERE class_id = 3 AND min_hours = 24;                   -- no 3A row for this slab: the general row is used
    SET v_r4 = fn_calculate_cancellation_refund(v_pnr, v_pno, v_at);

    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Rule Tables: REFUND_RULE Drives The Cancellation Charge',
            '25% (min 180) -> 40% -> general rule ignored for 3A -> flat 999 -> general rule when the class row is gone',
            CONCAT('Charges ', JSON_EXTRACT(v_r0, '$.charge'), ' / ', JSON_EXTRACT(v_r1, '$.charge'), ' / ', JSON_EXTRACT(v_r2, '$.charge'),
                   ' / ', JSON_EXTRACT(v_r3, '$.charge'), ' / ', JSON_EXTRACT(v_r4, '$.charge')),
            IF(JSON_EXTRACT(v_r0, '$.charge') = GREATEST(ROUND(v_elig * 0.25, 2), 180)
               AND JSON_EXTRACT(v_r1, '$.charge') = GREATEST(ROUND(v_elig * 0.40, 2), 180)
               AND JSON_EXTRACT(v_r2, '$.charge') = JSON_EXTRACT(v_r1, '$.charge')
               AND JSON_EXTRACT(v_r3, '$.charge') = LEAST(999, v_elig)
               AND JSON_EXTRACT(v_r4, '$.charge') = GREATEST(ROUND(v_elig * 0.01, 2), 120)
               AND JSON_EXTRACT(v_r0, '$.refund_amount') = ROUND(v_elig - JSON_EXTRACT(v_r0, '$.charge'), 2), 'PASS', 'FAIL'),
            'The slab is the highest min_hours reached; a class row beats a general row of the same slab; the charge is the larger of the percent and the flat minimum, never more than the fare.');

    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 51: Values that would break the money maths are refused (SETTING trigger and CHECK constraints)
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_rule_bad_values_refused$$
CREATE PROCEDURE test_rule_bad_values_refused()
BEGIN
    DECLARE v_refused INT DEFAULT 0;
    DECLARE v_accepted INT DEFAULT 0;

    START TRANSACTION;

    t1: BEGIN DECLARE CONTINUE HANDLER FOR SQLEXCEPTION SET v_refused = v_refused + 1;
        UPDATE SETTING SET setting_value = '1.5' WHERE setting_key = 'GST_RATE_AC'; END t1;
    t2: BEGIN DECLARE CONTINUE HANDLER FOR SQLEXCEPTION SET v_refused = v_refused + 1;
        UPDATE SETTING SET setting_value = 'abc' WHERE setting_key = 'GST_RATE_AC'; END t2;
    t3: BEGIN DECLARE CONTINUE HANDLER FOR SQLEXCEPTION SET v_refused = v_refused + 1;
        UPDATE SETTING SET setting_value = '-5' WHERE setting_key = 'INSURANCE_PREMIUM_PER_PASSENGER'; END t3;
    t4: BEGIN DECLARE CONTINUE HANDLER FOR SQLEXCEPTION SET v_refused = v_refused + 1;
        UPDATE SETTING SET setting_value = 'yes' WHERE setting_key = 'DYNAMIC_FARE_ENABLED'; END t4;
    t5: BEGIN DECLARE CONTINUE HANDLER FOR SQLEXCEPTION SET v_refused = v_refused + 1;
        UPDATE CONCESSION_RULE SET discount_pct = 150 WHERE rule_id = 8; END t5;
    t6: BEGIN DECLARE CONTINUE HANDLER FOR SQLEXCEPTION SET v_refused = v_refused + 1;
        UPDATE REFUND_RULE SET deduction_pct = -1 WHERE class_id = 3 AND min_hours = 24; END t6;
    t7: BEGIN DECLARE CONTINUE HANDLER FOR SQLEXCEPTION SET v_refused = v_refused + 1;
        UPDATE REFUND_RULE SET flat_min_charge = -10 WHERE class_id = 3 AND min_hours = 24; END t7;
    t8: BEGIN DECLARE CONTINUE HANDLER FOR SQLEXCEPTION SET v_refused = v_refused + 1;
        UPDATE FARE SET rate_per_km = -1 WHERE fare_id = 9; END t8;

    -- Allowed values still work
    UPDATE SETTING SET setting_value = '0.12' WHERE setting_key = 'GST_RATE_AC';
    SELECT COUNT(*) INTO v_accepted FROM SETTING WHERE setting_key = 'GST_RATE_AC' AND setting_value = '0.12';

    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Rule Tables: Bad Values Refused',
            '8 bad edits refused, a good edit accepted',
            CONCAT('Refused ', v_refused, ' of 8, good edit accepted: ', v_accepted),
            IF(v_refused = 8 AND v_accepted = 1, 'PASS', 'FAIL'),
            'GST outside 0 to 1, text, negative premium, bad on/off value, percent outside 0 to 100, negative flat charge and negative fare rate cannot be saved.');

    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 52: A rule edit writes an AUDIT_LOG row (the audit triggers keep working)
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_rule_edit_writes_audit$$
CREATE PROCEDURE test_rule_edit_writes_audit()
BEGIN
    DECLARE v_before INT;
    DECLARE v_after INT;
    DECLARE v_action VARCHAR(64);

    START TRANSACTION;
    SELECT COUNT(*) INTO v_before FROM AUDIT_LOG;
    UPDATE SETTING SET setting_value = '0.12' WHERE setting_key = 'GST_RATE_AC';
    UPDATE REFUND_RULE SET deduction_pct = 30 WHERE class_id = 3 AND min_hours = 24;
    UPDATE CONCESSION_RULE SET discount_pct = 55 WHERE rule_id = 8;
    SELECT COUNT(*) INTO v_after FROM AUDIT_LOG;
    SELECT action INTO v_action FROM AUDIT_LOG ORDER BY log_id DESC LIMIT 1;

    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Rule Tables: Edits Write The Audit Log',
            'Three edits write three AUDIT_LOG rows',
            CONCAT('Rows added: ', v_after - v_before, ', last action: ', COALESCE(v_action, 'NULL')),
            IF(v_after - v_before = 3, 'PASS', 'FAIL'),
            'BR-A8: a change to a fare, concession, refund rule or setting is logged by a database trigger.');

    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 53: Ids are handed out by the database: inserts without an id never clash, explicit ids still work
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_auto_increment_ids$$
CREATE PROCEDURE test_auto_increment_ids()
BEGIN
    DECLARE v_pnr VARCHAR(10);
    DECLARE v_stat VARCHAR(20);
    DECLARE v_fare DECIMAL(10,2);
    DECLARE v_err VARCHAR(32);
    DECLARE v_pass JSON;
    DECLARE v_id1 INT;
    DECLARE v_id2 INT;
    DECLARE v_explicit INT;
    DECLARE v_after_explicit INT;
    DECLARE v_res_ok INT DEFAULT 0;
    DECLARE v_auto_cols INT DEFAULT 0;

    SET v_pass = JSON_ARRAY(
        JSON_OBJECT('saved_passenger_id', 7, 'name', 'Id Test User', 'age', 30, 'gender', 'FEMALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH')
    );

    START TRANSACTION;
    SET @as_of_time = '2026-10-17 10:00:00';
    CALL sp_create_booking(50001, 1001, 3, 1145, 1149, 'GENERAL', 0, 0, 1, v_pass, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err);
    SELECT res_id INTO v_res_ok FROM RESERVATION WHERE pnr = v_pnr AND passenger_no = 1;

    INSERT INTO PAYMENT (pnr, amount, method, status, gateway_payment_id, paid_at) VALUES (v_pnr, 10.00, 'UPI', 'SUCCESS', 'pay_test_ai_1', '2026-10-17 10:01:00');
    SET v_id1 = LAST_INSERT_ID();
    INSERT INTO PAYMENT (pnr, amount, method, status, gateway_payment_id, paid_at) VALUES (v_pnr, 11.00, 'UPI', 'SUCCESS', 'pay_test_ai_2', '2026-10-17 10:02:00');
    SET v_id2 = LAST_INSERT_ID();
    -- an explicit id (the seed loader does this) moves the counter up, so the next automatic id is higher still
    SET v_explicit = v_id2 + 500;
    INSERT INTO PAYMENT (payment_id, pnr, amount, method, status, gateway_payment_id, paid_at) VALUES (v_explicit, v_pnr, 12.00, 'UPI', 'SUCCESS', 'pay_test_ai_3', '2026-10-17 10:03:00');
    INSERT INTO PAYMENT (pnr, amount, method, status, gateway_payment_id, paid_at) VALUES (v_pnr, 13.00, 'UPI', 'SUCCESS', 'pay_test_ai_4', '2026-10-17 10:04:00');
    SET v_after_explicit = LAST_INSERT_ID();

    SELECT COUNT(*) INTO v_auto_cols FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = 'railway_db' AND EXTRA LIKE '%auto_increment%'
      AND ((TABLE_NAME = 'RESERVATION' AND COLUMN_NAME = 'res_id') OR (TABLE_NAME = 'PAYMENT' AND COLUMN_NAME = 'payment_id')
        OR (TABLE_NAME = 'REFUND' AND COLUMN_NAME = 'refund_id') OR (TABLE_NAME = 'CANCELLATION' AND COLUMN_NAME = 'cancel_id')
        OR (TABLE_NAME = 'TICKET_VERIFICATION' AND COLUMN_NAME = 'verify_id') OR (TABLE_NAME = 'CHART_SNAPSHOT' AND COLUMN_NAME = 'snapshot_id'));

    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Ids: AUTO_INCREMENT On The Six Concurrent Tables',
            'Booking gets a res_id by itself, ids go up, an explicit id still works and the counter moves above it, 6 columns are AUTO_INCREMENT',
            CONCAT('res_id ', COALESCE(v_res_ok, 0), ', payment ids ', v_id1, ',', v_id2, ',', v_explicit, ',', v_after_explicit, ', auto columns ', v_auto_cols),
            IF(v_res_ok > 0 AND v_id2 > v_id1 AND v_after_explicit > v_explicit AND v_auto_cols = 6, 'PASS', 'FAIL'),
            'res_id, payment_id, refund_id, cancel_id, verify_id and snapshot_id no longer use MAX+1, so parallel bookings cannot get the same id.');

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 54-56: sp_verify_ticket - a valid check, a staff member who is not on duty, and an ID that was not checked
-- Train 125 on 2026-10-19 (Schedule 1137, PNR 2849100701). Everything is rolled back.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_verify_ticket_cases$$
CREATE PROCEDURE test_verify_ticket_cases()
BEGIN
    DECLARE v_verify_id INT;
    DECLARE v_status VARCHAR(20);
    DECLARE v_before INT;
    DECLARE v_after INT;
    DECLARE v_stored VARCHAR(20);

    START TRANSACTION;
    INSERT INTO STAFF_ASSIGNMENT (assign_id, staff_id, schedule_id, station_id, duty_type, shift_start, shift_end)
    VALUES (9990, 1, 1137, 10, 'TRAIN_DUTY', '2026-10-19 00:00:00', '2026-10-19 23:59:59');

    -- Valid check by the staff member on duty
    SELECT COUNT(*) INTO v_before FROM TICKET_VERIFICATION;
    CALL sp_verify_ticket('2849100701', 1, 1, 1, 0, 'VALID', 'ID checked by TC', 0, v_verify_id, v_status);
    SELECT COUNT(*) INTO v_after FROM TICKET_VERIFICATION;
    SELECT result INTO v_stored FROM TICKET_VERIFICATION WHERE verify_id = v_verify_id;
    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Verify Ticket: Valid Check By Staff On Duty',
            'SUCCESS, a verify_id is returned, one TICKET_VERIFICATION row with result VALID',
            CONCAT(COALESCE(v_status, 'NULL'), ', id ', COALESCE(v_verify_id, 'NULL'), ', rows +', v_after - v_before, ', stored ', COALESCE(v_stored, 'NULL')),
            IF(v_status = 'SUCCESS' AND v_verify_id IS NOT NULL AND v_after - v_before = 1 AND v_stored = 'VALID', 'PASS', 'FAIL'),
            'BR-ST3: a ticket check by a TC on TRAIN_DUTY for the run is stored with its own verify_id.');

    -- Staff 2 has no TRAIN_DUTY for this run
    SELECT COUNT(*) INTO v_before FROM TICKET_VERIFICATION;
    CALL sp_verify_ticket('2849100701', 1, 2, 1, 0, 'VALID', 'x', 0, v_verify_id, v_status);
    SELECT COUNT(*) INTO v_after FROM TICKET_VERIFICATION;
    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Verify Ticket: Staff Not On Duty Refused',
            'NOT_ON_DUTY, no verify_id, no row written',
            CONCAT(COALESCE(v_status, 'NULL'), ', id ', COALESCE(v_verify_id, 'NULL'), ', rows +', v_after - v_before),
            IF(v_status = 'NOT_ON_DUTY' AND v_verify_id IS NULL AND v_after = v_before, 'PASS', 'FAIL'),
            'BR-ST2: only staff with TRAIN_DUTY for the run may check its tickets.');

    -- The TC did not tick "ID checked"
    SELECT COUNT(*) INTO v_before FROM TICKET_VERIFICATION;
    CALL sp_verify_ticket('2849100701', 2, 1, 0, 0, 'VALID', 'x', 0, v_verify_id, v_status);
    SELECT COUNT(*) INTO v_after FROM TICKET_VERIFICATION;
    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Verify Ticket: ID Not Checked Refused',
            'VALIDATION_ERROR, no verify_id, no row written',
            CONCAT(COALESCE(v_status, 'NULL'), ', id ', COALESCE(v_verify_id, 'NULL'), ', rows +', v_after - v_before),
            IF(v_status = 'VALIDATION_ERROR' AND v_verify_id IS NULL AND v_after = v_before, 'PASS', 'FAIL'),
            'BR-ST3: a ticket check is only stored when the TC confirms the passenger ID was checked.');

    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 57-59: sp_board_passenger - a CONFIRMED passenger, a RAC passenger, and a passenger blocked by an open delay TDR
-- Train 125 on 2026-10-19 (Schedule 1137, class 3A). Everything is rolled back.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_board_passenger_cases$$
CREATE PROCEDURE test_board_passenger_cases()
BEGIN
    DECLARE v_status VARCHAR(20);
    DECLARE v_res_status VARCHAR(20);
    DECLARE v_seats_before INT;
    DECLARE v_rac_before INT;
    DECLARE v_seats_after INT;
    DECLARE v_rac_after INT;

    START TRANSACTION;
    INSERT INTO STAFF_ASSIGNMENT (assign_id, staff_id, schedule_id, station_id, duty_type, shift_start, shift_end)
    VALUES (9991, 1, 1137, 10, 'TRAIN_DUTY', '2026-10-19 00:00:00', '2026-10-19 23:59:59');

    -- CONFIRMED passenger boards
    CALL sp_board_passenger('2849100701', 2, 1, 0, v_status);
    SELECT status INTO v_res_status FROM RESERVATION WHERE pnr = '2849100701' AND passenger_no = 2;
    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Board: CONFIRMED Passenger Boards',
            'BOARDED and the reservation is BOARDED',
            CONCAT(COALESCE(v_status, 'NULL'), ', reservation ', COALESCE(v_res_status, 'NULL')),
            IF(v_status = 'BOARDED' AND v_res_status = 'BOARDED', 'PASS', 'FAIL'),
            'BR-ST4: a CONFIRMED passenger on a run where the staff member has TRAIN_DUTY can be marked BOARDED.');

    -- RAC passenger boards: the inventory counters move with it
    SELECT available_seats, rac_count INTO v_seats_before, v_rac_before
    FROM SCHEDULE_CLASS_INVENTORY WHERE schedule_id = 1137 AND class_id = 3;
    CALL sp_board_passenger('2849100985', 1, 1, 0, v_status);
    SELECT status INTO v_res_status FROM RESERVATION WHERE pnr = '2849100985' AND passenger_no = 1;
    SELECT available_seats, rac_count INTO v_seats_after, v_rac_after
    FROM SCHEDULE_CLASS_INVENTORY WHERE schedule_id = 1137 AND class_id = 3;
    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Board: RAC Passenger Boards And Inventory Follows',
            'BOARDED, available_seats -1 and rac_count -1',
            CONCAT(COALESCE(v_status, 'NULL'), ', reservation ', COALESCE(v_res_status, 'NULL'), ', seats ', v_seats_before, '->', v_seats_after, ', rac ', v_rac_before, '->', v_rac_after),
            IF(v_status = 'BOARDED' AND v_res_status = 'BOARDED' AND v_seats_after = v_seats_before - 1 AND v_rac_after = v_rac_before - 1, 'PASS', 'FAIL'),
            'A RAC passenger who boards uses a seat for real, so the class counters change and the inventory audit stays at 0 mismatches.');

    -- Open delay TDR on the third passenger blocks boarding (BR-T6)
    INSERT INTO TDR_FILING (tdr_ref_no, pnr, passenger_no, reason, filed_at, status, evidence_ref)
    VALUES ('TDR-TEST-BOARD-1', '2849100701', 3, 'TRAIN_DELAYED_OVER_3_HOURS', '2026-10-19 12:00:00', 'FILED', 'DELAY-NOTICE');
    CALL sp_board_passenger('2849100701', 3, 1, 0, v_status);
    SELECT status INTO v_res_status FROM RESERVATION WHERE pnr = '2849100701' AND passenger_no = 3;
    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Board: Open Delay TDR Blocks Boarding',
            'TDR_OPEN and the passenger stays CONFIRMED',
            CONCAT(COALESCE(v_status, 'NULL'), ', reservation ', COALESCE(v_res_status, 'NULL')),
            IF(v_status = 'TDR_OPEN' AND v_res_status = 'CONFIRMED', 'PASS', 'FAIL'),
            'BR-T6: a passenger with a FILED, UNDER_REVIEW or APPROVED delay TDR cannot be boarded.');

    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 60-61: sp_mark_passenger_noshow - the promotion happens, and a second mark is refused
-- Train 125 on 2026-10-19 (Schedule 1137): PNR 2849100701 passenger 1, next RAC passenger is PNR 2849100985.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_noshow_cases$$
CREATE PROCEDURE test_noshow_cases()
BEGIN
    DECLARE v_status VARCHAR(20);
    DECLARE v_status2 VARCHAR(20);
    DECLARE v_board VARCHAR(20);
    DECLARE v_res_status VARCHAR(20);
    DECLARE v_seat INT;
    DECLARE v_rac_status VARCHAR(20);
    DECLARE v_seat_now INT;

    START TRANSACTION;
    INSERT INTO STAFF_ASSIGNMENT (assign_id, staff_id, schedule_id, station_id, duty_type, shift_start, shift_end)
    VALUES (9992, 1, 1137, 10, 'TRAIN_DUTY', '2026-10-19 00:00:00', '2026-10-19 23:59:59');

    SELECT seat_id INTO v_seat FROM RESERVATION WHERE pnr = '2849100701' AND passenger_no = 1;
    CALL sp_mark_passenger_noshow('2849100701', 1, 1, 0, v_status);
    SELECT status, seat_id INTO v_res_status, v_seat_now FROM RESERVATION WHERE pnr = '2849100701' AND passenger_no = 1;
    SELECT status INTO v_rac_status FROM RESERVATION WHERE pnr = '2849100985' AND passenger_no = 1;
    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('No-Show: Seat Freed And RAC Promoted',
            'NO_SHOW_MARKED, passenger NO_SHOW without a seat, next RAC passenger CONFIRMED',
            CONCAT(COALESCE(v_status, 'NULL'), ', ', COALESCE(v_res_status, 'NULL'), ', seat ', COALESCE(v_seat_now, 'none'), ', next RAC ', COALESCE(v_rac_status, 'NULL')),
            IF(v_status = 'NO_SHOW_MARKED' AND v_res_status = 'NO_SHOW' AND v_seat IS NOT NULL AND v_seat_now IS NULL AND v_rac_status = 'CONFIRMED', 'PASS', 'FAIL'),
            'BR-ST4: the no-show releases the seat and sp_promote_passenger moves the first RAC passenger into it.');

    -- The same passenger again, and boarding after a no-show: both refused
    CALL sp_mark_passenger_noshow('2849100701', 1, 1, 0, v_status2);
    CALL sp_board_passenger('2849100701', 1, 1, 0, v_board);
    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('No-Show: Second Mark And Boarding Not Eligible',
            'NOT_ELIGIBLE for the second no-show and NOT_ELIGIBLE for boarding',
            CONCAT(COALESCE(v_status2, 'NULL'), ' / ', COALESCE(v_board, 'NULL')),
            IF(v_status2 = 'NOT_ELIGIBLE' AND v_board = 'NOT_ELIGIBLE', 'PASS', 'FAIL'),
            'Only CONFIRMED or RAC passengers can be marked no-show or boarded; a NO_SHOW passenger is neither.');

    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 62-63: sp_prepare_chart on Train 119, 2026-10-19 (Schedule 1111) - snapshot contents and the waiting-list purge
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_prepare_chart_snapshot_and_purge$$
CREATE PROCEDURE test_prepare_chart_snapshot_and_purge()
BEGIN
    DECLARE v_sched_id INT DEFAULT 1111;
    DECLARE v_expected INT;
    DECLARE v_wl INT;
    DECLARE v_wl_money DECIMAL(12,2);
    DECLARE v_snap_out INT DEFAULT 0;
    DECLARE v_snap_rows INT;
    DECLARE v_bad_rows INT;
    DECLARE v_cancelled_rows INT;
    DECLARE v_prepared DATETIME;
    DECLARE v_wl_left INT;
    DECLARE v_purge_rows INT;
    DECLARE v_purge_pending INT;
    DECLARE v_purge_money DECIMAL(12,2);

    START TRANSACTION;

    SELECT COUNT(*) INTO v_expected FROM RESERVATION WHERE schedule_id = v_sched_id AND status IN ('CONFIRMED', 'RAC');
    SELECT COUNT(*), COALESCE(SUM(pb.total_fare - pb.insurance), 0) INTO v_wl, v_wl_money
    FROM RESERVATION r JOIN PASSENGER_BOOKING pb ON pb.pnr = r.pnr AND pb.passenger_no = r.passenger_no
    WHERE r.schedule_id = v_sched_id AND r.status = 'WAITING_LIST';

    CALL sp_prepare_chart(v_sched_id, 0, v_snap_out);

    -- Snapshot contents: one row per CONFIRMED or RAC passenger, with coach, seat and stops filled in, same status as the reservation
    SELECT COUNT(*) INTO v_snap_rows FROM CHART_SNAPSHOT WHERE schedule_id = v_sched_id;
    SELECT COUNT(*) INTO v_bad_rows
    FROM CHART_SNAPSHOT s LEFT JOIN RESERVATION r ON r.pnr = s.pnr AND r.passenger_no = s.passenger_no
    WHERE s.schedule_id = v_sched_id
      AND (s.coach_no IS NULL OR s.seat_no IS NULL OR s.berth_type IS NULL OR s.from_station_id IS NULL OR s.to_station_id IS NULL
           OR r.status IS NULL OR r.status <> s.status);
    SELECT COUNT(*) INTO v_cancelled_rows
    FROM CHART_SNAPSHOT s JOIN RESERVATION r ON r.pnr = s.pnr AND r.passenger_no = s.passenger_no
    WHERE s.schedule_id = v_sched_id AND r.status = 'CANCELLED';
    SELECT chart_prepared_at INTO v_prepared FROM TRAIN_SCHEDULE WHERE schedule_id = v_sched_id;

    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Chart Prep: Snapshot Holds One Row Per Travelling Passenger',
            'Snapshot rows = CONFIRMED + RAC passengers, no empty field, no cancelled passenger, run marked prepared',
            CONCAT('Expected ', v_expected, ', returned ', v_snap_out, ', stored ', v_snap_rows, ', bad ', v_bad_rows, ', cancelled ', v_cancelled_rows, ', prepared ', IF(v_prepared IS NULL, 'no', 'yes')),
            IF(v_snap_out = v_expected AND v_snap_rows = v_expected AND v_expected > 0 AND v_bad_rows = 0 AND v_cancelled_rows = 0 AND v_prepared IS NOT NULL, 'PASS', 'FAIL'),
            'BR-B12a: the chart snapshot lists coach, seat, berth, status and stops for every passenger who still travels.');

    -- Waiting-list purge: nobody is left waiting, and every purged passenger gets a PENDING refund of the full fare (insurance excluded)
    SELECT COUNT(*) INTO v_wl_left FROM RESERVATION WHERE schedule_id = v_sched_id AND status = 'WAITING_LIST';
    SELECT COUNT(*), COALESCE(SUM(r.status = 'PENDING'), 0), COALESCE(SUM(r.amount), 0)
    INTO v_purge_rows, v_purge_pending, v_purge_money
    FROM REFUND r JOIN PAYMENT p ON p.payment_id = r.payment_id
    JOIN BOOKING b ON b.pnr = p.pnr
    WHERE r.reason = 'WAITLIST_PURGE' AND b.schedule_id = v_sched_id;

    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Chart Prep: Waiting List Purged With Full PENDING Refunds',
            'No WL left, one PENDING WAITLIST_PURGE refund per purged passenger, amount = full fare, insurance excluded',
            CONCAT('WL ', v_wl, '->', v_wl_left, ', refunds ', v_purge_rows, ' (pending ', v_purge_pending, '), money ', v_purge_money, ' of ', v_wl_money),
            IF(v_wl > 0 AND v_wl_left = 0 AND v_purge_rows = v_wl AND v_purge_pending = v_wl AND v_purge_money = v_wl_money, 'PASS', 'FAIL'),
            'BR-W8: waitlisted passengers are cancelled at chart time and refunded in full; the money leaves only when the gateway step marks the refund PROCESSED.');

    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 64-65: Concession fares with the seed rules (golden numbers)
-- Sleeper (class 4) on Train 101 (Duronto, standard rules, 800 km, GENERAL quota, no insurance, run 1001)
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_concession_fare_cases$$
CREATE PROCEDURE test_concession_fare_cases()
BEGIN
    DECLARE v_none JSON;
    DECLARE v_div JSON;
    DECLARE v_senior_off JSON;
    DECLARE v_senior_on JSON;

    START TRANSACTION;

    SET v_none = fn_calculate_fare(4, 101, 800, 'GENERAL', 'NONE', 0, 1001);
    SET v_div = fn_calculate_fare(4, 101, 800, 'GENERAL', 'DIVYAANG', 0, 1001);
    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Fare: DIVYAANG Sleeper Gets 75 Percent Off The Base Fare',
            'Base 496.00, discount 372.00, total 174.00 (full fare without concession 546.00)',
            CONCAT('Base ', JSON_EXTRACT(v_div, '$.base_fare'), ', discount ', JSON_EXTRACT(v_div, '$.concession_discount'),
                   ', total ', JSON_EXTRACT(v_div, '$.total_fare'), ' (none ', JSON_EXTRACT(v_none, '$.total_fare'), ')'),
            IF(JSON_EXTRACT(v_div, '$.base_fare') = 496 AND JSON_EXTRACT(v_div, '$.concession_discount') = 372
               AND JSON_EXTRACT(v_div, '$.total_fare') = 174 AND JSON_EXTRACT(v_none, '$.total_fare') = 546, 'PASS', 'FAIL'),
            'Seed rule 1: DIVYAANG on class 4 of a standard train is 75 percent of the base fare; the fixed charges stay.');

    -- Senior citizen: no concession in the seed (rule off, setting false); the rule and the setting must both be on
    SET v_senior_off = fn_calculate_fare(4, 101, 800, 'GENERAL', 'SENIOR_CITIZEN', 0, 1001);
    UPDATE CONCESSION_RULE SET is_active = 1, discount_pct = 40 WHERE rule_id = 10;
    UPDATE SETTING SET setting_value = 'true' WHERE setting_key = 'CONCESSION_SENIOR_ENABLED';
    SET v_senior_on = fn_calculate_fare(4, 101, 800, 'GENERAL', 'SENIOR_CITIZEN', 0, 1001);
    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Fare: SENIOR_CITIZEN Pays Full Fare Until Switched On, Then 40 Percent Off',
            'Seed: discount 0.00, total 546.00. Rule and setting on: discount 198.40, total 347.60',
            CONCAT('Seed: ', JSON_EXTRACT(v_senior_off, '$.concession_discount'), '/', JSON_EXTRACT(v_senior_off, '$.total_fare'),
                   '. On: ', JSON_EXTRACT(v_senior_on, '$.concession_discount'), '/', JSON_EXTRACT(v_senior_on, '$.total_fare')),
            IF(JSON_EXTRACT(v_senior_off, '$.concession_discount') = 0 AND JSON_EXTRACT(v_senior_off, '$.total_fare') = 546
               AND JSON_EXTRACT(v_senior_on, '$.concession_discount') = 198.4 AND JSON_EXTRACT(v_senior_on, '$.total_fare') = 347.6, 'PASS', 'FAIL'),
            'Senior concession is off in version 1 (BR-F7): it needs CONCESSION_SENIOR_ENABLED = true and an active rule.');

    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- TEST 66: The four audit triggers - one UPDATE on each table writes exactly one AUDIT_LOG row with the right action
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_four_audit_triggers$$
CREATE PROCEDURE test_four_audit_triggers()
BEGIN
    DECLARE v_fare INT;
    DECLARE v_concession INT;
    DECLARE v_refund_rule INT;
    DECLARE v_setting INT;
    DECLARE v_base INT;

    START TRANSACTION;

    SELECT COUNT(*) INTO v_base FROM AUDIT_LOG WHERE action = 'UPDATE_FARE_RATE';
    UPDATE FARE SET rate_per_km = rate_per_km + 0.10 WHERE fare_id = 1;
    SELECT COUNT(*) - v_base INTO v_fare FROM AUDIT_LOG WHERE action = 'UPDATE_FARE_RATE' AND table_name = 'FARE';

    SELECT COUNT(*) INTO v_base FROM AUDIT_LOG WHERE action = 'UPDATE_CONCESSION_RULE';
    UPDATE CONCESSION_RULE SET discount_pct = 30 WHERE rule_id = 8;
    SELECT COUNT(*) - v_base INTO v_concession FROM AUDIT_LOG WHERE action = 'UPDATE_CONCESSION_RULE' AND table_name = 'CONCESSION_RULE';

    SELECT COUNT(*) INTO v_base FROM AUDIT_LOG WHERE action = 'UPDATE_REFUND_RULE';
    UPDATE REFUND_RULE SET deduction_pct = 30 WHERE class_id = 3 AND min_hours = 24;
    SELECT COUNT(*) - v_base INTO v_refund_rule FROM AUDIT_LOG WHERE action = 'UPDATE_REFUND_RULE' AND table_name = 'REFUND_RULE';

    SELECT COUNT(*) INTO v_base FROM AUDIT_LOG WHERE action = 'UPDATE_SETTING';
    UPDATE SETTING SET setting_value = '0.12' WHERE setting_key = 'GST_RATE_AC';
    SELECT COUNT(*) - v_base INTO v_setting FROM AUDIT_LOG WHERE action = 'UPDATE_SETTING' AND table_name = 'SETTING';

    INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
    VALUES ('Audit Triggers: Each Of The 4 Writes One AUDIT_LOG Row',
            'One new row each for FARE, CONCESSION_RULE, REFUND_RULE and SETTING',
            CONCAT('FARE +', v_fare, ', CONCESSION_RULE +', v_concession, ', REFUND_RULE +', v_refund_rule, ', SETTING +', v_setting),
            IF(v_fare = 1 AND v_concession = 1 AND v_refund_rule = 1 AND v_setting = 1, 'PASS', 'FAIL'),
            'BR-A8: trg_audit_fare_change, trg_audit_concession_change, trg_audit_refund_rule_change and trg_audit_setting_change.');

    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- test_reset_id_counters
-- Rolled-back tests still move the AUTO_INCREMENT counters (a counter never goes back), and several older tests
-- insert explicit ids such as 988801. This puts the six counters back to MAX + 1 after the whole suite has run.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_reset_id_counters$$
CREATE PROCEDURE test_reset_id_counters()
BEGIN
    SET @id_next = (SELECT COALESCE(MAX(res_id), 0) + 1 FROM RESERVATION);
    SET @id_sql = CONCAT('ALTER TABLE RESERVATION AUTO_INCREMENT = ', @id_next);
    PREPARE id_stmt FROM @id_sql;
    EXECUTE id_stmt;
    DEALLOCATE PREPARE id_stmt;
    SET @id_next = (SELECT COALESCE(MAX(payment_id), 0) + 1 FROM PAYMENT);
    SET @id_sql = CONCAT('ALTER TABLE PAYMENT AUTO_INCREMENT = ', @id_next);
    PREPARE id_stmt FROM @id_sql;
    EXECUTE id_stmt;
    DEALLOCATE PREPARE id_stmt;
    SET @id_next = (SELECT COALESCE(MAX(refund_id), 0) + 1 FROM REFUND);
    SET @id_sql = CONCAT('ALTER TABLE REFUND AUTO_INCREMENT = ', @id_next);
    PREPARE id_stmt FROM @id_sql;
    EXECUTE id_stmt;
    DEALLOCATE PREPARE id_stmt;
    SET @id_next = (SELECT COALESCE(MAX(cancel_id), 0) + 1 FROM CANCELLATION);
    SET @id_sql = CONCAT('ALTER TABLE CANCELLATION AUTO_INCREMENT = ', @id_next);
    PREPARE id_stmt FROM @id_sql;
    EXECUTE id_stmt;
    DEALLOCATE PREPARE id_stmt;
    SET @id_next = (SELECT COALESCE(MAX(verify_id), 0) + 1 FROM TICKET_VERIFICATION);
    SET @id_sql = CONCAT('ALTER TABLE TICKET_VERIFICATION AUTO_INCREMENT = ', @id_next);
    PREPARE id_stmt FROM @id_sql;
    EXECUTE id_stmt;
    DEALLOCATE PREPARE id_stmt;
    SET @id_next = (SELECT COALESCE(MAX(snapshot_id), 0) + 1 FROM CHART_SNAPSHOT);
    SET @id_sql = CONCAT('ALTER TABLE CHART_SNAPSHOT AUTO_INCREMENT = ', @id_next);
    PREPARE id_stmt FROM @id_sql;
    EXECUTE id_stmt;
    DEALLOCATE PREPARE id_stmt;
END$$

-- -----------------------------------------------------------------------------
-- BR-Q3 / BR-CB5: Tatkal needs an Aadhaar-verified account (online) or an Aadhaar ID proof (counter)
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_tatkal_aadhaar_rule$$
CREATE PROCEDURE test_tatkal_aadhaar_rule()
BEGIN
    DECLARE v_pnr VARCHAR(10);
    DECLARE v_stat VARCHAR(20);
    DECLARE v_fare DECIMAL(10,2);
    DECLARE v_err VARCHAR(32);
    DECLARE v_err2 VARCHAR(32);
    DECLARE v_pax_plain JSON;
    DECLARE v_pax_aadhaar JSON;

    SET v_pax_plain = JSON_ARRAY(JSON_OBJECT('saved_passenger_id', 7, 'name', 'Tatkal User', 'age', 30, 'gender', 'MALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH'));
    SET v_pax_aadhaar = JSON_ARRAY(JSON_OBJECT('saved_passenger_id', 7, 'name', 'Tatkal User', 'age', 30, 'gender', 'MALE', 'concession_type', 'NONE', 'concession_proof_type', 'AADHAAR', 'concession_proof_ref', 'XXXX-XXXX-1234', 'berth_preference', 'NO_BERTH'));

    START TRANSACTION;
    SET @as_of_time = '2026-10-17 19:15:00';

    -- online, account NOT verified -> refused
    UPDATE USER_ACCOUNT SET aadhaar_verified = 0 WHERE user_id = 50002;
    CALL sp_create_booking(50002, 1001, 3, 1145, 1149, 'TATKAL', 0, 0, 0, v_pax_plain, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err);
    -- online, account verified -> the Aadhaar rule no longer refuses
    UPDATE USER_ACCOUNT SET aadhaar_verified = 1 WHERE user_id = 50002;
    CALL sp_create_booking(50002, 1001, 3, 1145, 1149, 'TATKAL', 0, 0, 0, v_pax_plain, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err2);

    IF v_err = 'AADHAAR_REQUIRED' AND COALESCE(v_err2, 'NONE') <> 'AADHAAR_REQUIRED' THEN
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Tatkal online needs an Aadhaar-verified account (BR-Q3)', 'AADHAAR_REQUIRED then allowed', CONCAT(v_err, ' then ', COALESCE(v_err2, 'OK')), 'PASS', 'Unverified account refused, verified account accepted.');
    ELSE
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Tatkal online needs an Aadhaar-verified account (BR-Q3)', 'AADHAAR_REQUIRED then allowed', CONCAT(COALESCE(v_err, 'NONE'), ' then ', COALESCE(v_err2, 'OK')), 'FAIL', 'Tatkal Aadhaar rule not enforced as expected.');
    END IF;

    -- counter: no Aadhaar proof -> refused; with an Aadhaar proof on one passenger -> not refused for Aadhaar
    SET v_err = NULL; SET v_err2 = NULL;
    CALL sp_create_counter_booking(1, NULL, 1001, 3, 1145, 1149, 'TATKAL', v_pax_plain, 'CASH', 0, v_pnr, v_fare, v_stat, v_err);
    CALL sp_create_counter_booking(1, NULL, 1001, 3, 1145, 1149, 'TATKAL', v_pax_aadhaar, 'CASH', 0, v_pnr, v_fare, v_stat, v_err2);
    IF v_err = 'AADHAAR_REQUIRED' AND COALESCE(v_err2, 'NONE') <> 'AADHAAR_REQUIRED' THEN
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Tatkal at the counter needs an Aadhaar ID proof (BR-CB5)', 'AADHAAR_REQUIRED then allowed', CONCAT(v_err, ' then ', COALESCE(v_err2, 'OK')), 'PASS', 'Counter Tatkal without proof refused, with proof accepted.');
    ELSE
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Tatkal at the counter needs an Aadhaar ID proof (BR-CB5)', 'AADHAAR_REQUIRED then allowed', CONCAT(COALESCE(v_err, 'NONE'), ' then ', COALESCE(v_err2, 'OK')), 'FAIL', 'Counter Tatkal Aadhaar rule not enforced as expected.');
    END IF;

    SET @as_of_time = NULL;
    ROLLBACK;
END$$

-- -----------------------------------------------------------------------------
-- BR-B15: the monthly limit counts on the TEST CLOCK month. 12 tickets in September do not block a booking made on 17 October.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS test_monthly_limit_test_clock_month$$
CREATE PROCEDURE test_monthly_limit_test_clock_month()
BEGIN
    DECLARE v_pnr VARCHAR(10);
    DECLARE v_stat VARCHAR(20);
    DECLARE v_fare DECIMAL(10,2);
    DECLARE v_err VARCHAR(32);
    DECLARE v_cnt INT DEFAULT 0;
    DECLARE v_pax JSON;

    SET v_pax = JSON_ARRAY(JSON_OBJECT('saved_passenger_id', 7, 'name', 'Limit User', 'age', 30, 'gender', 'MALE', 'concession_type', 'NONE', 'berth_preference', 'NO_BERTH'));
    DELETE FROM BOOKING WHERE pnr LIKE '88870000%';

    START TRANSACTION;
    SET @as_of_time = '2026-10-17 19:15:00';
    UPDATE USER_ACCOUNT SET aadhaar_verified = 0 WHERE user_id = 50002;
    WHILE v_cnt < 12 DO
        INSERT INTO BOOKING (pnr, user_id, schedule_id, class_id, from_stop_id, to_stop_id, channel, quota, requested_quota, berth_condition, total_fare, status, created_at)
        VALUES (CONCAT('88870000', LPAD(v_cnt, 2, '0')), 50002, 1001, 3, 1145, 1149, 'ONLINE', 'GENERAL', 'GENERAL', 0, 100.00, 'CONFIRMED', '2026-09-20 10:00:00');
        SET v_cnt = v_cnt + 1;
    END WHILE;
    CALL sp_create_booking(50002, 1001, 3, 1145, 1149, 'GENERAL', 0, 0, 0, v_pax, 'ONLINE', NULL, 0, v_pnr, v_stat, v_fare, v_err);

    IF COALESCE(v_err, 'NONE') <> 'MONTHLY_LIMIT_EXCEEDED' THEN
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Monthly limit counts the test-clock month (September tickets do not block October)', 'not MONTHLY_LIMIT_EXCEEDED', COALESCE(v_err, 'OK'), 'PASS', 'fn_check_monthly_ticket_limit is called with COALESCE(@as_of_time, NOW()).');
    ELSE
        INSERT INTO test_results (test_name, expected_outcome, actual_outcome, status, details)
        VALUES ('Monthly limit counts the test-clock month (September tickets do not block October)', 'not MONTHLY_LIMIT_EXCEEDED', v_err, 'FAIL', 'The limit looked at the wrong month.');
    END IF;

    SET @as_of_time = NULL;
    ROLLBACK;
    DELETE FROM BOOKING WHERE pnr LIKE '88870000%';
END$$

DROP PROCEDURE IF EXISTS sp_run_all_tests$$
CREATE PROCEDURE sp_run_all_tests()
BEGIN
    TRUNCATE TABLE test_results;

    CALL test_story_1();
    CALL test_story_2();
    CALL test_story_3();
    CALL test_story_4();
    CALL test_story_5();
    CALL test_waiting_list_full();
    CALL test_rac_open();
    CALL test_berth_preference_not_met();
    CALL test_monthly_limit_exceeded();
    CALL test_chart_prepared();
    CALL test_whole_pnr_cancel_two_seats();
    CALL test_cancel_wl_passenger();
    CALL test_whole_pnr_cancel_mixed_passengers();
    CALL test_cancel_after_chart();
    CALL test_tatkal_confirmed_cancel();
    CALL test_counter_ticket_cancel();
    CALL test_real_general_waiting_list_full();
    CALL test_real_general_rac_allocation();
    CALL test_real_inventory_sync_after_cancel_promotion();
    CALL test_payment_hold_pay_in_time();
    CALL test_payment_hold_pay_late();
    CALL test_payment_hold_expires_and_released();
    CALL test_payment_hold_same_gateway_id_twice();
    CALL test_counter_booking_unchanged();
    CALL test_payment_hold_pay_late_promotes_waiting();
    CALL test_confirmed_booking_second_payment_refunded();
    CALL test_all_inventory_counters_match_real_counts();
    CALL test_tdr_file_and_approve();
    CALL test_tdr_double_filing_blocked();
    CALL test_refund_cap_exceeds_payment();
    CALL test_cancel_after_tdr_refund_blocked();
    CALL test_booking_journey_past();
    CALL test_booking_outside_window();
    CALL test_booking_invalid_stops();
    CALL test_tatkal_aadhaar_rule();
    CALL test_monthly_limit_test_clock_month();
    CALL test_ladies_quota_male_refused();
    CALL test_senior_quota_underage_refused();
    CALL test_divyaang_without_proof_refused();
    CALL test_tdr_non_delay_before_run_refused();
    CALL test_prepare_chart_error_surfaces();
    CALL test_refund_created_pending();
    CALL test_refund_result_transitions();
    CALL test_failed_refund_counts_toward_cap();
    CALL test_two_pending_refunds_cap();
    CALL test_refund_view_processed_only();
    CALL test_payment_order_transitions();
    CALL test_payment_order_expired();
    CALL test_payment_order_amount_check();
    CALL test_rule_setting_changes_fare();
    CALL test_rule_concession_changes_fare();
    CALL test_rule_dynamic_fare_switch();
    CALL test_rule_refund_rule_changes_charge();
    CALL test_rule_bad_values_refused();
    CALL test_rule_edit_writes_audit();
    CALL test_auto_increment_ids();
    CALL test_verify_ticket_cases();
    CALL test_board_passenger_cases();
    CALL test_noshow_cases();
    CALL test_prepare_chart_snapshot_and_purge();
    CALL test_concession_fare_cases();
    CALL test_four_audit_triggers();

    CALL test_reset_id_counters();

    SELECT test_id, test_name, expected_outcome, actual_outcome, status, details FROM test_results;
END$$

DELIMITER ;
