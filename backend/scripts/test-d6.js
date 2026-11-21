/**
 * Railway Reservation System - Test Suite D6 (Prompt 15)
 * Short demo logins (TC101 alias), public PNR status (no personal data, rate limit), admin delay control (audit, Alerts, Live Trains),
 * counter duty check, Tatkal Aadhaar rule, real admin analytics, staff chart "not prepared" answer, and demo:clear (0 mismatches, repeatable).
 * Uses the seed clock (2026-10-17 19:15). NOTE: the last block runs demo:clear, so run this suite through test:all (it reloads the
 * seed before every suite) or run npm run demo:refresh afterwards.
 */
require('./helpers/testClock');
const mockGateway = require('./helpers/mockRazorpay').install();
void mockGateway;
const app = require('../src/app');
const { connectMongo } = require('../src/config/mongodb');
const pool = require('../src/config/mysql');

let server;
let baseUrl;
let totalTests = 0;
let passedTests = 0;

async function startServer() {
  await connectMongo().catch(() => {});
  return new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      console.log(`[Test Runner] Express test server listening on ${baseUrl}`);
      resolve();
    });
  });
}
async function stopServer() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    server.close(() => resolve());
  });
}
async function request(method, endpoint, body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${endpoint}`, opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
function assert(condition, message) {
  totalTests++;
  if (!condition) { console.error(`  FAIL: ${message}`); throw new Error(`Assertion failed: ${message}`); }
  passedTests++;
  console.log(`  PASS: ${message}`);
}

const PAX = [{ name: 'Test Traveller One', age: 40, gender: 'FEMALE', idProofType: 'AADHAAR', idProofReference: 'XXXX-XXXX-5001', berthPreference: 'NO_BERTH' }];
const BOOKING = {
  trainId: 129, journeyDate: '2026-10-20', boardingStationId: 21, destinationStationId: 10,
  classType: '3A', quota: 'GENERAL', passengers: PAX, preferences: { berthCondition: false },
};

async function runTests() {
  const safety = setTimeout(() => { console.error('\n[FATAL] Suite test-d6 timed out'); process.exit(1); }, 240000);
  safety.unref();
  console.log('================================================================');
  console.log(' RAILWAY RESERVATION SYSTEM - SUITE D6 (LOGINS, PUBLIC PNR, DELAY, RULES, ANALYTICS, CLEAR)');
  console.log('================================================================');
  await startServer();

  try {
    // ---------------------------------------------------------------- LOGINS
    console.log('\n--- SHORT DEMO LOGINS ---');
    const pax = await request('POST', '/api/auth/passenger/login', { email: 'passenger@rrms.in', password: 'Demo@123' });
    assert(pax.status === 200 && pax.data.data.token, 'passenger@rrms.in / Demo@123 signs in');
    const chain = await request('POST', '/api/auth/passenger/login', { email: 'chain@rrms.in', password: 'Demo@123' });
    assert(chain.status === 200, 'chain@rrms.in / Demo@123 signs in');
    const adminLogin = await request('POST', '/api/auth/admin/login', { email: 'admin@rrms.in', password: 'Demo@123' });
    assert(adminLogin.status === 200, 'admin@rrms.in / Demo@123 signs in');
    const staffShort = await request('POST', '/api/auth/staff/login', { employeeId: 'TC101', password: 'Demo@123' });
    assert(staffShort.status === 200 && staffShort.data.data.employeeId === 'EMP-TC-101', 'staff id TC101 is accepted and resolves to EMP-TC-101');
    const staffLong = await request('POST', '/api/auth/staff/login', { employeeId: 'EMP-TC-101', password: 'Demo@123' });
    assert(staffLong.status === 200, 'the long staff id EMP-TC-101 keeps working');
    const staffLower = await request('POST', '/api/auth/staff/login', { employeeId: 'tc101', password: 'Demo@123' });
    assert(staffLower.status === 200, 'tc101 (lower case) is accepted');
    const old = await request('POST', '/api/auth/passenger/login', { email: 'rahul.sharma@example.com', password: 'Password123!' });
    assert(old.status === 401, 'the old demo login no longer exists');
    const bad = await request('POST', '/api/auth/staff/login', { employeeId: 'TC101', password: 'wrong' });
    assert(bad.status === 401, 'wrong password is refused');
    const tPax = pax.data.data.token;
    const tAdmin = adminLogin.data.data.token;
    const tStaff = staffShort.data.data.token;

    // ---------------------------------------------------------------- ADMIN DELAY
    console.log('\n--- ADMIN DELAY CONTROL ---');
    const [[run]] = await pool.query("SELECT schedule_id FROM TRAIN_SCHEDULE WHERE train_id = 129 AND journey_date = '2026-10-20'");
    const sid = run.schedule_id;
    const noAuth = await request('POST', `/api/admin/schedules/${sid}/delay`, { delayMinutes: 30 }, tPax);
    assert(noAuth.status === 403, 'a passenger cannot set a delay (403)');
    const staffTry = await request('POST', `/api/admin/schedules/${sid}/delay`, { delayMinutes: 30 }, tStaff);
    assert(staffTry.status === 403, 'staff cannot use the admin delay route (403)');
    const badMin = await request('POST', `/api/admin/schedules/${sid}/delay`, { delayMinutes: -5 }, tAdmin);
    assert(badMin.status === 400, 'a negative delay is refused (400)');
    const badMax = await request('POST', `/api/admin/schedules/${sid}/delay`, { delayMinutes: 5000 }, tAdmin);
    assert(badMax.status === 400, 'a delay above 1440 minutes is refused (400)');
    const unknown = await request('POST', '/api/admin/schedules/99999999/delay', { delayMinutes: 10 }, tAdmin);
    assert(unknown.status === 404, 'an unknown run answers 404');

    const [[auditBefore]] = await pool.query("SELECT COUNT(*) AS n FROM AUDIT_LOG WHERE table_name = 'TRAIN_SCHEDULE' AND record_id = ?", [String(sid)]);
    const set = await request('POST', `/api/admin/schedules/${sid}/delay`, { delayMinutes: 95, reason: 'Signal failure near Vadodara' }, tAdmin);
    assert(set.status === 200 && set.data.data.delayMinutes === 95 && set.data.data.status === 'DELAYED', 'admin sets a 95 minute delay (status DELAYED)');
    const [[row]] = await pool.query('SELECT delay_minutes, status FROM TRAIN_SCHEDULE WHERE schedule_id = ?', [sid]);
    assert(Number(row.delay_minutes) === 95 && row.status === 'DELAYED', 'the same TRAIN_SCHEDULE row the staff use now holds the delay');
    const alerts = await request('GET', '/api/alerts');
    assert(alerts.data.data.some((a) => a.scheduleId === sid && a.delayMinutes === 95), 'the public Alerts strip shows the delay');
    const live = await request('GET', '/api/live-trains?date=2026-10-20&pageSize=100');
    const liveRow = live.data.data.trains.find((t) => t.scheduleId === sid);
    assert(liveRow && liveRow.delayMinutes === 95 && liveRow.runStatus === 'DELAYED', 'Live Trains shows the run as DELAYED with 95 minutes');
    const [[auditAfter]] = await pool.query("SELECT COUNT(*) AS n FROM AUDIT_LOG WHERE table_name = 'TRAIN_SCHEDULE' AND record_id = ?", [String(sid)]);
    assert(Number(auditAfter.n) === Number(auditBefore.n) + 1, 'one AUDIT_LOG entry was written for the change');
    const [[auditRow]] = await pool.query("SELECT action, new_value FROM AUDIT_LOG WHERE table_name = 'TRAIN_SCHEDULE' AND record_id = ? ORDER BY log_id DESC LIMIT 1", [String(sid)]);
    assert(auditRow.action === 'UPDATE_SCHEDULE_DELAY' && String(JSON.stringify(auditRow.new_value)).includes('Vadodara'), 'the audit entry names the action and keeps the reason');

    const clear = await request('POST', `/api/admin/schedules/${sid}/delay`, { delayMinutes: 0 }, tAdmin);
    assert(clear.status === 200 && clear.data.data.status === 'ON_TIME' && clear.data.data.previousDelayMinutes === 95, 'admin clears the delay (back to ON_TIME)');
    const alerts2 = await request('GET', '/api/alerts');
    assert(!alerts2.data.data.some((a) => a.scheduleId === sid), 'the Alerts strip no longer lists the run');
    await pool.query("UPDATE TRAIN_SCHEDULE SET status = 'CANCELLED' WHERE schedule_id = ?", [sid]);
    const cancelled = await request('POST', `/api/admin/schedules/${sid}/delay`, { delayMinutes: 10 }, tAdmin);
    assert(cancelled.status === 409, 'a cancelled run cannot get a delay (409)');
    await pool.query("UPDATE TRAIN_SCHEDULE SET status = 'ON_TIME' WHERE schedule_id = ?", [sid]);

    // ---------------------------------------------------------------- TATKAL AADHAAR
    console.log('\n--- TATKAL AADHAAR RULE (BR-Q3) ---');
    await pool.query('UPDATE USER_ACCOUNT SET aadhaar_verified = 0 WHERE email = ?', ['passenger@rrms.in']);
    const noAadhaar = await request('POST', '/api/bookings', { ...BOOKING, quota: 'TATKAL' }, tPax);
    assert(noAadhaar.status === 400 && noAadhaar.data.error.code === 'AADHAAR_REQUIRED', 'Tatkal with an unverified account is refused (AADHAAR_REQUIRED)');
    await pool.query('UPDATE USER_ACCOUNT SET aadhaar_verified = 1 WHERE email = ?', ['passenger@rrms.in']);
    const withAadhaar = await request('POST', '/api/bookings', { ...BOOKING, quota: 'TATKAL' }, tPax);
    assert(withAadhaar.status === 201, 'Tatkal with a verified account is accepted');
    const general = await request('POST', '/api/bookings', BOOKING, tPax);
    assert(general.status === 201, 'a General booking never needed the Aadhaar check');

    // ---------------------------------------------------------------- COUNTER DUTY
    console.log('\n--- COUNTER DUTY CHECK ---');
    const counterBody = { trainId: 129, journeyDate: '2026-10-20', boardingStationId: 21, destinationStationId: 10, classType: '3A', quota: 'GENERAL', isWalkin: true, passengers: PAX, payment: { method: 'CASH' } };
    const withDuty = await request('POST', '/api/counter/bookings', counterBody, tStaff);
    assert(withDuty.status === 201, 'staff with an active COUNTER_DUTY shift can book at the counter');
    await pool.query("DELETE FROM STAFF_ASSIGNMENT WHERE staff_id = 1 AND duty_type = 'COUNTER_DUTY'");
    const noDuty = await request('POST', '/api/counter/bookings', counterBody, tStaff);
    assert(noDuty.status === 403, 'without an active counter duty the counter booking is refused (403)');
    await pool.query("INSERT INTO STAFF_ASSIGNMENT (assign_id, staff_id, schedule_id, station_id, duty_type, shift_start, shift_end) VALUES (4, 1, NULL, 10, 'COUNTER_DUTY', '2026-01-01 00:00:00', '2036-12-31 23:59:59')");
    const tatkalNoProof = await request('POST', '/api/counter/bookings', { ...counterBody, quota: 'TATKAL', passengers: [{ ...PAX[0], idProofType: 'PAN', idProofReference: 'ABCDE1234F' }] }, tStaff);
    assert(tatkalNoProof.status === 400 && tatkalNoProof.data.error.code === 'AADHAAR_REQUIRED', 'counter Tatkal without an Aadhaar proof is refused (BR-CB5)');
    const tatkalProof = await request('POST', '/api/counter/bookings', { ...counterBody, quota: 'TATKAL', passengers: [{ ...PAX[0], idProofType: 'AADHAAR', idProofReference: 'XXXX-XXXX-4321' }] }, tStaff);
    assert(tatkalProof.status !== 400 || tatkalProof.data.error.code !== 'AADHAAR_REQUIRED', 'counter Tatkal with an Aadhaar proof passes the Aadhaar rule');

    // ---------------------------------------------------------------- ANALYTICS
    console.log('\n--- REAL ADMIN ANALYTICS ---');
    const forbidden = await request('GET', '/api/admin/analytics/summary', null, tPax);
    assert(forbidden.status === 403, 'analytics are admin only (403 for a passenger)');
    for (const tab of ['revenue', 'bookings', 'cancellations', 'occupancy', 'delays', 'complaints']) {
      const r = await request('GET', `/api/admin/analytics/${tab}`, null, tAdmin);
      assert(r.status === 200 && Array.isArray(r.data.data), `analytics/${tab} answers a list`);
    }
    const sum = await request('GET', '/api/admin/analytics/summary', null, tAdmin);
    const [[dbB]] = await pool.query("SELECT COUNT(*) AS n FROM BOOKING WHERE status <> 'FAILED'");
    const [[dbP]] = await pool.query("SELECT COALESCE(SUM(amount), 0) AS s FROM PAYMENT WHERE status = 'SUCCESS'");
    assert(sum.data.data.bookings === Number(dbB.n), 'summary.bookings equals the database count');
    assert(Math.abs(sum.data.data.revenue - Number(dbP.s)) < 0.01, 'summary.revenue equals the sum of SUCCESS payments');
    const notif = await request('GET', '/api/admin/analytics/notifications', null, tAdmin);
    assert(notif.status === 200 && typeof notif.data.data.total === 'number', 'analytics/notifications counts the real notifications');
    const unk = await request('GET', '/api/admin/analytics/nothing', null, tAdmin);
    assert(unk.status === 400, 'an unknown analytics tab is refused (400)');

    // ---------------------------------------------------------------- STAFF CHART
    console.log('\n--- STAFF CHART NOT PREPARED ---');
    const chart = await request('GET', '/api/staff/schedules/1001/chart', null, tStaff);
    assert(chart.status === 200 && chart.data.chartPrepared === false && chart.data.data.length === 0, 'an unprepared chart answers 200 with chartPrepared false (no 400)');

    // ---------------------------------------------------------------- PUBLIC PNR
    console.log('\n--- PUBLIC PNR STATUS ---');
    const [[sample]] = await pool.query("SELECT b.pnr, pb.name FROM BOOKING b JOIN PASSENGER_BOOKING pb ON pb.pnr = b.pnr WHERE b.status IN ('CONFIRMED', 'RAC', 'WAITING_LIST') ORDER BY b.created_at DESC LIMIT 1");
    const pub = await request('GET', `/api/pnr-status/${sample.pnr}`);
    assert(pub.status === 200 && pub.data.data.pnr === sample.pnr, 'GET /api/pnr-status/:pnr needs no login and answers 200');
    const text = JSON.stringify(pub.data);
    assert(!text.includes(sample.name), 'the answer does not contain the passenger name');
    const bannedKeys = ['name', 'age', 'gender', 'email', 'phone', 'idProof', 'userId', 'user_id', 'fare', 'seatNumber', 'coachNumber', 'totalFare'];
    assert(bannedKeys.every((k) => !new RegExp(`"${k}"`, 'i').test(text)), 'no name, age, gender, contact, ID, fare or seat field is exposed');
    assert(pub.data.data.passengers.length > 0 && pub.data.data.passengers.every((p) => ['CNF', 'RAC', 'WL', 'CAN'].includes(p.shortStatus)), 'each passenger has only a short status (CNF, RAC, WL)');
    assert(pub.data.data.boardingStation.stationCode && pub.data.data.destinationStation.stationCode && pub.data.data.trainNumber && pub.data.data.journeyDate, 'train, date and route are included');
    assert((await request('GET', '/api/pnr-status/12345')).status === 400, 'a PNR that is not 10 digits is refused (400)');
    assert((await request('GET', '/api/pnr-status/0000000000')).status === 404, 'an unknown PNR answers 404');
    let limited = null;
    for (let i = 0; i < 20 && !limited; i++) {
      const r = await request('GET', `/api/pnr-status/${sample.pnr}`);
      if (r.status === 429) limited = r;
    }
    assert(limited && limited.data.error.code === 'TOO_MANY_REQUESTS', 'after about 15 lookups in a minute the endpoint answers 429 (rate limit)');

    // ---------------------------------------------------------------- DEMO CLEAR (last: it removes every booking)
    console.log('\n--- DEMO CLEAR ---');
    const { main: demoClear } = require('./demo-clear');
    const savedExit = process.exitCode;
    await demoClear();
    const [[left]] = await pool.query('SELECT (SELECT COUNT(*) FROM BOOKING) AS b, (SELECT COUNT(*) FROM RESERVATION) AS r, (SELECT COUNT(*) FROM PAYMENT) AS p, (SELECT COUNT(*) FROM PAYMENT_ORDER) AS o, (SELECT COUNT(*) FROM REFUND) AS f, (SELECT COUNT(*) FROM TDR_FILING) AS t, (SELECT COUNT(*) FROM CHART_SNAPSHOT) AS c');
    assert(Object.values(left).every((v) => Number(v) === 0), 'demo:clear leaves 0 bookings, reservations, payments, orders, refunds, TDRs and chart rows');
    const { auditInventory } = require('./helpers/simulationHelper');
    const a1 = await auditInventory(pool);
    assert(a1.mismatches === 0, `inventory audit after demo:clear: ${a1.totalInventories} inventories, 0 mismatches`);
    const [[full]] = await pool.query('SELECT COUNT(*) AS n FROM SCHEDULE_CLASS_INVENTORY WHERE available_seats <> total_seats OR rac_count <> 0 OR wl_count <> 0');
    assert(Number(full.n) === 0, 'every inventory row is back to all seats free, no RAC, no waiting list');
    const [[kept]] = await pool.query('SELECT (SELECT COUNT(*) FROM USER_ACCOUNT) AS u, (SELECT COUNT(*) FROM TRAIN_SCHEDULE) AS s, (SELECT COUNT(*) FROM SAVED_PASSENGER) AS sp, (SELECT COUNT(*) FROM FARE) AS f');
    assert(Number(kept.u) > 50000 && Number(kept.s) > 0 && Number(kept.sp) > 0 && Number(kept.f) > 0, 'users, saved passengers, schedules and fares are untouched');
    await demoClear();
    const [[left2]] = await pool.query('SELECT COUNT(*) AS n FROM BOOKING');
    assert(Number(left2.n) === 0, 'demo:clear can run again on an empty database (repeatable)');
    process.exitCode = savedExit;
    const afterClear = await request('GET', '/api/live-trains?date=2026-10-20&pageSize=100');
    assert(afterClear.status === 200 && afterClear.data.data.trains.every((t) => t.classes.every((c) => c.availableSeats === c.totalSeats)), 'Live Trains works on the empty database (all seats free)');
    const emptySum = await request('GET', '/api/admin/analytics/summary', null, tAdmin);
    assert(emptySum.status === 200 && emptySum.data.data.bookings === 0 && emptySum.data.data.revenue === 0, 'analytics summary shows zeros on the empty database');
    const emptyRev = await request('GET', '/api/admin/analytics/revenue', null, tAdmin);
    assert(emptyRev.status === 200 && emptyRev.data.data.length === 0, 'revenue report is an empty list on the empty database');

    console.log('\n================================================================');
    console.log(` ALL ${passedTests}/${totalTests} TESTS PASSED`);
    console.log('================================================================');
  } catch (err) {
    console.error('\n[SUITE ERROR]', err.message);
    process.exitCode = 1;
  } finally {
    await stopServer();
    await pool.end().catch(() => {});
    process.exit(process.exitCode || 0);
  }
}

runTests();
