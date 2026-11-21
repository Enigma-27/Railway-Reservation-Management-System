# PBL PDF names and what the project really has

The PBL PDF uses 12 object names. The project was built with other names, and a few features live in Node or MongoDB instead of the database. This table says, for each PDF name, what exists, where, and how to show it in MySQL Workbench with one query.

Fit words: **exact** (same thing, same name), **close** (same job, different name), **partial** (part of the job is there), **gap** (not a database object; the feature lives somewhere else).

Run `USE railway_db;` first. Line numbers are for the files in this repository today.

| # | PDF name | What we really have (real object) | File and line | Show it in Workbench (one query) | Fit |
| :-- | :--- | :--- | :--- | :--- | :--- |
| 1 | `sp_register_user` | Passenger sign-up is done in Node, not in a procedure. `registerPassenger` checks the e-mail and phone, hashes the password with bcrypt, and inserts one `USER_ACCOUNT` row (role PASSENGER, status ACTIVE). | `backend/src/controllers/authController.js:24` | `SELECT user_id, email, role, account_status, aadhaar_verified, created_at FROM USER_ACCOUNT ORDER BY user_id DESC LIMIT 5;` | **gap** (lives in Node `authController`) |
| 2 | `v_active_staff` | No view of this name. The staff list is a join of `STAFF` and `USER_ACCOUNT` (Group 1 query G1-5, and `GET /api/admin/staff`). Optional alias view in `08_pdf_aliases.sql`. | `database/workbench/Group1_Workbench_Queries.sql` (G1-5); `database/mysql/08_pdf_aliases.sql` | `SELECT s.staff_id, s.employee_no, u.full_name, s.designation, s.status FROM STAFF s JOIN USER_ACCOUNT u ON u.user_id = s.user_id WHERE s.status = 'ACTIVE';` | **close** (a query, alias view optional) |
| 3 | `trg_audit_user_status` | No trigger on `USER_ACCOUNT`. When an admin changes a user status, Node writes the `AUDIT_LOG` row itself (`UPDATE_USER_STATUS`). | `backend/src/controllers/adminController.js:1460` (row written at line 1508) | `SELECT log_id, action, table_name, record_id, old_value, new_value, logged_at FROM AUDIT_LOG WHERE action = 'UPDATE_USER_STATUS' ORDER BY log_id DESC LIMIT 5;` (empty until an admin changes a status) | **partial** (audit exists, written by Node, not a trigger) |
| 4 | `sp_generate_dated_schedules` | Dated runs are created by Node: `ensureRunExists` and `createRunsForWindow` insert `TRAIN_SCHEDULE`, inventory and coach status rows. They are called by `npm run simulate:daily` and `npm run demo:refresh`. | `backend/scripts/helpers/simulationHelper.js:52` and `:140`; `backend/scripts/simulate-daily.js` | `SELECT journey_date, COUNT(*) AS runs FROM TRAIN_SCHEDULE GROUP BY journey_date ORDER BY journey_date DESC LIMIT 7;` | **gap** (lives in Node scripts) |
| 5 | `sp_check_seat_segment_overlap` | Trigger `trg_check_seat_overlap` stops two overlapping CONFIRMED bookings on one seat (rule: `GREATEST(start) < LEAST(end)` by stop sequence). Optional read-only procedure of the PDF name in `08_pdf_aliases.sql`. | `database/mysql/04_triggers.sql:25` | `SHOW CREATE TRIGGER trg_check_seat_overlap;` (or run the error demo G3-5 in `database/workbench/Group3_Workbench_Queries.sql`) | **close** (trigger, not procedure) |
| 6 | `trg_update_availability_on_booking` | No trigger. The seat counters in `SCHEDULE_CLASS_INVENTORY` are updated inside the procedures `sp_create_booking`, `sp_confirm_payment`, `sp_cancel_passenger_ticket`, `sp_promote_passenger`, `sp_release_expired_holds` and `sp_prepare_chart`, in the same transaction. | `database/mysql/03_procedures.sql` (for example lines 501, 1001, 1295, 1364) | `SELECT schedule_id, class_id, total_seats, available_seats, rac_count, wl_count FROM SCHEDULE_CLASS_INVENTORY WHERE schedule_id = 1404;` (use a schedule id from your data) | **partial** (same effect, done by procedures) |
| 7 | `trg_on_tdr_approved` | Approval is the procedure `sp_review_tdr`: it writes the refund, cancels the passenger and promotes the queue. The promotion itself is run by `trg_after_cancellation_promote`. | `database/mysql/03_procedures.sql:2155`; `database/mysql/04_triggers.sql:103` | `SELECT tdr_ref_no, status, refund_amount, reviewed_by, reviewed_at FROM TDR_FILING;` and story G5-4 in `database/workbench/Group5_Workbench_Queries.sql` | **close** (procedure plus trigger, not one trigger) |
| 8 | `sp_cancel_and_promote_rac` | `sp_cancel_passenger_ticket` cancels; the trigger `trg_after_cancellation_promote` calls `sp_promote_passenger` (RAC to CONFIRMED, waiting list to RAC). Optional wrapper of the PDF name in `08_pdf_aliases.sql`. | `database/mysql/03_procedures.sql:1032` (cancel) and `:37` (promote); `database/mysql/04_triggers.sql:103` | Story G5-3 in `database/workbench/Group5_Workbench_Queries.sql` (shows before and after of the chain) | **close** |
| 9 | `v_tc_reservation_chart` | No view of this name. The ticket collector chart is built by Node from the run (`getScheduleChart`) and, for the demo, by Group 6 query G6-2. After chart preparation the rows are also in `CHART_SNAPSHOT`. Optional alias view in `08_pdf_aliases.sql`. | `backend/src/controllers/staffController.js:337`; `database/workbench/Group6_Workbench_Queries.sql` (G6-2) | `SELECT c.coach_code, se.seat_number, se.berth_type, pb.name, r.status, b.pnr FROM RESERVATION r JOIN BOOKING b ON b.pnr = r.pnr JOIN PASSENGER_BOOKING pb ON pb.pnr = r.pnr AND pb.passenger_no = r.passenger_no JOIN SEAT se ON se.seat_id = r.seat_id JOIN COACH c ON c.coach_id = se.coach_id WHERE r.schedule_id = 1137 AND r.status IN ('CONFIRMED','BOARDED','NO_SHOW') ORDER BY c.sequence_number, se.seat_number LIMIT 12;` | **close** (query and Node, alias view optional) |
| 10 | `sp_mark_boarding_status` | Two procedures: `sp_board_passenger` (BOARDED) and `sp_mark_passenger_noshow` (NO_SHOW). `sp_verify_ticket` records the ticket check. Optional wrapper of the PDF name in `08_pdf_aliases.sql`. | `database/mysql/03_procedures.sql:420` and `:235`; `:320` | Story G6-3 in `database/workbench/Group6_Workbench_Queries.sql` | **close** (two procedures) |
| 11 | `trg_audit_master_changes` | Four triggers, one per master table: `trg_audit_fare_change`, `trg_audit_concession_change`, `trg_audit_refund_rule_change`, `trg_audit_setting_change`. Each writes before and after as JSON to `AUDIT_LOG`. | `database/mysql/04_triggers.sql:181`, `:202`, `:223`, `:244` | Block G7-5 in `database/workbench/Group7_Workbench_Queries.sql` (changes a fare, shows the new `AUDIT_LOG` row, rolls back) | **close** (four triggers instead of one) |
| 12 | `sp_resolve_grievance` | Complaints are in MongoDB (`complaints` collection), not in MySQL. The admin answers with `PUT /api/admin/complaints/:grievanceId`, handled by `adminUpdateComplaint`. | `backend/src/controllers/complaintController.js:70` | In MongoDB Compass: `db.complaints.find({}).limit(5)`. No MySQL query. | **gap** (lives in Node and MongoDB) |

