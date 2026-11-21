const Razorpay = require('razorpay');
const config = require('../config/env');
const pool = require('../config/mysql');
const { safeMongoInsert } = require('../config/mongodb');

/**
 * Gateway refunds, one REFUND row at a time.
 *
 * SQL decides every amount and writes the REFUND row as PENDING. This service only moves the money
 * at the gateway and then records the result through sp_set_refund_result (the only way a REFUND
 * status changes). No refund maths happens here: the amount is REFUND.amount, the payment is
 * REFUND.payment_id (never "the latest payment").
 *
 * Life of a row: PENDING -> PROCESSED, or PENDING -> FAILED -> (retry) -> PROCESSED / FAILED.
 */

/**
 * Convert rupee decimal to exact paise integer using BigInt math (never floating point)
 */
function toPaise(decimalStrOrNum) {
  const s = String(decimalStrOrNum).trim();
  const parts = s.split('.');
  const rupees = BigInt(parts[0] || '0');
  const frac = (parts[1] || '').padEnd(2, '0').slice(0, 2);
  const paise = BigInt(frac);
  return Number(rupees * 100n + paise);
}

/**
 * Real Razorpay payment IDs are 'pay_' plus exactly 14 letters or digits.
 * Seeded ids ('pay_test_...') and simulator ids ('pay_sim_...') are not real.
 */
function isRealRazorpayPaymentId(id) {
  if (typeof id !== 'string') return false;
  return /^pay_[a-zA-Z0-9]{14}$/.test(id);
}

let _razorpayClientOverride = null;

function setRazorpayClientOverride(mockClient) {
  _razorpayClientOverride = mockClient;
}

function isClientOverridden() {
  return Boolean(_razorpayClientOverride);
}

function getRazorpayClient() {
  return _razorpayClientOverride || new Razorpay({
    key_id: config.RAZORPAY_KEY_ID,
    key_secret: config.RAZORPAY_KEY_SECRET
  });
}

/**
 * Record a result through sp_set_refund_result. CALL and SELECT @out use the SAME connection.
 * Returns the procedure's status_out (PROCESSED, FAILED, INVALID_TRANSITION or NOT_FOUND).
 */
async function setRefundResult(conn, refundId, status, gatewayRefundId, failureReason) {
  await conn.query('CALL sp_set_refund_result(?, ?, ?, ?, @out_refund_status)', [
    refundId,
    status,
    gatewayRefundId || null,
    failureReason ? String(failureReason).slice(0, 255) : null
  ]);
  const [[row]] = await conn.query('SELECT @out_refund_status AS status_out');
  return row.status_out;
}

// Raw gateway replies are an optional audit copy in MongoDB: never let a Mongo problem touch a refund
async function logRawReply(doc) {
  await safeMongoInsert('raw_gateway_replies', doc);
}

/**
 * Process ONE refund row at the gateway and record the result.
 *
 * @param {number|string} refundId
 * @returns {Promise<{refundId:number, refundStatus:string, outcome:'SUCCESS'|'SKIPPED'|'FAILED'|'BUSY'|'NOT_FOUND'|'ALREADY_PROCESSED', message?:string}>}
 *   refundStatus is the REFUND.status after this call. outcome says what happened at the gateway:
 *   SUCCESS = real Razorpay refund done (or found already done), SKIPPED = no real money moves
 *   (cash, seeded or simulated payment), FAILED = gateway error (row is FAILED, will be retried).
 */
