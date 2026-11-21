const crypto = require('crypto');
const pool = require('../config/mysql');
const config = require('../config/env');
const AppError = require('../utils/appError');
const { safeMongoInsert } = require('../config/mongodb');
const {
  toPaise,
  getRazorpayClient,
  isClientOverridden,
  setRefundResult,
  processRefundsByIds,
  summarizeGatewayResult
} = require('./gatewayRefundService');

/**
 * Payment orders live in MySQL (PAYMENT_ORDER). MongoDB keeps only an optional audit copy.
 * The only code that confirms a payment is sp_confirm_payment. The amount always comes from
 * BOOKING.total_fare in the database, never from the browser or from Razorpay.
 *
 * Three doors lead here and all use the same confirm path:
 *   1. POST /api/payments/razorpay/verify     (browser success callback)
 *   2. reconcileOrder / POST .../reconcile    (ask Razorpay what happened to the order)
 *   3. POST /api/payments/razorpay/webhook    (Razorpay tells us)
 */

function gatewayKeysPresent() {
  return Boolean(config.RAZORPAY_KEY_ID && config.RAZORPAY_KEY_SECRET);
}

/** Turn raw SQL errors from sp_confirm_payment (RESIGNAL) into clear 400 errors instead of a generic 500. */
function mapConfirmError(err) {
  const text = `${err && err.sqlMessage ? err.sqlMessage : ''} ${err && err.message ? err.message : ''}`;
  if (text.includes('PAYMENT_AMOUNT_MISMATCH')) {
    return new AppError('PAYMENT_AMOUNT_MISMATCH', 'The payment amount does not match the booking fare. No ticket was issued.', 400);
  }
  if (text.includes('PAYMENT_AMOUNT_INVALID')) {
    return new AppError('PAYMENT_AMOUNT_INVALID', 'The payment amount is not valid. No ticket was issued.', 400);
  }
  return err;
}

/**
 * The PAYMENT.method value for a Razorpay payment object. Razorpay says card / upi / netbanking / wallet / emi ...
 * A card is CREDIT_CARD or DEBIT_CARD from card.type. Anything else, or no answer, is UNKNOWN.
 */
function methodFromGatewayPayment(payment) {
  if (!payment || typeof payment.method !== 'string') return 'UNKNOWN';
  switch (payment.method.toLowerCase()) {
    case 'upi': return 'UPI';
    case 'netbanking': return 'NET_BANKING';
    case 'card': {
      const type = payment.card && typeof payment.card.type === 'string' ? payment.card.type.toLowerCase() : '';
      if (type === 'credit') return 'CREDIT_CARD';
      if (type === 'debit') return 'DEBIT_CARD';
      return 'UNKNOWN';
    }
    default: return 'UNKNOWN';
  }
}

/** Ask Razorpay for the payment (to learn the real method). Any problem gives null, so the method becomes UNKNOWN. */
async function fetchGatewayPayment(gatewayPaymentId) {
  try {
    if (!gatewayKeysPresent() && !isClientOverridden()) return null;
    const razorpay = getRazorpayClient();
    if (!razorpay.payments || typeof razorpay.payments.fetch !== 'function') return null;
    return await razorpay.payments.fetch(gatewayPaymentId);
  } catch (err) {
    console.error(`[PAYMENT] Could not fetch payment ${gatewayPaymentId} to read its method: ${err && err.message ? err.message : err}`);
    return null;
  }
}

/**
 * Confirm one gateway payment for an order. Idempotent: the same gateway payment id never creates
 * a second PAYMENT row (sp_confirm_payment returns the earlier result). A per-order database lock
 * makes two callers (verify, webhook, reconcile) wait for each other instead of racing.
 *
 * paymentInfo is the Razorpay payment object when the caller already has it (reconcile); otherwise it is fetched
 * here so that PAYMENT.method stores what the customer really used (UPI, NET_BANKING, a card, or UNKNOWN).
 *
 * @returns {Promise<{late:boolean, bookingStatus:string, paymentId:number, refund?:Object}>}
 */
