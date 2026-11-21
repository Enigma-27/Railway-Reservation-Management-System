-- =====================================================================================
-- RAILWAY RESERVATION & MANAGEMENT SYSTEM - GROUP 1 WORKBENCH QUERIES
-- Module: User, RBAC & Passenger Master  (USER_ACCOUNT, SAVED_PASSENGER, STAFF)
--
-- BEFORE YOU START (once, by whoever has the project laptop):
--   node database/load/run-all.js      (clean seed data; the fixed PNRs below only exist there)
-- IN WORKBENCH: open Local instance MySQL80, run  USE railway_db;
--
-- HOW TO RUN: run ONE block at a time.
--   * "RUN: select the block, Ctrl+Shift+Enter"  -> drag-select the whole block and press Ctrl+Shift+Enter
--   * "RUN ALONE (error demo)"                   -> click inside that single statement, Ctrl+Enter.
--                                                  Screenshot the Output pane too (the error text is there).
--   * Blocks that start with START TRANSACTION and end with ROLLBACK must be selected completely.
--     If one stops half-way, run  ROLLBACK;  and  SET @as_of_time = NULL;
--   * Nothing here changes your data: read-only, fails on purpose, or rolled back.
--
-- Each block says which chapter of the report the screenshot goes under.
-- =====================================================================================
USE railway_db;

-- -------------------------------------------------------------------------------------
-- G1-1  |  Paste under chapter 2.3  |  Data dictionary of the group tables
-- RUN: click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT
FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='railway_db' AND TABLE_NAME IN ('USER_ACCOUNT','SAVED_PASSENGER','STAFF')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- -------------------------------------------------------------------------------------
-- G1-2  |  Paste under chapter 2.3  |  Keys and constraints (PK, UNIQUE, FK, CHECK)
-- RUN: click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
SELECT tc.TABLE_NAME AS `table`, tc.CONSTRAINT_TYPE AS type, tc.CONSTRAINT_NAME AS name,
       GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION) AS on_columns,
       MAX(k.REFERENCED_TABLE_NAME) AS references_table
FROM information_schema.TABLE_CONSTRAINTS tc
LEFT JOIN information_schema.KEY_COLUMN_USAGE k
       ON k.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND k.TABLE_NAME = tc.TABLE_NAME AND k.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
WHERE tc.TABLE_SCHEMA = 'railway_db' AND tc.TABLE_NAME IN ('USER_ACCOUNT','SAVED_PASSENGER','STAFF')
GROUP BY tc.TABLE_NAME, tc.CONSTRAINT_TYPE, tc.CONSTRAINT_NAME
ORDER BY tc.TABLE_NAME, tc.CONSTRAINT_TYPE;

-- -------------------------------------------------------------------------------------
-- G1-3  |  Paste under chapter 2.3  |  Normalisation: 1:1 user-staff and 1:N user-passengers
-- RUN: click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
SELECT 'USER_ACCOUNT -> STAFF  (1:1)' AS relationship, COUNT(*) AS child_rows, COUNT(DISTINCT user_id) AS distinct_parents FROM STAFF
UNION ALL
SELECT 'USER_ACCOUNT -> SAVED_PASSENGER  (1:N)', COUNT(*), COUNT(DISTINCT user_id) FROM SAVED_PASSENGER;

-- -------------------------------------------------------------------------------------
-- G1-4  |  Paste under chapter 2.4.3  |  User-defined functions: monthly ticket limit per user
-- RUN: click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
SELECT u.user_id, u.full_name, u.aadhaar_verified, t.bookings_made,
       fn_get_user_monthly_ticket_count(u.user_id, '2026-10-20 12:00:00') AS tickets_this_month,
       fn_check_monthly_ticket_limit(u.user_id, '2026-10-20 12:00:00') AS may_book_again
FROM USER_ACCOUNT u JOIN (SELECT user_id, COUNT(*) AS bookings_made FROM BOOKING GROUP BY user_id ORDER BY COUNT(*) DESC LIMIT 5) t ON t.user_id = u.user_id;

-- -------------------------------------------------------------------------------------
-- G1-5  |  Paste under chapter 2.5  |  Credential-masked staff list (password never shown)
-- RUN: click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
SELECT s.staff_id, s.employee_no, u.full_name, s.designation, u.role, s.status, u.email,
       '********' AS password_shown, CHAR_LENGTH(u.password_hash) AS stored_hash_length
FROM STAFF s JOIN USER_ACCOUNT u ON u.user_id = s.user_id
WHERE s.status = 'ACTIVE' ORDER BY s.staff_id;

-- -------------------------------------------------------------------------------------
-- G1-6a  |  Paste under chapter 3.2  |  Duplicate e-mail rejected (UNIQUE)
-- RUN ALONE (error demo): click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
-- (a) duplicate e-mail  -> Error 1062 Duplicate entry
INSERT INTO USER_ACCOUNT (user_id, email, password_hash, phone, full_name, role, account_status, aadhaar_verified, created_at)
SELECT 99999, email, 'x', '+91-0000000000', 'Duplicate Email Test', 'PASSENGER', 'ACTIVE', 0, NOW() FROM USER_ACCOUNT WHERE user_id = 1;

-- -------------------------------------------------------------------------------------
-- G1-6b  |  Paste under chapter 3.2  |  Age 200 rejected (CHECK)
-- RUN ALONE (error demo): click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
-- (b) age 200 -> Error 3819 Check constraint 'chk_passenger_age' is violated
INSERT INTO SAVED_PASSENGER (passenger_id, user_id, name, age, gender, id_proof_type, id_proof_reference)
VALUES (999999, 1, 'Age Check Test', 200, 'MALE', 'AADHAAR', 'TEST-0000');

-- -------------------------------------------------------------------------------------
-- G1-6c  |  Paste under chapter 3.2  |  Invalid role rejected (ENUM)
-- RUN ALONE (error demo): click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
-- (c) invalid role -> Error 1265 Data truncated for column 'role'
INSERT INTO USER_ACCOUNT (user_id, email, password_hash, phone, full_name, role, account_status, aadhaar_verified, created_at)
VALUES (99998, 'role.test@example.com', 'x', '+91-0000000001', 'Role Test', 'HACKER', 'ACTIVE', 0, NOW());

-- NOTE: Group 1 has no stored procedure or trigger of its own in the database, so chapters 2.4.1 and 2.4.2 have no screenshot from this file.
