-- =============================================================================
-- Railway Reservation & Management System (MySQL 8.0)
-- File: 03_procedures.sql
-- Description: Stored procedures with business rules:
--   1. sp_promote_passenger (Single promotion procedure per BR-W4, BR-W5, BR-W6)
--      * NO explicit transaction control inside (no COMMIT/ROLLBACK)
--      * Handles VARCHAR queue_position ('RAC/1', 'WL/1', etc.)
--   2. sp_mark_passenger_noshow (Staff NO_SHOW action calling sp_promote_passenger)
--   3. sp_create_booking (Booking procedure with quota fallback, RAC/WL, berth
--      preference check, monthly limit check, chart lockout, savepoints, payment hold)
--   4. sp_cancel_passenger_ticket (Cancellation with refund slabs, clerkage)
--   5. sp_prepare_chart (Chart prep: lockout, quota sweep, auto-upgrade, WL purge, snapshot)
--   6. sp_process_late_payment_refund (BR-B14 auto-refund for expired/failed holds)
--   7. sp_create_counter_booking (Counter booking for walk-in passengers)
--   8. sp_confirm_payment (BR-B9, BR-B14 confirms payment inside window, refunds if late)
--   9. sp_release_expired_holds (BR-B9 releases expired PAYMENT_PENDING bookings and promotes)
-- =============================================================================

USE railway_db;

DELIMITER $$

-- -----------------------------------------------------------------------------
-- 1. sp_promote_passenger
-- ONE single promotion procedure called from:
--   - trg_after_cancellation_promote (AFTER INSERT ON CANCELLATION trigger)
--   - sp_mark_passenger_noshow (Staff NO_SHOW action)
--   - sp_prepare_chart (during chart preparation quota release & auto-upgrade)
--
-- Crucial architectural design for MySQL 8.0:
--   - Contains NO 'START TRANSACTION', 'COMMIT', or 'ROLLBACK'
--   - Does NOT touch or modify CANCELLATION table
--   - Safe to be invoked from within triggers as well as procedures.
--   - Extracts numeric suffix from 'RAC/x' and 'WL/x' strings for queue management.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_promote_passenger$$
CREATE PROCEDURE sp_promote_passenger(
    IN p_schedule_id INT,
    IN p_class_id INT,
    IN p_freed_seat_id INT
)
proc_label: BEGIN
    DECLARE v_rac_res_id INT DEFAULT NULL;
    DECLARE v_rac_pnr VARCHAR(10) DEFAULT NULL;
    DECLARE v_rac_pass_no INT DEFAULT NULL;
    DECLARE v_wl_res_id INT DEFAULT NULL;
    DECLARE v_wl_pnr VARCHAR(10) DEFAULT NULL;
    DECLARE v_wl_pass_no INT DEFAULT NULL;
    DECLARE v_wl_old_num INT DEFAULT NULL;
    DECLARE v_max_rac_num INT DEFAULT 0;

    -- If a confirmed seat is freed
    IF p_freed_seat_id IS NOT NULL THEN
        -- Find lowest RAC passenger for this schedule and class
        SELECT r.res_id, r.pnr, r.passenger_no
        INTO v_rac_res_id, v_rac_pnr, v_rac_pass_no
        FROM RESERVATION r
        JOIN BOOKING b ON r.pnr = b.pnr
        WHERE r.schedule_id = p_schedule_id
          AND b.class_id = p_class_id
          AND r.status = 'RAC'
        ORDER BY
            CAST(SUBSTRING_INDEX(COALESCE(r.queue_position, '0'), '/', -1) AS UNSIGNED) ASC,
            r.res_id ASC
        LIMIT 1;

        IF v_rac_res_id IS NOT NULL THEN
            -- Promote RAC passenger to CONFIRMED with freed seat
            UPDATE RESERVATION
            SET status = 'CONFIRMED',
                seat_id = p_freed_seat_id,
                queue_position = NULL
            WHERE res_id = v_rac_res_id;

            -- Check if booking overall status should update to CONFIRMED
            IF NOT EXISTS (
                SELECT 1 FROM RESERVATION
                WHERE pnr = v_rac_pnr AND status IN ('RAC', 'WAITING_LIST')
            ) THEN
                UPDATE BOOKING SET status = 'CONFIRMED' WHERE pnr = v_rac_pnr;
            END IF;

            -- Update class inventory counts: RAC count decrements, available seats adjust
            UPDATE SCHEDULE_CLASS_INVENTORY
            SET rac_count = GREATEST(0, rac_count - 1)
            WHERE schedule_id = p_schedule_id AND class_id = p_class_id;

            -- A RAC slot just opened up! Now advance lowest WL passenger to RAC
            SELECT r.res_id, r.pnr, r.passenger_no,
                   CAST(SUBSTRING_INDEX(COALESCE(r.queue_position, '0'), '/', -1) AS UNSIGNED)
            INTO v_wl_res_id, v_wl_pnr, v_wl_pass_no, v_wl_old_num
            FROM RESERVATION r
            JOIN BOOKING b ON r.pnr = b.pnr
            WHERE r.schedule_id = p_schedule_id
              AND b.class_id = p_class_id
              AND r.status = 'WAITING_LIST'
            ORDER BY
                CAST(SUBSTRING_INDEX(COALESCE(r.queue_position, '0'), '/', -1) AS UNSIGNED) ASC,
                r.res_id ASC
            LIMIT 1;

            IF v_wl_res_id IS NOT NULL THEN
                -- Find highest current RAC queue position + 1
                SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(COALESCE(r.queue_position, '0'), '/', -1) AS UNSIGNED)), 0) + 1
                INTO v_max_rac_num
                FROM RESERVATION r
                JOIN BOOKING b ON r.pnr = b.pnr
                WHERE r.schedule_id = p_schedule_id AND b.class_id = p_class_id AND r.status = 'RAC';

                UPDATE RESERVATION
                SET status = 'RAC',
                    queue_position = CONCAT('RAC/', v_max_rac_num)
                WHERE res_id = v_wl_res_id;

                UPDATE BOOKING SET status = 'RAC' WHERE pnr = v_wl_pnr AND status = 'WAITING_LIST';

                UPDATE SCHEDULE_CLASS_INVENTORY
                SET rac_count = rac_count + 1,
                    wl_count = GREATEST(0, wl_count - 1)
                WHERE schedule_id = p_schedule_id AND class_id = p_class_id;

                -- Shift subsequent WL queue positions up by 1
                UPDATE RESERVATION r
                JOIN BOOKING b ON r.pnr = b.pnr
                SET r.queue_position = CONCAT('WL/', CAST(SUBSTRING_INDEX(r.queue_position, '/', -1) AS UNSIGNED) - 1)
                WHERE r.schedule_id = p_schedule_id
                  AND b.class_id = p_class_id
                  AND r.status = 'WAITING_LIST'
                  AND CAST(SUBSTRING_INDEX(COALESCE(r.queue_position, '0'), '/', -1) AS UNSIGNED) > v_wl_old_num;
            END IF;

        ELSE
            -- No RAC passengers exist. Check if a Waiting List passenger exists directly (e.g., classes without RAC like 1A, CC, EC)
            SELECT r.res_id, r.pnr, r.passenger_no,
                   CAST(SUBSTRING_INDEX(COALESCE(r.queue_position, '0'), '/', -1) AS UNSIGNED)
            INTO v_wl_res_id, v_wl_pnr, v_wl_pass_no, v_wl_old_num
            FROM RESERVATION r
            JOIN BOOKING b ON r.pnr = b.pnr
            WHERE r.schedule_id = p_schedule_id
              AND b.class_id = p_class_id
              AND r.status = 'WAITING_LIST'
            ORDER BY
                CAST(SUBSTRING_INDEX(COALESCE(r.queue_position, '0'), '/', -1) AS UNSIGNED) ASC,
                r.res_id ASC
            LIMIT 1;

            IF v_wl_res_id IS NOT NULL THEN
                UPDATE RESERVATION
                SET status = 'CONFIRMED',
                    seat_id = p_freed_seat_id,
                    queue_position = NULL
                WHERE res_id = v_wl_res_id;

                IF NOT EXISTS (
                    SELECT 1 FROM RESERVATION
                    WHERE pnr = v_wl_pnr AND status IN ('RAC', 'WAITING_LIST')
                ) THEN
                    UPDATE BOOKING SET status = 'CONFIRMED' WHERE pnr = v_wl_pnr;
                END IF;

                UPDATE SCHEDULE_CLASS_INVENTORY
                SET wl_count = GREATEST(0, wl_count - 1)
                WHERE schedule_id = p_schedule_id AND class_id = p_class_id;

                UPDATE RESERVATION r
                JOIN BOOKING b ON r.pnr = b.pnr
                SET r.queue_position = CONCAT('WL/', CAST(SUBSTRING_INDEX(r.queue_position, '/', -1) AS UNSIGNED) - 1)
                WHERE r.schedule_id = p_schedule_id
                  AND b.class_id = p_class_id
                  AND r.status = 'WAITING_LIST'
                  AND CAST(SUBSTRING_INDEX(COALESCE(r.queue_position, '0'), '/', -1) AS UNSIGNED) > v_wl_old_num;
            ELSE
                UPDATE SCHEDULE_CLASS_INVENTORY
                SET available_seats = available_seats + 1
                WHERE schedule_id = p_schedule_id AND class_id = p_class_id;
            END IF;
        END IF;

    ELSE
        -- No specific seat freed, but an RAC slot freed (e.g. RAC passenger cancelled)
        SELECT r.res_id, r.pnr, r.passenger_no,
               CAST(SUBSTRING_INDEX(COALESCE(r.queue_position, '0'), '/', -1) AS UNSIGNED)
        INTO v_wl_res_id, v_wl_pnr, v_wl_pass_no, v_wl_old_num
        FROM RESERVATION r
        JOIN BOOKING b ON r.pnr = b.pnr
        WHERE r.schedule_id = p_schedule_id
          AND b.class_id = p_class_id
          AND r.status = 'WAITING_LIST'
        ORDER BY
            CAST(SUBSTRING_INDEX(COALESCE(r.queue_position, '0'), '/', -1) AS UNSIGNED) ASC,
            r.res_id ASC
        LIMIT 1;

        IF v_wl_res_id IS NOT NULL THEN
            SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(COALESCE(r.queue_position, '0'), '/', -1) AS UNSIGNED)), 0) + 1
            INTO v_max_rac_num
            FROM RESERVATION r
            JOIN BOOKING b ON r.pnr = b.pnr
            WHERE r.schedule_id = p_schedule_id AND b.class_id = p_class_id AND r.status = 'RAC';

            UPDATE RESERVATION
            SET status = 'RAC',
                queue_position = CONCAT('RAC/', v_max_rac_num)
            WHERE res_id = v_wl_res_id;

            UPDATE BOOKING SET status = 'RAC' WHERE pnr = v_wl_pnr AND status = 'WAITING_LIST';

            UPDATE SCHEDULE_CLASS_INVENTORY
            SET wl_count = GREATEST(0, wl_count - 1)
            WHERE schedule_id = p_schedule_id AND class_id = p_class_id;

            UPDATE RESERVATION r
            JOIN BOOKING b ON r.pnr = b.pnr
            SET r.queue_position = CONCAT('WL/', CAST(SUBSTRING_INDEX(r.queue_position, '/', -1) AS UNSIGNED) - 1)
            WHERE r.schedule_id = p_schedule_id
              AND b.class_id = p_class_id
              AND r.status = 'WAITING_LIST'
              AND CAST(SUBSTRING_INDEX(COALESCE(r.queue_position, '0'), '/', -1) AS UNSIGNED) > v_wl_old_num;
        ELSE
            UPDATE SCHEDULE_CLASS_INVENTORY
            SET rac_count = GREATEST(0, rac_count - 1)
            WHERE schedule_id = p_schedule_id AND class_id = p_class_id;
        END IF;
    END IF;

END proc_label$$

-- -----------------------------------------------------------------------------
-- 2. sp_mark_passenger_noshow
-- Staff action to mark a passenger NO_SHOW, freeing their berth and calling
-- the single promotion procedure sp_promote_passenger (BR-ST4, BR-ST5).
-- Transaction managed via p_manage_tx.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_mark_passenger_noshow$$
CREATE PROCEDURE sp_mark_passenger_noshow(
    IN p_pnr VARCHAR(10),
    IN p_passenger_no INT,
    IN p_staff_id INT,
    IN p_manage_tx TINYINT(1),
    OUT p_out_status VARCHAR(20)
)
proc_label: BEGIN
    DECLARE v_sched_id INT;
    DECLARE v_cls_id INT;
    DECLARE v_st_id INT DEFAULT NULL;
    DECLARE v_res_status VARCHAR(20);
    DECLARE v_on_duty INT DEFAULT 0;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        IF p_manage_tx = 1 THEN
            ROLLBACK;
        END IF;
        SET p_out_status = 'FAILED';
    END;

    IF p_manage_tx = 1 THEN
        START TRANSACTION;
    END IF;

    SELECT b.schedule_id, b.class_id, r.seat_id, r.status
    INTO v_sched_id, v_cls_id, v_st_id, v_res_status
    FROM BOOKING b
    JOIN RESERVATION r ON b.pnr = r.pnr
    WHERE b.pnr = p_pnr AND r.passenger_no = p_passenger_no
    LIMIT 1;

    IF v_sched_id IS NULL THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_status = 'NOT_FOUND';
        LEAVE proc_label;
    END IF;

    -- Staff member must have a TRAIN_DUTY row in STAFF_ASSIGNMENT for that schedule (BR-ST2)
    SELECT COUNT(*) INTO v_on_duty
    FROM STAFF_ASSIGNMENT
    WHERE staff_id = p_staff_id
      AND schedule_id = v_sched_id
      AND duty_type = 'TRAIN_DUTY';

    IF v_on_duty = 0 THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_status = 'NOT_ON_DUTY';
        LEAVE proc_label;
    END IF;

    -- Only RESERVATION status CONFIRMED or RAC may become NO_SHOW (BR-ST4)
    IF v_res_status NOT IN ('CONFIRMED', 'RAC') THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_status = 'NOT_ELIGIBLE';
        LEAVE proc_label;
    END IF;

    -- Update reservation status to NO_SHOW and vacate physical seat
    UPDATE RESERVATION
    SET status = 'NO_SHOW',
        seat_id = NULL
    WHERE pnr = p_pnr AND passenger_no = p_passenger_no;

    -- Trigger promotion
    IF v_res_status = 'CONFIRMED' AND v_st_id IS NOT NULL THEN
        CALL sp_promote_passenger(v_sched_id, v_cls_id, v_st_id);
    ELSEIF v_res_status = 'RAC' THEN
        CALL sp_promote_passenger(v_sched_id, v_cls_id, NULL);
    END IF;

    IF p_manage_tx = 1 THEN
        COMMIT;
    END IF;

    SET p_out_status = 'NO_SHOW_MARKED';
END proc_label$$