async function confirmOrderPayment(order, gatewayPaymentId, paymentInfo = null) {
  const gatewayPayment = paymentInfo && paymentInfo.method ? paymentInfo : await fetchGatewayPayment(gatewayPaymentId);
  const method = methodFromGatewayPayment(gatewayPayment);
  const conn = await pool.getConnection();
  const lockName = `payment_order_${order.order_id}`;
  let locked = false;
  try {
    const [[lockRow]] = await conn.query('SELECT GET_LOCK(?, 15) AS got', [lockName]);
    locked = Number(lockRow.got) === 1;
    if (!locked) {
      throw new AppError('SERVICE_UNAVAILABLE', 'This payment is being processed. Please check again in a moment.', 503);
    }

    // Amount comes from the database booking, and must equal what the order was created for
    const [bookingRows] = await conn.query('SELECT pnr, user_id, total_fare, status FROM BOOKING WHERE pnr = ?', [order.pnr]);
    if (bookingRows.length === 0) throw new AppError('NOT_FOUND', 'Booking not found', 404);
    const booking = bookingRows[0];
    if (Number(order.amount_paise) !== toPaise(booking.total_fare)) {
      throw new AppError('BAD_REQUEST', 'Order amount mismatch', 400);
    }

    try {
      // CALL and SELECT @out on the SAME connection (session variables are per connection)
      await conn.query(
        'CALL sp_confirm_payment(?, ?, ?, ?, 1, @out_pay_status, @out_pay_id)',
        [order.pnr, booking.total_fare, method, gatewayPaymentId]
      );
    } catch (err) {
      throw mapConfirmError(err);
    }
    const [[out]] = await conn.query('SELECT @out_pay_status AS status, @out_pay_id AS payment_id');
    if (!out || out.status === null || out.status === undefined) {
      throw new AppError('INTERNAL_SERVER_ERROR', 'Failed to confirm payment via procedure', 500);
    }

    const late = out.status === 'LATE';
    // Record the order result (INVALID_TRANSITION just means an earlier call already did it)
    await conn.query('CALL sp_set_payment_order_result(?, ?, ?, @out_order_status)', [
      order.order_id, late ? 'LATE_PAID' : 'PAID', gatewayPaymentId
    ]);

    const result = { late, bookingStatus: late ? 'FAILED' : out.status, paymentId: out.payment_id, userId: booking.user_id, totalFare: booking.total_fare };

    if (late) {
      // SQL wrote a PENDING refund for the late payment; the gateway service sends it and records the result
      const [refundRows] = await conn.query(
        `SELECT r.refund_id, r.amount, r.reason, r.status
         FROM REFUND r JOIN PAYMENT p ON r.payment_id = p.payment_id
         WHERE p.gateway_payment_id = ? LIMIT 1`,
        [gatewayPaymentId]
      );
      const refundRow = refundRows[0] || null;
      let gatewayRefund = 'SKIPPED';
      let refundStatus = refundRow ? refundRow.status : 'PENDING';
      if (refundRow) {
        const gwResults = await processRefundsByIds([refundRow.refund_id]);
        gatewayRefund = summarizeGatewayResult(gwResults);
        const [[fresh]] = await conn.query('SELECT status FROM REFUND WHERE refund_id = ?', [refundRow.refund_id]);
        if (fresh) refundStatus = fresh.status;
      }
      result.refund = {
        refundId: refundRow ? refundRow.refund_id : null,
        amount: Number(booking.total_fare),
        reason: refundRow ? refundRow.reason : 'PAYMENT_AFTER_EXPIRY',
        status: refundStatus,
        gatewayRefund,
        gatewayPaymentId: String(gatewayPaymentId)
      };
    }
    return result;
  } finally {
    if (locked) {
      try { await conn.query('SELECT RELEASE_LOCK(?)', [lockName]); } catch (_) { /* ignore */ }
    }
    conn.release();
  }
}

/**
 * Ask Razorpay what happened to one order, and finish it if the money was taken.
 * Safe to call any number of times: a finished order is skipped, and a repeated confirm never
 * creates a second PAYMENT row.
 *
 * @returns {Promise<{orderId:string, orderStatus:string, outcome:string, late?:boolean, bookingStatus?:string, result?:Object}>}
 *   outcome: NOT_FOUND | SKIPPED (order already finished) | NOT_PAID | CONFIRMED | LATE
 */
