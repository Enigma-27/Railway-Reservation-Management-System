-- =============================================================================
-- Railway Reservation & Management System (MySQL 8.0)
-- File: 02_functions.sql
-- Description: User-defined functions for:
--   1. fn_calculate_distance (distance in km between two route stops)
--   2. fn_calculate_fare (detailed fare calculation per Section 6)
--   3. fn_check_monthly_ticket_limit (check 12 vs 24 monthly PNR limit)
--   4. fn_get_user_monthly_ticket_count (count valid PNRs in a calendar month)
--   5. fn_calculate_cancellation_refund (work out deduction and refund slab)
-- =============================================================================

USE railway_db;

DELIMITER $$

-- -----------------------------------------------------------------------------
-- 1. fn_calculate_distance
-- Calculates chargeable distance between boarding and destination route stops.
-- Enforces minimum chargeable distance of 100 km (BR-F1).
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_calculate_distance$$
CREATE FUNCTION fn_calculate_distance(
    p_from_stop_id INT,
    p_to_stop_id INT
)
RETURNS INT
DETERMINISTIC
READS SQL DATA
BEGIN
    DECLARE v_from_dist INT DEFAULT 0;
    DECLARE v_to_dist INT DEFAULT 0;
    DECLARE v_dist INT DEFAULT 0;
    DECLARE v_min_km INT DEFAULT 100;

    SELECT distance_from_origin INTO v_from_dist FROM ROUTE_STOP WHERE stop_id = p_from_stop_id;
    SELECT distance_from_origin INTO v_to_dist FROM ROUTE_STOP WHERE stop_id = p_to_stop_id;

    SET v_dist = ABS(v_to_dist - v_from_dist);

    SELECT CAST(setting_value AS SIGNED) INTO v_min_km
    FROM SETTING
    WHERE setting_key IN ('MIN_CHARGEABLE_DISTANCE_KM', 'MIN_CHARGEABLE_KM')
    ORDER BY (setting_key = 'MIN_CHARGEABLE_DISTANCE_KM') DESC
    LIMIT 1; -- seed key is MIN_CHARGEABLE_DISTANCE_KM; the old name is only a fallback

    IF v_dist < v_min_km THEN
        SET v_dist = v_min_km;
    END IF;

    RETURN v_dist;
END$$

-- -----------------------------------------------------------------------------
-- 2. fn_get_user_monthly_ticket_count
-- Counts how many valid tickets (PNRs) a user created in the same calendar month.
-- Excludes FAILED bookings and shared COUNTER_WALKIN (BR-B15).
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_get_user_monthly_ticket_count$$
CREATE FUNCTION fn_get_user_monthly_ticket_count(
    p_user_id INT,
    p_booking_date DATETIME
)
RETURNS INT
READS SQL DATA
BEGIN
    DECLARE v_count INT DEFAULT 0;

    -- Shared COUNTER_WALKIN account is exempt (BR-B15). It is the fixed seed user 50008
    -- (USER_ACCOUNT.csv, full_name COUNTER_WALKIN). It is on purpose: all walk-in counter
    -- tickets are booked under this one account, so a monthly cap would block the counter.
    IF p_user_id = 50008 THEN
        RETURN 0;
    END IF;

    SELECT COUNT(*) INTO v_count
    FROM BOOKING
    WHERE user_id = p_user_id
      AND YEAR(created_at) = YEAR(p_booking_date)
      AND MONTH(created_at) = MONTH(p_booking_date)
      AND status != 'FAILED';

    RETURN v_count;
END$$

