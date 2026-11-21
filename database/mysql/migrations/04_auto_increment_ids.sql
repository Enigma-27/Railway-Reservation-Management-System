-- =============================================================================
-- Migration 04: AUTO_INCREMENT ids for the tables that concurrent users write to
-- Before: procedures made ids with MAX(id)+1. Two bookings on different runs at the same time read the
-- same MAX and one failed with a duplicate key (shown as TRANSACTION_FAILED).
-- After: the database hands out the id. Explicit-id inserts (seed loader, tests) still work.
-- Tables: RESERVATION.res_id, PAYMENT.payment_id, REFUND.refund_id, CANCELLATION.cancel_id,
--         TICKET_VERIFICATION.verify_id, CHART_SNAPSHOT.snapshot_id.
-- Safe to run on a live database: no row is changed. InnoDB sets each counter above the current MAX;
-- the prepared ALTERs at the end set it explicitly as well.
-- After it, apply the changed routines:
--   node database/load/apply-sql.js 02_functions 03_procedures 04_triggers 05_views
-- Undo (keeps all data; the procedures from before this change then need MAX+1 again, see the git history):
--   ALTER TABLE RESERVATION MODIFY res_id INT NOT NULL;   (same for the other five)
-- =============================================================================

USE railway_db;

SET FOREIGN_KEY_CHECKS = 0;

ALTER TABLE RESERVATION          MODIFY res_id      INT NOT NULL AUTO_INCREMENT;
ALTER TABLE PAYMENT              MODIFY payment_id  INT NOT NULL AUTO_INCREMENT;
ALTER TABLE REFUND               MODIFY refund_id   INT NOT NULL AUTO_INCREMENT;
ALTER TABLE CANCELLATION         MODIFY cancel_id   INT NOT NULL AUTO_INCREMENT;
ALTER TABLE TICKET_VERIFICATION  MODIFY verify_id   INT NOT NULL AUTO_INCREMENT;
ALTER TABLE CHART_SNAPSHOT       MODIFY snapshot_id INT NOT NULL AUTO_INCREMENT;

SET FOREIGN_KEY_CHECKS = 1;

-- Next counter = current MAX + 1 (explicit, in case a counter was reset)
SET @n = (SELECT COALESCE(MAX(res_id), 0) + 1 FROM RESERVATION);
SET @sql = CONCAT('ALTER TABLE RESERVATION AUTO_INCREMENT = ', @n);
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

SET @n = (SELECT COALESCE(MAX(payment_id), 0) + 1 FROM PAYMENT);
SET @sql = CONCAT('ALTER TABLE PAYMENT AUTO_INCREMENT = ', @n);
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

SET @n = (SELECT COALESCE(MAX(refund_id), 0) + 1 FROM REFUND);
SET @sql = CONCAT('ALTER TABLE REFUND AUTO_INCREMENT = ', @n);
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

SET @n = (SELECT COALESCE(MAX(cancel_id), 0) + 1 FROM CANCELLATION);
SET @sql = CONCAT('ALTER TABLE CANCELLATION AUTO_INCREMENT = ', @n);
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

SET @n = (SELECT COALESCE(MAX(verify_id), 0) + 1 FROM TICKET_VERIFICATION);
SET @sql = CONCAT('ALTER TABLE TICKET_VERIFICATION AUTO_INCREMENT = ', @n);
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

SET @n = (SELECT COALESCE(MAX(snapshot_id), 0) + 1 FROM CHART_SNAPSHOT);
SET @sql = CONCAT('ALTER TABLE CHART_SNAPSHOT AUTO_INCREMENT = ', @n);
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