async function reconcileOrder(orderId) {
  const [rows] = await pool.query('SELECT * FROM PAYMENT_ORDER WHERE order_id = ?', [String(orderId)]);
  if (rows.length === 0) return { orderId, orderStatus: 'UNKNOWN', outcome: 'NOT_FOUND' };
  const order = rows[0];
  // CREATED and EXPIRED orders are still open (an EXPIRED one only means the hold ended unpaid)
  if (order.status !== 'CREATED' && order.status !== 'EXPIRED') return { orderId, orderStatus: order.status, outcome: 'SKIPPED' };

  await pool.query('UPDATE PAYMENT_ORDER SET last_checked_at = COALESCE(@as_of_time, NOW()) WHERE order_id = ?', [order.order_id]);

  if (!gatewayKeysPresent() && !isClientOverridden()) {
    throw new AppError('SERVICE_UNAVAILABLE', 'Payment gateway configuration missing. Check Razorpay keys.', 503);
  }
  const razorpay = getRazorpayClient();
  const reply = await razorpay.orders.fetchPayments(order.order_id);
  const items = (reply && reply.items) || [];

  // Money is only taken for a captured payment. An authorized one is captured first (amount from OUR order row).
  let chosen = items.find(p => p && p.status === 'captured');
  if (!chosen) {
    const authorized = items.find(p => p && p.status === 'authorized');
    if (authorized) {
      if (Number(authorized.amount) !== Number(order.amount_paise)) {
        console.error(`[RECONCILE] Order ${order.order_id}: authorized payment ${authorized.id} amount ${authorized.amount} does not match order ${order.amount_paise}. Not captured.`);
        return { orderId, orderStatus: 'CREATED', outcome: 'NOT_PAID' };
      }
      chosen = await razorpay.payments.capture(authorized.id, Number(order.amount_paise), order.currency || 'INR');
      // capture() answers with the captured payment; keep the method from the authorized one if it is missing
      if (chosen && !chosen.method && authorized.method) chosen = { ...chosen, method: authorized.method, card: authorized.card };
    }
  }
  if (!chosen) return { orderId, orderStatus: 'CREATED', outcome: 'NOT_PAID' };

  if (Number(chosen.amount) !== Number(order.amount_paise)) {
    console.error(`[RECONCILE] Order ${order.order_id}: payment ${chosen.id} amount ${chosen.amount} does not match order ${order.amount_paise}. Not confirmed.`);
    return { orderId, orderStatus: 'CREATED', outcome: 'NOT_PAID' };
  }

  const result = await confirmOrderPayment(order, chosen.id, chosen);
  safeMongoInsert('raw_gateway_replies', {
    pnr: String(order.pnr), type: result.late ? 'reconcile_late' : 'reconcile_success',
    orderId: order.order_id, gatewayPaymentId: String(chosen.id), status: result.bookingStatus
  });
  return {
    orderId,
    orderStatus: result.late ? 'LATE_PAID' : 'PAID',
    outcome: result.late ? 'LATE' : 'CONFIRMED',
    late: result.late,
    bookingStatus: result.bookingStatus,
    result
  };
}

/** Reconcile every CREATED order of a PNR (used by the passenger "check payment status" call). */
async function reconcilePnr(pnr) {
  const [orders] = await pool.query(
    `SELECT order_id FROM PAYMENT_ORDER
      WHERE pnr = ? AND (status = 'CREATED' OR (status = 'EXPIRED' AND created_at >= COALESCE(@as_of_time, NOW()) - INTERVAL 24 HOUR))
      ORDER BY created_at ASC`,
    [String(pnr)]
  );
  const results = [];
  for (const o of orders) {
    try {
      results.push(await reconcileOrder(o.order_id));
    } catch (err) {
      console.error(`[RECONCILE] Order ${o.order_id} failed:`, err.message);
      results.push({ orderId: o.order_id, orderStatus: 'CREATED', outcome: 'ERROR', message: err.message });
    }
  }
  return results;
}

/**
 * Reconcile CREATED orders older than minAgeMinutes and newer than maxAgeHours (max `limit` per run).
 * One run at a time (database lock); each order has its own lock inside confirmOrderPayment.
 */
async function reconcileDueOrders({ minAgeMinutes = 1, maxAgeHours = 24, limit = 20 } = {}) {
  const conn = await pool.getConnection();
  let locked = false;
  try {
    const [[lockRow]] = await conn.query("SELECT GET_LOCK('payment_reconcile_run', 0) AS got");
    locked = Number(lockRow.got) === 1;
    if (!locked) return { skipped: true, attempted: 0, results: [] };

    const [due] = await conn.query(
      `SELECT order_id FROM PAYMENT_ORDER
       WHERE status IN ('CREATED', 'EXPIRED')
         AND created_at <= COALESCE(@as_of_time, NOW()) - INTERVAL ? MINUTE
         AND created_at >= COALESCE(@as_of_time, NOW()) - INTERVAL ? HOUR
       ORDER BY created_at ASC
       LIMIT ?`,
      [minAgeMinutes, maxAgeHours, limit]
    );

    const results = [];
    for (const o of due) {
      try {
        results.push(await reconcileOrder(o.order_id));
      } catch (err) {
        console.error(`[RECONCILE] Order ${o.order_id} failed:`, err.message);
        results.push({ orderId: o.order_id, orderStatus: 'CREATED', outcome: 'ERROR', message: err.message });
      }
    }
    return { skipped: false, attempted: results.length, results };
  } finally {
    if (locked) {
      try { await conn.query("SELECT RELEASE_LOCK('payment_reconcile_run')"); } catch (_) { /* ignore */ }
    }
    conn.release();
  }
}

