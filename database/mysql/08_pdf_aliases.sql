-- =============================================================================
-- Railway Reservation & Management System (MySQL 8.0)
-- File: 08_pdf_aliases.sql   (OPTIONAL)
--
-- What this is
--   Five thin objects that carry the NAMES used in the PBL PDF, for an examiner
--   who insists on exact names. They only read data or CALL the real procedures.
--   They add NO business rule, NO trigger, NO second promotion path and NO second
--   refund or fare logic.
--
--     v_active_staff                 view       active staff with their login details (read-only)
--     v_tc_reservation_chart         view       passenger chart rows per run (read-only)
--     sp_check_seat_segment_overlap  procedure  is a seat taken for a run and stop range (read-only,
--                                               same rule as trigger trg_check_seat_overlap)
--     sp_cancel_and_promote_rac      procedure  only CALLs sp_cancel_passenger_ticket (promotion still
--                                               happens through trg_after_cancellation_promote and
--                                               sp_promote_passenger)
--     sp_mark_boarding_status        procedure  only CALLs sp_board_passenger or sp_mark_passenger_noshow
--
-- This file is NOT run by database/load/run-all.js.
-- Apply:   node database/load/apply-sql.js 08_pdf_aliases
-- Remove:  node database/load/apply-sql.js 08_pdf_aliases_drop
--          (or run these statements by hand)
--            DROP VIEW      IF EXISTS v_active_staff;
--            DROP VIEW      IF EXISTS v_tc_reservation_chart;
--            DROP PROCEDURE IF EXISTS sp_check_seat_segment_overlap;
--            DROP PROCEDURE IF EXISTS sp_cancel_and_promote_rac;
--            DROP PROCEDURE IF EXISTS sp_mark_boarding_status;
-- Mapping of all 12 PDF names: docs/PBL_NAME_MAPPING.md
-- =============================================================================

USE railway_db;

-- -----------------------------------------------------------------------------
-- v_active_staff: staff members whose staff row and user account are both ACTIVE
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_active_staff AS
SELECT
    s.staff_id,
    s.employee_no,
    u.full_name,
    s.designation,
    u.email,
    u.phone,
    s.status AS staff_status,
    u.account_status
FROM STAFF s
JOIN USER_ACCOUNT u ON u.user_id = s.user_id
WHERE s.status = 'ACTIVE' AND u.account_status = 'ACTIVE';

-- -----------------------------------------------------------------------------
-- v_tc_reservation_chart: the reservation chart a ticket collector reads, one row
-- per passenger who holds a seat or berth (CONFIRMED, RAC, BOARDED, NO_SHOW)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_tc_reservation_chart AS
SELECT
    r.schedule_id,
    t.train_number,
    ts.journey_date,
    c.coach_code,
    se.seat_number,
    se.berth_type,
    pb.name AS passenger_name,
    pb.age,
    pb.gender,
    r.status AS reservation_status,
    b.pnr,
    sf.station_code AS from_station,
    st.station_code AS to_station
FROM RESERVATION r
JOIN BOOKING b ON b.pnr = r.pnr
JOIN PASSENGER_BOOKING pb ON pb.pnr = r.pnr AND pb.passenger_no = r.passenger_no
JOIN TRAIN_SCHEDULE ts ON ts.schedule_id = r.schedule_id
JOIN TRAIN t ON t.train_id = ts.train_id
JOIN SEAT se ON se.seat_id = r.seat_id
JOIN COACH c ON c.coach_id = se.coach_id
JOIN ROUTE_STOP rf ON rf.stop_id = b.from_stop_id
JOIN ROUTE_STOP rt ON rt.stop_id = b.to_stop_id
JOIN STATION sf ON sf.station_id = rf.station_id
JOIN STATION st ON st.station_id = rt.station_id
WHERE r.status IN ('CONFIRMED', 'RAC', 'BOARDED', 'NO_SHOW');

DELIMITER $$