## How to apply the optional alias file

If an examiner insists on the exact PDF names for items 2, 5, 8, 9 and 10, apply the optional file. It is **not** part of the normal load:

```
node database/load/apply-sql.js 08_pdf_aliases
```

It creates two views (`v_active_staff`, `v_tc_reservation_chart`) and three procedures (`sp_check_seat_segment_overlap`, `sp_cancel_and_promote_rac`, `sp_mark_boarding_status`). They only read data or `CALL` the real procedures, so the business rules stay in one place. To remove them again:

```
node database/load/apply-sql.js 08_pdf_aliases_drop
```

The same drop statements are written at the top of `database/mysql/08_pdf_aliases.sql`. It was tested once on the demo database: every object was run read-only or inside a rolled-back transaction, then dropped, and the database was back to 38 tables, 6 views, 9 functions, 15 procedures and 9 triggers.

Examples after applying it:
```
SELECT * FROM v_active_staff;
SELECT * FROM v_tc_reservation_chart WHERE schedule_id = 1137 LIMIT 5;
CALL sp_check_seat_segment_overlap(1137, 25, 1145, 1152, @n, @taken); SELECT @n, @taken;
START TRANSACTION;
CALL sp_cancel_and_promote_rac('2849100146', 1, 'PLANS_CHANGED', 0, @c, @r, @s); SELECT @c, @r, @s;
ROLLBACK;
```

## Mapping slide (paste into the presentation)

- The PDF names are the plan. The built system keeps the same jobs under 15 procedures, 9 functions, 9 triggers and 6 views.
- Promotion has one path only: `sp_cancel_passenger_ticket`, then trigger `trg_after_cancellation_promote`, then `sp_promote_passenger`.
- Boarding and no-show are `sp_board_passenger` and `sp_mark_passenger_noshow`; ticket checks are `sp_verify_ticket`.
- Seat overlap is the trigger `trg_check_seat_overlap`; seat counters are kept by the booking and cancellation procedures.
- Master-data audit is four triggers (fare, concession, refund rule, setting) writing before and after JSON to `AUDIT_LOG`.
- Register user, dated schedules, user-status audit and grievances live in Node (and MongoDB for grievances), because they are application work, not database rules.
- Optional `08_pdf_aliases.sql` adds the exact PDF names for five items as thin wrappers; one DROP file removes them.