-- -----------------------------------------------------------------------------
-- 2a. sp_verify_ticket
-- Inserts TICKET_VERIFICATION record with MAX+1 verify_id (BR-ST3).
-- Transaction managed via p_manage_tx.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_verify_ticket$$
CREATE PROCEDURE sp_verify_ticket(
    IN p_pnr VARCHAR(10),
    IN p_passenger_no INT,
    IN p_staff_id INT,
    IN p_id_checked TINYINT(1),
    IN p_concession_checked TINYINT(1),
    IN p_result VARCHAR(20),
    IN p_remarks VARCHAR(255),
    IN p_manage_tx TINYINT(1),
    OUT p_out_verify_id INT,
    OUT p_out_status VARCHAR(20)
)
proc_label: BEGIN
    DECLARE v_sched_id INT;
    DECLARE v_on_duty INT DEFAULT 0;
    DECLARE v_new_verify_id INT;
    DECLARE v_concession_match VARCHAR(20);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        IF p_manage_tx = 1 THEN
            ROLLBACK;
        END IF;
        SET p_out_verify_id = NULL;
        SET p_out_status = 'FAILED';
    END;

    IF p_manage_tx = 1 THEN
        START TRANSACTION;
    END IF;

    -- idChecked must be true
    IF p_id_checked != 1 THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_verify_id = NULL;
        SET p_out_status = 'VALIDATION_ERROR';
        LEAVE proc_label;
    END IF;

    IF p_result NOT IN ('VALID', 'INVALID', 'MISMATCH') THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_verify_id = NULL;
        SET p_out_status = 'VALIDATION_ERROR';
        LEAVE proc_label;
    END IF;

    -- Check reservation exists
    SELECT b.schedule_id INTO v_sched_id
    FROM BOOKING b
    JOIN RESERVATION r ON b.pnr = r.pnr
    WHERE b.pnr = p_pnr AND r.passenger_no = p_passenger_no
    LIMIT 1;

    IF v_sched_id IS NULL THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_verify_id = NULL;
        SET p_out_status = 'NOT_FOUND';
        LEAVE proc_label;
    END IF;

    -- Same on-duty check
    SELECT COUNT(*) INTO v_on_duty
    FROM STAFF_ASSIGNMENT
    WHERE staff_id = p_staff_id
      AND schedule_id = v_sched_id
      AND duty_type = 'TRAIN_DUTY';

    IF v_on_duty = 0 THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_verify_id = NULL;
        SET p_out_status = 'NOT_ON_DUTY';
        LEAVE proc_label;
    END IF;

    SET v_concession_match = IF(p_concession_checked = 1, p_result, 'NOT_APPLICABLE');

    -- verify_id is AUTO_INCREMENT: two staff verifying at once can never get the same id
    INSERT INTO TICKET_VERIFICATION (
        staff_id, pnr, passenger_no, id_proof_match, concession_match, result, remarks, verified_at
    ) VALUES (
        p_staff_id, p_pnr, p_passenger_no, p_result, v_concession_match, p_result, p_remarks, NOW()
    );
    SET v_new_verify_id = LAST_INSERT_ID();

    IF p_manage_tx = 1 THEN
        COMMIT;
    END IF;

    SET p_out_verify_id = v_new_verify_id;
    SET p_out_status = 'SUCCESS';
END proc_label$$

-- -----------------------------------------------------------------------------
-- 2b. sp_board_passenger
-- Marks a CONFIRMED or RAC passenger as BOARDED (BR-ST4, BR-T6).
-- Refuses with TDR_OPEN if delay TDR exists.
-- When an RAC passenger boards, updates inventory so compare_inventory stays at 0.
-- Transaction managed via p_manage_tx.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_board_passenger$$
CREATE PROCEDURE sp_board_passenger(
    IN p_pnr VARCHAR(10),
    IN p_passenger_no INT,
    IN p_staff_id INT,
    IN p_manage_tx TINYINT(1),
    OUT p_out_status VARCHAR(20)
)
proc_label: BEGIN
    DECLARE v_sched_id INT;
    DECLARE v_cls_id INT;
    DECLARE v_res_status VARCHAR(20);
    DECLARE v_on_duty INT DEFAULT 0;
    DECLARE v_tdr_count INT DEFAULT 0;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        IF p_manage_tx = 1 THEN
            ROLLBACK;
        END IF;
        SET p_out_status = 'FAILED';
    END;

    IF p_manage_tx = 1 THEN
        START TRANSACTION;
    END IF;

    SELECT b.schedule_id, b.class_id, r.status
    INTO v_sched_id, v_cls_id, v_res_status
    FROM BOOKING b
    JOIN RESERVATION r ON b.pnr = r.pnr
    WHERE b.pnr = p_pnr AND r.passenger_no = p_passenger_no
    LIMIT 1;

    IF v_sched_id IS NULL THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_status = 'NOT_FOUND';
        LEAVE proc_label;
    END IF;

    -- Check staff on duty
    SELECT COUNT(*) INTO v_on_duty
    FROM STAFF_ASSIGNMENT
    WHERE staff_id = p_staff_id
      AND schedule_id = v_sched_id
      AND duty_type = 'TRAIN_DUTY';

    IF v_on_duty = 0 THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_status = 'NOT_ON_DUTY';
        LEAVE proc_label;
    END IF;

    -- CONFIRMED or RAC only (BR-ST4)
    IF v_res_status NOT IN ('CONFIRMED', 'RAC') THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_status = 'NOT_ELIGIBLE';
        LEAVE proc_label;
    END IF;

    -- Refuse with status TDR_OPEN if passenger has a TRAIN_DELAYED_OVER_3_HOURS TDR_FILING
    -- in FILED, UNDER_REVIEW or APPROVED (treat TDR passenger_no NULL as the whole PNR) (BR-T6)
    SELECT COUNT(*) INTO v_tdr_count
    FROM TDR_FILING
    WHERE pnr = p_pnr
      AND (passenger_no IS NULL OR passenger_no = p_passenger_no)
      AND reason = 'TRAIN_DELAYED_OVER_3_HOURS'
      AND status IN ('FILED', 'UNDER_REVIEW', 'APPROVED');

    IF v_tdr_count > 0 THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_status = 'TDR_OPEN';
        LEAVE proc_label;
    END IF;

    -- Update reservation status to BOARDED
    UPDATE RESERVATION
    SET status = 'BOARDED'
    WHERE pnr = p_pnr AND passenger_no = p_passenger_no;

    -- If passenger was RAC, update inventory to keep compare_inventory audit at 0
    IF v_res_status = 'RAC' THEN
        UPDATE SCHEDULE_CLASS_INVENTORY
        SET available_seats = GREATEST(0, available_seats - 1),
            rac_count = GREATEST(0, rac_count - 1)
        WHERE schedule_id = v_sched_id AND class_id = v_cls_id;
    END IF;

    IF p_manage_tx = 1 THEN
        COMMIT;
    END IF;

    SET p_out_status = 'BOARDED';
END proc_label$$

