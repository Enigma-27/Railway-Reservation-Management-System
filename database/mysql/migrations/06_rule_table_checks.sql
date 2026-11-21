-- =============================================================================
-- Migration 06: CHECK constraints on the money rule tables
-- An admin (or any SQL) can no longer save a percent below 0 or above 100, a negative charge, or a bad slab.
-- Run after migration 05 (REFUND_RULE needs class_id first). Existing seed rows already satisfy all checks.
-- Undo: ALTER TABLE REFUND_RULE DROP CHECK chk_refund_rule_hours, DROP CHECK chk_refund_rule_pct, DROP CHECK chk_refund_rule_money;
--       ALTER TABLE CONCESSION_RULE DROP CHECK chk_conc_rule_pct, DROP CHECK chk_conc_rule_group;  ALTER TABLE FARE DROP CHECK chk_fare_slab;
-- =============================================================================

USE railway_db;

ALTER TABLE REFUND_RULE
    ADD CONSTRAINT chk_refund_rule_hours CHECK (min_hours >= 0 AND (max_hours IS NULL OR max_hours > min_hours)),
    ADD CONSTRAINT chk_refund_rule_pct CHECK (deduction_pct >= 0 AND deduction_pct <= 100),
    ADD CONSTRAINT chk_refund_rule_money CHECK (flat_min_charge >= 0 AND clerkage >= 0);

ALTER TABLE CONCESSION_RULE
    ADD CONSTRAINT chk_conc_rule_pct CHECK (discount_pct >= 0 AND discount_pct <= 100),
    ADD CONSTRAINT chk_conc_rule_group CHECK (train_group IN ('STANDARD', 'PREMIUM'));

ALTER TABLE FARE
    ADD CONSTRAINT chk_fare_slab CHECK (rate_per_km >= 0 AND min_distance_km >= 0 AND max_distance_km >= min_distance_km);