async function processRefundById(refundId) {
  const id = parseInt(refundId, 10);
  if (isNaN(id) || id <= 0) return { refundId: id, refundStatus: 'UNKNOWN', outcome: 'NOT_FOUND' };

  // One refund row is never processed by two runs at once (retry timer, admin retry, the request itself)
  const conn = await pool.getConnection();
  let locked = false;
  try {
    const [[lockRow]] = await conn.query('SELECT GET_LOCK(?, 0) AS got', [`refund_row_${id}`]);
    locked = Number(lockRow.got) === 1;
    if (!locked) {
      const [[cur]] = await conn.query('SELECT status FROM REFUND WHERE refund_id = ?', [id]);
      return { refundId: id, refundStatus: cur ? cur.status : 'UNKNOWN', outcome: 'BUSY', message: 'Another run is already processing this refund' };
    }

    // Read the row inside the lock (an earlier run may just have finished it)
    const [rows] = await conn.query(
      `SELECT r.refund_id, r.status, r.amount, r.reason, r.payment_id,
              p.pnr, p.method, p.gateway_payment_id
       FROM REFUND r
       JOIN PAYMENT p ON p.payment_id = r.payment_id
       WHERE r.refund_id = ?`,
      [id]
    );
    if (rows.length === 0) return { refundId: id, refundStatus: 'UNKNOWN', outcome: 'NOT_FOUND' };
    const refund = rows[0];

    if (refund.status === 'PROCESSED') {
      return { refundId: id, refundStatus: 'PROCESSED', outcome: 'ALREADY_PROCESSED' };
    }

    // No real money moves for cash, seeded ('pay_test_') and simulated ('pay_sim_') payments.
    // The row is still moved to PROCESSED (with a note) so it does not stay PENDING forever.
    const isReal = isRealRazorpayPaymentId(refund.gateway_payment_id);
    const isTestOverride = Boolean(_razorpayClientOverride)
      && typeof refund.gateway_payment_id === 'string' && refund.gateway_payment_id.startsWith('pay_sim_');

    if (refund.method === 'CASH' || !refund.gateway_payment_id || (!isReal && !isTestOverride)) {
      const note = refund.method === 'CASH' ? 'CASH_PAYMENT_NO_GATEWAY' : 'SIMULATED_PAYMENT';
      const out = await setRefundResult(conn, id, 'PROCESSED', null, note);
      return {
        refundId: id,
        refundStatus: out === 'PROCESSED' ? 'PROCESSED' : refund.status,
        outcome: 'SKIPPED',
        message: `${note}: no real money moved`
      };
    }

    const razorpay = getRazorpayClient();
    const amountInPaise = toPaise(refund.amount);

    try {
      // Retry safety: if Razorpay already holds a refund for this REFUND row, do not create a second one
      const existing = await razorpay.payments.fetchMultipleRefund(refund.gateway_payment_id, { count: 100 });
      const items = (existing && existing.items) || [];
      const already = items.find(it => it && it.notes && String(it.notes.refund_id) === String(id));
      if (already) {
        const out = await setRefundResult(conn, id, 'PROCESSED', already.id, 'ALREADY_AT_GATEWAY');
        await logRawReply({ pnr: String(refund.pnr), type: 'refund_success', paymentId: String(refund.gateway_payment_id), refundIds: [id], amount: amountInPaise, reason: refund.reason, reply: already, found: 'existing' });
        return { refundId: id, refundStatus: out === 'PROCESSED' ? 'PROCESSED' : refund.status, outcome: 'SUCCESS', message: 'Refund already existed at the gateway' };
      }

      const reply = await razorpay.payments.refund(refund.gateway_payment_id, {
        amount: amountInPaise,
        notes: { refund_id: String(id), pnr: String(refund.pnr), reason: String(refund.reason) }
      });

      const out = await setRefundResult(conn, id, 'PROCESSED', reply && reply.id, null);
      await logRawReply({ pnr: String(refund.pnr), type: 'refund_success', paymentId: String(refund.gateway_payment_id), refundIds: [id], amount: amountInPaise, reason: refund.reason, reply });
      return { refundId: id, refundStatus: out === 'PROCESSED' ? 'PROCESSED' : refund.status, outcome: 'SUCCESS' };
    } catch (err) {
      const description = (err.error && err.error.description) || err.description || err.message || 'Unknown gateway error';
      console.error(`[GATEWAY_REFUND_FAIL]: refund ${id}: ${description}`);
      await logRawReply({
        pnr: String(refund.pnr), type: 'refund_failure', paymentId: String(refund.gateway_payment_id), refundIds: [id],
        amount: amountInPaise, reason: refund.reason,
        reply: { statusCode: err.statusCode || null, description, error: err.error || null }
      });
      const out = await setRefundResult(conn, id, 'FAILED', null, description);
      return { refundId: id, refundStatus: out === 'FAILED' ? 'FAILED' : refund.status, outcome: 'FAILED', message: description };
    }
  } finally {
    if (locked) {
      try { await conn.query('SELECT RELEASE_LOCK(?)', [`refund_row_${id}`]); } catch (_) { /* ignore */ }
    }
    conn.release();
  }
}