-- -----------------------------------------------------------------------------
-- 3. fn_check_monthly_ticket_limit
-- Returns 1 if user can book, 0 if MONTHLY_LIMIT_EXCEEDED (12 or 24 if Aadhaar verified).
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_check_monthly_ticket_limit$$
CREATE FUNCTION fn_check_monthly_ticket_limit(
    p_user_id INT,
    p_booking_date DATETIME
)
RETURNS TINYINT(1)
READS SQL DATA
BEGIN
    DECLARE v_aadhaar_verified TINYINT(1) DEFAULT 0;
    DECLARE v_max_limit INT DEFAULT 12;
    DECLARE v_current_count INT DEFAULT 0;

    IF p_user_id = 50008 THEN
        RETURN 1; -- COUNTER_WALKIN exempt on purpose (see fn_get_user_monthly_ticket_count)
    END IF;

    SELECT aadhaar_verified INTO v_aadhaar_verified
    FROM USER_ACCOUNT
    WHERE user_id = p_user_id;

    IF v_aadhaar_verified = 1 THEN
        SELECT CAST(setting_value AS SIGNED) INTO v_max_limit
        FROM SETTING WHERE setting_key = 'MAX_TICKETS_PER_MONTH_AADHAAR_VERIFIED';
        IF v_max_limit IS NULL THEN SET v_max_limit = 24; END IF;
    ELSE
        SELECT CAST(setting_value AS SIGNED) INTO v_max_limit
        FROM SETTING WHERE setting_key = 'MAX_TICKETS_PER_MONTH';
        IF v_max_limit IS NULL THEN SET v_max_limit = 12; END IF;
    END IF;

    SET v_current_count = fn_get_user_monthly_ticket_count(p_user_id, p_booking_date);

    IF v_current_count >= v_max_limit THEN
        RETURN 0;
    END IF;

    RETURN 1;
END$$

-- -----------------------------------------------------------------------------
-- 3a. fn_get_setting
-- Reads one SETTING value as text, or the given default when the key is missing.
-- Used by fn_calculate_fare and fn_calculate_cancellation_refund so the admin can change the values.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_get_setting$$
CREATE FUNCTION fn_get_setting(
    p_key VARCHAR(64),
    p_default VARCHAR(255)
)
RETURNS VARCHAR(255)
READS SQL DATA
BEGIN
    DECLARE v_value VARCHAR(255) DEFAULT NULL;
    SELECT setting_value INTO v_value FROM SETTING WHERE setting_key = p_key;
    RETURN COALESCE(v_value, p_default);
END$$

-- -----------------------------------------------------------------------------
-- 3b. fn_setting_value_valid
-- 1 if the value is allowed for the key, 0 if it would break the money maths.
-- Used by the SETTING triggers (trg_validate_setting_insert / _update). Keys not listed accept any text.
--   GST_RATE_AC                      number from 0 to 1 (0.05 = 5 percent)
--   INSURANCE_PREMIUM_PER_PASSENGER  number from 0 to 10000
--   CLERKAGE_PER_PASSENGER           number from 0 to 10000
--   DYNAMIC_FARE_ENABLED, CONCESSION_SENIOR_ENABLED   true or false
--   MIN_CHARGEABLE_DISTANCE_KM       whole number from 0 to 10000
--   BOOKING_WINDOW_DAYS              whole number from 0 to 365
--   HOLD_MINUTES                     whole number from 1 to 1440
--   SENIOR_AGE_MALE, SENIOR_AGE_FEMALE   whole number from 1 to 120
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_setting_value_valid$$
CREATE FUNCTION fn_setting_value_valid(
    p_key VARCHAR(64),
    p_value VARCHAR(255)
)
RETURNS TINYINT(1)
DETERMINISTIC
BEGIN
    DECLARE v_num DECIMAL(20,6);
    IF p_value IS NULL THEN RETURN 0; END IF;

    IF p_key IN ('DYNAMIC_FARE_ENABLED', 'CONCESSION_SENIOR_ENABLED') THEN
        RETURN IF(p_value IN ('true', 'false'), 1, 0);
    END IF;

    IF p_key IN ('GST_RATE_AC', 'INSURANCE_PREMIUM_PER_PASSENGER', 'CLERKAGE_PER_PASSENGER') THEN
        IF p_value NOT REGEXP '^[0-9]{1,10}(\\.[0-9]{1,6})?$' THEN RETURN 0; END IF;
        SET v_num = CAST(p_value AS DECIMAL(20,6));
        IF p_key = 'GST_RATE_AC' THEN RETURN IF(v_num <= 1, 1, 0); END IF;
        RETURN IF(v_num <= 10000, 1, 0);
    END IF;

    IF p_key IN ('SENIOR_AGE_MALE', 'SENIOR_AGE_FEMALE') THEN
        IF p_value NOT REGEXP '^[0-9]{1,3}$' THEN RETURN 0; END IF;
        RETURN IF(CAST(p_value AS UNSIGNED) BETWEEN 1 AND 120, 1, 0);
    END IF;

    IF p_key IN ('MIN_CHARGEABLE_DISTANCE_KM', 'BOOKING_WINDOW_DAYS', 'HOLD_MINUTES') THEN
        IF p_value NOT REGEXP '^[0-9]{1,6}$' THEN RETURN 0; END IF;
        SET v_num = CAST(p_value AS DECIMAL(20,6));
        IF p_key = 'MIN_CHARGEABLE_DISTANCE_KM' THEN RETURN IF(v_num <= 10000, 1, 0); END IF;
        IF p_key = 'BOOKING_WINDOW_DAYS' THEN RETURN IF(v_num <= 365, 1, 0); END IF;
        RETURN IF(v_num >= 1 AND v_num <= 1440, 1, 0);
    END IF;

    RETURN 1;
