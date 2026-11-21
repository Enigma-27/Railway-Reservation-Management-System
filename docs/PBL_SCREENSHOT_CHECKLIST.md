# Screenshot checklist for the report and the slides

Take the screenshots in this order. For the database ones use a freshly loaded seed (`node database/load/run-all.js`, then `USE railway_db;` in MySQL Workbench). For the website ones use the demo data (`cd backend`, `npm run demo:refresh`, `npm run demo:chain`, `npm start`, and in `frontend` `npm run dev`, then open http://localhost:5173). Write down the PNRs and the passenger e-mail that `demo:chain` prints. Do not run `npm run test:all` between the website screenshots (it resets the data).

Logins: staff `EMP-TC-101` / `StaffPassword123!`; admin `admin@railways.gov.in` / `AdminPassword123!`; passenger = the "Owner Login Email" printed by `demo:chain` with the password `Password123!` (all seeded passengers share it).

## A. Design and database (MySQL Workbench)

1. **ER diagram.** Open `database/FINALx4_Railway Reservation & Management System – ER Diagram.html` in a browser. The picture must show all entities and their relationships on one screen (zoom out if needed).
2. **Table list.** In Workbench: `SHOW FULL TABLES FROM railway_db;`. The result must show 38 base tables and 6 views.
3. **Data dictionary of one group.** Open `database/workbench/Group5_Workbench_Queries.sql`, run block `G5-1`. The picture must show the columns of `CANCELLATION`, `TDR_FILING` and `REFUND`.
4. **One stored procedure.** `SHOW CREATE PROCEDURE sp_promote_passenger;` then click the `Create Procedure` cell and "Open Value in Viewer". The picture must show the procedure text and its name.
5. **One trigger.** `SHOW CREATE TRIGGER trg_after_cancellation_promote;` (cell viewer as above). The picture must show `AFTER INSERT ON CANCELLATION` and the call to `sp_promote_passenger`.
6. **One function.** Group 1 file, block `G1-4`. The picture must show the monthly ticket count and the "may book again" column next to the user ids.
7. **Constraint error demos.** Group 1 blocks `G1-6a`, `G1-6b`, `G1-6c` (one at a time, "RUN ALONE"). Each picture must show the red error line in the Output pane (duplicate e-mail 1062, age check 3819, bad role 1265).
8. **Seat overlap trigger.** Group 3 block `G3-5`. The picture must show `SEAT_OVERLAP_ERROR` in the Output pane.
9. **RANK report.** Group 7 block `G7-4`. The picture must show `rank_pos` and `dense_rank_pos` next to the train names.

## B. The demo stories (MySQL Workbench, clean seed)

10. **Story 1, cancellation chain.** `Group5_Workbench_Queries.sql`, block `G5-3` (select the whole block, Ctrl+Shift+Enter). The picture must show: cancelling passenger CONFIRMED to CANCELLED, first RAC passenger RAC to CONFIRMED, first waiting-list passenger WAITING_LIST to RAC, and the refund row with status PENDING.
11. **Story 2, approved TDR.** Same file, block `G5-4`. The picture must show the TDR as APPROVED with a refund of 600.00 and the same three-line chain.
12. **Story 3, no-show.** `Group6_Workbench_Queries.sql`, block `G6-3`. The picture must show `NO_SHOW_MARKED`, boarding refused (`NOT_ELIGIBLE`), the passenger as NO_SHOW without a seat, and the next RAC passenger CONFIRMED.
13. **Story 4, chart preparation.** `Story_D_Chart_Preparation_Workbench.sql`, run D-1, then select D-2 and D-3 together. Take one picture of the before counts (107 waiting) and one of the after (0 waiting, 107 PENDING refunds, fare-minus-insurance total, 817 snapshot rows).
14. **Story 5, ladies quota full.** `Group4_Workbench_Queries.sql`, block `G4-4`. The picture must show `SEAT_NOT_AVAILABLE` without consent and a CONFIRMED booking on quota GENERAL with consent.
15. **Edge cases.** `Group5_Workbench_Queries.sql`, block `G5-5`. The picture must show the five test cases: chart prepared, a normal cancel, cancelled twice, TDR not eligible, TDR filed by another user.
16. **Audit trigger.** `Group7_Workbench_Queries.sql`, block `G7-5`. The picture must show the new `AUDIT_LOG` row with before and after JSON, then the original rate after the rollback.

## C. The three portals (website)

17. **Passenger login.** Open http://localhost:5173, click **Sign In**, choose the **Passenger** tile. The picture must show the login box.
18. **Passenger main screen.** After login: the home page with **Book Tickets**, search box and the user name.
19. **Passenger action: book a ticket.** **Book Tickets**, search BCT to NDLS two days ahead, pick a train, add a passenger, **Reserve & Hold Seats (10 min)**. The picture must show the countdown and the fare breakdown.
20. **Razorpay test payment.** Click **Pay now**. Take the Razorpay checkout window with the test card or UPI, and then the confirmed e-ticket page with the PNR. The picture must show "test mode" and the CONFIRMED status.
21. **Passenger action: cancel with refund estimate.** Sign in as the "Owner Login Email" of the chain. **My Bookings**, open the Confirmed PNR, **Cancel Ticket**. The picture must show the refund estimate and the confirm button.
22. **Passenger promotion result.** **PNR Enquiry** for the first RAC PNR printed by `demo:chain`. The picture must show it as CONFIRMED after the cancellation.
23. **Passenger action: TDR.** **TDR / Refunds**, **+ File TDR**. The picture must show the filed TDR with status FILED.
24. **Staff login and main screen.** Staff tile, `EMP-TC-101`. The picture must show **Overview** with the duty (train, date, station).
25. **Staff action.** **Passenger Manifest**, **Board Passenger** or **Mark No-Show**. The picture must show the status change on one passenger and the success message.
26. **Admin login and main screen.** Admin tile. The picture must show the **Dashboard** with the RANK reports.
27. **Admin action: TDR adjudication.** **Operations, TDR Adjudication**, approve the TDR from step 23. The picture must show APPROVED and the refund.
28. **Refund transactions page.** **Operations, Refund Transactions**. The picture must show the refund rows with status chips (PENDING, PROCESSED, FAILED) and the Retry button on a PENDING or FAILED row.
29. **Chart preparation.** **Trains & Routes, Schedules**, find the schedule id printed by `demo:chain`, **Prepare Chart**. The picture must show the purged count and refund total. Do this last, because it ends the chain.

## D. Tests

30. **API tests.** In `backend`: `npm run test:all`. The picture must show the summary table with 10 suites passed and `TOTAL ASSERTIONS: 947/947 (100%)`. (It takes about 5 minutes and resets the data: run `demo:refresh` and `demo:chain` after it.)
31. **SQL tests.** `node database/load/apply-sql.js 07_tests --run-tests` (plain seed). The picture must show `TEST SUMMARY: 66 passed, 0 not passed, 66 total`.
32. **Smoke test.** With the backend running and fresh demo data: `npm run test:smoke` in `backend`. The picture must show 28 PASS rows and `28 passed, 0 failed`.

## E. Optional (only if the examiner asks about the PDF names)

33. **Mapping table.** Open `docs/PBL_NAME_MAPPING.md` on GitHub. The picture must show the 12-row table.
34. **Alias objects.** `node database/load/apply-sql.js 08_pdf_aliases`, then run the examples at the end of the mapping document. The picture must show `SELECT * FROM v_active_staff;` and the output of `sp_check_seat_segment_overlap`. Remove them afterwards with `node database/load/apply-sql.js 08_pdf_aliases_drop`.
35. **Architecture.** Open `docs/ARCHITECTURE.md` on GitHub. One picture per diagram (system overview, booking and payment, cancellation and promotion, refund life, TDR, hold).
