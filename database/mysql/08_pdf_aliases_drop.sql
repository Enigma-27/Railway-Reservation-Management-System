-- =============================================================================
-- File: 08_pdf_aliases_drop.sql
-- Removes everything created by 08_pdf_aliases.sql (nothing else is touched).
-- Run:  node database/load/apply-sql.js 08_pdf_aliases_drop
-- =============================================================================

USE railway_db;

DROP VIEW IF EXISTS v_active_staff;
DROP VIEW IF EXISTS v_tc_reservation_chart;
DROP PROCEDURE IF EXISTS sp_check_seat_segment_overlap;
DROP PROCEDURE IF EXISTS sp_cancel_and_promote_rac;
DROP PROCEDURE IF EXISTS sp_mark_boarding_status;