END$$

-- -----------------------------------------------------------------------------
-- 4. fn_calculate_fare
-- Computes passenger fare components per Section 6 (Base, Concession, Res,
-- Superfast, Tatkal, Dynamic, GST, Insurance, Total).
-- Returns JSON object with all components.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_calculate_fare$$
CREATE FUNCTION fn_calculate_fare(
    p_class_id INT,
    p_train_id INT,
    p_distance INT,
    p_quota VARCHAR(20),
    p_concession_type VARCHAR(20),
    p_include_insurance TINYINT(1),
    p_schedule_id INT
)
RETURNS JSON
READS SQL DATA
BEGIN
    DECLARE v_train_type VARCHAR(20);
    DECLARE v_coach_type VARCHAR(10);
    DECLARE v_rate_per_km DECIMAL(6,2) DEFAULT 0.00;
    DECLARE v_base_fare DECIMAL(10,2) DEFAULT 0.00;
    DECLARE v_concession_pct DECIMAL(5,2) DEFAULT 0.00;
    DECLARE v_concession_discount DECIMAL(10,2) DEFAULT 0.00;
    DECLARE v_res_charge DECIMAL(10,2) DEFAULT 0.00;
    DECLARE v_sf_charge DECIMAL(10,2) DEFAULT 0.00;
    DECLARE v_tatkal_charge DECIMAL(10,2) DEFAULT 0.00;
    DECLARE v_dynamic_surcharge DECIMAL(10,2) DEFAULT 0.00;
    DECLARE v_taxable DECIMAL(10,2) DEFAULT 0.00;
    DECLARE v_gst DECIMAL(10,2) DEFAULT 0.00;
    DECLARE v_insurance DECIMAL(10,2) DEFAULT 0.00;
    DECLARE v_total_fare DECIMAL(10,2) DEFAULT 0.00;
    DECLARE v_group VARCHAR(32) DEFAULT 'STANDARD';
    DECLARE v_gst_rate DECIMAL(6,4) DEFAULT 0.0500;
    DECLARE v_ins_premium DECIMAL(10,2) DEFAULT 0.45;
    DECLARE v_total_seats INT DEFAULT 0;
    DECLARE v_avail_seats INT DEFAULT 0;

    -- 1. Identify train type and coach type
    SELECT train_type INTO v_train_type FROM TRAIN WHERE train_id = p_train_id;
    SELECT coach_type INTO v_coach_type FROM SEAT_CLASS WHERE class_id = p_class_id;

    -- 2. Lookup rate per km from FARE slab table
    SELECT rate_per_km INTO v_rate_per_km
    FROM FARE
    WHERE class_id = p_class_id
      AND p_distance >= min_distance_km
      AND (max_distance_km IS NULL OR max_distance_km = 0 OR p_distance <= max_distance_km)
    LIMIT 1;

    IF v_rate_per_km IS NULL THEN
        -- Fallback to default multiplier
        SELECT base_multiplier INTO v_rate_per_km FROM SEAT_CLASS WHERE class_id = p_class_id;
    END IF;

    SET v_base_fare = ROUND(p_distance * v_rate_per_km, 2);

    -- 3. Concession on the base fare, read from CONCESSION_RULE (BR-F6, BR-C1, BR-C2, BR-C5).
    --    Tatkal never gets a concession. Premium trains (Rajdhani, Shatabdi, Duronto, Vande Bharat) use the
    --    PREMIUM rule of the class if there is one, otherwise the STANDARD rule. A rule counts only when
    --    is_active = 1. The senior concession also needs the setting CONCESSION_SENIOR_ENABLED = true.
    SET v_group = IF(v_train_type IN ('RAJDHANI', 'SHATABDI', 'DURONTO', 'VANDE_BHARAT'), 'PREMIUM', 'STANDARD');
    IF p_quota != 'TATKAL' AND p_concession_type IN ('DIVYAANG', 'SENIOR_CITIZEN') THEN
        IF p_concession_type = 'DIVYAANG' OR fn_get_setting('CONCESSION_SENIOR_ENABLED', 'false') = 'true' THEN
            SELECT discount_pct INTO v_concession_pct
            FROM CONCESSION_RULE
            WHERE concession_type = p_concession_type
              AND class_id = p_class_id
              AND is_active = 1
              AND train_group IN (v_group, 'STANDARD')
            ORDER BY (train_group = v_group) DESC
            LIMIT 1;
        END IF;
        SET v_concession_discount = ROUND(v_base_fare * (v_concession_pct / 100.00), 2);
    END IF;

    -- 4. Reservation charge
    CASE p_class_id
        WHEN 7 THEN SET v_res_charge = 15.00; -- 2S
        WHEN 4 THEN SET v_res_charge = 20.00; -- SL
        WHEN 3 THEN SET v_res_charge = 40.00; -- 3A
        WHEN 2 THEN SET v_res_charge = 50.00; -- 2A
        WHEN 1 THEN SET v_res_charge = 60.00; -- 1A
        WHEN 5 THEN SET v_res_charge = 40.00; -- CC
        WHEN 6 THEN SET v_res_charge = 60.00; -- EC
        ELSE SET v_res_charge = 20.00;
    END CASE;

    -- 5. Superfast charge (Rajdhani, Shatabdi, Duronto, Vande Bharat)
    IF v_train_type IN ('RAJDHANI', 'SHATABDI', 'DURONTO', 'VANDE_BHARAT') THEN
        CASE p_class_id
            WHEN 7 THEN SET v_sf_charge = 15.00; -- 2S
            WHEN 4 THEN SET v_sf_charge = 30.00; -- SL
            WHEN 3 THEN SET v_sf_charge = 45.00; -- 3A
            WHEN 2 THEN SET v_sf_charge = 45.00; -- 2A
            WHEN 1 THEN SET v_sf_charge = 75.00; -- 1A
            WHEN 5 THEN SET v_sf_charge = 45.00; -- CC
            WHEN 6 THEN SET v_sf_charge = 75.00; -- EC
            ELSE SET v_sf_charge = 30.00;
        END CASE;
    END IF;

    -- 6. Tatkal charge (30% AC, 10% non-AC of base fare)
    IF p_quota = 'TATKAL' THEN
        IF v_coach_type = 'AC' THEN
            SET v_tatkal_charge = ROUND(v_base_fare * 0.30, 2);
        ELSE
            SET v_tatkal_charge = ROUND(v_base_fare * 0.10, 2);
        END IF;
    END IF;

    -- 6a. Dynamic Tatkal fare (BR-F11): only when DYNAMIC_FARE_ENABLED = true, only for TATKAL, and only when
    --     80 percent or more of the confirmed seats of the run and class are already booked.
    --     Surcharge = base fare x 0.5 (the 80 percent and the 1.5 multiplier are fixed by the business rules).
    IF p_quota = 'TATKAL' AND fn_get_setting('DYNAMIC_FARE_ENABLED', 'false') = 'true' THEN
        SELECT total_seats, available_seats INTO v_total_seats, v_avail_seats
        FROM SCHEDULE_CLASS_INVENTORY
        WHERE schedule_id = p_schedule_id AND class_id = p_class_id;
        IF v_total_seats > 0 AND (v_total_seats - v_avail_seats) * 100 >= v_total_seats * 80 THEN
            SET v_dynamic_surcharge = ROUND(v_base_fare * 0.5, 2);
        END IF;
    END IF;

    -- 7. Taxable Amount
    SET v_taxable = (v_base_fare - v_concession_discount) + v_res_charge + v_sf_charge + v_tatkal_charge + v_dynamic_surcharge;

    -- 8. GST on AC classes, rate from SETTING GST_RATE_AC (0.05 = 5%)
    SET v_gst_rate = CAST(fn_get_setting('GST_RATE_AC', '0.05') AS DECIMAL(6,4));
    IF v_coach_type = 'AC' THEN
        SET v_gst = ROUND(v_taxable * v_gst_rate, 2);
    ELSE
        SET v_gst = 0.00;
    END IF;

    -- 9. Optional insurance premium, from SETTING INSURANCE_PREMIUM_PER_PASSENGER (0.45 flat)
    SET v_ins_premium = CAST(fn_get_setting('INSURANCE_PREMIUM_PER_PASSENGER', '0.45') AS DECIMAL(10,2));
    IF p_include_insurance = 1 THEN
        SET v_insurance = v_ins_premium;
    ELSE
        SET v_insurance = 0.00;
    END IF;

    -- 10. Total fare
    SET v_total_fare = ROUND(v_taxable + v_gst + v_insurance, 2);

    RETURN JSON_OBJECT(
        'base_fare', v_base_fare,
        'concession_discount', v_concession_discount,
        'reservation_charge', v_res_charge,
        'superfast_charge', v_sf_charge,
        'tatkal_charge', v_tatkal_charge,
        'dynamic_surcharge', v_dynamic_surcharge,
        'gst', v_gst,
        'insurance', v_insurance,
        'total_fare', v_total_fare
    );