-- -----------------------------------------------------------------------------
-- 3. sp_create_booking
-- Complete booking transaction with:
--   - Chart-time check (CHART_PREPARED)
--   - Monthly ticket limit check (MONTHLY_LIMIT_EXCEEDED)
--   - Adult passenger check (NO_ADULT_PASSENGER)
--   - Quota fallback handling with user consent (BR-Q13)
--   - Berth preference condition check (BERTH_PREFERENCE_NOT_MET) with SAVEPOINT
--   - RAC and Waiting List allocation (WAITING_LIST_FULL)
--   - Transaction safety: p_manage_tx = 1 manages its own transaction; p_manage_tx = 0
--     participates safely in caller's transaction without stray COMMIT/ROLLBACK.
--   - Exact error codes per BR-B5
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_create_booking$$
CREATE PROCEDURE sp_create_booking(
    IN p_user_id INT,
    IN p_schedule_id INT,
    IN p_class_id INT,
    IN p_from_stop_id INT,
    IN p_to_stop_id INT,
    IN p_quota VARCHAR(20),
    IN p_fallback_consent TINYINT(1),
    IN p_berth_condition TINYINT(1),
    IN p_hold_for_payment TINYINT(1),
    IN p_passengers JSON,
    IN p_channel VARCHAR(10),
    IN p_staff_id INT,
    IN p_manage_tx TINYINT(1),
    OUT p_out_pnr VARCHAR(10),
    OUT p_out_status VARCHAR(20),
    OUT p_out_total_fare DECIMAL(10,2),
    OUT p_out_error_code VARCHAR(32)
)
proc_label: BEGIN
    DECLARE v_chart_prep DATETIME DEFAULT NULL;
    DECLARE v_journey_date DATE;
    DECLARE v_dep_time TIME;
    DECLARE v_train_id INT;
    DECLARE v_pass_count INT DEFAULT 0;
    DECLARE v_adult_count INT DEFAULT 0;
    DECLARE v_idx INT DEFAULT 0;
    DECLARE v_can_book TINYINT(1) DEFAULT 1;
    DECLARE v_active_quota VARCHAR(20);
    DECLARE v_requested_quota VARCHAR(20);
    DECLARE v_avail_seats INT DEFAULT 0;
    DECLARE v_rac_cap INT DEFAULT 0;
    DECLARE v_rac_cnt INT DEFAULT 0;
    DECLARE v_wl_cap INT DEFAULT 0;
    DECLARE v_wl_cnt INT DEFAULT 0;
    DECLARE v_new_pnr VARCHAR(10);
    DECLARE v_total_booking_fare DECIMAL(10,2) DEFAULT 0.00;
    DECLARE v_overall_status VARCHAR(20) DEFAULT 'CONFIRMED';
    DECLARE v_distance INT DEFAULT 0;
    DECLARE v_has_berths TINYINT(1) DEFAULT 1;
    DECLARE v_tot_class_seats INT DEFAULT 0;
    DECLARE v_quota_cap INT DEFAULT 0;
    DECLARE v_quota_booked INT DEFAULT 0;
    DECLARE v_quota_free INT DEFAULT 0;
    DECLARE v_tatkal_cap INT DEFAULT 0;
    DECLARE v_ladies_cap INT DEFAULT 0;
    DECLARE v_divyaang_cap INT DEFAULT 0;
    DECLARE v_senior_cap INT DEFAULT 0;
    DECLARE v_sched_status VARCHAR(20) DEFAULT NULL;
    DECLARE v_as_of DATETIME;
    DECLARE v_from_train INT DEFAULT NULL;
    DECLARE v_to_train INT DEFAULT NULL;
    DECLARE v_from_seq INT DEFAULT NULL;
    DECLARE v_to_seq INT DEFAULT NULL;
    DECLARE v_from_dep TIME DEFAULT NULL;
    DECLARE v_from_off INT DEFAULT 0;
    DECLARE v_boarding_dep DATETIME;
    DECLARE v_window_days INT DEFAULT 7;
    DECLARE v_e_age INT;
    DECLARE v_e_gender VARCHAR(10);
    DECLARE v_e_conc VARCHAR(20);
    DECLARE v_e_ptype VARCHAR(32);
    DECLARE v_e_pref VARCHAR(64);
    DECLARE v_pnr_dup TINYINT DEFAULT 1;
    DECLARE v_pnr_tries INT DEFAULT 0;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        IF p_manage_tx = 1 THEN
            ROLLBACK;
        END IF;
        SET p_out_error_code = 'TRANSACTION_FAILED';
        SET p_out_pnr = NULL;
        SET p_out_status = 'FAILED';
    END;

    IF p_manage_tx = 1 THEN
        START TRANSACTION;
    END IF;

    SET p_out_error_code = NULL;
    SET v_pass_count = JSON_LENGTH(p_passengers);

    IF v_pass_count IS NULL OR v_pass_count < 1 THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_error_code = 'SEAT_NOT_AVAILABLE';
        LEAVE proc_label;
    END IF;

    -- 1. Check at least one adult (age >= 18) (BR-Q15, BR-B3)
    SET v_idx = 0;
    WHILE v_idx < v_pass_count DO
        IF JSON_EXTRACT(p_passengers, CONCAT('$[', v_idx, '].age')) >= 18 THEN
            SET v_adult_count = v_adult_count + 1;
        END IF;
        SET v_idx = v_idx + 1;
    END WHILE;

    IF v_adult_count = 0 THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_error_code = 'NO_ADULT_PASSENGER';
        LEAVE proc_label;
    END IF;

    -- 2. Lock schedule and check Chart Prepared / Lockout (BR-B12a)
    SELECT ts.chart_prepared_at, ts.journey_date, ts.departure_time, ts.train_id, ts.status
    INTO v_chart_prep, v_journey_date, v_dep_time, v_train_id, v_sched_status
    FROM TRAIN_SCHEDULE ts
    WHERE ts.schedule_id = p_schedule_id
    FOR UPDATE;

    IF v_chart_prep IS NOT NULL THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_error_code = 'CHART_PREPARED';
        LEAVE proc_label;
    END IF;

    -- 2a. The run itself must be running (BR-B5 TRAIN_NOT_RUNNING; a CANCELLED run takes no bookings)
    IF v_sched_status = 'CANCELLED' THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_error_code = 'TRAIN_NOT_RUNNING';
        LEAVE proc_label;
    END IF;

    -- 2b. From and to stops must both belong to this train, and the from stop must come first
    SELECT train_id, stop_sequence, departure_time, day_offset
    INTO v_from_train, v_from_seq, v_from_dep, v_from_off
    FROM ROUTE_STOP WHERE stop_id = p_from_stop_id;

    SELECT train_id, stop_sequence
    INTO v_to_train, v_to_seq
    FROM ROUTE_STOP WHERE stop_id = p_to_stop_id;

    IF v_from_train IS NULL OR v_to_train IS NULL
       OR v_from_train <> v_train_id OR v_to_train <> v_train_id
       OR v_from_seq >= v_to_seq THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_error_code = 'INVALID_STOPS';
        LEAVE proc_label;
    END IF;

    -- 2c. The train must not have left the boarding station yet (scheduled departure, India time).
    --     "Now" is COALESCE(@as_of_time, NOW()) so the date-pinned tests keep working.
    SET v_as_of = COALESCE(@as_of_time, NOW());
    SET v_boarding_dep = TIMESTAMP(v_journey_date, v_from_dep) + INTERVAL v_from_off DAY;
    IF v_boarding_dep <= v_as_of THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_error_code = 'JOURNEY_PAST';
        LEAVE proc_label;
    END IF;

    -- 2d. Booking window (BR-B1): the boarding date may be at most BOOKING_WINDOW_DAYS days ahead
    SELECT CAST(setting_value AS SIGNED) INTO v_window_days
    FROM SETTING WHERE setting_key = 'BOOKING_WINDOW_DAYS';
    IF v_window_days IS NULL THEN SET v_window_days = 7; END IF;
    IF DATEDIFF(DATE(v_boarding_dep), DATE(v_as_of)) > v_window_days THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_error_code = 'OUTSIDE_BOOKING_WINDOW';
        LEAVE proc_label;
    END IF;

    -- 2e. Concession proof (BR-C6) and quota eligibility (BR-Q2, BR-Q4, BR-Q5, BR-Q9, BR-Q14), per passenger.
    --     Done before any seat is reserved, so a refusal leaves nothing to undo.
    SET v_idx = 0;
    WHILE v_idx < v_pass_count DO
        SET v_e_age = COALESCE(JSON_EXTRACT(p_passengers, CONCAT('$[', v_idx, '].age')), 0);
        SET v_e_gender = JSON_UNQUOTE(JSON_EXTRACT(p_passengers, CONCAT('$[', v_idx, '].gender')));
        SET v_e_conc = JSON_UNQUOTE(JSON_EXTRACT(p_passengers, CONCAT('$[', v_idx, '].concession_type')));
        IF v_e_conc IS NULL OR v_e_conc = 'null' OR v_e_conc = '' THEN SET v_e_conc = 'NONE'; END IF;
        SET v_e_ptype = JSON_UNQUOTE(JSON_EXTRACT(p_passengers, CONCAT('$[', v_idx, '].concession_proof_type')));
        IF v_e_ptype = 'null' OR TRIM(v_e_ptype) = '' THEN SET v_e_ptype = NULL; END IF;
        SET v_e_pref = JSON_UNQUOTE(JSON_EXTRACT(p_passengers, CONCAT('$[', v_idx, '].concession_proof_ref')));
        IF v_e_pref = 'null' OR TRIM(v_e_pref) = '' THEN SET v_e_pref = NULL; END IF;

        -- Any concession other than NONE needs a proof type and a proof reference
        IF v_e_conc <> 'NONE' AND (v_e_ptype IS NULL OR v_e_pref IS NULL) THEN
            IF p_manage_tx = 1 THEN ROLLBACK; END IF;
            SET p_out_error_code = 'CONCESSION_PROOF_REQUIRED';
            LEAVE proc_label;
        END IF;

        -- LADIES: every passenger aged 12 or more must be FEMALE (OTHER is not eligible)
        IF p_quota = 'LADIES' AND v_e_age >= 12 AND COALESCE(v_e_gender, '') <> 'FEMALE' THEN
            IF p_manage_tx = 1 THEN ROLLBACK; END IF;
            SET p_out_error_code = 'QUOTA_NOT_ELIGIBLE';
            LEAVE proc_label;
        END IF;

        -- SENIOR_CITIZEN: women from SENIOR_AGE_FEMALE (default 45), men and OTHER from SENIOR_AGE_MALE (default 60)
        IF p_quota = 'SENIOR_CITIZEN' AND NOT (
               (v_e_gender = 'FEMALE' AND v_e_age >= CAST(fn_get_setting('SENIOR_AGE_FEMALE', '45') AS SIGNED))
            OR (COALESCE(v_e_gender, '') <> 'FEMALE' AND v_e_age >= CAST(fn_get_setting('SENIOR_AGE_MALE', '60') AS SIGNED))
        ) THEN
            IF p_manage_tx = 1 THEN ROLLBACK; END IF;
            SET p_out_error_code = 'QUOTA_NOT_ELIGIBLE';
            LEAVE proc_label;
        END IF;

        -- DIVYAANG: every passenger needs disability proof (type and reference)
        IF p_quota = 'DIVYAANG' AND (v_e_ptype IS NULL OR v_e_pref IS NULL) THEN
            IF p_manage_tx = 1 THEN ROLLBACK; END IF;
            SET p_out_error_code = 'QUOTA_NOT_ELIGIBLE';
            LEAVE proc_label;
        END IF;

        SET v_idx = v_idx + 1;
    END WHILE;

    -- 2f. Tatkal needs an Aadhaar-verified account (BR-Q3, BR-Q6). At the counter (BR-CB5) the staff member enters an
    --     Aadhaar ID proof for at least one passenger instead (the OTP step is simulated). Error code: AADHAAR_REQUIRED.
    IF p_quota = 'TATKAL' THEN
        IF p_channel = 'COUNTER' THEN
            IF JSON_SEARCH(p_passengers, 'one', 'AADHAAR', NULL, '$[*].concession_proof_type') IS NULL THEN
                IF p_manage_tx = 1 THEN ROLLBACK; END IF;
                SET p_out_error_code = 'AADHAAR_REQUIRED';
                LEAVE proc_label;
            END IF;
        ELSEIF COALESCE((SELECT aadhaar_verified FROM USER_ACCOUNT WHERE user_id = p_user_id), 0) = 0 THEN
            IF p_manage_tx = 1 THEN ROLLBACK; END IF;
            SET p_out_error_code = 'AADHAAR_REQUIRED';
            LEAVE proc_label;
        END IF;
    END IF;

    -- 3. Check Monthly ticket limit (BR-B15). "Now" is the project test clock COALESCE(@as_of_time, NOW()) (v_as_of).
    SET v_can_book = fn_check_monthly_ticket_limit(p_user_id, v_as_of);
    IF v_can_book = 0 THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_error_code = 'MONTHLY_LIMIT_EXCEEDED';
        LEAVE proc_label;
    END IF;

    -- 4. Check Inventory and Quota Free Seats for run & class
    SELECT total_seats, available_seats, rac_capacity, rac_count, wl_capacity, wl_count
    INTO v_tot_class_seats, v_avail_seats, v_rac_cap, v_rac_cnt, v_wl_cap, v_wl_cnt
    FROM SCHEDULE_CLASS_INVENTORY
    WHERE schedule_id = p_schedule_id AND class_id = p_class_id
    FOR UPDATE;

    SELECT has_berths INTO v_has_berths FROM SEAT_CLASS WHERE class_id = p_class_id;

    SET v_requested_quota = p_quota;
    SET v_active_quota = p_quota;

    -- Compute quota capacities per BR-Q10
    SET v_tatkal_cap = ROUND(v_tot_class_seats * 0.10);
    SET v_ladies_cap = ROUND(v_tot_class_seats * 0.10);
    IF p_class_id IN (3, 4, 5, 7) THEN SET v_divyaang_cap = 4; ELSE SET v_divyaang_cap = 0; END IF;
    IF p_class_id = 4 THEN SET v_senior_cap = 6 * (SELECT COUNT(*) FROM COACH WHERE train_id = v_train_id AND class_id = 4);
    ELSEIF p_class_id = 3 THEN SET v_senior_cap = 4 * (SELECT COUNT(*) FROM COACH WHERE train_id = v_train_id AND class_id = 3);
    ELSEIF p_class_id = 2 THEN SET v_senior_cap = 3 * (SELECT COUNT(*) FROM COACH WHERE train_id = v_train_id AND class_id = 2);
    ELSE SET v_senior_cap = 0; END IF;

    IF v_requested_quota = 'LADIES' THEN
        SET v_quota_cap = v_ladies_cap;
    ELSEIF v_requested_quota = 'TATKAL' THEN
        SET v_quota_cap = v_tatkal_cap;
    ELSEIF v_requested_quota = 'DIVYAANG' THEN
        SET v_quota_cap = v_divyaang_cap;
    ELSEIF v_requested_quota = 'SENIOR_CITIZEN' THEN
        SET v_quota_cap = v_senior_cap;
    ELSE
        -- GENERAL quota gets the remainder per BR-Q10
        SET v_quota_cap = GREATEST(0, v_tot_class_seats - (v_tatkal_cap + v_ladies_cap + v_divyaang_cap + v_senior_cap));
    END IF;

    SELECT COUNT(r.res_id) INTO v_quota_booked
    FROM BOOKING b
    JOIN RESERVATION r ON b.pnr = r.pnr
    WHERE b.schedule_id = p_schedule_id AND b.class_id = p_class_id AND b.quota = v_requested_quota AND r.status IN ('CONFIRMED', 'BOARDED');

    IF v_quota_cap >= v_quota_booked THEN
        SET v_quota_free = v_quota_cap - v_quota_booked;
    ELSE
        SET v_quota_free = 0;
    END IF;

    -- If overall available seats in inventory are less than quota free seats, physical availability is the ceiling
    IF v_avail_seats < v_quota_free THEN
        SET v_quota_free = v_avail_seats;
    END IF;

    IF v_requested_quota IN ('LADIES', 'SENIOR_CITIZEN', 'DIVYAANG') THEN
        IF v_quota_free < v_pass_count THEN
            IF p_fallback_consent = 1 THEN
                SET v_active_quota = 'GENERAL';
                -- Recompute for GENERAL quota
                SET v_quota_cap = GREATEST(0, v_tot_class_seats - (v_tatkal_cap + v_ladies_cap + v_divyaang_cap + v_senior_cap));
                SELECT COUNT(r.res_id) INTO v_quota_booked
                FROM BOOKING b
                JOIN RESERVATION r ON b.pnr = r.pnr
                WHERE b.schedule_id = p_schedule_id AND b.class_id = p_class_id AND b.quota = 'GENERAL' AND r.status IN ('CONFIRMED', 'BOARDED');
                SET v_quota_free = GREATEST(0, v_quota_cap - v_quota_booked);
                IF v_avail_seats < v_quota_free THEN
                    SET v_quota_free = v_avail_seats;
                END IF;
            ELSE
                IF p_manage_tx = 1 THEN ROLLBACK; END IF;
                SET p_out_error_code = 'SEAT_NOT_AVAILABLE';
                LEAVE proc_label;
            END IF;
        END IF;
    END IF;

    IF v_quota_free < v_pass_count THEN
        IF v_active_quota IN ('GENERAL', 'TATKAL') AND v_has_berths = 1 THEN
            IF (v_quota_free + (v_rac_cap - v_rac_cnt) + (v_wl_cap - v_wl_cnt)) < v_pass_count THEN
                IF p_manage_tx = 1 THEN ROLLBACK; END IF;
                SET p_out_error_code = 'WAITING_LIST_FULL';
                LEAVE proc_label;
            END IF;
        ELSEIF v_active_quota IN ('GENERAL', 'TATKAL') AND v_has_berths = 0 THEN
            IF (v_quota_free + (v_wl_cap - v_wl_cnt)) < v_pass_count THEN
                IF p_manage_tx = 1 THEN ROLLBACK; END IF;
                SET p_out_error_code = 'WAITING_LIST_FULL';
                LEAVE proc_label;
            END IF;
        ELSE
            IF p_manage_tx = 1 THEN ROLLBACK; END IF;
            SET p_out_error_code = 'SEAT_NOT_AVAILABLE';
            LEAVE proc_label;
        END IF;
    END IF;

    SAVEPOINT sp_berth_check;

    SET v_distance = fn_calculate_distance(p_from_stop_id, p_to_stop_id);

    -- PNR: a random 10-digit number. We do NOT look it up first (a "does it exist?" read takes a gap lock
    -- and two bookings at the same time then block each other's insert). We insert, and if the PNR is
    -- already taken (duplicate key) we draw a new one and try again.
    SET v_pnr_dup = 1;
    SET v_pnr_tries = 0;
    WHILE v_pnr_dup = 1 AND v_pnr_tries < 20 DO
        SET v_pnr_dup = 0;
        SET v_pnr_tries = v_pnr_tries + 1;
        SET v_new_pnr = LPAD(FLOOR(RAND() * 8999999999 + 1000000000), 10, '0');
        pnr_insert: BEGIN
            DECLARE CONTINUE HANDLER FOR 1062 SET v_pnr_dup = 1;
            INSERT INTO BOOKING (
                pnr, user_id, schedule_id, class_id, from_stop_id, to_stop_id,
                channel, booked_by_staff_id, quota, requested_quota,
                berth_condition, total_fare, status, created_at
            ) VALUES (
                v_new_pnr, p_user_id, p_schedule_id, p_class_id, p_from_stop_id, p_to_stop_id,
                p_channel, p_staff_id, v_active_quota, v_requested_quota,
                p_berth_condition, 0.00, 'PAYMENT_PENDING', COALESCE(@as_of_time, NOW())
            );
        END pnr_insert;
    END WHILE;
    IF v_pnr_dup = 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Could not allocate a free PNR';
    END IF;

    SET v_idx = 0;
    WHILE v_idx < v_pass_count DO
        passenger_block: BEGIN
            DECLARE v_p_saved_id INT;
            DECLARE v_p_saved_raw VARCHAR(64);
            DECLARE v_p_name VARCHAR(128);
            DECLARE v_p_age INT;
            DECLARE v_p_gender VARCHAR(10);
            DECLARE v_p_conc_type VARCHAR(20);
            DECLARE v_p_proof_type VARCHAR(32);
            DECLARE v_p_proof_ref VARCHAR(64);
            DECLARE v_p_berth_pref VARCHAR(20);
            DECLARE v_fare_json JSON;
            DECLARE v_assigned_seat_id INT DEFAULT NULL;
            DECLARE v_seat_berth VARCHAR(20) DEFAULT NULL;
            DECLARE v_pass_status VARCHAR(20) DEFAULT 'CONFIRMED';
            DECLARE v_queue_pos VARCHAR(16) DEFAULT NULL;

            SET v_p_saved_raw = JSON_UNQUOTE(JSON_EXTRACT(p_passengers, CONCAT('$[', v_idx, '].saved_passenger_id')));
            IF v_p_saved_raw IS NULL OR v_p_saved_raw = 'null' OR v_p_saved_raw = '' THEN
                SET v_p_saved_id = NULL;
            ELSE
                SET v_p_saved_id = CAST(v_p_saved_raw AS UNSIGNED);
            END IF;
            SET v_p_name = JSON_UNQUOTE(JSON_EXTRACT(p_passengers, CONCAT('$[', v_idx, '].name')));
            SET v_p_age = JSON_EXTRACT(p_passengers, CONCAT('$[', v_idx, '].age'));
            SET v_p_gender = JSON_UNQUOTE(JSON_EXTRACT(p_passengers, CONCAT('$[', v_idx, '].gender')));
            SET v_p_conc_type = JSON_UNQUOTE(JSON_EXTRACT(p_passengers, CONCAT('$[', v_idx, '].concession_type')));
            IF v_p_conc_type IS NULL OR v_p_conc_type = 'null' THEN SET v_p_conc_type = 'NONE'; END IF;
            SET v_p_proof_type = JSON_UNQUOTE(JSON_EXTRACT(p_passengers, CONCAT('$[', v_idx, '].concession_proof_type')));
            IF v_p_proof_type = 'null' THEN SET v_p_proof_type = NULL; END IF;
            SET v_p_proof_ref = JSON_UNQUOTE(JSON_EXTRACT(p_passengers, CONCAT('$[', v_idx, '].concession_proof_ref')));
            IF v_p_proof_ref = 'null' THEN SET v_p_proof_ref = NULL; END IF;
            SET v_p_berth_pref = JSON_UNQUOTE(JSON_EXTRACT(p_passengers, CONCAT('$[', v_idx, '].berth_preference')));
            IF v_p_berth_pref IS NULL OR v_p_berth_pref = 'null' THEN SET v_p_berth_pref = 'NO_BERTH'; END IF;

            SET v_fare_json = fn_calculate_fare(p_class_id, v_train_id, v_distance, v_active_quota, v_p_conc_type, 1, p_schedule_id);

            IF v_quota_free > 0 AND v_avail_seats > 0 THEN
                SELECT s.seat_id, s.berth_type
                INTO v_assigned_seat_id, v_seat_berth
                FROM SEAT s
                JOIN COACH c ON s.coach_id = c.coach_id
                WHERE c.train_id = v_train_id
                  AND c.class_id = p_class_id
                  AND s.seat_id NOT IN (
                      SELECT r.seat_id FROM RESERVATION r
                      WHERE r.schedule_id = p_schedule_id
                        AND r.seat_id IS NOT NULL
                        AND r.status IN ('CONFIRMED', 'BOARDED')
                  )
                ORDER BY
                    CASE WHEN (v_p_age >= CAST(fn_get_setting('SENIOR_AGE_MALE', '60') AS SIGNED) AND s.berth_type = 'LOWER') THEN 1
                         WHEN (v_p_berth_pref = s.berth_type) THEN 2
                         ELSE 3 END,
                    s.seat_id ASC
                LIMIT 1;

                IF v_assigned_seat_id IS NOT NULL THEN
                    SET v_pass_status = 'CONFIRMED';
                    SET v_avail_seats = v_avail_seats - 1;
                    SET v_quota_free = v_quota_free - 1;

                    IF p_berth_condition = 1 AND v_has_berths = 1 THEN
                        IF v_p_berth_pref != 'NO_BERTH' AND v_seat_berth != v_p_berth_pref THEN
                            ROLLBACK TO SAVEPOINT sp_berth_check;
                            IF p_manage_tx = 1 THEN ROLLBACK; END IF;
                            SET p_out_error_code = 'BERTH_PREFERENCE_NOT_MET';
                            LEAVE proc_label;
                        END IF;
                    END IF;
                ELSE
                    SET v_avail_seats = 0;
                    SET v_quota_free = 0;
                END IF;
            END IF;

            IF v_assigned_seat_id IS NULL THEN
                IF p_berth_condition = 1 THEN
                    ROLLBACK TO SAVEPOINT sp_berth_check;
                    IF p_manage_tx = 1 THEN ROLLBACK; END IF;
                    SET p_out_error_code = 'BERTH_PREFERENCE_NOT_MET';
                    LEAVE proc_label;
                END IF;

                IF v_has_berths = 1 AND v_rac_cnt < v_rac_cap AND v_active_quota IN ('GENERAL', 'TATKAL') THEN
                    SET v_pass_status = 'RAC';
                    SET v_rac_cnt = v_rac_cnt + 1;
                    SET v_queue_pos = CONCAT('RAC/', v_rac_cnt);
                    IF v_overall_status != 'WAITING_LIST' THEN SET v_overall_status = 'RAC'; END IF;
                ELSEIF v_wl_cnt < v_wl_cap THEN
                    SET v_pass_status = 'WAITING_LIST';
                    SET v_wl_cnt = v_wl_cnt + 1;
                    SET v_queue_pos = CONCAT('WL/', v_wl_cnt);
                    SET v_overall_status = 'WAITING_LIST';
                ELSE
                    ROLLBACK TO SAVEPOINT sp_berth_check;
                    IF p_manage_tx = 1 THEN ROLLBACK; END IF;
                    SET p_out_error_code = 'WAITING_LIST_FULL';
                    LEAVE proc_label;
                END IF;
            END IF;

            INSERT INTO PASSENGER_BOOKING (
                pnr, passenger_no, saved_passenger_id, name, age, gender,
                concession_type, concession_proof_type, concession_proof_ref,
                base_fare, concession_discount, reservation_charge, superfast_charge,
                tatkal_charge, dynamic_surcharge, gst, insurance, total_fare
            ) VALUES (
                v_new_pnr, v_idx + 1, v_p_saved_id, v_p_name, v_p_age, v_p_gender,
                v_p_conc_type, v_p_proof_type, v_p_proof_ref,
                JSON_EXTRACT(v_fare_json, '$.base_fare'),
                JSON_EXTRACT(v_fare_json, '$.concession_discount'),
                JSON_EXTRACT(v_fare_json, '$.reservation_charge'),
                JSON_EXTRACT(v_fare_json, '$.superfast_charge'),
                JSON_EXTRACT(v_fare_json, '$.tatkal_charge'),
                JSON_EXTRACT(v_fare_json, '$.dynamic_surcharge'),
                JSON_EXTRACT(v_fare_json, '$.gst'),
                JSON_EXTRACT(v_fare_json, '$.insurance'),
                JSON_EXTRACT(v_fare_json, '$.total_fare')
            );

            SET v_total_booking_fare = v_total_booking_fare + JSON_EXTRACT(v_fare_json, '$.total_fare');

            -- res_id is AUTO_INCREMENT: bookings on different runs at the same time never clash
            INSERT INTO RESERVATION (
                pnr, passenger_no, schedule_id, seat_id, status, queue_position
            ) VALUES (
                v_new_pnr, v_idx + 1, p_schedule_id, v_assigned_seat_id, v_pass_status, v_queue_pos
            );

        END passenger_block;
        SET v_idx = v_idx + 1;
    END WHILE;

    UPDATE SCHEDULE_CLASS_INVENTORY
    SET available_seats = v_avail_seats,
        rac_count = v_rac_cnt,
        wl_count = v_wl_cnt
    WHERE schedule_id = p_schedule_id AND class_id = p_class_id;

    UPDATE BOOKING
    SET total_fare = v_total_booking_fare,
        status = IF(p_hold_for_payment = 1, 'PAYMENT_PENDING', v_overall_status)
    WHERE pnr = v_new_pnr;

    IF p_manage_tx = 1 THEN
        COMMIT;
    END IF;

    SET p_out_pnr = v_new_pnr;
    SET p_out_status = v_overall_status;
    SET p_out_total_fare = v_total_booking_fare;
    SET p_out_error_code = NULL;

END proc_label$$

-- -----------------------------------------------------------------------------
-- 4. sp_cancel_passenger_ticket
-- Cancels a single passenger or full PNR, works out deduction charge via
-- fn_calculate_cancellation_refund, records CANCELLATION and REFUND.
-- Note: When cancelling a whole PNR (p_passenger_no IS NULL), creates one CANCELLATION
-- row per passenger, each with its own refund line (BR-R3, BR-R4).
-- The promotion is automatically triggered by trg_after_cancellation_promote!
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_cancel_passenger_ticket$$
CREATE PROCEDURE sp_cancel_passenger_ticket(
    IN p_pnr VARCHAR(10),
    IN p_passenger_no INT,
    IN p_reason VARCHAR(128),
    IN p_manage_tx TINYINT(1),
    OUT p_out_charge DECIMAL(10,2),
    OUT p_out_refund_amount DECIMAL(10,2),
    OUT p_out_status VARCHAR(32)
)
proc_label: BEGIN
    DECLARE v_active_count INT DEFAULT 0;
    DECLARE v_total_charge DECIMAL(10,2) DEFAULT 0.00;
    DECLARE v_total_refund DECIMAL(10,2) DEFAULT 0.00;
    DECLARE v_new_cancel_id INT;
    DECLARE v_new_refund_id INT;
    DECLARE v_payment_id INT;
    DECLARE v_sched_id INT;
    DECLARE v_dep_date DATE;
    DECLARE v_dep_time TIME;
    DECLARE v_origin_departure DATETIME;
    DECLARE v_as_of DATETIME;
    DECLARE v_hours_left DECIMAL(10,2);
    DECLARE v_planned_refund DECIMAL(10,2) DEFAULT 0.00;
    DECLARE done INT DEFAULT 0;

    DECLARE cur_pass_no INT;
    DECLARE cur_pass CURSOR FOR
        SELECT pb.passenger_no
        FROM PASSENGER_BOOKING pb
        JOIN RESERVATION r ON pb.pnr = r.pnr AND pb.passenger_no = r.passenger_no
        WHERE pb.pnr = p_pnr
          AND (p_passenger_no IS NULL OR pb.passenger_no = p_passenger_no)
          AND r.status != 'CANCELLED';
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        IF p_manage_tx = 1 THEN
            ROLLBACK;
        END IF;
        SET p_out_status = 'FAILED';
    END;

    IF p_manage_tx = 1 THEN
        START TRANSACTION;
    END IF;

    SET v_as_of = COALESCE(@as_of_time, NOW());

    -- Verify active reservations exist to cancel
    SELECT COUNT(*) INTO v_active_count
    FROM RESERVATION
    WHERE pnr = p_pnr
      AND (p_passenger_no IS NULL OR passenger_no = p_passenger_no)
      AND status != 'CANCELLED';

    IF v_active_count = 0 THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_charge = 0.00;
        SET p_out_refund_amount = 0.00;
        SET p_out_status = 'ALREADY_CANCELLED';
        LEAVE proc_label;
    END IF;

    -- BR-B12, BR-R7, API_CONTRACT: Online cancellation closes at chart time (8 hrs before origin departure)
    SELECT schedule_id INTO v_sched_id FROM BOOKING WHERE pnr = p_pnr;
    SELECT journey_date, departure_time INTO v_dep_date, v_dep_time FROM TRAIN_SCHEDULE WHERE schedule_id = v_sched_id;
    SET v_origin_departure = TIMESTAMP(v_dep_date, v_dep_time);
    SET v_hours_left = TIMESTAMPDIFF(MINUTE, v_as_of, v_origin_departure) / 60.0;

    IF v_hours_left <= 8.0 THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_charge = 0.00;
        SET p_out_refund_amount = 0.00;
        SET p_out_status = 'CHART_PREPARED';
        LEAVE proc_label;
    END IF;

    -- Refunds go back to the original payment (never a late payment that was already refunded)
    SET v_payment_id = fn_pick_refund_payment(p_pnr);

    -- Refund cap (a): a seat whose TDR was approved or refunded cannot also be cancelled the normal way,
    -- or it would be refunded twice.
    IF EXISTS (
        SELECT 1 FROM TDR_FILING t
        WHERE t.pnr = p_pnr
          AND t.status IN ('APPROVED', 'REFUND_PROCESSED')
          AND (t.passenger_no IS NULL OR EXISTS (
                SELECT 1 FROM RESERVATION r2
                WHERE r2.pnr = p_pnr AND r2.passenger_no = t.passenger_no
                  AND r2.status <> 'CANCELLED'
                  AND (p_passenger_no IS NULL OR r2.passenger_no = p_passenger_no)))
    ) THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_charge = 0.00;
        SET p_out_refund_amount = 0.00;
        SET p_out_status = 'REFUND_EXCEEDS_PAYMENT';
        LEAVE proc_label;
    END IF;

    -- Refund cap (b): the refunds this cancel would write must fit in what is left of the payment.
    -- Choice here: refuse the whole cancel (nothing is changed) rather than shrink a passenger's refund.
    IF v_payment_id IS NOT NULL THEN
        SELECT COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(
                   fn_calculate_cancellation_refund(r.pnr, r.passenger_no, v_as_of), '$.refund_amount')) AS DECIMAL(10,2))), 0.00)
        INTO v_planned_refund
        FROM RESERVATION r
        WHERE r.pnr = p_pnr
          AND (p_passenger_no IS NULL OR r.passenger_no = p_passenger_no)
          AND r.status <> 'CANCELLED';

        IF v_planned_refund > fn_refund_room(v_payment_id) THEN
            IF p_manage_tx = 1 THEN ROLLBACK; END IF;
            SET p_out_charge = 0.00;
            SET p_out_refund_amount = 0.00;
            SET p_out_status = 'REFUND_EXCEEDS_PAYMENT';
            LEAVE proc_label;
        END IF;
    END IF;

    OPEN cur_pass;
    pass_loop: LOOP
        FETCH cur_pass INTO cur_pass_no;
        IF done = 1 THEN LEAVE pass_loop; END IF;

        cancel_single: BEGIN
            DECLARE v_p_refund_json JSON;
            DECLARE v_p_charge DECIMAL(10,2);
            DECLARE v_p_refund DECIMAL(10,2);

            SET v_p_refund_json = fn_calculate_cancellation_refund(p_pnr, cur_pass_no, v_as_of);
            SET v_p_charge = JSON_EXTRACT(v_p_refund_json, '$.charge');
            SET v_p_refund = JSON_EXTRACT(v_p_refund_json, '$.refund_amount');

            SET v_total_charge = v_total_charge + v_p_charge;
            SET v_total_refund = v_total_refund + v_p_refund;

            -- cancel_id and refund_id are AUTO_INCREMENT (read back with LAST_INSERT_ID)
            INSERT INTO CANCELLATION (pnr, passenger_no, reason, charge, cancelled_at)
            VALUES (p_pnr, cur_pass_no, p_reason, v_p_charge, v_as_of);
            SET v_new_cancel_id = LAST_INSERT_ID();

            UPDATE RESERVATION
            SET status = 'CANCELLED',
                seat_id = NULL,
                queue_position = NULL
            WHERE pnr = p_pnr AND passenger_no = cur_pass_no;

            IF v_payment_id IS NOT NULL AND v_p_refund > 0 THEN
                INSERT INTO REFUND (cancel_id, tdr_ref_no, payment_id, amount, reason, status)
                VALUES (v_new_cancel_id, NULL, v_payment_id, v_p_refund, 'CANCELLATION', 'PENDING');
            END IF;
        END cancel_single;
    END LOOP;
    CLOSE cur_pass;

    IF NOT EXISTS (
        SELECT 1 FROM RESERVATION WHERE pnr = p_pnr AND status != 'CANCELLED'
    ) THEN
        UPDATE BOOKING SET status = 'CANCELLED' WHERE pnr = p_pnr;
    END IF;

    IF p_manage_tx = 1 THEN
        COMMIT;
    END IF;

    SET p_out_charge = v_total_charge;
    SET p_out_refund_amount = v_total_refund;
    SET p_out_status = 'CANCELLED';

