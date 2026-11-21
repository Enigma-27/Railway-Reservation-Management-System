-- =============================================================================
-- Migration 02: refund life columns on REFUND
-- A refund is PENDING when the row is created, then PROCESSED (gateway done) or
-- FAILED (gateway failed, will be retried). Existing rows keep their status.
-- Safe to run on an existing database. Run it once; it stops with an error if a
-- column already exists (a fresh run-all.js load already has the columns).
-- After it, apply the changed routines:
--   node database/load/apply-sql.js 02_functions 03_procedures 04_triggers 05_views
-- Undo (keeps all data):
--   ALTER TABLE REFUND DROP COLUMN gateway_refund_id, DROP COLUMN failure_reason,
--     DROP COLUMN attempts, DROP COLUMN last_attempt_at, DROP COLUMN processed_at;
-- =============================================================================

USE railway_db;

ALTER TABLE REFUND
    ADD COLUMN gateway_refund_id VARCHAR(40) NULL AFTER status,
    ADD COLUMN failure_reason VARCHAR(255) NULL AFTER gateway_refund_id,
    ADD COLUMN attempts INT NOT NULL DEFAULT 0 AFTER failure_reason,
    ADD COLUMN last_attempt_at DATETIME NULL AFTER attempts,
    ADD COLUMN processed_at DATETIME NULL AFTER last_attempt_at;