END$$

-- -----------------------------------------------------------------------------
-- 5. fn_calculate_cancellation_refund
-- Computes cancellation deduction charge and net refund amount per Section 8.
-- Returns JSON with charge and refund_amount.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_calculate_cancellation_refund$$
CREATE FUNCTION fn_calculate_cancellation_refund(
    p_pnr VARCHAR(10),
    p_passenger_no INT,
    p_cancellation_time DATETIME
)
RETURNS JSON
READS SQL DATA
BEGIN
    DECLARE v_status VARCHAR(20);
    DECLARE v_quota VARCHAR(20);
    DECLARE v_class_id INT;
    DECLARE v_schedule_id INT;
    DECLARE v_total_fare DECIMAL(10,2);
    DECLARE v_insurance DECIMAL(10,2);
    DECLARE v_dep_date DATE;
    DECLARE v_dep_time TIME;
    DECLARE v_origin_departure DATETIME;
    DECLARE v_hours_left DECIMAL(10,2);
    DECLARE v_charge DECIMAL(10,2) DEFAULT 0.00;
    DECLARE v_refund DECIMAL(10,2) DEFAULT 0.00;
    DECLARE v_flat_min DECIMAL(10,2) DEFAULT 0.00;
    DECLARE v_deduction_pct DECIMAL(5,2) DEFAULT 0.00;
    DECLARE v_clerkage DECIMAL(10,2) DEFAULT 60.00;
    DECLARE v_eligible_fare DECIMAL(10,2) DEFAULT 0.00;
    DECLARE v_rule_pct DECIMAL(5,2) DEFAULT NULL;
    DECLARE v_rule_flat DECIMAL(8,2) DEFAULT NULL;

    -- Retrieve booking & passenger info
    SELECT b.schedule_id, b.class_id, b.quota, pb.total_fare, pb.insurance, r.status
    INTO v_schedule_id, v_class_id, v_quota, v_total_fare, v_insurance, v_status
    FROM BOOKING b
    JOIN PASSENGER_BOOKING pb ON b.pnr = pb.pnr
    JOIN RESERVATION r ON pb.pnr = r.pnr AND pb.passenger_no = r.passenger_no
    WHERE b.pnr = p_pnr AND pb.passenger_no = p_passenger_no;

    -- Origin departure datetime
    SELECT journey_date, departure_time
    INTO v_dep_date, v_dep_time
    FROM TRAIN_SCHEDULE
    WHERE schedule_id = v_schedule_id;

    SET v_origin_departure = TIMESTAMP(v_dep_date, v_dep_time);
    IF p_cancellation_time IS NOT NULL THEN
        SET v_hours_left = TIMESTAMPDIFF(MINUTE, p_cancellation_time, v_origin_departure) / 60.0;
    ELSEIF @as_of_time IS NOT NULL THEN
        SET v_hours_left = TIMESTAMPDIFF(MINUTE, @as_of_time, v_origin_departure) / 60.0;
    ELSE
        SET v_hours_left = TIMESTAMPDIFF(MINUTE, NOW(), v_origin_departure) / 60.0;
    END IF;
    SET v_eligible_fare = v_total_fare - v_insurance; -- Insurance never refunded on voluntary cancel

    -- Rule BR-R6: Confirmed Tatkal tickets get no refund
    IF v_quota = 'TATKAL' AND v_status = 'CONFIRMED' THEN
        SET v_charge = v_eligible_fare;
        SET v_refund = 0.00;
        RETURN JSON_OBJECT('charge', v_charge, 'refund_amount', v_refund);
    END IF;

    -- Rule BR-R5: RAC and WL passengers get full refund minus clerkage
    IF v_status IN ('RAC', 'WAITING_LIST') THEN
        SELECT CAST(setting_value AS DECIMAL(10,2)) INTO v_clerkage
        FROM SETTING WHERE setting_key = 'CLERKAGE_PER_PASSENGER';
        IF v_clerkage IS NULL THEN SET v_clerkage = 60.00; END IF;

        IF v_eligible_fare > v_clerkage THEN
            SET v_charge = v_clerkage;
            SET v_refund = v_eligible_fare - v_clerkage;
        ELSE
            SET v_charge = v_eligible_fare;
            SET v_refund = 0.00;
        END IF;
        RETURN JSON_OBJECT('charge', v_charge, 'refund_amount', v_refund);
    END IF;

    -- Rule BR-R1: refund slab by hours before origin departure, read from REFUND_RULE.
    -- The slab is the rule with the highest min_hours that the time has reached (the top slab, which has no
    -- max_hours, needs the time to be strictly above its min_hours). A rule for the ticket's class beats a
    -- general rule (class_id NULL) of the same slab. Before the first slab (time already past departure) the
    -- lowest slab applies.
    SELECT deduction_pct, flat_min_charge INTO v_rule_pct, v_rule_flat
    FROM REFUND_RULE
    WHERE (class_id = v_class_id OR class_id IS NULL)
      AND (v_hours_left > min_hours OR (max_hours IS NOT NULL AND v_hours_left >= min_hours))
    ORDER BY min_hours DESC, (class_id IS NOT NULL) DESC
    LIMIT 1;

    IF v_rule_pct IS NULL THEN
        SELECT deduction_pct, flat_min_charge INTO v_rule_pct, v_rule_flat
        FROM REFUND_RULE
        WHERE class_id = v_class_id OR class_id IS NULL
        ORDER BY min_hours ASC, (class_id IS NOT NULL) DESC
        LIMIT 1;
    END IF;

    -- The charge is the larger of the flat minimum and the percentage of the fare, never more than the fare
    SET v_charge = GREATEST(ROUND(v_eligible_fare * (COALESCE(v_rule_pct, 100.00) / 100.00), 2), COALESCE(v_rule_flat, 0.00));

    IF v_charge > v_eligible_fare THEN
        SET v_charge = v_eligible_fare;
    END IF;

    SET v_refund = ROUND(v_eligible_fare - v_charge, 2);

    RETURN JSON_OBJECT('charge', v_charge, 'refund_amount', v_refund);
