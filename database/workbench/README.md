# Workbench query files

These files are for MySQL Workbench screenshots in the report and the live demo. They use the **clean seed**, whose data is frozen at 2026-10-17 19:15 (India time).

## 1. Load the clean seed first

```
node database/load/run-all.js
```

This resets the database to the plain seed (and takes a few minutes). The fixed PNRs and run ids in these files (for example `2849100146`, run `1111`) exist only there.

Then open MySQL Workbench, connect to **Local instance MySQL80** and run:

```
USE railway_db;
```

> The website stories are different. They need `npm run demo:refresh` and `npm run demo:chain` instead (the website cannot set the test clock). **Run the Workbench stories on a freshly loaded seed (`node database/load/run-all.js`); the website stories need demo:refresh + demo:chain instead.** After the Workbench session, repeat `demo:refresh` and `demo:chain` before presenting the website.

## 2. How to run a block

- Run **one block at a time**. A block starts with a comment line such as `-- G5-3 | Paste under chapter 2.4.1 | ...`.
- Blocks marked `RUN: select the block, Ctrl+Shift+Enter`: drag-select the whole block and press Ctrl+Shift+Enter. Blocks that start with `START TRANSACTION` and end with `ROLLBACK` must be selected completely.
- Blocks marked `RUN ALONE (error demo)`: click inside the single statement and press Ctrl+Enter. The error is the point of the screenshot; take the Output pane too.
- If a block stops half-way, run `ROLLBACK;` and `SET @as_of_time = NULL;`.
- Nothing in these files changes your data. Every block is read-only, fails on purpose, or is rolled back.

## 3. The files, in the order to open them

| Order | File | What it covers |
| :--- | :--- | :--- |
| 1 | `Group1_Workbench_Queries.sql` | Users, staff, saved passengers: data dictionary, constraints, monthly limit functions, three error demos |
| 2 | `Group2_Workbench_Queries.sql` | Stations, trains, route stops, timetable: self-join, EXPLAIN, `fn_calculate_distance`, three error demos |
| 3 | `Group3_Workbench_Queries.sql` | Coaches, seats, inventory: hierarchy, availability view, locking, the seat-overlap and RAC triggers |
| 4 | `Group4_Workbench_Queries.sql` | Booking and payment: fare function, the booking transaction (G4-3), ladies quota fallback (G4-4) |
| 5 | `Group5_Workbench_Queries.sql` | Cancellation, TDR and refunds: the cancellation chain (G5-3), the approved TDR chain (G5-4), five refusals (G5-5) |
| 6 | `Group6_Workbench_Queries.sql` | Ticket collector: chart, no-show on boarding (G6-3), staff not on duty (G6-5) |
| 7 | `Group7_Workbench_Queries.sql` | Reports and audit: RANK reports, occupancy view, the audit trigger (G7-5) |
| 8 | `Story_D_Chart_Preparation_Workbench.sql` | Chart preparation with the waiting-list purge (D-1 to D-3) |

`Shared_Leaders_Workbench_Queries.sql` does not exist in this repository, so it is not listed.

## 4. The five stories

| Story | Block | What it proves |
| :--- | :--- | :--- |
| Cancellation chain | `G5-3` in Group 5 | One CONFIRMED passenger cancels. The first RAC passenger becomes CONFIRMED and the first waiting-list passenger becomes RAC (trigger `trg_after_cancellation_promote` and `sp_promote_passenger`). A `PENDING` refund row is written and the cancelled row is kept (soft delete). |
| Approved TDR chain | `G5-4` in Group 5 | A passenger files a TDR for a train that is over 3 hours late and the admin approves it. A refund is written, the passenger is cancelled and the same chain moves. |
| No-show on boarding | `G6-3` in Group 6 | The ticket collector verifies a ticket and marks NO_SHOW. The seat is freed, the next RAC passenger becomes CONFIRMED, and boarding the no-show is refused. |
| Ladies quota full | `G4-4` in Group 4 | With the LADIES quota sold out, a booking without consent is refused (`SEAT_NOT_AVAILABLE`); with consent it falls back to the GENERAL quota and is CONFIRMED. |
| Chart preparation (Story D) | `D-1` to `D-3` in `Story_D_Chart_Preparation_Workbench.sql` | At chart time the 107 waiting-list passengers of run 1111 are cancelled, each gets a `PENDING` refund of fare minus insurance, the counters match the real queue, and 817 rows are written to `CHART_SNAPSHOT`. Everything is rolled back at the end. |

The stories that need an old date set the clock themselves with `SET @as_of_time = '2026-10-17 19:15:00';` (and reset it to NULL at the end), so they work on any real date.

## 5. Checking the files without Workbench

The files were run statement by statement against a freshly loaded seed with a small throwaway script: every query returns rows, and the only errors are the error demos marked `RUN ALONE (error demo)`.
