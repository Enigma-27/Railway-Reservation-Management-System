-- =============================================================================
-- Migration 05: REFUND_RULE per class (so the cancellation charge can be read from the table)
-- Before: fn_calculate_cancellation_refund used hard-coded flat minimum charges per class and fixed slabs.
-- After: it reads REFUND_RULE. class_id NULL = general rule; a class rule beats a general rule of the same slab.
-- The new class rows reproduce today's numbers exactly (BR-R2: 1A and EC 240, 2A 200, 3A and CC 180, SL 120, 2S 60).
-- The four general rows (rule 1 to 4) become the fallback for a class that has no row of its own (flat 120).
-- Run once on an existing database (it stops with an error if class_id already exists). Then:
--   node database/load/apply-sql.js 02_functions 03_procedures 04_triggers 05_views
-- Undo (no refund, payment or booking row is touched):
--   DELETE FROM REFUND_RULE WHERE rule_id > 4;
--   UPDATE REFUND_RULE SET flat_min_charge = 240 WHERE rule_id = 1;  -- 200, 180, 120 for rules 2, 3, 4
--   ALTER TABLE REFUND_RULE DROP FOREIGN KEY fk_refund_rule_class, DROP KEY idx_refund_rule_class, DROP COLUMN class_id;
--   (then re-apply the routines of the previous version from git)
-- =============================================================================

USE railway_db;

ALTER TABLE REFUND_RULE
    ADD COLUMN class_id INT NULL AFTER rule_id,
    ADD KEY idx_refund_rule_class (class_id),
    ADD CONSTRAINT fk_refund_rule_class FOREIGN KEY (class_id) REFERENCES SEAT_CLASS (class_id);

UPDATE REFUND_RULE SET flat_min_charge = 120.00 WHERE rule_id IN (1, 2, 3, 4) AND class_id IS NULL;

INSERT INTO REFUND_RULE (rule_id, class_id, min_hours, max_hours, deduction_pct, flat_min_charge, clerkage) VALUES
    (5, 1, 72, NULL, 0.00, 240.00, 60.00),
    (6, 1, 24, 72, 25.00, 240.00, 60.00),
    (7, 1, 8, 24, 50.00, 240.00, 60.00),
    (8, 1, 0, 8, 100.00, 240.00, 60.00),
    (9, 2, 72, NULL, 0.00, 200.00, 60.00),
    (10, 2, 24, 72, 25.00, 200.00, 60.00),
    (11, 2, 8, 24, 50.00, 200.00, 60.00),
    (12, 2, 0, 8, 100.00, 200.00, 60.00),
    (13, 3, 72, NULL, 0.00, 180.00, 60.00),
    (14, 3, 24, 72, 25.00, 180.00, 60.00),
    (15, 3, 8, 24, 50.00, 180.00, 60.00),
    (16, 3, 0, 8, 100.00, 180.00, 60.00),
    (17, 4, 72, NULL, 0.00, 120.00, 60.00),
    (18, 4, 24, 72, 25.00, 120.00, 60.00),
    (19, 4, 8, 24, 50.00, 120.00, 60.00),
    (20, 4, 0, 8, 100.00, 120.00, 60.00),
    (21, 5, 72, NULL, 0.00, 180.00, 60.00),
    (22, 5, 24, 72, 25.00, 180.00, 60.00),
    (23, 5, 8, 24, 50.00, 180.00, 60.00),
    (24, 5, 0, 8, 100.00, 180.00, 60.00),
    (25, 6, 72, NULL, 0.00, 240.00, 60.00),
    (26, 6, 24, 72, 25.00, 240.00, 60.00),
    (27, 6, 8, 24, 50.00, 240.00, 60.00),
    (28, 6, 0, 8, 100.00, 240.00, 60.00),
    (29, 7, 72, NULL, 0.00, 60.00, 60.00),
    (30, 7, 24, 72, 25.00, 60.00, 60.00),
    (31, 7, 8, 24, 50.00, 60.00, 60.00),
    (32, 7, 0, 8, 100.00, 60.00, 60.00);
