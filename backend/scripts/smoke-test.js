/**
 * Railway Reservation System - API Smoke Test
 * File: backend/scripts/smoke-test.js
 *
 * One command that proves the main parts of a RUNNING backend still work together.
 *
 *   npm run test:smoke                       (backend on http://localhost:5000)
 *   npm run test:smoke -- http://host:port   (another address)
 *
 * IMPORTANT - this script MAY CREATE TEST DATA in the live database:
 *   - one throwaway passenger account (smoke_<time>@example.com) and its password change
 *   - one held booking (PAYMENT_PENDING, released by the hold timer), one counter (walk-in) booking
 *   - one saved passenger (added, edited and deleted again)
 *   - it CANCELS one RAC booking on the demo chain run and BOARDS one CONFIRMED passenger there
 *   - one staff ticket verification
 * It never changes the password of a seed account. To get back to a clean demo afterwards run:
 *   npm run demo:refresh   then   npm run demo:chain
 *
 * Needs today's data: run "npm run demo:refresh" and "npm run demo:chain" first. The chain run (tomorrow, full train
 * with RAC and waiting list) and EMP-TC-101's duty on it are found through the API itself; no database access here.
 *
 * Prints a PASS / FAIL / SKIP table and "N passed, M failed". Exit code 0 only when nothing failed.
 * A failed CRITICAL check (health, the three logins, finding the chain run) stops the remaining checks (they show SKIP).
 */

const BASE = String(process.argv[2] || process.env.SMOKE_BASE_URL || 'http://localhost:5000').replace(/\/+$/, '');

const SEED_PASSENGER_PASSWORD = 'Demo@123';
const STAFF_LOGIN = { employeeId: 'EMP-TC-101', password: 'Demo@123' };
const ADMIN_LOGIN = { email: 'admin@rrms.in', password: 'Demo@123' };

const rows = [];
let halted = false;

function ymd(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
const TODAY = new Date();
const TOMORROW = ymd(new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + 1));

async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch (_) { json = null; }
  return { status: res.status, body: json, data: json && json.data !== undefined ? json.data : null };
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function need(value, what) {
  if (value === undefined || value === null) throw new Error(`needs ${what} from an earlier check`);
  return value;
}

async function check(name, critical, fn) {
  if (halted) {
    rows.push({ name, status: 'SKIP', detail: 'not run: an earlier critical check failed' });
    return false;
  }
  try {
    const detail = await fn();
    rows.push({ name, status: 'PASS', detail: detail || '' });
    return true;
  } catch (err) {
    rows.push({ name, status: 'FAIL', detail: err.message });
    if (critical) halted = true;
    return false;
  }
}

// What the checks share
const s = {};