END proc_label$$

-- -----------------------------------------------------------------------------
-- 5. sp_prepare_chart
-- Chart preparation procedure per BR-B12a, BR-B16:
--   1. Chart lockout: set chart_prepared_at = NOW()
--   2. Cancel active holds for this run
--   3. Move unsold quota seats to GENERAL and run promotion
--   4. Purge/cancel passengers still waitlisted and refund in full (BR-W8)
--   5. Create unchanging CHART_SNAPSHOT records
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_prepare_chart$$
CREATE PROCEDURE sp_prepare_chart(
    IN p_schedule_id INT,
    IN p_manage_tx TINYINT(1),
    OUT p_out_snapshot_count INT
)
proc_label: BEGIN
    DECLARE v_new_refund_id INT DEFAULT 0;
    DECLARE done INT DEFAULT 0;

    DECLARE cur_hold_pnr VARCHAR(10);
    DECLARE cur_hold_class_id INT;
    DECLARE cur_hold_res_id INT;
    DECLARE cur_hold_seat_id INT;
    DECLARE cur_hold_res_status VARCHAR(20);
    DECLARE cur_hold_queue VARCHAR(16);
    DECLARE cur_hold_wl_num INT;
    DECLARE v_wl_amount DECIMAL(10,2);
    DECLARE v_wl_room DECIMAL(10,2);

    DECLARE cur_wl_pnr VARCHAR(10);
    DECLARE cur_wl_pass_no INT;
    DECLARE cur_wl_fare DECIMAL(10,2);
    DECLARE cur_wl_ins DECIMAL(10,2);
    DECLARE cur_wl_pay_id INT;
    DECLARE cur_wl CURSOR FOR
        SELECT r.pnr, r.passenger_no, pb.total_fare, pb.insurance, p.payment_id
        FROM RESERVATION r
        JOIN PASSENGER_BOOKING pb ON r.pnr = pb.pnr AND r.passenger_no = pb.passenger_no
        LEFT JOIN PAYMENT p ON p.payment_id = fn_pick_refund_payment(r.pnr)
        WHERE r.schedule_id = p_schedule_id AND r.status = 'WAITING_LIST';
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

    -- Errors are no longer swallowed: undo what this call started, then pass the error to the caller
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        IF p_manage_tx = 1 THEN
            ROLLBACK;
        END IF;
        SET p_out_snapshot_count = 0;
        RESIGNAL;
    END;

    IF p_manage_tx = 1 THEN
        START TRANSACTION;
    END IF;

    UPDATE TRAIN_SCHEDULE
    SET chart_prepared_at = NOW()
    WHERE schedule_id = p_schedule_id;

    DELETE FROM SEAT_HOLD WHERE schedule_id = p_schedule_id;

    -- BR-B12a: Cancel running holds for this run and release seats before chart snapshot
    WHILE EXISTS (
        SELECT 1 FROM BOOKING
        WHERE schedule_id = p_schedule_id AND status = 'PAYMENT_PENDING'
    ) DO
        SELECT pnr, class_id
        INTO cur_hold_pnr, cur_hold_class_id
        FROM BOOKING
        WHERE schedule_id = p_schedule_id AND status = 'PAYMENT_PENDING'
        LIMIT 1;

        WHILE EXISTS (SELECT 1 FROM RESERVATION WHERE pnr = cur_hold_pnr AND status != 'CANCELLED') DO
            SELECT res_id, seat_id, status, queue_position
            INTO cur_hold_res_id, cur_hold_seat_id, cur_hold_res_status, cur_hold_queue
            FROM RESERVATION
            WHERE pnr = cur_hold_pnr AND status != 'CANCELLED'
            LIMIT 1;

            UPDATE RESERVATION
            SET status = 'CANCELLED', seat_id = NULL, queue_position = NULL
            WHERE res_id = cur_hold_res_id;

            IF cur_hold_res_status = 'CONFIRMED' AND cur_hold_seat_id IS NOT NULL THEN
                CALL sp_promote_passenger(p_schedule_id, cur_hold_class_id, cur_hold_seat_id);
            ELSEIF cur_hold_res_status = 'RAC' THEN
                CALL sp_promote_passenger(p_schedule_id, cur_hold_class_id, NULL);
            ELSEIF cur_hold_res_status = 'WAITING_LIST' THEN
                IF cur_hold_queue IS NOT NULL THEN
                    SET cur_hold_wl_num = CAST(SUBSTRING_INDEX(cur_hold_queue, '/', -1) AS UNSIGNED);
                    UPDATE SCHEDULE_CLASS_INVENTORY
                    SET wl_count = GREATEST(0, wl_count - 1)
                    WHERE schedule_id = p_schedule_id AND class_id = cur_hold_class_id;

                    UPDATE RESERVATION r
                    JOIN BOOKING b ON r.pnr = b.pnr
                    SET r.queue_position = CONCAT('WL/', CAST(SUBSTRING_INDEX(r.queue_position, '/', -1) AS UNSIGNED) - 1)
                    WHERE r.schedule_id = p_schedule_id
                      AND b.class_id = cur_hold_class_id
                      AND r.status = 'WAITING_LIST'
                      AND CAST(SUBSTRING_INDEX(COALESCE(r.queue_position, '0'), '/', -1) AS UNSIGNED) > cur_hold_wl_num;
                END IF;
            END IF;
        END WHILE;

        UPDATE BOOKING SET status = 'FAILED' WHERE pnr = cur_hold_pnr;

        UPDATE SCHEDULE_CLASS_INVENTORY sci
        LEFT JOIN (
            SELECT 
                r.schedule_id,
                b.class_id,
                SUM(CASE WHEN r.status IN ('CONFIRMED', 'BOARDED') THEN 1 ELSE 0 END) as conf_count,
                SUM(CASE WHEN r.status = 'RAC' THEN 1 ELSE 0 END) as rac_count,
                SUM(CASE WHEN r.status = 'WAITING_LIST' THEN 1 ELSE 0 END) as wl_count
            FROM RESERVATION r
            JOIN BOOKING b ON r.pnr = b.pnr
            WHERE r.schedule_id = p_schedule_id AND b.class_id = cur_hold_class_id
            GROUP BY r.schedule_id, b.class_id
        ) res ON sci.schedule_id = res.schedule_id AND sci.class_id = res.class_id
        SET sci.available_seats = sci.total_seats - COALESCE(res.conf_count, 0),
            sci.rac_count = COALESCE(res.rac_count, 0),
            sci.wl_count = COALESCE(res.wl_count, 0)
        WHERE sci.schedule_id = p_schedule_id AND sci.class_id = cur_hold_class_id;
    END WHILE;

    OPEN cur_wl;
    wl_loop: LOOP
        FETCH cur_wl INTO cur_wl_pnr, cur_wl_pass_no, cur_wl_fare, cur_wl_ins, cur_wl_pay_id;
        IF done = 1 THEN LEAVE wl_loop; END IF;

        UPDATE RESERVATION
        SET status = 'CANCELLED'
        WHERE pnr = cur_wl_pnr AND passenger_no = cur_wl_pass_no;

        IF cur_wl_pay_id IS NOT NULL THEN
            -- Refund cap: the chart must always finish, so here the refund is reduced to what is
            -- left of the payment (and skipped if nothing is left). A reduced refund is logged.
            SET v_wl_amount = cur_wl_fare - cur_wl_ins;
            SET v_wl_room = fn_refund_room(cur_wl_pay_id);
            IF v_wl_amount > v_wl_room THEN
                INSERT INTO AUDIT_LOG (user_id, action, table_name, record_id, old_value, new_value, logged_at)
                VALUES (NULL, 'REFUND_CAPPED', 'PAYMENT', CAST(cur_wl_pay_id AS CHAR),
                        JSON_OBJECT('wanted_refund', v_wl_amount),
                        JSON_OBJECT('refund_given', v_wl_room, 'pnr', cur_wl_pnr, 'passenger_no', cur_wl_pass_no),
                        COALESCE(@as_of_time, NOW()));
                SET v_wl_amount = v_wl_room;
            END IF;
            IF v_wl_amount > 0 THEN
                INSERT INTO REFUND (cancel_id, tdr_ref_no, payment_id, amount, reason, status)
                VALUES (
                    NULL, NULL, cur_wl_pay_id, v_wl_amount, 'WAITLIST_PURGE', 'PENDING'
                );
            END IF;
        END IF;
    END LOOP;
    CLOSE cur_wl;

    -- Purged waitlisted passengers; reset wl_count on schedule inventory to 0 per BR-W8
    UPDATE SCHEDULE_CLASS_INVENTORY
    SET wl_count = 0
    WHERE schedule_id = p_schedule_id;

    -- snapshot_id is AUTO_INCREMENT: two charts made at the same time never clash
    INSERT INTO CHART_SNAPSHOT (
        schedule_id, pnr, passenger_no, coach_no, seat_no,
        berth_type, status, from_station_id, to_station_id, concession_flag, generated_at
    )
    SELECT
        p_schedule_id,
        b.pnr,
        pb.passenger_no,
        COALESCE(c.coach_code, 'RAC'),
        COALESCE(s.seat_number, 0),
        COALESCE(s.berth_type, 'SIDE_LOWER'),
        r.status,
        rs_from.station_id,
        rs_to.station_id,
        CASE WHEN pb.concession_type != 'NONE' THEN 1 ELSE 0 END,
        NOW()
    FROM BOOKING b
    JOIN PASSENGER_BOOKING pb ON b.pnr = pb.pnr
    JOIN RESERVATION r ON pb.pnr = r.pnr AND pb.passenger_no = r.passenger_no
    JOIN ROUTE_STOP rs_from ON b.from_stop_id = rs_from.stop_id
    JOIN ROUTE_STOP rs_to ON b.to_stop_id = rs_to.stop_id
    LEFT JOIN SEAT s ON r.seat_id = s.seat_id
    LEFT JOIN COACH c ON s.coach_id = c.coach_id
    WHERE b.schedule_id = p_schedule_id
      AND r.status IN ('CONFIRMED', 'RAC')
    ORDER BY b.pnr, pb.passenger_no;

    SELECT COUNT(*) INTO p_out_snapshot_count
    FROM CHART_SNAPSHOT
    WHERE schedule_id = p_schedule_id;

    IF p_manage_tx = 1 THEN
        COMMIT;
    END IF;