/**
 * Process several refund rows one after the other. Never throws: an error on one row
 * is logged and reported as FAILED for that row only.
 */
async function processRefundsByIds(refundIds) {
  const results = [];
  for (const id of (refundIds || [])) {
    try {
      results.push(await processRefundById(id));
    } catch (err) {
      console.error(`[GATEWAY_REFUND_ERROR]: refund ${id}:`, err.message);
      results.push({ refundId: Number(id), refundStatus: 'PENDING', outcome: 'FAILED', message: err.message });
    }
  }
  return results;
}

/**
 * One word for the HTTP response field gatewayRefund:
 * FAILED if any row failed, PENDING if any row is still waiting, SKIPPED if no real money moved,
 * PROCESSED if every row was refunded, SKIPPED when there is nothing to refund.
 */
function summarizeGatewayResult(results) {
  if (!results || results.length === 0) return 'SKIPPED';
  if (results.some(r => r.outcome === 'FAILED' || r.refundStatus === 'FAILED')) return 'FAILED';
  if (results.some(r => r.refundStatus === 'PENDING' || r.outcome === 'BUSY')) return 'PENDING';
  if (results.every(r => r.outcome === 'SKIPPED')) return 'SKIPPED';
  return 'PROCESSED';
}

/** Plain message for the response when something is not done yet. Null when all is fine. */
function refundMessage(summary) {
  if (summary === 'FAILED') return 'The cancellation is done. The refund could not be sent yet and will be retried automatically.';
  if (summary === 'PENDING') return 'The cancellation is done. The refund is being processed.';
  return null;
}

/**
 * Retry refund rows that are PENDING or FAILED, older than minAgeMinutes, with fewer than maxAttempts tries.
 * Age counts from the last attempt, or (never tried) from the cancellation, TDR review or payment time.
 * An overlapping run is skipped with a database lock; each row also has its own lock.
 */
async function retryDueRefunds({ minAgeMinutes = 5, maxAttempts = 3, limit = 50 } = {}) {
  const conn = await pool.getConnection();
  let locked = false;
  try {
    const [[lockRow]] = await conn.query("SELECT GET_LOCK('refund_retry_run', 0) AS got");
    locked = Number(lockRow.got) === 1;
    if (!locked) return { skipped: true, attempted: 0, results: [] };

    const [due] = await conn.query(
      `SELECT r.refund_id
       FROM REFUND r
       JOIN PAYMENT p ON p.payment_id = r.payment_id
       LEFT JOIN CANCELLATION c ON c.cancel_id = r.cancel_id
       LEFT JOIN TDR_FILING t ON t.tdr_ref_no = r.tdr_ref_no
       WHERE r.status IN ('PENDING', 'FAILED')
         AND r.attempts < ?
         AND COALESCE(r.last_attempt_at, c.cancelled_at, t.reviewed_at, p.paid_at)
             <= COALESCE(@as_of_time, NOW()) - INTERVAL ? MINUTE
       ORDER BY r.refund_id ASC
       LIMIT ?`,
      [maxAttempts, minAgeMinutes, limit]
    );

    const results = await processRefundsByIds(due.map(d => d.refund_id));
    return { skipped: false, attempted: results.length, results };
  } finally {
    if (locked) {
      try { await conn.query("SELECT RELEASE_LOCK('refund_retry_run')"); } catch (_) { /* ignore */ }
    }
    conn.release();
  }
}

module.exports = {
  toPaise,
  isRealRazorpayPaymentId,
  setRazorpayClientOverride,
  isClientOverridden,
  getRazorpayClient,
  setRefundResult,
  processRefundById,
  processRefundsByIds,
  summarizeGatewayResult,
  refundMessage,
  retryDueRefunds
};