async function main() {
  console.log(`Smoke test against ${BASE}  (tomorrow = ${TOMORROW})`);
  console.log('Note: this script may create test data (see the header of backend/scripts/smoke-test.js).\n');

  // ---- 1. Health --------------------------------------------------------------------------------------------
  await check('Health: MySQL and MongoDB are up', true, async () => {
    const r = await api('GET', '/api/health');
    expect(r.status === 200, `HTTP ${r.status}`);
    const services = (r.data && r.data.services) || {};
    expect(services.mysql && services.mysql.status === 'UP', 'MySQL is not UP');
    expect(services.mongodb && services.mongodb.status === 'UP', 'MongoDB is not UP');
    return 'mysql UP, mongodb UP';
  });

  // ---- 2. Logins --------------------------------------------------------------------------------------------
  await check('Admin login', true, async () => {
    const r = await api('POST', '/api/auth/admin/login', ADMIN_LOGIN);
    expect(r.status === 200 && r.data && r.data.token, `HTTP ${r.status}`);
    s.adminToken = r.data.token;
    return 'role ' + r.data.role;
  });

  await check('Staff login (EMP-TC-101)', true, async () => {
    const r = await api('POST', '/api/auth/staff/login', STAFF_LOGIN);
    expect(r.status === 200 && r.data && r.data.token, `HTTP ${r.status}`);
    s.staffToken = r.data.token;
    return 'role ' + r.data.role;
  });

  // ---- 3. Find the demo chain run (staff duty -> run -> RAC / CONFIRMED bookings -> owner) ----------------------
  await check('Demo chain found (staff duty, RAC and CONFIRMED bookings, owner)', true, async () => {
    const duty = await api('GET', '/api/staff/assignments/current', undefined, s.staffToken);
    expect(duty.status === 200 && duty.data && duty.data.scheduleId, `no TRAIN_DUTY for EMP-TC-101 (HTTP ${duty.status}); run npm run demo:chain`);
    s.chain = { scheduleId: duty.data.scheduleId, trainId: duty.data.schedule.trainId, journeyDate: duty.data.schedule.journeyDate };

    const q = `trainId=${s.chain.trainId}&journeyDate=${s.chain.journeyDate}&limit=200`;
    const rac = await api('GET', `/api/admin/bookings?bookingStatus=RAC&${q}`, undefined, s.adminToken);
    expect(rac.status === 200 && Array.isArray(rac.data) && rac.data.length > 0, 'no RAC booking on the chain run; run npm run demo:chain');
    s.racPnr = rac.data[0].pnr;
    const classType = rac.data[0].classType;

    const conf = await api('GET', `/api/admin/bookings?bookingStatus=CONFIRMED&${q}`, undefined, s.adminToken);
    const confirmed = (conf.data || []).filter((b) => b.classType === classType).sort((a, b) => Number(a.pnr) - Number(b.pnr));
    expect(confirmed.length >= 2, 'fewer than 2 CONFIRMED bookings on the chain run');
    s.ownerPnr = confirmed[0].pnr;
    s.ownerUserId = confirmed[0].userId;
    s.ownerName = confirmed[0].userName;
    s.boardCandidates = confirmed.slice(1).map((b) => b.pnr);   // the verify / board checks pick one that is not boarded yet

    const users = await api('GET', `/api/admin/users?search=${encodeURIComponent(s.ownerName)}`, undefined, s.adminToken);
    const owner = (users.data || []).find((u) => Number(u.userId) === Number(s.ownerUserId));
    expect(owner && owner.email, 'could not read the chain owner e-mail');
    s.ownerEmail = owner.email;
    return `run ${s.chain.scheduleId} (${s.chain.journeyDate}), RAC ${s.racPnr}, owner PNR ${s.ownerPnr}`;
  });

  await check('Passenger login (chain owner)', true, async () => {
    const r = await api('POST', '/api/auth/passenger/login', { email: need(s.ownerEmail, 'owner e-mail'), password: SEED_PASSENGER_PASSWORD });
    expect(r.status === 200 && r.data && r.data.token, `HTTP ${r.status}`);
    s.ownerToken = r.data.token;
    return 'role ' + r.data.role;
  });

  // ---- 4. Throwaway passenger (used for booking, saved passengers and the password change) ------------------------
  const stamp = Date.now();
  s.tmpEmail = `smoke_${stamp}@example.com`;
  s.tmpPassword = 'SmokePass#1234';
  await check('Register a throwaway passenger', false, async () => {
    const r = await api('POST', '/api/auth/passenger/register', {
      name: 'Smoke Test Passenger',
      email: s.tmpEmail,
      phone: `+91-9${String(stamp).slice(-9)}`,
      password: s.tmpPassword
    });
    expect(r.status === 201 && r.data && r.data.token, `HTTP ${r.status} ${r.body && r.body.error ? r.body.error.code : ''}`);
    s.tmpToken = r.data.token;
    return s.tmpEmail;
  });

  // ---- 5. Public data ---------------------------------------------------------------------------------------
  await check('Station list', false, async () => {
    const r = await api('GET', '/api/stations');
    expect(r.status === 200 && Array.isArray(r.data) && r.data.length >= 100, `HTTP ${r.status}, ${Array.isArray(r.data) ? r.data.length : 'no'} stations`);
    return `${r.data.length} stations`;
  });

  // Pick a train that is not the chain train: first train in the admin schedule list for tomorrow with a route
  await check('Train search for tomorrow', false, async () => {
    const sched = await api('GET', `/api/admin/schedules?from_date=${TOMORROW}&to_date=${TOMORROW}&limit=200`, undefined, s.adminToken);
    expect(sched.status === 200 && Array.isArray(sched.data), `schedule list HTTP ${sched.status}`);
    const candidates = sched.data.filter((x) => !x.chart_prepared_at && (!s.chain || x.trainId !== s.chain.trainId));
    for (const cand of candidates.slice(0, 25)) {
      const t = await api('GET', `/api/trains/${cand.trainId}`);
      const route = t.data && t.data.route;
      if (!route || route.length < 2) continue;
      const from = route[0];
      const to = route[route.length - 1];
      const found = await api('GET', `/api/trains/search?sourceStationId=${from.stationId}&destinationStationId=${to.stationId}&journeyDate=${TOMORROW}`);
      const hit = (found.data || []).find((x) => x.trainId === cand.trainId);
      const cls = hit && (hit.availableClasses || []).find((c) => c.availableSeats >= 1);
      if (hit && cls) {
        s.trip = { trainId: cand.trainId, from: from.stationId, to: to.stationId, classType: cls.classType, trainNumber: hit.trainNumber };
        return `train ${hit.trainNumber}, ${from.stationCode} -> ${to.stationCode}, class ${cls.classType} (${cls.availableSeats} seats)`;
      }
    }
    throw new Error('no train with free seats found for tomorrow');
  });

  await check('Availability for that train and class', false, async () => {
    const t = need(s.trip, 'a trip');
    const r = await api('GET', `/api/trains/${t.trainId}/availability?journeyDate=${TOMORROW}&classType=${t.classType}`);
    expect(r.status === 200 && r.body && r.body.success === true, `HTTP ${r.status} ${r.body && r.body.error ? r.body.error.message : ''}`);
    return `HTTP 200`;
  });

  // ---- 6. Booking -------------------------------------------------------------------------------------------
  const passenger = (name, ref) => ({ name, age: 34, gender: 'MALE', idProofType: 'AADHAAR', idProofReference: ref });

  await check('Create a hold booking (201, PAYMENT_PENDING)', false, async () => {
    const t = need(s.trip, 'a trip');
    const r = await api('POST', '/api/bookings', {
      trainId: t.trainId, journeyDate: TOMORROW, boardingStationId: t.from, destinationStationId: t.to,
      classType: t.classType, quota: 'GENERAL', passengers: [passenger('Smoke Hold', 'XXXX-XXXX-5001')],
      preferences: { autoUpgrade: false, berthCondition: false }
    }, need(s.tmpToken, 'the throwaway passenger'));
    expect(r.status === 201, `HTTP ${r.status} ${r.body && r.body.error ? r.body.error.code + ': ' + r.body.error.message : ''}`);
    const status = r.data.bookingStatus || r.data.status;
    expect(status === 'PAYMENT_PENDING', `status ${status}`);
    s.holdPnr = r.data.pnr;
    return `PNR ${r.data.pnr}, ${status}`;
  });

  await check('Refund estimate for a chain PNR', false, async () => {
    const r = await api('GET', `/api/bookings/${need(s.ownerPnr, 'the owner PNR')}/refund-estimate`, undefined, s.ownerToken);
    expect(r.status === 200 && r.data && typeof r.data.totalRefundAmount === 'number', `HTTP ${r.status}`);
    return `PNR ${s.ownerPnr}: refund ${r.data.totalRefundAmount}, charge ${r.data.totalCancellationCharge}`;
  });

  await check('Cancel a RAC PNR as admin (200)', false, async () => {
    const r = await api('POST', `/api/bookings/${need(s.racPnr, 'a RAC PNR')}/cancel`, {}, s.adminToken);
    expect(r.status === 200 && r.body.success === true, `HTTP ${r.status} ${r.body && r.body.error ? r.body.error.code : ''}`);
    return `PNR ${s.racPnr}, refund ${r.data.refundAmount}`;
  });

  await check('Second cancel of the same PNR is refused (400)', false, async () => {
    const r = await api('POST', `/api/bookings/${need(s.racPnr, 'a RAC PNR')}/cancel`, {}, s.adminToken);
    expect(r.status === 400 && r.body.success === false, `HTTP ${r.status}`);
    return `HTTP 400 ${r.body.error.code}`;
  });

  await check('TDR with a bad reason gives a validation error (400)', false, async () => {
    const r = await api('POST', '/api/tdr', { pnr: need(s.ownerPnr, 'the owner PNR'), passengerNos: [1], reason: 'NOT_A_REAL_REASON' }, s.ownerToken);
    expect(r.status === 400 && r.body.success === false, `HTTP ${r.status}`);
    return `HTTP 400 ${r.body.error.code}`;
  });

  // ---- 7. Staff on the chain run ----------------------------------------------------------------------------
  await check('Staff verifies a ticket on the chain run', false, async () => {
    // Take the first CONFIRMED booking whose passenger 1 is still CONFIRMED (a re-run finds the earlier one BOARDED)
    for (const pnr of need(s.boardCandidates, 'the CONFIRMED PNRs')) {
      const one = await api('GET', `/api/staff/pnr/${pnr}`, undefined, s.staffToken);
      const p1 = one.data && (one.data.passengers || []).find((p) => p.passengerNo === 1);
      if (p1 && p1.status === 'CONFIRMED') { s.boardPnr = pnr; break; }
    }
    expect(s.boardPnr, 'no CONFIRMED passenger left on the chain run to verify; run npm run demo:chain');
    const r = await api('POST', '/api/staff/verification', {
      pnr: s.boardPnr, passengerNo: 1, idChecked: true, concessionChecked: false, result: 'VALID', remarks: 'smoke test'
    }, s.staffToken);
    expect(r.status >= 200 && r.status < 300 && r.body.success === true, `HTTP ${r.status} ${r.body && r.body.error ? r.body.error.code : ''}`);
    return `PNR ${s.boardPnr} passenger 1`;
  });

  await check('Staff boards the passenger', false, async () => {
    const r = await api('POST', '/api/staff/boarding', { pnr: need(s.boardPnr, 'a CONFIRMED PNR'), passengerNo: 1 }, s.staffToken);
    expect(r.status >= 200 && r.status < 300 && r.body.success === true, `HTTP ${r.status} ${r.body && r.body.error ? r.body.error.code : ''}`);
    return `PNR ${s.boardPnr} BOARDED`;
  });

  await check('Counter booking for a walk-in (201)', false, async () => {
    const t = need(s.trip, 'a trip');
    const r = await api('POST', '/api/counter/bookings', {
      trainId: t.trainId, journeyDate: TOMORROW, boardingStationId: t.from, destinationStationId: t.to, classType: t.classType,
      quota: 'GENERAL', isWalkin: true, passengers: [passenger('Smoke Walkin', 'XXXX-XXXX-5002')], payment: { method: 'CASH' }
    }, s.staffToken);
    expect(r.status === 201, `HTTP ${r.status} ${r.body && r.body.error ? r.body.error.code + ': ' + r.body.error.message : ''}`);
    return `PNR ${r.data.pnr}`;
  });

  await check('POST /api/staff/promote no longer exists (404)', false, async () => {
    const r = await api('POST', '/api/staff/promote', { pnr: need(s.ownerPnr, 'a PNR'), passengerNo: 1 }, s.staffToken);
    expect(r.status === 404, `HTTP ${r.status}`);
    return 'HTTP 404';
  });

  // ---- 8. Saved passengers: add, list, edit, ownership, delete ----------------------------------------------
  await check('Saved passengers: add, list and edit', false, async () => {
    const body = { name: 'Smoke Saved', age: 41, gender: 'FEMALE', idProofType: 'AADHAAR', idProofReference: 'XXXX-XXXX-5003' };
    const add = await api('POST', '/api/saved-passengers', body, need(s.tmpToken, 'the throwaway passenger'));
    expect(add.status === 201 && add.data && add.data.passengerId, `add HTTP ${add.status}`);
    s.savedId = add.data.passengerId;
    const list = await api('GET', '/api/saved-passengers', undefined, s.tmpToken);
    expect(list.status === 200 && list.data.some((p) => p.passengerId === s.savedId), 'new saved passenger not in the list');
    const edit = await api('PUT', `/api/saved-passengers/${s.savedId}`, { ...body, age: 42 }, s.tmpToken);
    expect(edit.status === 200, `edit HTTP ${edit.status}`);
    return `passenger ${s.savedId}`;
  });

  await check('Saved passengers: another user cannot edit or delete it', false, async () => {
    const id = need(s.savedId, 'a saved passenger');
    const put = await api('PUT', `/api/saved-passengers/${id}`, { name: 'Intruder', age: 30, gender: 'MALE', idProofType: 'AADHAAR', idProofReference: 'X' }, s.ownerToken);
    expect(put.status === 404 || put.status === 403, `other user edit HTTP ${put.status}`);
    const del = await api('DELETE', `/api/saved-passengers/${id}`, undefined, s.ownerToken);
    expect(del.status === 404 || del.status === 403, `other user delete HTTP ${del.status}`);
    return `edit HTTP ${put.status}, delete HTTP ${del.status}`;
  });

  await check('Saved passengers: the owner deletes it', false, async () => {
    const id = need(s.savedId, 'a saved passenger');
    const del = await api('DELETE', `/api/saved-passengers/${id}`, undefined, s.tmpToken);
    expect(del.status === 200, `HTTP ${del.status}`);
    const list = await api('GET', '/api/saved-passengers', undefined, s.tmpToken);
    expect(!list.data.some((p) => p.passengerId === id), 'still in the list after delete');
    return 'deleted';
  });

  await check('Notifications list', false, async () => {
    const r = await api('GET', '/api/notifications', undefined, s.ownerToken);
    expect(r.status === 200 && Array.isArray(r.data), `HTTP ${r.status}`);
    return `${r.data.length} notifications`;
  });

  // ---- 9. Admin lists ---------------------------------------------------------------------------------------
  for (const [label, path] of [
    ['bookings', '/api/admin/bookings?limit=5'],
    ['users', '/api/admin/users'],
    ['schedules', '/api/admin/schedules?limit=5'],
    ['refund-transactions', '/api/admin/refund-transactions?limit=5']
  ]) {
    await check(`Admin list: ${label} (200)`, false, async () => {
      const r = await api('GET', path, undefined, s.adminToken);
      expect(r.status === 200 && r.body.success === true && Array.isArray(r.data), `HTTP ${r.status}`);
      return `${r.data.length} rows`;
    });
  }

  // ---- 10. Rules ---------------------------------------------------------------------------------------------
  await check('Booking for a past date is refused (JOURNEY_PAST)', false, async () => {
    // JOURNEY_PAST is only reached for a run that has left but has no chart yet. demo:refresh prepares the chart of
    // every run of today that has left, so use an older run (the original seed runs of October stay in the database
    // with no chart). The newest such run before today is picked.
    const today = ymd(TODAY);
    const sched = await api('GET', `/api/admin/schedules?from_date=2000-01-01&to_date=${ymd(new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - 1))}&limit=200`, undefined, s.adminToken);
    expect(sched.status === 200 && Array.isArray(sched.data), `schedule list HTTP ${sched.status}`);
    const left = sched.data.find((x) => !x.chartPreparedAt && x.journeyDate < today && x.classes && x.classes.length > 0);
    expect(left, 'no older run without a chart found (the October seed runs are missing)');
    const t = await api('GET', `/api/trains/${left.trainId}`);
    const route = (t.data && t.data.route) || [];
    expect(route.length >= 2, 'no route for the old run');
    const r = await api('POST', '/api/bookings', {
      trainId: left.trainId, journeyDate: left.journeyDate, boardingStationId: route[0].stationId, destinationStationId: route[route.length - 1].stationId,
      classType: left.classes[0].classCode, quota: 'GENERAL',
      passengers: [passenger('Smoke Past', 'XXXX-XXXX-5004')], preferences: { autoUpgrade: false, berthCondition: false }
    }, need(s.tmpToken, 'the throwaway passenger'));
    expect(r.status === 400 && r.body.error && r.body.error.code === 'JOURNEY_PAST', `HTTP ${r.status} ${r.body && r.body.error ? r.body.error.code : ''}`);
    return `train ${left.trainNumber} on ${left.journeyDate}: HTTP 400 JOURNEY_PAST`;
  });

  await check('Change password of the throwaway passenger', false, async () => {
    const newPassword = 'SmokePass#5678';
    const r = await api('POST', '/api/auth/change-password', { currentPassword: need(s.tmpPassword, 'a password'), newPassword }, need(s.tmpToken, 'the throwaway passenger'));
    expect(r.status === 200 && r.body.success === true, `HTTP ${r.status} ${r.body && r.body.error ? r.body.error.code : ''}`);
    const login = await api('POST', '/api/auth/passenger/login', { email: s.tmpEmail, password: newPassword });
    expect(login.status === 200, `login with the new password HTTP ${login.status}`);
    const old = await api('POST', '/api/auth/passenger/login', { email: s.tmpEmail, password: s.tmpPassword });
    expect(old.status === 401, `login with the old password HTTP ${old.status} (expected 401)`);
    return 'new password works, old one refused';
  });

  // ---- Result table -----------------------------------------------------------------------------------------
  const passed = rows.filter((r) => r.status === 'PASS').length;
  const failed = rows.filter((r) => r.status === 'FAIL').length;
  const skipped = rows.filter((r) => r.status === 'SKIP').length;

  const nameWidth = Math.max(5, ...rows.map((r) => r.name.length));
  console.log('\n' + '#'.padEnd(4) + 'Check'.padEnd(nameWidth + 2) + 'Result'.padEnd(8) + 'Detail');
  console.log('-'.repeat(4 + nameWidth + 2 + 8 + 40));
  rows.forEach((r, i) => {
    console.log(String(i + 1).padEnd(4) + r.name.padEnd(nameWidth + 2) + r.status.padEnd(8) + r.detail);
  });
  console.log('-'.repeat(4 + nameWidth + 2 + 8 + 40));
  console.log(`${passed} passed, ${failed} failed` + (skipped ? ` (${skipped} skipped after a critical failure)` : ''));
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exitCode = 1;
});
