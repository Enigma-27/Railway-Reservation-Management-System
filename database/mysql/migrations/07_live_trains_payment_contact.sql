-- =============================================================================
-- Migration 07 (Prompt 13): payment method UNKNOWN, expired payment orders, contact and senior-age settings
-- Safe to run once on an existing database (it only widens two ENUMs and adds missing SETTING rows).
-- After it, apply the changed routines:
--   node database/load/apply-sql.js 02_functions 03_procedures 04_triggers 05_views
-- Undo: ALTER the two ENUMs back (only possible while no row uses the new values) and
--   DELETE FROM SETTING WHERE setting_key IN ('CONTACT_HELPLINE','CONTACT_EMAIL','CONTACT_ADDRESS','SENIOR_AGE_MALE','SENIOR_AGE_FEMALE');
-- =============================================================================

USE railway_db;

-- 1. PAYMENT.method keeps what Razorpay really used; 'UNKNOWN' when Razorpay gives no usable method
ALTER TABLE PAYMENT
    MODIFY method ENUM('CREDIT_CARD', 'DEBIT_CARD', 'UPI', 'NET_BANKING', 'CASH', 'UNKNOWN') NOT NULL;

-- 2. PAYMENT_ORDER.status gets EXPIRED (hold ended without payment; still checked for 24 hours)
ALTER TABLE PAYMENT_ORDER
    MODIFY status ENUM('CREATED', 'PAID', 'LATE_PAID', 'FAILED', 'EXPIRED') NOT NULL DEFAULT 'CREATED';

-- 3. Settings: contact panel (demo values, change them in Admin > Settings) and senior-citizen ages
INSERT IGNORE INTO SETTING (setting_key, setting_value, description) VALUES
    ('CONTACT_HELPLINE', '1800-000-0139 (demo number, 6 am to 10 pm)', 'Contact panel: helpline text (demo value)'),
    ('CONTACT_EMAIL', 'support@rrms.example.com', 'Contact panel: support e-mail (demo value)'),
    ('CONTACT_ADDRESS', 'RRMS Help Centre (demo address)', 'Contact panel: address line (demo value)'),
    ('SENIOR_AGE_MALE', '60', 'Minimum age of a male or other-gender senior citizen'),
    ('SENIOR_AGE_FEMALE', '45', 'Minimum age of a female senior citizen');