END proc_label$$

-- -----------------------------------------------------------------------------
-- 6. sp_process_late_payment_refund
-- Automatic full refund (including insurance) for payments received after hold
-- expired or when booking status is FAILED (BR-B14).
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_process_late_payment_refund$$
CREATE PROCEDURE sp_process_late_payment_refund(
    IN p_pnr VARCHAR(10),
    IN p_amount DECIMAL(10,2),
    IN p_payment_method VARCHAR(20),
    IN p_gateway_id VARCHAR(64),
    IN p_manage_tx TINYINT(1),
    OUT p_out_refund_id INT,
    OUT p_out_status VARCHAR(32)
)
proc_label: BEGIN
    DECLARE v_new_payment_id INT;
    DECLARE v_new_refund_id INT;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        IF p_manage_tx = 1 THEN
            ROLLBACK;
        END IF;
        SET p_out_status = 'FAILED';
    END;

    IF p_manage_tx = 1 THEN
        START TRANSACTION;
    END IF;

    -- payment_id and refund_id are AUTO_INCREMENT
    INSERT INTO PAYMENT (pnr, amount, method, status, gateway_payment_id, paid_at)
    VALUES (p_pnr, p_amount, p_payment_method, 'SUCCESS', p_gateway_id, COALESCE(@as_of_time, NOW()));
    SET v_new_payment_id = LAST_INSERT_ID();

    -- Refund cap: this refund is the whole new payment, so it only fails if refunds already exist for it
    IF fn_refund_room(v_new_payment_id) < p_amount THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_refund_id = NULL;
        SET p_out_status = 'REFUND_EXCEEDS_PAYMENT';
        LEAVE proc_label;
    END IF;

    INSERT INTO REFUND (cancel_id, tdr_ref_no, payment_id, amount, reason, status)
    VALUES (NULL, NULL, v_new_payment_id, p_amount, 'PAYMENT_AFTER_EXPIRY', 'PENDING');
    SET v_new_refund_id = LAST_INSERT_ID();

    UPDATE BOOKING
    SET status = 'FAILED'
    WHERE pnr = p_pnr AND status IN ('PAYMENT_PENDING', 'FAILED');

    IF p_manage_tx = 1 THEN
        COMMIT;
    END IF;

    SET p_out_refund_id = v_new_refund_id;
    SET p_out_status = 'REFUND_PROCESSED';
END proc_label$$

-- -----------------------------------------------------------------------------
-- 7. sp_create_counter_booking
-- Facilitates counter booking by staff with CASH/UPI payment, assigning
-- COUNTER_WALKIN account (50008) when walk-in passenger has no account (BR-CB3).
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_create_counter_booking$$
CREATE PROCEDURE sp_create_counter_booking(
    IN p_staff_id INT,
    IN p_walkin_user_id INT,
    IN p_schedule_id INT,
    IN p_class_id INT,
    IN p_from_stop_id INT,
    IN p_to_stop_id INT,
    IN p_quota VARCHAR(20),
    IN p_passengers JSON,
    IN p_payment_method VARCHAR(20),
    IN p_manage_tx TINYINT(1),
    OUT p_out_pnr VARCHAR(10),
    OUT p_out_total_fare DECIMAL(10,2),
    OUT p_out_status VARCHAR(20),
    OUT p_out_error_code VARCHAR(32)
)
proc_label: BEGIN
    DECLARE v_user_id INT;
    DECLARE v_pnr VARCHAR(10);
    DECLARE v_fare DECIMAL(10,2);
    DECLARE v_status VARCHAR(20);
    DECLARE v_err VARCHAR(32);
    DECLARE v_new_payment_id INT;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        IF p_manage_tx = 1 THEN
            ROLLBACK;
        END IF;
        SET p_out_error_code = 'TRANSACTION_FAILED';
        SET p_out_status = 'FAILED';
    END;

    IF p_manage_tx = 1 THEN
        START TRANSACTION;
    END IF;

    IF p_walkin_user_id IS NULL OR p_walkin_user_id = 0 THEN
        SET v_user_id = 50008; -- Shared COUNTER_WALKIN account
    ELSE
        SET v_user_id = p_walkin_user_id;
    END IF;

    CALL sp_create_booking(
        v_user_id, p_schedule_id, p_class_id, p_from_stop_id, p_to_stop_id,
        p_quota, 1, 0, 0, p_passengers, 'COUNTER', p_staff_id, 0,
        v_pnr, v_status, v_fare, v_err
    );

    IF v_err IS NOT NULL THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_error_code = v_err;
        SET p_out_status = 'FAILED';
        LEAVE proc_label;
    END IF;

    INSERT INTO PAYMENT (
        pnr, amount, method, status, gateway_payment_id, paid_at
    ) VALUES (
        v_pnr, v_fare, p_payment_method, 'SUCCESS',
        CONCAT('counter_pay_', v_pnr, '_new'), NOW()
    );
    SET v_new_payment_id = LAST_INSERT_ID();
    UPDATE PAYMENT SET gateway_payment_id = CONCAT('counter_pay_', v_pnr, '_', v_new_payment_id)
    WHERE payment_id = v_new_payment_id;

    IF p_manage_tx = 1 THEN
        COMMIT;
    END IF;

    SET p_out_pnr = v_pnr;
    SET p_out_total_fare = v_fare;
    SET p_out_status = v_status;
    SET p_out_error_code = NULL;
END proc_label$$

