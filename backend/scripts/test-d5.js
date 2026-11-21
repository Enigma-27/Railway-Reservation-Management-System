/**
 * Railway Reservation System - Test Suite D5 (Prompt 13)
 * Live Trains, booking rules and fare preview, Cancel unpaid booking, payment fixes (real method, one open order,
 * expired orders, signed webhook, reconcile, "backend was down while the user paid"), TDR eligibility.
 * Uses the mock Razorpay gateway (no network, no money) and the seed clock (2026-10-17 19:15).
 */
require('./helpers/testClock');
const mockGateway = require('./helpers/mockRazorpay').install();
const crypto = require('crypto');
const app = require('../src/app');
const config = require('../src/config/env');
const { connectMongo, closeMongo } = require('../src/config/mongodb');
const pool = require('../src/config/mysql');
const { releaseExpiredHolds } = require('../src/services/holdCleanupService');
const { expireAbandonedOrders, reconcileDueOrders } = require('../src/services/paymentOrderService');

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

async function request(method, endpoint, body = null, token = null, rawBody = null, extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  const opts = { method, headers };
  if (rawBody !== null) opts.body = rawBody;
  else if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${endpoint}`, opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`  PASS: ${message}`);
}

const login = async (email) => (await request('POST', '/api/auth/passenger/login', { email, password: 'Demo@123' })).data.data.token;

const PAX = [{ name: 'Test Traveller One', age: 40, gender: 'FEMALE', idProofType: 'AADHAAR', idProofReference: 'XXXX-XXXX-5001', berthPreference: 'NO_BERTH' }];
const BOOKING = {
  trainId: 129, journeyDate: '2026-10-20', boardingStationId: 21, destinationStationId: 10,
  classType: '3A', quota: 'GENERAL', passengers: PAX, preferences: { berthCondition: false }
};

async function book(token, over = {}) {
  const r = await request('POST', '/api/bookings', { ...BOOKING, ...over }, token);
  assert(r.status === 201, `Booking created (${over.quota || 'GENERAL'}, ${(over.passengers || PAX).length} passenger(s))`);
  return r.data.data;
}

async function createOrder(token, pnr) {
  return request('POST', '/api/payments/razorpay/order', { pnr }, token);
}

function signedVerify(token, pnr, orderId, paymentId) {
  const sig = crypto.createHmac('sha256', config.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  return request('POST', '/api/payments/razorpay/verify', { pnr, razorpayOrderId: orderId, razorpayPaymentId: paymentId, razorpaySignature: sig }, token);
}

function webhook(event, secret, signatureOverride = null) {
  const raw = JSON.stringify(event);
  const sig = signatureOverride !== null ? signatureOverride : crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return request('POST', '/api/payments/razorpay/webhook', null, null, raw, { 'X-Razorpay-Signature': sig });
}

async function runTests() {
  const safety = setTimeout(() => { console.error('\n[FATAL] Suite test-d5 timed out'); process.exit(1); }, 240000);
  safety.unref();

  console.log('================================================================');
  console.log(' RAILWAY RESERVATION SYSTEM - SUITE D5 (LIVE TRAINS, RULES, PAYMENTS, TDR)');
  console.log('================================================================');
  await startServer();

  try {
    const rahul = await login('passenger@rrms.in');
    const priya = await login('chain@rrms.in');
    const admin = (await request('POST', '/api/auth/admin/login', { email: 'admin@rrms.in', password: 'Demo@123' })).data.data.token;
    const [[run]] = await pool.query("SELECT schedule_id FROM TRAIN_SCHEDULE WHERE train_id = 129 AND journey_date = '2026-10-20'");
    const runId = run.schedule_id;

    // ---------------------------------------------------------------- LIVE TRAINS
    console.log('\n--- LIVE TRAINS ---');
    const list = await request('GET', '/api/live-trains?date=2026-10-20&pageSize=100');
    assert(list.status === 200 && list.data.success === true, 'GET /api/live-trains is public and answers 200');
    assert(list.data.data.date === '2026-10-20' && list.data.data.trains.length > 0, 'The list holds the runs of the chosen date');
    const t129 = list.data.data.trains.find((t) => t.scheduleId === runId);
    assert(!!t129 && t129.trainNumber && t129.origin.stationId && t129.destination.stationId, 'A run carries train, origin and destination (with station ids)');

    // Seat numbers are the numbers of SCHEDULE_CLASS_INVENTORY
    const [inv] = await pool.query(
      `SELECT sc.class_code, i.total_seats, i.available_seats, i.rac_count, i.rac_capacity, i.wl_count, i.wl_capacity
         FROM SCHEDULE_CLASS_INVENTORY i JOIN SEAT_CLASS sc ON sc.class_id = i.class_id WHERE i.schedule_id = ?`, [runId]);
    assert(inv.length === t129.classes.length, 'Every inventory class of the run is listed');
    for (const row of inv) {
      const c = t129.classes.find((x) => x.classCode === row.class_code);
      assert(c && c.totalSeats === row.total_seats && c.availableSeats === row.available_seats && c.racCount === row.rac_count
        && c.waitingListCount === row.wl_count && c.bookedSeats === row.total_seats - row.available_seats,
      `Class ${row.class_code}: total, available, booked, RAC and WL equal the database inventory`);
    }

    const byType = await request('GET', `/api/live-trains?date=2026-10-20&type=${t129.trainType}&pageSize=100`);
    assert(byType.data.data.trains.every((t) => t.trainType === t129.trainType), 'Filter train type works');
    const byClass = await request('GET', '/api/live-trains?date=2026-10-20&class=3A&pageSize=100');
    assert(byClass.data.data.trains.every((t) => t.classes.some((c) => c.classCode === '3A')), 'Filter class works');
    const byQ = await request('GET', `/api/live-trains?date=2026-10-20&q=${encodeURIComponent(t129.trainNumber)}`);
    assert(byQ.data.data.trains.some((t) => t.scheduleId === runId), 'Search by train number works');
    const byRoute = await request('GET', `/api/live-trains?date=2026-10-20&from=${t129.origin.code}&to=${t129.destination.code}&pageSize=100`);
    assert(byRoute.data.data.trains.some((t) => t.scheduleId === runId), 'Filter from and to station works');
    const reversed = await request('GET', `/api/live-trains?date=2026-10-20&from=${t129.destination.code}&to=${t129.origin.code}&pageSize=100`);
    assert(!reversed.data.data.trains.some((t) => t.scheduleId === runId), 'A reversed route (to before from) does not list the train');
    assert((await request('GET', '/api/live-trains?date=2026-13-45')).status === 400, 'A bad date is refused with 400');
    assert((await request('GET', '/api/live-trains?status=FLYING')).status === 400, 'A bad status is refused with 400');
    const page1 = await request('GET', '/api/live-trains?date=2026-10-20&pageSize=5&page=1');
    assert(page1.data.data.trains.length === 5 && page1.data.data.total === list.data.data.total, 'Paging: 5 per page and the total is the same');

    // Delay shows with the same number as the alerts
    await pool.query('UPDATE TRAIN_SCHEDULE SET delay_minutes = 95, status = ? WHERE schedule_id = ?', ['DELAYED', runId]);
    const delayed = await request('GET', '/api/live-trains?date=2026-10-20&status=DELAYED&pageSize=100');
    const dRun = delayed.data.data.trains.find((t) => t.scheduleId === runId);
    assert(dRun && dRun.runStatus === 'DELAYED' && dRun.delayMinutes === 95, 'A delayed run shows DELAYED with its delay minutes');
    const alerts = await request('GET', '/api/alerts');
    // The alerts strip looks at CURDATE() .. +6 days of the pinned clock (2026-10-17 .. 2026-10-23)
    const alertRow = alerts.data.data.find((a) => a.scheduleId === runId);
    assert(alertRow && alertRow.delayMinutes === dRun.delayMinutes, 'The delay is the same number as the Alerts strip shows');
    await pool.query('UPDATE TRAIN_SCHEDULE SET delay_minutes = 0, status = ? WHERE schedule_id = ?', ['ON_TIME', runId]);

    const detail = await request('GET', `/api/live-trains/${runId}`);
    assert(detail.status === 200 && detail.data.data.classes.every((c) => Array.isArray(c.quotas) && c.quotas.length === 5), 'Detail: every class lists its 5 quotas');
    const dc = detail.data.data.classes.find((c) => c.classCode === '3A');
    assert(dc.fare > 0 && dc.quotas.every((q) => q.fare > 0), 'Detail: a current fare for every class and quota');
    assert(dc.quotas.find((q) => q.quota === 'GENERAL').totalSeats + dc.quotas.find((q) => q.quota === 'TATKAL').totalSeats > 0, 'Detail: quota seat shares are present');
    assert((await request('GET', '/api/live-trains/99999999')).status === 404, 'Detail of an unknown run is 404');

    // ---------------------------------------------------------------- BOOKING RULES
    console.log('\n--- BOOKING RULES AND FARE PREVIEW ---');
    const rules = await request('GET', '/api/booking-rules');
    assert(rules.status === 200 && rules.data.data.limits.maxPassengers === 6 && rules.data.data.limits.maxPassengersTatkal === 4, 'GET /api/booking-rules gives 6 passengers (4 for Tatkal) from SETTING');
    assert(rules.data.data.seniorCitizen.minAgeFemale === 45 && rules.data.data.seniorCitizen.minAgeMale === 60, 'Senior ages come from SETTING (45 women, 60 men)');
    const divy = rules.data.data.concessions.find((c) => c.type === 'DIVYAANG');
    assert(divy && divy.needsProof && divy.proofTypes.includes('UDID') && divy.discounts.some((d) => d.discountPct === 75), 'The concession list comes from CONCESSION_RULE (proofs and discount)');

    const tatkal5 = await request('POST', '/api/bookings', { ...BOOKING, quota: 'TATKAL', passengers: Array(5).fill(PAX[0]) }, rahul);
    assert(tatkal5.status === 400 && /at most 4/.test(tatkal5.data.error.message), 'The API refuses 5 passengers on a Tatkal booking (limit 4)');
    const general7 = await request('POST', '/api/bookings', { ...BOOKING, passengers: Array(7).fill(PAX[0]) }, rahul);
    assert(general7.status === 400 && /at most 6/.test(general7.data.error.message), 'The API refuses 7 passengers on a normal booking (limit 6)');

    const adult = { name: 'Asha Rao', age: 34, gender: 'FEMALE' };
    const child = { name: 'Little Rao', age: 3, gender: 'MALE' };
    const senior = { name: 'Old Rao', age: 70, gender: 'MALE', concessionType: 'DIVYAANG', idProofType: 'UDID', idProofReference: 'UDID-1' };
    const previewBody = { ...BOOKING, passengers: [adult, child, senior] };
    const pv = await request('POST', '/api/bookings/fare-preview', previewBody, rahul);
    assert(pv.status === 200 && pv.data.data.valid === true && pv.data.data.passengers.length === 3, 'Fare preview: 3 passengers, valid');
    assert(pv.data.data.passengers[2].concessionDiscount > 0 && pv.data.data.passengers[0].concessionDiscount === 0, 'Fare preview: the Divyaang passenger gets a discount, the others do not');
    const pvNoAdult = await request('POST', '/api/bookings/fare-preview', { ...BOOKING, passengers: [child] }, rahul);
    assert(pvNoAdult.data.data.valid === false && pvNoAdult.data.data.errors.some((e) => e.code === 'NO_ADULT_PASSENGER'), 'Fare preview: no adult is reported');
    const pvLadies = await request('POST', '/api/bookings/fare-preview', { ...BOOKING, quota: 'LADIES', passengers: [{ name: 'Mr X', age: 30, gender: 'MALE' }] }, rahul);
    assert(pvLadies.data.data.errors.some((e) => e.code === 'QUOTA_NOT_ELIGIBLE'), 'Fare preview: a man on the Ladies quota is reported');
    const pvSenior = await request('POST', '/api/bookings/fare-preview', { ...BOOKING, quota: 'SENIOR_CITIZEN', passengers: [{ name: 'Young', age: 50, gender: 'MALE' }, { name: 'Woman', age: 46, gender: 'FEMALE' }] }, rahul);
    assert(pvSenior.data.data.errors.filter((e) => e.code === 'QUOTA_NOT_ELIGIBLE').length === 1, 'Fare preview: senior ages (man 50 refused, woman 46 allowed)');
    const pvProof = await request('POST', '/api/bookings/fare-preview', { ...BOOKING, passengers: [adult, { ...senior, idProofReference: '' }] }, rahul);
    assert(pvProof.data.data.errors.some((e) => e.code === 'CONCESSION_PROOF_REQUIRED'), 'Fare preview: a concession without proof is reported');
    const pvTatkal = await request('POST', '/api/bookings/fare-preview', { ...BOOKING, quota: 'TATKAL', passengers: [adult, senior] }, rahul);
    assert(pvTatkal.data.data.warnings.some((w) => w.code === 'NO_CONCESSION_ON_TATKAL') && pvTatkal.data.data.passengers[1].concessionDiscount === 0, 'Fare preview: no concession on Tatkal (warning, full fare)');
    assert((await request('POST', '/api/bookings/fare-preview', previewBody)).status === 401, 'Fare preview needs a login');

    // The preview equals the real booking, line by line
    const real = await book(rahul, { passengers: [adult, child, senior] });
    const same = pv.data.data.passengers.every((p, i) => {
      const f = real.fareBreakdown[i];
      return Math.abs(p.totalFare - f.totalFare) < 0.005 && Math.abs(p.baseFare - f.baseFare) < 0.005 && Math.abs(p.gst - f.gst) < 0.005
        && Math.abs(p.concessionDiscount - f.concessionDiscount) < 0.005 && Math.abs(p.insurance - f.insurance) < 0.005;
    });
    assert(same && Math.abs(pv.data.data.totalFare - real.totalFare) < 0.005, 'The fare preview equals the real booking fare, line by line and in total');

    // ---------------------------------------------------------------- CANCEL UNPAID
    console.log('\n--- CANCEL UNPAID BOOKING ---');
    const [[invBefore]] = await pool.query('SELECT available_seats FROM SCHEDULE_CLASS_INVENTORY WHERE schedule_id = ? AND class_id = 3', [runId]);
    const unpaid = await book(rahul, { passengers: [adult, child] });
    const [[invHeld]] = await pool.query('SELECT available_seats FROM SCHEDULE_CLASS_INVENTORY WHERE schedule_id = ? AND class_id = 3', [runId]);
    assert(invHeld.available_seats === invBefore.available_seats - 2, 'The hold took 2 seats');
    assert((await request('POST', `/api/bookings/${unpaid.pnr}/cancel-unpaid`, {}, priya)).status === 403, 'Another passenger cannot cancel my unpaid booking (403)');
    const cu = await request('POST', `/api/bookings/${unpaid.pnr}/cancel-unpaid`, {}, rahul);
    assert(cu.status === 200 && cu.data.data.released === true, 'Cancel unpaid booking answers 200');
    const [[bk]] = await pool.query('SELECT status FROM BOOKING WHERE pnr = ?', [unpaid.pnr]);
    const [[invAfter]] = await pool.query('SELECT available_seats FROM SCHEDULE_CLASS_INVENTORY WHERE schedule_id = ? AND class_id = 3', [runId]);
    const [cancelledRes] = await pool.query("SELECT COUNT(*) AS n FROM RESERVATION WHERE pnr = ? AND status = 'CANCELLED'", [unpaid.pnr]);
    assert(bk.status === 'FAILED' && Number(cancelledRes[0].n) === 2 && invAfter.available_seats === invBefore.available_seats, 'The booking is FAILED, both reservations cancelled, the seats are back');
    assert((await request('POST', `/api/bookings/${unpaid.pnr}/cancel-unpaid`, {}, rahul)).status === 409, 'Cancelling the same booking again answers 409');
    const own = await request('GET', `/api/bookings/${real.pnr}`, null, rahul);
    assert(own.data.data.bookingStatus === 'PAYMENT_PENDING' && own.data.data.holdSecondsRemaining > 0 && own.data.data.passengers.every((p) => p.fare && p.fare.totalFare > 0), 'PNR detail of an unpaid booking has the hold time and the fare line of each passenger');

    // ---------------------------------------------------------------- PAYMENT: one open order, real method
    console.log('\n--- PAYMENT: ONE OPEN ORDER AND THE REAL METHOD ---');
    const o1 = await createOrder(rahul, real.pnr);
    const o2 = await createOrder(rahul, real.pnr);
    assert(o1.status === 200 && o2.status === 200 && o2.data.data.orderId === o1.data.data.orderId && o2.data.data.reused === true, 'Pressing Pay twice gives the SAME order (no second order)');
    const [orders1] = await pool.query('SELECT order_id FROM PAYMENT_ORDER WHERE pnr = ?', [real.pnr]);
    assert(orders1.length === 1, 'Only one PAYMENT_ORDER row exists for the booking');

    const pNet = mockGateway.addPayment(o1.data.data.orderId, 'captured', 'netbanking');
    const v1 = await signedVerify(rahul, real.pnr, o1.data.data.orderId, pNet.id);
    assert(v1.status === 200 && v1.data.success === true, 'Verify with a valid signature confirms the booking');
    const [[pay1]] = await pool.query('SELECT method FROM PAYMENT WHERE gateway_payment_id = ?', [pNet.id]);
    assert(pay1.method === 'NET_BANKING', 'PAYMENT.method is the real method from Razorpay (NET_BANKING), no longer always UPI');

    const methodCases = [
      ['upi', null, 'UPI'],
      ['card', { type: 'credit' }, 'CREDIT_CARD'],
      ['card', { type: 'debit' }, 'DEBIT_CARD'],
      ['wallet', null, 'UNKNOWN']
    ];
    for (const [method, card, expected] of methodCases) {
      const b = await book(rahul);
      const o = await createOrder(rahul, b.pnr);
      const p = mockGateway.addPayment(o.data.data.orderId, 'captured', method, card);
      const v = await signedVerify(rahul, b.pnr, o.data.data.orderId, p.id);
      const [[row]] = await pool.query('SELECT method FROM PAYMENT WHERE gateway_payment_id = ?', [p.id]);
      assert(v.status === 200 && row.method === expected, `Razorpay method ${method}${card ? ' (' + card.type + ')' : ''} is stored as ${expected}`);
    }
    // a payment the gateway cannot describe at all: UNKNOWN
    const bUnk = await book(rahul);
    const oUnk = await createOrder(rahul, bUnk.pnr);
    const unknownId = 'pay_notatgateway01';
    mockGateway.orders.get(oUnk.data.data.orderId).payments.push({ id: unknownId, order_id: oUnk.data.data.orderId, status: 'captured', amount: Math.round(bUnk.totalFare * 100) });
    const vUnk = await signedVerify(rahul, bUnk.pnr, oUnk.data.data.orderId, unknownId);
    const [[rowUnk]] = await pool.query('SELECT method FROM PAYMENT WHERE gateway_payment_id = ?', [unknownId]);
    assert(vUnk.status === 200 && rowUnk.method === 'UNKNOWN', 'A payment without a method is stored as UNKNOWN');

    // ---------------------------------------------------------------- WEBHOOK
    console.log('\n--- PAYMENT: SIGNED WEBHOOK ---');
    const SECRET = 'whsec_test_prompt13';
    config.RAZORPAY_WEBHOOK_SECRET = '';
    const bWh = await book(priya);
    const oWh = await createOrder(priya, bWh.pnr);
    const pWh = mockGateway.addPayment(oWh.data.data.orderId, 'captured', 'upi');
    const event = { event: 'payment.captured', payload: { payment: { entity: { id: pWh.id, order_id: oWh.data.data.orderId, status: 'captured' } } } };
    assert((await webhook(event, SECRET)).status === 503, 'Webhook without a configured secret answers 503');
    config.RAZORPAY_WEBHOOK_SECRET = SECRET;
    assert((await webhook(event, SECRET, 'deadbeef')).status === 400, 'Webhook with a bad signature is rejected (400)');
    const [[stillPending]] = await pool.query('SELECT status FROM BOOKING WHERE pnr = ?', [bWh.pnr]);
    assert(stillPending.status === 'PAYMENT_PENDING', 'A rejected webhook changed nothing');
    const w1 = await webhook(event, SECRET);
    assert(w1.status === 200 && w1.data.data.handled === true, 'A correctly signed payment.captured webhook is accepted (200)');
    const [[afterWh]] = await pool.query('SELECT status FROM BOOKING WHERE pnr = ?', [bWh.pnr]);
    const [[whPay]] = await pool.query('SELECT MAX(method) AS method, COUNT(*) AS n FROM PAYMENT WHERE pnr = ?', [bWh.pnr]);
    assert(afterWh.status === 'CONFIRMED' && Number(whPay.n) === 1 && whPay.method === 'UPI', 'The webhook confirmed the booking with ONE payment (method UPI)');
    const w2 = await webhook(event, SECRET);
    const w3 = await webhook(event, SECRET);
    const [[repeat]] = await pool.query('SELECT COUNT(*) AS n FROM PAYMENT WHERE pnr = ?', [bWh.pnr]);
    assert(w2.status === 200 && w3.status === 200 && Number(repeat.n) === 1, 'Repeated deliveries give no second payment');
    const [wOrder] = await pool.query('SELECT status FROM PAYMENT_ORDER WHERE order_id = ?', [oWh.data.data.orderId]);
    assert(wOrder[0].status === 'PAID', 'The order is PAID');
    const wUnknown = await webhook({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x', order_id: 'order_does_not_exist' } } } }, SECRET);
    assert(wUnknown.status === 200, 'A signed webhook for an unknown order is answered 200 (nothing to do)');
    config.RAZORPAY_WEBHOOK_SECRET = '';

    // ---------------------------------------------------------------- RECONCILE and BACKEND DOWN
    console.log('\n--- PAYMENT: RECONCILE ROUTE AND "BACKEND WAS DOWN WHILE THE USER PAID" ---');
    const bRc = await book(priya);
    const oRc = await createOrder(priya, bRc.pnr);
    assert((await request('POST', '/api/payments/razorpay/reconcile', { pnr: bRc.pnr }, priya)).data.data.paymentReceived === false, 'Reconcile before any payment: nothing received');
    mockGateway.addPayment(oRc.data.data.orderId, 'captured', 'netbanking');
    // Reconcile is limited to one call per PNR every 10 seconds
    await new Promise((r) => setTimeout(r, 10200));
    const rc = await request('POST', '/api/payments/razorpay/reconcile', { pnr: bRc.pnr }, priya);
    assert(rc.status === 200 && rc.data.data.paymentReceived === true && rc.data.data.bookingStatus === 'CONFIRMED', 'Reconcile finds the payment made at the gateway and confirms the booking');
    const rc2 = await request('POST', '/api/payments/razorpay/reconcile', { pnr: bRc.pnr }, priya);
    assert(rc2.status === 429, 'A second reconcile within 10 seconds is refused (429)');
    assert((await request('POST', '/api/payments/razorpay/reconcile', { pnr: bRc.pnr }, rahul)).status === 403, 'Reconcile of someone else\'s PNR is refused (403)');

    // The browser never called /verify (backend was down). The background job finds the paid order.
    const bDown = await book(priya);
    const oDown = await createOrder(priya, bDown.pnr);
    const pDown = mockGateway.addPayment(oDown.data.data.orderId, 'captured', 'upi');
    await pool.query("UPDATE PAYMENT_ORDER SET created_at = NOW() - INTERVAL 5 MINUTE WHERE order_id = ?", [oDown.data.data.orderId]);
    const job = await reconcileDueOrders({ minAgeMinutes: 1, maxAgeHours: 24, limit: 50 });
    const [[downBk]] = await pool.query('SELECT status FROM BOOKING WHERE pnr = ?', [bDown.pnr]);
    const [[downPay]] = await pool.query('SELECT COUNT(*) AS n FROM PAYMENT WHERE gateway_payment_id = ?', [pDown.id]);
    assert(!job.skipped && downBk.status === 'CONFIRMED' && Number(downPay.n) === 1, 'Backend down while paying: the reconcile job later confirms the ticket (inside the hold)');

    // ... and when the hold had already ended by the time the backend was back: automatic refund
    const bLate = await book(priya);
    const oLate = await createOrder(priya, bLate.pnr);
    mockGateway.addPayment(oLate.data.data.orderId, 'captured', 'upi');
    await pool.query('UPDATE BOOKING SET created_at = NOW() - INTERVAL 20 MINUTE WHERE pnr = ?', [bLate.pnr]);
    await pool.query("UPDATE PAYMENT_ORDER SET created_at = NOW() - INTERVAL 19 MINUTE WHERE order_id = ?", [oLate.data.data.orderId]);
    await releaseExpiredHolds();
    await new Promise((r) => setTimeout(r, 1500)); // the release closes abandoned orders in the background
    const [[lateOrder]] = await pool.query('SELECT status FROM PAYMENT_ORDER WHERE order_id = ?', [oLate.data.data.orderId]);
    const [[lateRefund]] = await pool.query(
      `SELECT r.reason, r.amount FROM REFUND r JOIN PAYMENT p ON p.payment_id = r.payment_id WHERE p.pnr = ?`, [bLate.pnr]);
    assert(lateOrder.status === 'LATE_PAID' && lateRefund && lateRefund.reason === 'PAYMENT_AFTER_EXPIRY', 'Paid after the hold ended: the order becomes LATE_PAID and the full amount is refunded automatically');

    // ---------------------------------------------------------------- EXPIRE ABANDONED ORDERS
    console.log('\n--- PAYMENT: ABANDONED ORDERS ARE CLOSED ---');
    const bAb = await book(priya);
    const oAb = await createOrder(priya, bAb.pnr);
    const [[openNow]] = await pool.query('SELECT status FROM PAYMENT_ORDER WHERE order_id = ?', [oAb.data.data.orderId]);
    assert(openNow.status === 'CREATED', 'An open order of a live booking stays CREATED');
    await expireAbandonedOrders();
    const [[stillOpen]] = await pool.query('SELECT status FROM PAYMENT_ORDER WHERE order_id = ?', [oAb.data.data.orderId]);
    assert(stillOpen.status === 'CREATED', 'The closer does not touch an order whose booking is still waiting for payment');
    await pool.query('UPDATE BOOKING SET created_at = NOW() - INTERVAL 20 MINUTE WHERE pnr = ?', [bAb.pnr]);
    await releaseExpiredHolds();
    await new Promise((r) => setTimeout(r, 1500));
    const [[closed]] = await pool.query('SELECT status FROM PAYMENT_ORDER WHERE order_id = ?', [oAb.data.data.orderId]);
    assert(closed.status === 'EXPIRED', 'When the hold is released, its unpaid order is closed (EXPIRED)');
    // a payment that still arrives on an EXPIRED order is not lost
    mockGateway.addPayment(oAb.data.data.orderId, 'captured', 'upi');
    await pool.query("UPDATE PAYMENT_ORDER SET created_at = NOW() - INTERVAL 5 MINUTE WHERE order_id = ?", [oAb.data.data.orderId]);
    await reconcileDueOrders({ minAgeMinutes: 1, maxAgeHours: 24, limit: 50 });
    const [[reopened]] = await pool.query('SELECT status FROM PAYMENT_ORDER WHERE order_id = ?', [oAb.data.data.orderId]);
    assert(reopened.status === 'LATE_PAID', 'A payment on an EXPIRED order is still found, marked LATE_PAID and refunded');
    // the cancel-unpaid button also closes the order
    const bCu = await book(priya);
    const oCu = await createOrder(priya, bCu.pnr);
    const cu2 = await request('POST', `/api/bookings/${bCu.pnr}/cancel-unpaid`, {}, priya);
    const [[cuOrder]] = await pool.query('SELECT status FROM PAYMENT_ORDER WHERE order_id = ?', [oCu.data.data.orderId]);
    assert(cu2.status === 200 && cuOrder.status === 'EXPIRED', 'Cancel unpaid booking closes the booking\'s open order');

    // ---------------------------------------------------------------- TDR
    console.log('\n--- TDR ELIGIBILITY AND FILING ---');
    const tdrPnr = real.pnr; // the first booking: confirmed above by the NET_BANKING payment (3 passengers)
    const [[tdrState]] = await pool.query('SELECT status FROM BOOKING WHERE pnr = ?', [tdrPnr]);
    assert(tdrState.status === 'CONFIRMED', 'Setup: the booking used for TDR is CONFIRMED');
    const el0 = await request('GET', `/api/tdr/eligibility/${tdrPnr}`, null, rahul);
    assert(el0.status === 200 && el0.data.data.passengers.length === 3 && el0.data.data.passengers.every((p) => p.name), 'Eligibility lists every passenger by name');
    const delayReason0 = el0.data.data.passengers[0].reasons.find((r) => r.code === 'TRAIN_DELAYED_OVER_3_HOURS');
    assert(delayReason0.eligible === false && /not delayed/.test(delayReason0.why), 'On time: "delayed over 3 hours" is not offered and says the train is not delayed');
    const journeyReason = el0.data.data.passengers[0].reasons.find((r) => r.code === 'AC_FAILURE');
    assert(journeyReason.eligible === false && /not left yet/.test(journeyReason.why), 'Before departure: the journey reasons say the train has not left yet');
    assert(el0.data.data.passengers[0].reasons.find((r) => r.code === 'TRAIN_DIVERTED').eligible === true, 'Before departure a confirmed passenger can use "diverted"');
    assert((await request('GET', `/api/tdr/eligibility/${tdrPnr}`, null, priya)).status === 403, 'Eligibility of someone else\'s PNR is refused (403)');

    const tryDelay = await request('POST', '/api/tdr', { pnr: tdrPnr, passengerNos: [1], reason: 'TRAIN_DELAYED_OVER_3_HOURS' }, rahul);
    assert(tryDelay.status === 400 && /not delayed/.test(tryDelay.data.error.message) && /Asha Rao/.test(tryDelay.data.error.message), 'The refusal names the passenger and says the train is not delayed (no more generic message)');

    await pool.query('UPDATE TRAIN_SCHEDULE SET delay_minutes = 200, status = ? WHERE schedule_id = ?', ['DELAYED', runId]);
    const el1 = await request('GET', `/api/tdr/eligibility/${tdrPnr}`, null, rahul);
    assert(el1.data.data.delayMinutes === 200 && el1.data.data.passengers[0].reasons.find((r) => r.code === 'TRAIN_DELAYED_OVER_3_HOURS').eligible === true, 'With a 200 minute delay the delay reason becomes valid');
    const filed = await request('POST', '/api/tdr', { pnr: tdrPnr, passengerNos: [1], reason: 'TRAIN_DELAYED_OVER_3_HOURS' }, rahul);
    assert(filed.status === 201 && filed.data.data.tdrRefNo, 'A TDR for a CONFIRMED passenger is filed');
    const el2 = await request('GET', `/api/tdr/eligibility/${tdrPnr}`, null, rahul);
    const dup = el2.data.data.passengers[0].reasons.find((r) => r.code === 'TRAIN_DELAYED_OVER_3_HOURS');
    assert(dup.eligible === false && /already/.test(dup.why), 'After filing, the same passenger shows "already filed" and passenger 2 is still eligible');
    assert(el2.data.data.passengers[1].reasons.find((r) => r.code === 'TRAIN_DELAYED_OVER_3_HOURS').eligible === true, 'The other passengers are still eligible');

    const [[fareLine]] = await pool.query('SELECT total_fare - insurance AS line FROM PASSENGER_BOOKING WHERE pnr = ? AND passenger_no = 1', [tdrPnr]);
    const approve = await request('PUT', `/api/admin/tdr/${filed.data.data.tdrRefNo}`, { status: 'APPROVED', refundAmount: Number(fareLine.line), remarks: 'Delay confirmed' }, admin);
    assert(approve.status === 200 && approve.data.data.status === 'APPROVED', 'The admin approves the TDR');
    const mine = await request('GET', '/api/tdr', null, rahul);
    const row = mine.data.data.find((t) => t.tdrRefNo === filed.data.data.tdrRefNo);
    assert(row && row.passengerName === 'Asha Rao' && row.trainNumber && row.reasonLabel && row.refundAmount === Number(fareLine.line), 'My TDR list shows the passenger name, train, reason, status and refund amount');
    assert(row.refundStatus === 'PENDING' || row.refundStatus === 'PROCESSED' || row.refundStatus === 'FAILED', 'My TDR list shows the refund status');
    await pool.query('UPDATE TRAIN_SCHEDULE SET delay_minutes = 0, status = ? WHERE schedule_id = ?', ['ON_TIME', runId]);

    // ---------------------------------------------------------------- SETTINGS and CONTACT
    console.log('\n--- CONTACT INFO, ADMIN FARES AND CONTACT MESSAGES ---');
    const ci = await request('GET', '/api/contact-info');
    assert(ci.status === 200 && ci.data.data.helpline && ci.data.data.email && ci.data.data.address, 'Contact info (helpline, e-mail, address) is read from SETTING');
    const upd = await request('PUT', '/api/admin/settings/CONTACT_HELPLINE', { value: '1800-000-1111 (demo)' }, admin);
    assert(upd.status === 200, 'Admin can change the helpline setting');
    assert((await request('GET', '/api/contact-info')).data.data.helpline === '1800-000-1111 (demo)', 'The contact panel value changes in one place');
    await request('PUT', '/api/admin/settings/CONTACT_HELPLINE', { value: '1800-000-0139 (demo number, 6 am to 10 pm)' }, admin);
    assert((await request('PUT', '/api/admin/settings/SENIOR_AGE_MALE', { value: '0' }, admin)).status === 400, 'A senior age of 0 is refused');
    const calc = await request('GET', '/api/admin/fares/calculate?classCode=3A&distanceKm=1000&trainType=RAJDHANI&quota=GENERAL&concession=NONE', null, admin);
    assert(calc.status === 200 && calc.data.data.totalFare > calc.data.data.baseFare, 'Admin fare calculator returns the real fare');
    assert((await request('GET', '/api/admin/fares/calculate?classCode=3A&distanceKm=1000', null, rahul)).status === 403, 'The fare calculator is admin only');

    const sent = await request('POST', '/api/contact', { name: 'Suite D5', email: 'd5@example.com', message: 'Hello from test suite D5' });
    if (sent.status === 201) {
      const msgs = await request('GET', '/api/admin/contact-messages?status=NEW', null, admin);
      const mine5 = msgs.data.data.find((m) => m.messageId === sent.data.data.messageId);
      assert(!!mine5 && mine5.status === 'NEW', 'The Contact Us message is listed for the admin');
      const done = await request('PATCH', `/api/admin/contact-messages/${mine5.messageId}`, { status: 'DONE' }, admin);
      assert(done.status === 200 && done.data.data.status === 'DONE' && done.data.data.handledAt, 'The admin marks the message done');
      assert((await request('GET', '/api/admin/contact-messages', null, rahul)).status === 403, 'Contact messages are admin only');
    } else {
      console.log('  [INFO] MongoDB not available: contact message checks skipped');
    }

    console.log('\n================================================================');
    console.log(` ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY!`);
    console.log('================================================================');
  } catch (err) {
    console.error('\nTEST SUITE FAILED WITH ERROR:', err);
    process.exitCode = 1;
  } finally {
    clearTimeout(safety);
    config.RAZORPAY_WEBHOOK_SECRET = '';
    await stopServer();
    await pool.end().catch(() => {});
    await closeMongo().catch(() => {});
    console.log('\n✓ Test suite test-d5.js finished.');
    if (require.main === module) process.exit(process.exitCode || 0);
  }
}

runTests().catch(async (err) => {
  console.error('\n[FATAL ERROR IN TEST SUITE]:', err);
  try { await stopServer(); await pool.end().catch(() => {}); await closeMongo().catch(() => {}); } catch (_) {}
  process.exit(1);
});