END$$

-- -----------------------------------------------------------------------------
-- 6. fn_pick_refund_payment
-- The payment a refund must be booked against: the latest SUCCESS payment of the
-- PNR that is NOT itself a "payment after expiry" (BR-B14). A late payment is
-- already refunded in full, so cancellations and TDR refunds must never use it.
-- Returns NULL when the PNR has no such payment.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_pick_refund_payment$$
CREATE FUNCTION fn_pick_refund_payment(
    p_pnr VARCHAR(10)
)
RETURNS INT
READS SQL DATA
BEGIN
    DECLARE v_payment_id INT DEFAULT NULL;

    SELECT p.payment_id INTO v_payment_id
    FROM PAYMENT p
    WHERE p.pnr = p_pnr
      AND p.status = 'SUCCESS'
      AND NOT EXISTS (
          SELECT 1 FROM REFUND r
          WHERE r.payment_id = p.payment_id AND r.reason = 'PAYMENT_AFTER_EXPIRY'
      )
    ORDER BY p.paid_at DESC, p.payment_id DESC
    LIMIT 1;

    RETURN v_payment_id;
END$$

-- -----------------------------------------------------------------------------
-- 7. fn_refund_room
-- How much more can still be refunded on a payment: amount paid minus the refund
-- rows already written for it. PENDING, PROCESSED and FAILED all count: a FAILED
-- refund is still owed to the passenger and will be retried.
-- Only refunds that belong to the payment's own PNR are counted: the cancellation or
-- TDR behind a refund must be for the same PNR as the payment. (The seed data has
-- refund rows attached to another PNR's payment; those are not refunds of this payment.)
-- Used by the refund cap checks (never refund more than was paid).
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_refund_room$$
CREATE FUNCTION fn_refund_room(
    p_payment_id INT
)
RETURNS DECIMAL(10,2)
READS SQL DATA
BEGIN
    DECLARE v_paid DECIMAL(10,2) DEFAULT NULL;
    DECLARE v_pnr VARCHAR(10) DEFAULT NULL;
    DECLARE v_refunded DECIMAL(10,2) DEFAULT 0.00;

    SELECT amount, pnr INTO v_paid, v_pnr FROM PAYMENT WHERE payment_id = p_payment_id;
    IF v_paid IS NULL THEN
        RETURN 0.00;
    END IF;

    SELECT COALESCE(SUM(r.amount), 0.00) INTO v_refunded
    FROM REFUND r
    LEFT JOIN CANCELLATION c ON c.cancel_id = r.cancel_id
    LEFT JOIN TDR_FILING t ON t.tdr_ref_no = r.tdr_ref_no
    WHERE r.payment_id = p_payment_id
      AND COALESCE(c.pnr, t.pnr, v_pnr) = v_pnr;

    RETURN GREATEST(0.00, v_paid - v_refunded);
END$$

DELIMITER ;