/** Move one order to a new status through sp_set_payment_order_result (the only way an order changes). */
async function setOrderStatus(orderId, status) {
  const conn = await pool.getConnection();
  try {
    await conn.query('CALL sp_set_payment_order_result(?, ?, NULL, @out_order_status)', [String(orderId), status]);
    const [[row]] = await conn.query('SELECT @out_order_status AS status');
    return row ? row.status : null;
  } finally {
    conn.release();
  }
}

/**
 * Close abandoned orders. An order still CREATED while its booking is no longer PAYMENT_PENDING (the hold ended,
 * the passenger cancelled it, or another order paid) is abandoned. Razorpay cannot cancel an order and the payment
 * window may still be open in a browser, so the order is first checked at Razorpay (a payment is finished as usual,
 * late payments are refunded). Only when nothing was paid is it marked EXPIRED. EXPIRED orders are still checked
 * for 24 hours by the reconcile job and the webhook. If Razorpay cannot be reached the order stays CREATED.
 *
 * @param {string} [pnr] only this booking's orders (default: every abandoned order, at most 50)
 * @returns {Promise<{checked:number, expired:number, finished:number}>}
 */
async function expireAbandonedOrders(pnr = null) {
  const [rows] = await pool.query(
    `SELECT o.order_id FROM PAYMENT_ORDER o JOIN BOOKING b ON b.pnr = o.pnr
      WHERE o.status = 'CREATED' AND b.status <> 'PAYMENT_PENDING' ${pnr ? 'AND o.pnr = ?' : ''}
      ORDER BY o.created_at ASC LIMIT 50`,
    pnr ? [String(pnr)] : []
  );
  const out = { checked: 0, expired: 0, finished: 0 };
  for (const row of rows) {
    out.checked++;
    try {
      const res = await reconcileOrder(row.order_id);
      if (res.outcome === 'CONFIRMED' || res.outcome === 'LATE') { out.finished++; continue; }
      if (res.outcome === 'NOT_PAID') {
        if ((await setOrderStatus(row.order_id, 'EXPIRED')) === 'EXPIRED') out.expired++;
      }
    } catch (err) {
      console.error(`[PAYMENT_ORDER] Could not close abandoned order ${row.order_id}: ${err.message}`);
    }
  }
  return out;
}

/**
 * Check the X-Razorpay-Signature header: HMAC-SHA256 of the RAW body with RAZORPAY_WEBHOOK_SECRET.
 */
function verifyWebhookSignature(rawBody, signatureHeader, secret) {
  if (!secret || !signatureHeader || !Buffer.isBuffer(rawBody)) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(String(signatureHeader), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Act on one verified webhook event. Idempotent: repeated deliveries change nothing.
 * payment.captured / order.paid  -> reconcileOrder(order_id) (Razorpay is asked again, the body alone is not trusted)
 * refund.processed / refund.failed -> sp_set_refund_result on the REFUND row (found by notes.refund_id or gateway_refund_id)
 */
async function handleWebhookEvent(event) {
  const name = event && event.event;
  const payload = (event && event.payload) || {};

  if (name === 'payment.captured' || name === 'order.paid') {
    const orderId = (payload.payment && payload.payment.entity && payload.payment.entity.order_id)
      || (payload.order && payload.order.entity && payload.order.entity.id);
    if (!orderId) return { handled: false, reason: 'NO_ORDER_ID' };
    const res = await reconcileOrder(orderId);
    return { handled: true, event: name, outcome: res.outcome };
  }

  if (name === 'refund.processed' || name === 'refund.failed') {
    const entity = payload.refund && payload.refund.entity;
    if (!entity) return { handled: false, reason: 'NO_REFUND_ENTITY' };
    let refundId = entity.notes && entity.notes.refund_id ? parseInt(entity.notes.refund_id, 10) : null;
    if (!refundId || isNaN(refundId)) {
      const [rows] = await pool.query('SELECT refund_id FROM REFUND WHERE gateway_refund_id = ? LIMIT 1', [String(entity.id)]);
      refundId = rows.length ? rows[0].refund_id : null;
    }
    if (!refundId) return { handled: false, reason: 'REFUND_NOT_FOUND' };

    const conn = await pool.getConnection();
    try {
      const status = name === 'refund.processed' ? 'PROCESSED' : 'FAILED';
      const out = await setRefundResult(
        conn, refundId, status, entity.id,
        status === 'FAILED' ? 'Gateway reported the refund failed (webhook)' : null
      );
      return { handled: true, event: name, refundId, result: out };
    } finally {
      conn.release();
    }
  }

  return { handled: false, reason: 'IGNORED_EVENT' };
}

module.exports = {
  methodFromGatewayPayment,
  expireAbandonedOrders,
  confirmOrderPayment,
  reconcileOrder,
  reconcilePnr,
  reconcileDueOrders,
  verifyWebhookSignature,
  handleWebhookEvent,
  mapConfirmError
};