-- -----------------------------------------------------------------------------
-- 8. sp_confirm_payment
-- Confirms payment for an online booking within the hold window.
-- If inside window and status is PAYMENT_PENDING:
--   Inserts PAYMENT (SUCCESS) and updates BOOKING.status based on passenger reservations.
-- If window passed or status not PAYMENT_PENDING:
--   Releases any held reservations (if still pending), calls sp_process_late_payment_refund, returns 'LATE'.
-- If gateway_payment_id already exists:
--   Returns earlier result idempotently without second insert.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_confirm_payment$$
CREATE PROCEDURE sp_confirm_payment(
    IN p_pnr VARCHAR(10),
    IN p_amount DECIMAL(10,2),
    IN p_payment_method VARCHAR(20),
    IN p_gateway_id VARCHAR(64),
    IN p_manage_tx TINYINT(1),
    OUT p_out_status VARCHAR(20),
    OUT p_out_payment_id INT
)
proc_label: BEGIN
    DECLARE v_booking_status VARCHAR(20);
    DECLARE v_sched_id INT;
    DECLARE v_class_id INT;
    DECLARE v_total_fare DECIMAL(10,2);
    DECLARE v_created_at DATETIME;
    DECLARE v_hold_minutes INT DEFAULT 10;
    DECLARE v_as_of DATETIME;
    DECLARE v_final_status VARCHAR(20);
    DECLARE v_existing_payment_id INT DEFAULT NULL;
    DECLARE v_existing_refund_id INT DEFAULT NULL;
    DECLARE v_new_payment_id INT;
    DECLARE v_refund_id INT;
    DECLARE v_ref_status VARCHAR(20);
    DECLARE v_cur_res_id INT;
    DECLARE v_cur_seat_id INT;
    DECLARE v_cur_status VARCHAR(20);
    DECLARE v_cur_queue VARCHAR(16);
    DECLARE v_old_wl_num INT;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        IF p_manage_tx = 1 THEN
            ROLLBACK;
        END IF;
        RESIGNAL;
    END;

    -- Safety check: payment amount must be strictly greater than zero
    IF p_amount IS NULL OR p_amount <= 0 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'PAYMENT_AMOUNT_INVALID: Payment amount must be strictly greater than zero.';
    END IF;

    IF p_manage_tx = 1 THEN
        START TRANSACTION;
    END IF;

    -- 1. Idempotency check: if gateway_payment_id already exists, return earlier result
    SELECT payment_id INTO v_existing_payment_id
    FROM PAYMENT
    WHERE gateway_payment_id = p_gateway_id
    LIMIT 1;

    IF v_existing_payment_id IS NOT NULL THEN
        SELECT refund_id INTO v_existing_refund_id
        FROM REFUND
        WHERE payment_id = v_existing_payment_id AND reason = 'PAYMENT_AFTER_EXPIRY'
        LIMIT 1;

        IF v_existing_refund_id IS NOT NULL THEN
            SET p_out_status = 'LATE';
            SET p_out_payment_id = v_existing_payment_id;
        ELSE
            SELECT status INTO p_out_status FROM BOOKING WHERE pnr = p_pnr;
            SET p_out_payment_id = v_existing_payment_id;
        END IF;

        IF p_manage_tx = 1 THEN
            COMMIT;
        END IF;
        LEAVE proc_label;
    END IF;

    -- 2. Fetch booking details
    SELECT status, created_at, schedule_id, class_id, total_fare
    INTO v_booking_status, v_created_at, v_sched_id, v_class_id, v_total_fare
    FROM BOOKING
    WHERE pnr = p_pnr
    FOR UPDATE;

    IF v_booking_status IS NULL THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_status = 'FAILED';
        SET p_out_payment_id = NULL;
        LEAVE proc_label;
    END IF;

    -- Safety check: payment amount must equal booking total fare
    IF p_amount <> v_total_fare THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'PAYMENT_AMOUNT_MISMATCH: Payment amount does not match booking total fare.';
    END IF;

    -- 3. Read HOLD_MINUTES from SETTING
    SELECT CAST(setting_value AS SIGNED) INTO v_hold_minutes
    FROM SETTING
    WHERE setting_key = 'HOLD_MINUTES';
    IF v_hold_minutes IS NULL THEN
        SET v_hold_minutes = 10;
    END IF;

    SET v_as_of = COALESCE(@as_of_time, NOW());

    -- 4. Check if inside window and booking is PAYMENT_PENDING
    IF v_booking_status = 'PAYMENT_PENDING' AND v_as_of <= (v_created_at + INTERVAL v_hold_minutes MINUTE) THEN
        -- Derive final booking status from passenger reservation statuses:
        -- Weakest status: WAITING_LIST > RAC > CONFIRMED
        IF EXISTS (SELECT 1 FROM RESERVATION WHERE pnr = p_pnr AND status = 'WAITING_LIST') THEN
            SET v_final_status = 'WAITING_LIST';
        ELSEIF EXISTS (SELECT 1 FROM RESERVATION WHERE pnr = p_pnr AND status = 'RAC') THEN
            SET v_final_status = 'RAC';
        ELSE
            SET v_final_status = 'CONFIRMED';
        END IF;

        INSERT INTO PAYMENT (
            pnr, amount, method, status, gateway_payment_id, paid_at
        ) VALUES (
            p_pnr, p_amount, p_payment_method, 'SUCCESS', p_gateway_id, v_as_of
        );
        SET v_new_payment_id = LAST_INSERT_ID();

        UPDATE BOOKING
        SET status = v_final_status
        WHERE pnr = p_pnr;

        IF p_manage_tx = 1 THEN
            COMMIT;
        END IF;

        SET p_out_status = v_final_status;
        SET p_out_payment_id = v_new_payment_id;

    ELSE
        -- Window passed or booking not PAYMENT_PENDING: late payment
        -- If booking is still PAYMENT_PENDING, release its reservations and sync inventory
        IF v_booking_status = 'PAYMENT_PENDING' THEN
            WHILE EXISTS (SELECT 1 FROM RESERVATION WHERE pnr = p_pnr AND status != 'CANCELLED') DO
                SELECT res_id, seat_id, status, queue_position
                INTO v_cur_res_id, v_cur_seat_id, v_cur_status, v_cur_queue
                FROM RESERVATION
                WHERE pnr = p_pnr AND status != 'CANCELLED'
                LIMIT 1;

                UPDATE RESERVATION
                SET status = 'CANCELLED', seat_id = NULL, queue_position = NULL
                WHERE res_id = v_cur_res_id;

                IF v_cur_status = 'CONFIRMED' AND v_cur_seat_id IS NOT NULL THEN
                    CALL sp_promote_passenger(v_sched_id, v_class_id, v_cur_seat_id);
                ELSEIF v_cur_status = 'RAC' THEN
                    CALL sp_promote_passenger(v_sched_id, v_class_id, NULL);
                ELSEIF v_cur_status = 'WAITING_LIST' THEN
                    IF v_cur_queue IS NOT NULL THEN
                        SET v_old_wl_num = CAST(SUBSTRING_INDEX(v_cur_queue, '/', -1) AS UNSIGNED);
                        UPDATE SCHEDULE_CLASS_INVENTORY
                        SET wl_count = GREATEST(0, wl_count - 1)
                        WHERE schedule_id = v_sched_id AND class_id = v_class_id;

                        UPDATE RESERVATION r
                        JOIN BOOKING b ON r.pnr = b.pnr
                        SET r.queue_position = CONCAT('WL/', CAST(SUBSTRING_INDEX(r.queue_position, '/', -1) AS UNSIGNED) - 1)
                        WHERE r.schedule_id = v_sched_id
                          AND b.class_id = v_class_id
                          AND r.status = 'WAITING_LIST'
                          AND CAST(SUBSTRING_INDEX(COALESCE(r.queue_position, '0'), '/', -1) AS UNSIGNED) > v_old_wl_num;
                    END IF;
                END IF;
            END WHILE;

            UPDATE SCHEDULE_CLASS_INVENTORY sci
            LEFT JOIN (
                SELECT 
                    r.schedule_id,
                    b.class_id,
                    SUM(CASE WHEN r.status IN ('CONFIRMED', 'BOARDED') THEN 1 ELSE 0 END) as conf_count,
                    SUM(CASE WHEN r.status = 'RAC' THEN 1 ELSE 0 END) as rac_count,
                    SUM(CASE WHEN r.status = 'WAITING_LIST' THEN 1 ELSE 0 END) as wl_count
                FROM RESERVATION r
                JOIN BOOKING b ON r.pnr = b.pnr
                WHERE r.schedule_id = v_sched_id AND b.class_id = v_class_id
                GROUP BY r.schedule_id, b.class_id
            ) res ON sci.schedule_id = res.schedule_id AND sci.class_id = res.class_id
            SET sci.available_seats = sci.total_seats - COALESCE(res.conf_count, 0),
                sci.rac_count = COALESCE(res.rac_count, 0),
                sci.wl_count = COALESCE(res.wl_count, 0)
            WHERE sci.schedule_id = v_sched_id AND sci.class_id = v_class_id;
        END IF;

        -- Process late payment refund (sets BOOKING.status = 'FAILED', creates PAYMENT and REFUND)
        CALL sp_process_late_payment_refund(
            p_pnr, p_amount, p_payment_method, p_gateway_id, 0, v_refund_id, v_ref_status
        );

        IF p_manage_tx = 1 THEN
            COMMIT;
        END IF;

        SET p_out_status = 'LATE';
        SELECT payment_id INTO p_out_payment_id
        FROM PAYMENT
        WHERE gateway_payment_id = p_gateway_id
        LIMIT 1;

    END IF;

END proc_label$$

-- -----------------------------------------------------------------------------
-- 9. sp_release_expired_holds
-- Scans for all PAYMENT_PENDING bookings older than HOLD_MINUTES.
-- Sets BOOKING.status = 'FAILED', cancels reservations, promotes waiting passengers
-- using sp_promote_passenger, and synchronizes inventory counters to real counts.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_release_expired_holds$$
CREATE PROCEDURE sp_release_expired_holds(
    IN p_manage_tx TINYINT(1),
    OUT p_out_released_count INT
)
proc_label: BEGIN
    DECLARE v_hold_minutes INT DEFAULT 10;
    DECLARE v_as_of DATETIME;
    DECLARE cur_pnr VARCHAR(10);
    DECLARE cur_sched_id INT;
    DECLARE cur_class_id INT;
    DECLARE v_cur_res_id INT;
    DECLARE v_cur_seat_id INT;
    DECLARE v_cur_status VARCHAR(20);
    DECLARE v_cur_queue VARCHAR(16);
    DECLARE v_old_wl_num INT;

    -- Still returns 0 on error, but now writes one AUDIT_LOG row with the error text so it can be seen.
    -- The run lock (see below) is released on this path too.
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        DECLARE v_err_no INT DEFAULT NULL;
        DECLARE v_err_text TEXT DEFAULT NULL;
        GET DIAGNOSTICS CONDITION 1 v_err_no = MYSQL_ERRNO, v_err_text = MESSAGE_TEXT;
        IF p_manage_tx = 1 THEN
            ROLLBACK;
        END IF;
        SET p_out_released_count = 0;
        BEGIN
            DECLARE CONTINUE HANDLER FOR SQLEXCEPTION BEGIN END;
            INSERT INTO AUDIT_LOG (user_id, action, table_name, record_id, old_value, new_value, logged_at)
            VALUES (NULL, 'RELEASE_HOLDS_FAILED', 'BOOKING', 'sp_release_expired_holds', NULL,
                    JSON_OBJECT('mysql_errno', v_err_no, 'message', LEFT(COALESCE(v_err_text, ''), 500)),
                    COALESCE(@as_of_time, NOW()));
            IF p_manage_tx = 1 THEN
                COMMIT;
            END IF;
        END;
        DO RELEASE_LOCK('release_expired_holds');
    END;

    -- Only one release run at a time (timer, createOrder, verifyPayment, reconcile can all call this).
    -- A second caller returns 0 at once, so the same freed seat is never promoted twice.
    SET p_out_released_count = 0;
    IF COALESCE(GET_LOCK('release_expired_holds', 0), 0) <> 1 THEN
        LEAVE proc_label;
    END IF;

    IF p_manage_tx = 1 THEN
        START TRANSACTION;
    END IF;

    -- Read HOLD_MINUTES from SETTING
    SELECT CAST(setting_value AS SIGNED) INTO v_hold_minutes
    FROM SETTING
    WHERE setting_key = 'HOLD_MINUTES';
    IF v_hold_minutes IS NULL THEN
        SET v_hold_minutes = 10;
    END IF;

    SET v_as_of = COALESCE(@as_of_time, NOW());

    WHILE EXISTS (
        SELECT 1 FROM BOOKING 
        WHERE status = 'PAYMENT_PENDING' 
          AND v_as_of > (created_at + INTERVAL v_hold_minutes MINUTE)
    ) DO
        SELECT pnr, schedule_id, class_id
        INTO cur_pnr, cur_sched_id, cur_class_id
        FROM BOOKING
        WHERE status = 'PAYMENT_PENDING' 
          AND v_as_of > (created_at + INTERVAL v_hold_minutes MINUTE)
        LIMIT 1;

        -- Process all uncancelled reservations for this booking
        WHILE EXISTS (SELECT 1 FROM RESERVATION WHERE pnr = cur_pnr AND status != 'CANCELLED') DO
            SELECT res_id, seat_id, status, queue_position
            INTO v_cur_res_id, v_cur_seat_id, v_cur_status, v_cur_queue
            FROM RESERVATION
            WHERE pnr = cur_pnr AND status != 'CANCELLED'
            LIMIT 1;

            UPDATE RESERVATION
            SET status = 'CANCELLED', seat_id = NULL, queue_position = NULL
            WHERE res_id = v_cur_res_id;

            IF v_cur_status = 'CONFIRMED' AND v_cur_seat_id IS NOT NULL THEN
                CALL sp_promote_passenger(cur_sched_id, cur_class_id, v_cur_seat_id);
            ELSEIF v_cur_status = 'RAC' THEN
                CALL sp_promote_passenger(cur_sched_id, cur_class_id, NULL);
            ELSEIF v_cur_status = 'WAITING_LIST' THEN
                IF v_cur_queue IS NOT NULL THEN
                    SET v_old_wl_num = CAST(SUBSTRING_INDEX(v_cur_queue, '/', -1) AS UNSIGNED);
                    UPDATE SCHEDULE_CLASS_INVENTORY
                    SET wl_count = GREATEST(0, wl_count - 1)
                    WHERE schedule_id = cur_sched_id AND class_id = cur_class_id;

                    UPDATE RESERVATION r
                    JOIN BOOKING b ON r.pnr = b.pnr
                    SET r.queue_position = CONCAT('WL/', CAST(SUBSTRING_INDEX(r.queue_position, '/', -1) AS UNSIGNED) - 1)
                    WHERE r.schedule_id = cur_sched_id
                      AND b.class_id = cur_class_id
                      AND r.status = 'WAITING_LIST'
                      AND CAST(SUBSTRING_INDEX(COALESCE(r.queue_position, '0'), '/', -1) AS UNSIGNED) > v_old_wl_num;
                END IF;
            END IF;
        END WHILE;

        -- Mark booking as FAILED
        UPDATE BOOKING
        SET status = 'FAILED'
        WHERE pnr = cur_pnr;

        -- Synchronize inventory counters to real counts for this schedule and class
        UPDATE SCHEDULE_CLASS_INVENTORY sci
        LEFT JOIN (
            SELECT 
                r.schedule_id,
                b.class_id,
                SUM(CASE WHEN r.status IN ('CONFIRMED', 'BOARDED') THEN 1 ELSE 0 END) as conf_count,
                SUM(CASE WHEN r.status = 'RAC' THEN 1 ELSE 0 END) as rac_count,
                SUM(CASE WHEN r.status = 'WAITING_LIST' THEN 1 ELSE 0 END) as wl_count
            FROM RESERVATION r
            JOIN BOOKING b ON r.pnr = b.pnr
            WHERE r.schedule_id = cur_sched_id AND b.class_id = cur_class_id
            GROUP BY r.schedule_id, b.class_id
        ) res ON sci.schedule_id = res.schedule_id AND sci.class_id = res.class_id
        SET sci.available_seats = sci.total_seats - COALESCE(res.conf_count, 0),
            sci.rac_count = COALESCE(res.rac_count, 0),
            sci.wl_count = COALESCE(res.wl_count, 0)
        WHERE sci.schedule_id = cur_sched_id AND sci.class_id = cur_class_id;

        SET p_out_released_count = p_out_released_count + 1;
    END WHILE;

    IF p_manage_tx = 1 THEN
        COMMIT;
    END IF;

    -- Release after the commit, so the next run sees the finished state
    DO RELEASE_LOCK('release_expired_holds');

