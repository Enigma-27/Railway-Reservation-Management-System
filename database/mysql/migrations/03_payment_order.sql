-- =============================================================================
-- Migration 03: PAYMENT_ORDER (Razorpay orders saved in MySQL)
-- MySQL, not MongoDB, is now the source of truth for payment orders, so a payment
-- can always be matched to its booking, even when MongoDB is down.
-- Safe to run once on an existing database (it stops with an error if the table exists).
-- After it, apply the changed routines:
--   node database/load/apply-sql.js 02_functions 03_procedures 04_triggers 05_views
-- Undo (no booking, payment or refund data is touched):
--   DROP PROCEDURE IF EXISTS sp_set_payment_order_result;
--   DROP TABLE IF EXISTS PAYMENT_ORDER;
-- =============================================================================

USE railway_db;

CREATE TABLE PAYMENT_ORDER (
    order_id VARCHAR(40) NOT NULL,
    pnr VARCHAR(10) NOT NULL,
    amount_paise BIGINT NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    status ENUM('CREATED', 'PAID', 'LATE_PAID', 'FAILED') NOT NULL DEFAULT 'CREATED',
    gateway_payment_id VARCHAR(40) NULL,
    created_at DATETIME NOT NULL,
    paid_at DATETIME NULL,
    last_checked_at DATETIME NULL,
    PRIMARY KEY (order_id),
    KEY idx_payment_order_pnr (pnr),
    KEY idx_payment_order_status_created (status, created_at),
    CONSTRAINT fk_payment_order_booking FOREIGN KEY (pnr) REFERENCES BOOKING (pnr) ON DELETE CASCADE,
    CONSTRAINT chk_payment_order_amount CHECK (amount_paise > 0)
) ENGINE=InnoDB;