-- -----------------------------------------------------------------------------
-- sp_check_seat_segment_overlap (read-only)
-- Same rule as trg_check_seat_overlap: two segments overlap when
--   GREATEST(start A, start B) < LEAST(end A, end B)   (stop sequence numbers)
-- and only CONFIRMED and BOARDED reservations hold a seat for the whole segment.
-- OUT p_overlap_count: how many such reservations block the seat. OUT p_seat_taken: 1 when that is more than 0.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_check_seat_segment_overlap$$
CREATE PROCEDURE sp_check_seat_segment_overlap(
    IN p_schedule_id INT,
    IN p_seat_id INT,
    IN p_from_stop_id INT,
    IN p_to_stop_id INT,
    OUT p_overlap_count INT,
    OUT p_seat_taken TINYINT(1)
)
BEGIN
    DECLARE v_from_seq INT;
    DECLARE v_to_seq INT;

    SELECT stop_sequence INTO v_from_seq FROM ROUTE_STOP WHERE stop_id = p_from_stop_id;
    SELECT stop_sequence INTO v_to_seq FROM ROUTE_STOP WHERE stop_id = p_to_stop_id;

    SELECT COUNT(*) INTO p_overlap_count
    FROM RESERVATION r
    JOIN BOOKING b ON b.pnr = r.pnr
    JOIN ROUTE_STOP rs_from ON rs_from.stop_id = b.from_stop_id
    JOIN ROUTE_STOP rs_to ON rs_to.stop_id = b.to_stop_id
    WHERE r.schedule_id = p_schedule_id
      AND r.seat_id = p_seat_id
      AND r.status IN ('CONFIRMED', 'BOARDED')
      AND GREATEST(rs_from.stop_sequence, v_from_seq) < LEAST(rs_to.stop_sequence, v_to_seq);

    SET p_seat_taken = IF(p_overlap_count > 0, 1, 0);
END$$

-- -----------------------------------------------------------------------------
-- sp_cancel_and_promote_rac
-- Only CALLs sp_cancel_passenger_ticket. The promotion (RAC to CONFIRMED, waiting list
-- to RAC) is done by trg_after_cancellation_promote and sp_promote_passenger, exactly as
-- for a normal cancellation. p_passenger_no NULL cancels the whole PNR.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_cancel_and_promote_rac$$
CREATE PROCEDURE sp_cancel_and_promote_rac(
    IN p_pnr VARCHAR(10),
    IN p_passenger_no INT,
    IN p_reason VARCHAR(128),
    IN p_manage_tx TINYINT(1),
    OUT p_out_charge DECIMAL(10,2),
    OUT p_out_refund_amount DECIMAL(10,2),
    OUT p_out_status VARCHAR(32)
)
BEGIN
    CALL sp_cancel_passenger_ticket(p_pnr, p_passenger_no, p_reason, p_manage_tx,
                                    p_out_charge, p_out_refund_amount, p_out_status);
END$$

-- -----------------------------------------------------------------------------
-- sp_mark_boarding_status
-- p_status 'BOARDED'  -> CALL sp_board_passenger
-- p_status 'NO_SHOW'  -> CALL sp_mark_passenger_noshow
-- Any other value answers INVALID_STATUS and changes nothing.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_mark_boarding_status$$
CREATE PROCEDURE sp_mark_boarding_status(
    IN p_pnr VARCHAR(10),
    IN p_passenger_no INT,
    IN p_staff_id INT,
    IN p_status VARCHAR(16),
    IN p_manage_tx TINYINT(1),
    OUT p_out_status VARCHAR(20)
)
BEGIN
    IF p_status = 'BOARDED' THEN
        CALL sp_board_passenger(p_pnr, p_passenger_no, p_staff_id, p_manage_tx, p_out_status);
    ELSEIF p_status = 'NO_SHOW' THEN
        CALL sp_mark_passenger_noshow(p_pnr, p_passenger_no, p_staff_id, p_manage_tx, p_out_status);
    ELSE
        SET p_out_status = 'INVALID_STATUS';
    END IF;
END$$

DELIMITER ;
