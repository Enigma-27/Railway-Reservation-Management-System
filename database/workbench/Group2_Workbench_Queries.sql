-- =====================================================================================
-- RAILWAY RESERVATION & MANAGEMENT SYSTEM - GROUP 2 WORKBENCH QUERIES
-- Module: Network Topology & Timetables  (STATION, TRAIN, ROUTE_STOP, TRAIN_SCHEDULE)
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
-- G2-1  |  Paste under chapter 2.3  |  Data dictionary of the group tables
-- RUN: click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT
FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='railway_db' AND TABLE_NAME IN ('STATION','TRAIN','ROUTE_STOP','TRAIN_SCHEDULE')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- -------------------------------------------------------------------------------------
-- G2-2  |  Paste under chapter 2.5  |  Self-join on ROUTE_STOP: hop distance between halts
-- RUN: click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
SELECT t.train_number, sf.station_code AS from_stn, st.station_code AS to_stn,
       r1.stop_sequence AS from_seq, r2.stop_sequence AS to_seq,
       (r2.distance_from_origin - r1.distance_from_origin) AS hop_km
FROM ROUTE_STOP r1
JOIN ROUTE_STOP r2 ON r1.train_id = r2.train_id AND r1.stop_sequence < r2.stop_sequence
JOIN TRAIN t ON t.train_id = r1.train_id
JOIN STATION sf ON sf.station_id = r1.station_id
JOIN STATION st ON st.station_id = r2.station_id
WHERE r1.train_id = 101
ORDER BY hop_km DESC LIMIT 8;

-- -------------------------------------------------------------------------------------
-- G2-3  |  Paste under chapter 2.5  |  EXPLAIN plan of the self-join (uses the composite B-Tree index)
-- RUN: click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
EXPLAIN SELECT t.train_number, sf.station_code, st.station_code, (r2.distance_from_origin - r1.distance_from_origin) AS hop_km
FROM ROUTE_STOP r1
JOIN ROUTE_STOP r2 ON r1.train_id = r2.train_id AND r1.stop_sequence < r2.stop_sequence
JOIN TRAIN t ON t.train_id = r1.train_id
JOIN STATION sf ON sf.station_id = r1.station_id
JOIN STATION st ON st.station_id = r2.station_id
WHERE r1.train_id = 101;

-- -------------------------------------------------------------------------------------
-- G2-4  |  Paste under chapter 2.5  |  Route timetable of one train (view)
-- RUN: click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
SELECT train_number, train_name, stop_sequence, station_code, arrival_time, departure_time, distance_from_origin
FROM vw_train_master_schedule WHERE train_id = 101 ORDER BY stop_sequence;

-- -------------------------------------------------------------------------------------
-- G2-5  |  Paste under chapter 2.4.3  |  User-defined function fn_calculate_distance (100 km minimum)
-- RUN: click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
SELECT f.stop_sequence AS from_seq, t.stop_sequence AS to_seq,
       (t.distance_from_origin - f.distance_from_origin) AS actual_km,
       fn_calculate_distance(f.stop_id, t.stop_id) AS chargeable_km
FROM ROUTE_STOP f JOIN ROUTE_STOP t ON t.train_id = f.train_id AND t.stop_sequence > f.stop_sequence
WHERE f.train_id = 101 AND f.stop_sequence = 1 ORDER BY t.stop_sequence;

-- -------------------------------------------------------------------------------------
-- G2-6a  |  Paste under chapter 3.2  |  stop_sequence 0 rejected (CHECK)
-- RUN ALONE (error demo): click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
-- (a) stop_sequence 0  -> Error 3819 chk_stop_seq
INSERT INTO ROUTE_STOP (stop_id, train_id, station_id, stop_sequence, arrival_time, departure_time, day_offset, distance_from_origin, platform_number)
VALUES (99001, 101, 1, 0, '10:00:00', '10:05:00', 0, 0, 1);

-- -------------------------------------------------------------------------------------
-- G2-6b  |  Paste under chapter 3.2  |  Duplicate train + sequence rejected (UNIQUE)
-- RUN ALONE (error demo): click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
-- (b) same train and sequence twice -> Error 1062 uq_train_stop_seq
INSERT INTO ROUTE_STOP (stop_id, train_id, station_id, stop_sequence, arrival_time, departure_time, day_offset, distance_from_origin, platform_number)
VALUES (99002, 101, 1, 1, '10:00:00', '10:05:00', 0, 0, 1);

-- -------------------------------------------------------------------------------------
-- G2-6c  |  Paste under chapter 3.2  |  Unknown train rejected (FOREIGN KEY)
-- RUN ALONE (error demo): click inside the statement, Ctrl+Enter
-- -------------------------------------------------------------------------------------
-- (c) train that does not exist -> Error 1452 foreign key fails
INSERT INTO ROUTE_STOP (stop_id, train_id, station_id, stop_sequence, arrival_time, departure_time, day_offset, distance_from_origin, platform_number)
VALUES (99003, 999, 1, 20, '10:00:00', '10:05:00', 0, 0, 1);

-- NOTE: Group 2 has no stored procedure or trigger of its own in the database, so chapters 2.4.1 and 2.4.2 have no screenshot from this file.