END proc_label$$

-- -----------------------------------------------------------------------------
-- 9b. sp_cancel_unpaid_booking
-- The passenger gives up a booking that is still PAYMENT_PENDING ("Cancel unpaid booking"). Same release work as
-- sp_release_expired_holds, for ONE booking: every reservation is cancelled and the freed seats are promoted,
-- the booking becomes FAILED (the same end state as an expired hold) and the inventory counters are re-synced.
-- p_out_status: RELEASED, NOT_FOUND, FORBIDDEN (not the owner) or NOT_PENDING (already paid, released or cancelled).
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_cancel_unpaid_booking$$
CREATE PROCEDURE sp_cancel_unpaid_booking(
    IN p_pnr VARCHAR(10),
    IN p_user_id INT,
    IN p_manage_tx TINYINT(1),
    OUT p_out_status VARCHAR(20)
)
proc_label: BEGIN
    DECLARE v_user_id INT DEFAULT NULL;
    DECLARE v_status VARCHAR(20) DEFAULT NULL;
    DECLARE v_sched_id INT;
    DECLARE v_class_id INT;
    DECLARE v_cur_res_id INT;
    DECLARE v_cur_seat_id INT;
    DECLARE v_cur_status VARCHAR(20);
    DECLARE v_cur_queue VARCHAR(16);
    DECLARE v_old_wl_num INT;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        RESIGNAL;
    END;

    IF p_manage_tx = 1 THEN START TRANSACTION; END IF;

    SELECT user_id, status, schedule_id, class_id
    INTO v_user_id, v_status, v_sched_id, v_class_id
    FROM BOOKING WHERE pnr = p_pnr FOR UPDATE;

    IF v_user_id IS NULL THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_status = 'NOT_FOUND';
        LEAVE proc_label;
    END IF;
    IF v_user_id <> p_user_id THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_status = 'FORBIDDEN';
        LEAVE proc_label;
    END IF;
    IF v_status <> 'PAYMENT_PENDING' THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_status = 'NOT_PENDING';
        LEAVE proc_label;
    END IF;

    WHILE EXISTS (SELECT 1 FROM RESERVATION WHERE pnr = p_pnr AND status != 'CANCELLED') DO
        SELECT res_id, seat_id, status, queue_position
        INTO v_cur_res_id, v_cur_seat_id, v_cur_status, v_cur_queue
        FROM RESERVATION
        WHERE pnr = p_pnr AND status != 'CANCELLED'
        LIMIT 1;

        UPDATE RESERVATION
        SET status = 'CANCELLED', seat_id = NULL, queue_position = NULL
        WHERE res_id = v_cur_res_id;

        IF v_cur_status = 'CONFIRMED' AND v_cur_seat_id IS NOT NULL THEN
            CALL sp_promote_passenger(v_sched_id, v_class_id, v_cur_seat_id);
        ELSEIF v_cur_status = 'RAC' THEN
            CALL sp_promote_passenger(v_sched_id, v_class_id, NULL);
        ELSEIF v_cur_status = 'WAITING_LIST' THEN
            IF v_cur_queue IS NOT NULL THEN
                SET v_old_wl_num = CAST(SUBSTRING_INDEX(v_cur_queue, '/', -1) AS UNSIGNED);
                UPDATE SCHEDULE_CLASS_INVENTORY
                SET wl_count = GREATEST(0, wl_count - 1)
                WHERE schedule_id = v_sched_id AND class_id = v_class_id;

                UPDATE RESERVATION r
                JOIN BOOKING b ON r.pnr = b.pnr
                SET r.queue_position = CONCAT('WL/', CAST(SUBSTRING_INDEX(r.queue_position, '/', -1) AS UNSIGNED) - 1)
                WHERE r.schedule_id = v_sched_id
                  AND b.class_id = v_class_id
                  AND r.status = 'WAITING_LIST'
                  AND CAST(SUBSTRING_INDEX(COALESCE(r.queue_position, '0'), '/', -1) AS UNSIGNED) > v_old_wl_num;
            END IF;
        END IF;
    END WHILE;

    UPDATE BOOKING SET status = 'FAILED' WHERE pnr = p_pnr;

    UPDATE SCHEDULE_CLASS_INVENTORY sci
    LEFT JOIN (
        SELECT r.schedule_id, b.class_id,
               SUM(CASE WHEN r.status IN ('CONFIRMED', 'BOARDED') THEN 1 ELSE 0 END) AS conf_count,
               SUM(CASE WHEN r.status = 'RAC' THEN 1 ELSE 0 END) AS rac_count,
               SUM(CASE WHEN r.status = 'WAITING_LIST' THEN 1 ELSE 0 END) AS wl_count
        FROM RESERVATION r
        JOIN BOOKING b ON r.pnr = b.pnr
        WHERE r.schedule_id = v_sched_id AND b.class_id = v_class_id
        GROUP BY r.schedule_id, b.class_id
    ) res ON sci.schedule_id = res.schedule_id AND sci.class_id = res.class_id
    SET sci.available_seats = sci.total_seats - COALESCE(res.conf_count, 0),
        sci.rac_count = COALESCE(res.rac_count, 0),
        sci.wl_count = COALESCE(res.wl_count, 0)
    WHERE sci.schedule_id = v_sched_id AND sci.class_id = v_class_id;

    IF p_manage_tx = 1 THEN COMMIT; END IF;
    SET p_out_status = 'RELEASED';
END proc_label$$

-- -----------------------------------------------------------------------------
-- 10. sp_file_tdr
-- Files a Ticket Deposit Receipt (TDR) per BR-T3, BR-T4, BR-T6.
-- One TDR_FILING row per passenger. Owner check enforced.
-- Handles transaction management via p_manage_tx.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_file_tdr$$
CREATE PROCEDURE sp_file_tdr(
    IN p_pnr VARCHAR(10),
    IN p_passenger_no INT,
    IN p_user_id INT,
    IN p_reason VARCHAR(64),
    IN p_evidence_ref VARCHAR(128),
    IN p_remarks TEXT,
    IN p_manage_tx TINYINT(1),
    OUT p_out_tdr_ref_no VARCHAR(32),
    OUT p_out_status VARCHAR(32)
)
proc_label: BEGIN
    DECLARE v_book_user_id INT;
    DECLARE v_sched_id INT;
    DECLARE v_cls_id INT;
    DECLARE v_from_stop_id INT;
    DECLARE v_to_stop_id INT;
    DECLARE v_res_status VARCHAR(20);
    DECLARE v_seat_id INT;
    
    DECLARE v_deadline_hours INT;
    DECLARE v_requires_verification TINYINT(1);
    DECLARE v_refund_pct DECIMAL(5,2);
    
    DECLARE v_journey_date DATE;
    DECLARE v_sched_dep_time TIME;
    DECLARE v_delay_minutes INT DEFAULT 0;
    
    DECLARE v_from_dep_time TIME;
    DECLARE v_from_day_offset INT DEFAULT 0;
    
    DECLARE v_to_arr_time TIME;
    DECLARE v_to_day_offset INT DEFAULT 0;
    
    DECLARE v_as_of DATETIME;
    DECLARE v_dep_datetime DATETIME;
    DECLARE v_dest_arr_datetime DATETIME;
    DECLARE v_deadline DATETIME;
    
    DECLARE v_open_tdr_count INT DEFAULT 0;
    DECLARE v_tdr_seq INT DEFAULT 1;
    DECLARE v_tdr_ref_no VARCHAR(32);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        IF p_manage_tx = 1 THEN
            ROLLBACK;
        END IF;
        SET p_out_tdr_ref_no = NULL;
        SET p_out_status = 'FAILED';
    END;

    IF p_manage_tx = 1 THEN
        START TRANSACTION;
    END IF;

    SET v_as_of = COALESCE(@as_of_time, NOW());

    -- 0. A TDR is always for one passenger (BR-T3): a missing passenger number is refused
    IF p_passenger_no IS NULL THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_tdr_ref_no = NULL;
        SET p_out_status = 'PASSENGER_REQUIRED';
        LEAVE proc_label;
    END IF;

    -- 1. Check reservation and booking ownership (BR-T3)
    SELECT b.user_id, b.schedule_id, b.class_id, b.from_stop_id, b.to_stop_id, r.status, r.seat_id
    INTO v_book_user_id, v_sched_id, v_cls_id, v_from_stop_id, v_to_stop_id, v_res_status, v_seat_id
    FROM BOOKING b
    JOIN RESERVATION r ON b.pnr = r.pnr
    WHERE b.pnr = p_pnr AND r.passenger_no = p_passenger_no
    LIMIT 1;

    IF v_book_user_id IS NULL THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_tdr_ref_no = NULL;
        SET p_out_status = 'NOT_FOUND';
        LEAVE proc_label;
    END IF;

    IF v_book_user_id != p_user_id THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_tdr_ref_no = NULL;
        SET p_out_status = 'FORBIDDEN';
        LEAVE proc_label;
    END IF;

    -- 2. Validate reason code against TDR_RULE
    SELECT deadline_hours, requires_verification, refund_pct
    INTO v_deadline_hours, v_requires_verification, v_refund_pct
    FROM TDR_RULE
    WHERE reason_code = p_reason
    LIMIT 1;

    IF v_deadline_hours IS NULL THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_tdr_ref_no = NULL;
        SET p_out_status = 'INVALID_REASON';
        LEAVE proc_label;
    END IF;

    -- 3. One open TDR per passenger (BR-T3). FILED, UNDER_REVIEW, APPROVED and REFUND_PROCESSED all count,
    --    so a refunded passenger cannot file again. A REJECTED TDR is not open, so it may be filed again
    --    (BR-T3 only limits open TDRs; BUSINESS_RULES section 9 has no ban on re-filing after a rejection).
    SELECT COUNT(*) INTO v_open_tdr_count
    FROM TDR_FILING
    WHERE pnr = p_pnr
      AND (passenger_no IS NULL OR passenger_no = p_passenger_no)
      AND status IN ('FILED', 'UNDER_REVIEW', 'APPROVED', 'REFUND_PROCESSED');

    IF v_open_tdr_count > 0 THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_tdr_ref_no = NULL;
        SET p_out_status = 'DUPLICATE_TDR';
        LEAVE proc_label;
    END IF;

    -- 4. Read TRAIN_SCHEDULE and ROUTE_STOP data
    SELECT journey_date, departure_time, delay_minutes
    INTO v_journey_date, v_sched_dep_time, v_delay_minutes
    FROM TRAIN_SCHEDULE
    WHERE schedule_id = v_sched_id;

    SELECT departure_time, day_offset
    INTO v_from_dep_time, v_from_day_offset
    FROM ROUTE_STOP
    WHERE stop_id = v_from_stop_id;

    SELECT arrival_time, day_offset
    INTO v_to_arr_time, v_to_day_offset
    FROM ROUTE_STOP
    WHERE stop_id = v_to_stop_id;

    -- 5. Reason specific eligibility checks
    IF p_reason IN ('TRAIN_DELAYED_OVER_3_HOURS', 'TRAIN_DIVERTED') THEN
        -- Reservation must be CONFIRMED or RAC
        IF v_res_status NOT IN ('CONFIRMED', 'RAC') THEN
            IF p_manage_tx = 1 THEN ROLLBACK; END IF;
            SET p_out_tdr_ref_no = NULL;
            SET p_out_status = 'NOT_ELIGIBLE';
            LEAVE proc_label;
        END IF;

        -- Delay reason needs delay_minutes >= 180
        IF p_reason = 'TRAIN_DELAYED_OVER_3_HOURS' AND v_delay_minutes < 180 THEN
            IF p_manage_tx = 1 THEN ROLLBACK; END IF;
            SET p_out_tdr_ref_no = NULL;
            SET p_out_status = 'NOT_ELIGIBLE';
            LEAVE proc_label;
        END IF;

        -- Train must not have departed yet (scheduled departure + TRAIN_SCHEDULE.delay_minutes)
        SET v_dep_datetime = TIMESTAMP(v_journey_date, v_from_dep_time) + INTERVAL v_from_day_offset DAY + INTERVAL v_delay_minutes MINUTE;
        IF v_as_of >= v_dep_datetime THEN
            IF p_manage_tx = 1 THEN ROLLBACK; END IF;
            SET p_out_tdr_ref_no = NULL;
            SET p_out_status = 'DEADLINE_EXCEEDED';
            LEAVE proc_label;
        END IF;

    ELSE
        -- The other four reasons: reservation CONFIRMED, RAC or BOARDED
        IF v_res_status NOT IN ('CONFIRMED', 'RAC', 'BOARDED') THEN
            IF p_manage_tx = 1 THEN ROLLBACK; END IF;
            SET p_out_tdr_ref_no = NULL;
            SET p_out_status = 'NOT_ELIGIBLE';
            LEAVE proc_label;
        END IF;

        -- These four reasons are about what happened on the journey, so the train must have left first
        -- (boarding stop departure + delay). Before that there is nothing to claim yet.
        SET v_dep_datetime = TIMESTAMP(v_journey_date, v_from_dep_time) + INTERVAL v_from_day_offset DAY + INTERVAL v_delay_minutes MINUTE;
        IF v_as_of < v_dep_datetime THEN
            IF p_manage_tx = 1 THEN ROLLBACK; END IF;
            SET p_out_tdr_ref_no = NULL;
            SET p_out_status = 'NOT_ELIGIBLE';
            LEAVE proc_label;
        END IF;

        -- Evidence ref required when requires_verification = 1
        IF v_requires_verification = 1 AND (p_evidence_ref IS NULL OR TRIM(p_evidence_ref) = '') THEN
            IF p_manage_tx = 1 THEN ROLLBACK; END IF;
            SET p_out_tdr_ref_no = NULL;
            SET p_out_status = 'EVIDENCE_REQUIRED';
            LEAVE proc_label;
        END IF;

        -- Filed within TDR_RULE.deadline_hours after scheduled destination arrival + delay_minutes
        SET v_dest_arr_datetime = TIMESTAMP(v_journey_date, v_to_arr_time) + INTERVAL v_to_day_offset DAY + INTERVAL v_delay_minutes MINUTE;
        SET v_deadline = v_dest_arr_datetime + INTERVAL v_deadline_hours HOUR;

        IF v_as_of > v_deadline THEN
            IF p_manage_tx = 1 THEN ROLLBACK; END IF;
            SET p_out_tdr_ref_no = NULL;
            SET p_out_status = 'DEADLINE_EXCEEDED';
            LEAVE proc_label;
        END IF;

    END IF;

    -- 6. Generate tdr_ref_no: 'TDR-<pnr>-<passengerNo>-<n>'
    SET v_tdr_seq = 1;
    WHILE EXISTS (SELECT 1 FROM TDR_FILING WHERE tdr_ref_no = CONCAT('TDR-', p_pnr, '-', p_passenger_no, '-', v_tdr_seq)) DO
        SET v_tdr_seq = v_tdr_seq + 1;
    END WHILE;
    SET v_tdr_ref_no = CONCAT('TDR-', p_pnr, '-', p_passenger_no, '-', v_tdr_seq);

    -- 7. Insert into TDR_FILING (status FILED, one row per passenger)
    INSERT INTO TDR_FILING (
        tdr_ref_no, pnr, passenger_no, reason, filed_at, status, evidence_ref, remarks
    ) VALUES (
        v_tdr_ref_no, p_pnr, p_passenger_no, p_reason, v_as_of, 'FILED', p_evidence_ref, p_remarks
    );

    IF p_manage_tx = 1 THEN
        COMMIT;
    END IF;

    SET p_out_tdr_ref_no = v_tdr_ref_no;
    SET p_out_status = 'FILED';
END proc_label$$

-- -----------------------------------------------------------------------------
-- 11. sp_review_tdr
-- Reviews a TDR claim by admin (APPROVED or REJECTED) per BR-T7, BR-T8.
-- On APPROVED: inserts REFUND, sets REFUND_PROCESSED, promotes passengers
-- for delay/diverted, maintains BOOKING.status, logs to AUDIT_LOG.
-- Handles transaction management via p_manage_tx.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_review_tdr$$
CREATE PROCEDURE sp_review_tdr(
    IN p_tdr_ref_no VARCHAR(32),
    IN p_admin_id INT,
    IN p_decision VARCHAR(20),
    IN p_refund_amount DECIMAL(10,2),
    IN p_remarks TEXT,
    IN p_manage_tx TINYINT(1),
    OUT p_out_refund_id INT,
    OUT p_out_status VARCHAR(32)
)
proc_label: BEGIN
    DECLARE v_admin_user_id INT;
    DECLARE v_pnr VARCHAR(10);
    DECLARE v_passenger_no INT;
    DECLARE v_reason VARCHAR(64);
    DECLARE v_curr_status VARCHAR(20);
    DECLARE v_old_refund_amount DECIMAL(10,2);
    DECLARE v_max_refund DECIMAL(10,2);
    
    DECLARE v_payment_id INT;
    DECLARE v_new_refund_id INT;
    DECLARE v_sched_id INT;
    DECLARE v_cls_id INT;
    DECLARE v_res_status VARCHAR(20);
    DECLARE v_seat_id INT;
    DECLARE v_as_of DATETIME;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        IF p_manage_tx = 1 THEN
            ROLLBACK;
        END IF;
        SET p_out_refund_id = NULL;
        SET p_out_status = 'FAILED';
    END;

    IF p_manage_tx = 1 THEN
        START TRANSACTION;
    END IF;

    SET v_as_of = COALESCE(@as_of_time, NOW());

    -- 1. Check admin exists
    SELECT user_id INTO v_admin_user_id
    FROM ADMIN
    WHERE admin_id = p_admin_id;

    IF v_admin_user_id IS NULL THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_refund_id = NULL;
        SET p_out_status = 'FORBIDDEN';
        LEAVE proc_label;
    END IF;

    -- 2. Validate decision
    IF p_decision NOT IN ('APPROVED', 'REJECTED') THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_refund_id = NULL;
        SET p_out_status = 'INVALID_DECISION';
        LEAVE proc_label;
    END IF;

    -- 3. Lock and retrieve TDR row
    SELECT pnr, passenger_no, reason, status, refund_amount
    INTO v_pnr, v_passenger_no, v_reason, v_curr_status, v_old_refund_amount
    FROM TDR_FILING
    WHERE tdr_ref_no = p_tdr_ref_no
    FOR UPDATE;

    IF v_pnr IS NULL THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_refund_id = NULL;
        SET p_out_status = 'NOT_FOUND';
        LEAVE proc_label;
    END IF;

    -- Can only review FILED or UNDER_REVIEW
    IF v_curr_status NOT IN ('FILED', 'UNDER_REVIEW') THEN
        IF p_manage_tx = 1 THEN ROLLBACK; END IF;
        SET p_out_refund_id = NULL;
        SET p_out_status = 'ALREADY_REVIEWED';
        LEAVE proc_label;
    END IF;

    -- 4. Get passenger fare line (total_fare - insurance)
    IF v_passenger_no IS NOT NULL THEN
        SELECT (total_fare - insurance) INTO v_max_refund
        FROM PASSENGER_BOOKING
        WHERE pnr = v_pnr AND passenger_no = v_passenger_no;
    ELSE
        SELECT SUM(total_fare - insurance) INTO v_max_refund
        FROM PASSENGER_BOOKING
        WHERE pnr = v_pnr;
    END IF;

    IF p_decision = 'APPROVED' THEN
        -- Re-check current reservation status with the same eligibility rules as sp_file_tdr
        IF v_passenger_no IS NOT NULL THEN
            SELECT b.schedule_id, b.class_id, r.status, r.seat_id
            INTO v_sched_id, v_cls_id, v_res_status, v_seat_id
            FROM BOOKING b
            JOIN RESERVATION r ON b.pnr = r.pnr
            WHERE b.pnr = v_pnr AND r.passenger_no = v_passenger_no
            LIMIT 1;

            IF v_res_status IS NULL THEN
                IF p_manage_tx = 1 THEN ROLLBACK; END IF;
                SET p_out_refund_id = NULL;
                SET p_out_status = 'NOT_FOUND';
                LEAVE proc_label;
            END IF;

            IF v_reason IN ('TRAIN_DELAYED_OVER_3_HOURS', 'TRAIN_DIVERTED') THEN
                IF v_res_status NOT IN ('CONFIRMED', 'RAC') THEN
                    IF p_manage_tx = 1 THEN ROLLBACK; END IF;
                    SET p_out_refund_id = NULL;
                    SET p_out_status = 'NOT_ELIGIBLE';
                    LEAVE proc_label;
                END IF;
            ELSE
                IF v_res_status NOT IN ('CONFIRMED', 'RAC', 'BOARDED') THEN
                    IF p_manage_tx = 1 THEN ROLLBACK; END IF;
                    SET p_out_refund_id = NULL;
                    SET p_out_status = 'NOT_ELIGIBLE';
                    LEAVE proc_label;
                END IF;
            END IF;
        END IF;

        -- Check refund amount
        IF p_refund_amount IS NULL OR p_refund_amount <= 0 OR p_refund_amount > v_max_refund THEN
            IF p_manage_tx = 1 THEN ROLLBACK; END IF;
            SET p_out_refund_id = NULL;
            SET p_out_status = 'INVALID_REFUND_AMOUNT';
            LEAVE proc_label;
        END IF;

        -- Find original successful payment (never a late payment that was already refunded)
        SET v_payment_id = fn_pick_refund_payment(v_pnr);

        IF v_payment_id IS NULL THEN
            IF p_manage_tx = 1 THEN ROLLBACK; END IF;
            SET p_out_refund_id = NULL;
            SET p_out_status = 'FAILED';
            LEAVE proc_label;
        END IF;

        -- Refund cap: total refunds on this payment may never be more than was paid.
        -- Choice here: refuse (the admin can approve a smaller amount); the amount is never changed silently.
        IF p_refund_amount > fn_refund_room(v_payment_id) THEN
            IF p_manage_tx = 1 THEN ROLLBACK; END IF;
            SET p_out_refund_id = NULL;
            SET p_out_status = 'REFUND_EXCEEDS_PAYMENT';
            LEAVE proc_label;
        END IF;

        -- Insert REFUND row (refund_id is AUTO_INCREMENT)
        INSERT INTO REFUND (cancel_id, tdr_ref_no, payment_id, amount, reason, status)
        VALUES (NULL, p_tdr_ref_no, v_payment_id, p_refund_amount, 'TDR_APPROVED', 'PENDING');
        SET v_new_refund_id = LAST_INSERT_ID();

        -- Set TDR status to REFUND_PROCESSED
        UPDATE TDR_FILING
        SET status = 'REFUND_PROCESSED',
            refund_amount = p_refund_amount,
            reviewed_by = p_admin_id,
            reviewed_at = v_as_of,
            remarks = COALESCE(p_remarks, remarks)
        WHERE tdr_ref_no = p_tdr_ref_no;

        -- ONLY for delay or diverted TDRs: set reservation CANCELLED with seat NULL and call sp_promote_passenger
        IF v_reason IN ('TRAIN_DELAYED_OVER_3_HOURS', 'TRAIN_DIVERTED') THEN
            UPDATE RESERVATION
            SET status = 'CANCELLED',
                seat_id = NULL,
                queue_position = NULL
            WHERE pnr = v_pnr AND passenger_no = v_passenger_no;

            -- Promote passenger
            IF v_res_status = 'CONFIRMED' AND v_seat_id IS NOT NULL THEN
                CALL sp_promote_passenger(v_sched_id, v_cls_id, v_seat_id);
            ELSEIF v_res_status = 'RAC' THEN
                CALL sp_promote_passenger(v_sched_id, v_cls_id, NULL);
            END IF;

            -- Keep BOOKING.status consistent the way sp_cancel_passenger_ticket does
            IF NOT EXISTS (
                SELECT 1 FROM RESERVATION WHERE pnr = v_pnr AND status != 'CANCELLED'
            ) THEN
                UPDATE BOOKING SET status = 'CANCELLED' WHERE pnr = v_pnr;
            END IF;
        END IF;

        -- Write to AUDIT_LOG (BR-T7)
        INSERT INTO AUDIT_LOG (user_id, action, table_name, record_id, old_value, new_value, logged_at)
        VALUES (
            v_admin_user_id,
            'TDR_REVIEW',
            'TDR_FILING',
            p_tdr_ref_no,
            JSON_OBJECT('status', v_curr_status, 'refund_amount', v_old_refund_amount),
            JSON_OBJECT('status', 'REFUND_PROCESSED', 'refund_amount', p_refund_amount, 'refund_id', v_new_refund_id, 'reviewed_by', p_admin_id),
            v_as_of
        );

        IF p_manage_tx = 1 THEN
            COMMIT;
        END IF;

        SET p_out_refund_id = v_new_refund_id;
        SET p_out_status = 'APPROVED';

    ELSE
        -- Decision is REJECTED
        UPDATE TDR_FILING
        SET status = 'REJECTED',
            refund_amount = 0.00,
            reviewed_by = p_admin_id,
            reviewed_at = v_as_of,
            remarks = COALESCE(p_remarks, remarks)
        WHERE tdr_ref_no = p_tdr_ref_no;

        -- Write to AUDIT_LOG (BR-T7)
        INSERT INTO AUDIT_LOG (user_id, action, table_name, record_id, old_value, new_value, logged_at)
        VALUES (
            v_admin_user_id,
            'TDR_REVIEW',
            'TDR_FILING',
            p_tdr_ref_no,
            JSON_OBJECT('status', v_curr_status, 'refund_amount', v_old_refund_amount),
            JSON_OBJECT('status', 'REJECTED', 'refund_amount', 0.00, 'reviewed_by', p_admin_id),
            v_as_of
        );

        IF p_manage_tx = 1 THEN
            COMMIT;
        END IF;

        SET p_out_refund_id = NULL;
        SET p_out_status = 'REJECTED';
    END IF;

END proc_label$$

-- -----------------------------------------------------------------------------
-- 12. sp_set_refund_result
-- The ONLY way a REFUND status changes after the row is created. Node calls it after
-- the Razorpay call. A refund has a real life:
--   PENDING (row created)  ->  PROCESSED (gateway done)  or  FAILED (gateway failed)
--   FAILED  (can be retried) ->  PROCESSED  or  FAILED again
-- Everything else (PROCESSED to anything, PENDING to PENDING, unknown status) is
-- INVALID_TRANSITION and nothing is changed. Each accepted call counts one attempt.
-- p_status_out: the new status, or INVALID_TRANSITION, or NOT_FOUND.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_set_refund_result$$
CREATE PROCEDURE sp_set_refund_result(
    IN p_refund_id INT,
    IN p_status VARCHAR(20),
    IN p_gateway_refund_id VARCHAR(40),
    IN p_failure_reason VARCHAR(255),
    OUT p_status_out VARCHAR(32)
)
proc_label: BEGIN
    DECLARE v_cur VARCHAR(20) DEFAULT NULL;
    DECLARE v_now DATETIME;

    SET v_now = COALESCE(@as_of_time, NOW());

    SELECT status INTO v_cur FROM REFUND WHERE refund_id = p_refund_id FOR UPDATE;

    IF v_cur IS NULL THEN
        SET p_status_out = 'NOT_FOUND';
        LEAVE proc_label;
    END IF;

    IF NOT (
        (v_cur = 'PENDING' AND p_status IN ('PROCESSED', 'FAILED'))
        OR (v_cur = 'FAILED' AND p_status IN ('PROCESSED', 'FAILED'))
    ) THEN
        SET p_status_out = 'INVALID_TRANSITION';
        LEAVE proc_label;
    END IF;

    UPDATE REFUND
    SET status = p_status,
        gateway_refund_id = COALESCE(p_gateway_refund_id, gateway_refund_id),
        failure_reason = LEFT(p_failure_reason, 255),
        attempts = attempts + 1,
        last_attempt_at = v_now,
        processed_at = IF(p_status = 'PROCESSED', v_now, processed_at)
    WHERE refund_id = p_refund_id;

    SET p_status_out = p_status;
END proc_label$$

-- -----------------------------------------------------------------------------
-- 13. sp_set_payment_order_result
-- The ONLY way a PAYMENT_ORDER status changes. Allowed: CREATED -> PAID, CREATED -> LATE_PAID,
-- CREATED -> FAILED, CREATED -> EXPIRED (the hold ended unpaid) and EXPIRED -> PAID or LATE_PAID (a payment
-- still arrived inside the 24 hour check window). FAILED is final. Everything else is INVALID_TRANSITION (including a repeat of the same
-- status), unknown order is NOT_FOUND. PAID and LATE_PAID set paid_at and keep the gateway payment id.
-- p_status_out: the new status, INVALID_TRANSITION or NOT_FOUND.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_set_payment_order_result$$
CREATE PROCEDURE sp_set_payment_order_result(
    IN p_order_id VARCHAR(40),
    IN p_status VARCHAR(20),
    IN p_gateway_payment_id VARCHAR(40),
    OUT p_status_out VARCHAR(32)
)
proc_label: BEGIN
    DECLARE v_cur VARCHAR(20) DEFAULT NULL;
    DECLARE v_now DATETIME;

    SET v_now = COALESCE(@as_of_time, NOW());

    SELECT status INTO v_cur FROM PAYMENT_ORDER WHERE order_id = p_order_id FOR UPDATE;

    IF v_cur IS NULL THEN
        SET p_status_out = 'NOT_FOUND';
        LEAVE proc_label;
    END IF;

    IF NOT (   (v_cur = 'CREATED' AND p_status IN ('PAID', 'LATE_PAID', 'FAILED', 'EXPIRED'))
            OR (v_cur = 'EXPIRED' AND p_status IN ('PAID', 'LATE_PAID'))) THEN
        SET p_status_out = 'INVALID_TRANSITION';
        LEAVE proc_label;
    END IF;

    UPDATE PAYMENT_ORDER
    SET status = p_status,
        gateway_payment_id = COALESCE(p_gateway_payment_id, gateway_payment_id),
        paid_at = IF(p_status IN ('PAID', 'LATE_PAID'), v_now, paid_at),
        last_checked_at = v_now
    WHERE order_id = p_order_id;

    SET p_status_out = p_status;
END proc_label$$

DELIMITER ;
