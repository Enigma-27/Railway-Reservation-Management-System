const crypto = require('crypto');
const pool = require('../config/mysql');
const config = require('../config/env');
const { safeMongoInsert } = require('../config/mongodb');
const AppError = require('../utils/appError');
const { releaseExpiredHolds } = require('../services/holdCleanupService');
const { toPaise, getRazorpayClient } = require('../services/gatewayRefundService');
const {
  confirmOrderPayment,
  reconcileOrder,
  reconcilePnr,
  verifyWebhookSignature,
  handleWebhookEvent
} = require('../services/paymentOrderService');
const { createNotification } = require('../services/notificationService');
const { logActivity } = require('../services/activityLogService');

/**
 * 4.3.1 Create Gateway Order
 * POST /api/payments/razorpay/order
 *
 * The order is saved in MySQL (PAYMENT_ORDER) right after Razorpay creates it. MongoDB gets an optional
 * audit copy afterwards; a Mongo problem never fails order creation.
 */
async function createOrder(req, res, next) {
  try {
    // Release any expired holds first
    await releaseExpiredHolds();

    const userId = req.user.user_id || req.user.userId;
    const { pnr } = req.body;

    if (!pnr) {
      throw new AppError('VALIDATION_ERROR', 'PNR is required to create order', 400);
    }

    // Retrieve booking details and verify hold window
    const [bookingRows] = await pool.query(
      `SELECT b.pnr, b.user_id, b.total_fare, b.status, b.created_at,
              CAST(COALESCE(s.setting_value, '10') AS SIGNED) AS hold_minutes,
              NOW() AS db_now,
              (NOW() > DATE_ADD(b.created_at, INTERVAL CAST(COALESCE(s.setting_value, '10') AS SIGNED) MINUTE)) AS is_expired
       FROM BOOKING b
       LEFT JOIN SETTING s ON s.setting_key = 'HOLD_MINUTES'
       WHERE b.pnr = ?`,
      [pnr]
    );

    if (bookingRows.length === 0) {
      throw new AppError('NOT_FOUND', 'Booking not found', 404);
    }

    const booking = bookingRows[0];

    // Only the owner of the PNR may create an order
    if (Number(booking.user_id) !== Number(userId)) {
      throw new AppError('FORBIDDEN', 'Access denied: you do not own this booking', 403);
    }

    // Must be PAYMENT_PENDING and within hold window
    if (booking.status !== 'PAYMENT_PENDING' || Number(booking.is_expired) === 1) {
      throw new AppError('HOLD_EXPIRED', 'The 10-minute seat hold timer lapsed before payment completion.', 400);
    }

    // Ensure Razorpay credentials are present
    if (!config.RAZORPAY_KEY_ID || !config.RAZORPAY_KEY_SECRET) {
      throw new AppError('SERVICE_UNAVAILABLE', 'Payment gateway configuration missing. Check Razorpay keys.', 503);
    }

    // Convert total_fare from database to paise with exact integer math
    const amountInPaise = toPaise(booking.total_fare);

    // Pressing Pay twice must not create a second order: reuse the open order of this booking (same amount).
    // Before reusing it, ask Razorpay once whether it was already paid (then the ticket is finished here).
    const [openOrders] = await pool.query(
      `SELECT order_id FROM PAYMENT_ORDER
        WHERE pnr = ? AND status = 'CREATED' AND amount_paise = ? ORDER BY created_at DESC LIMIT 1`,
      [String(pnr), amountInPaise]
    );
    if (openOrders.length > 0) {
      const open = openOrders[0];
      let settled = null;
      try { settled = await reconcileOrder(open.order_id); } catch (_) { settled = null; }
      if (settled && settled.outcome === 'CONFIRMED') {
        return res.status(200).json({
          success: true,
          data: { alreadyPaid: true, pnr: String(pnr), bookingStatus: settled.bookingStatus }
        });
      }
      if (settled && settled.outcome === 'LATE') {
        throw new AppError('HOLD_EXPIRED', 'The payment arrived after the seat hold expired. It is being refunded automatically.', 400);
      }
      return res.status(200).json({
        success: true,
        data: {
          orderId: open.order_id,
          amount: amountInPaise,
          currency: 'INR',
          keyId: config.RAZORPAY_KEY_ID,
          pnr: String(pnr),
          reused: true
        }
      });
    }

    let order;
    try {
      const razorpay = getRazorpayClient();
      order = await razorpay.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt: String(pnr)
      });
    } catch (gwErr) {
      throw new AppError('SERVICE_UNAVAILABLE', `Payment gateway unavailable: ${gwErr.message || 'Order creation failed'}`, 503);
    }

    // 1. MySQL FIRST: the order must be saved here, or a later payment cannot be matched to this booking
    try {
      await pool.query(
        `INSERT INTO PAYMENT_ORDER (order_id, pnr, amount_paise, currency, status, created_at)
         VALUES (?, ?, ?, 'INR', 'CREATED', NOW())`,
        [order.id, String(pnr), amountInPaise]
      );
    } catch (dbErr) {
      console.error(`[PAYMENT_ORDER] Razorpay order ${order.id} for PNR ${pnr} was created but could not be saved in MySQL:`, dbErr.message);
      throw new AppError(
        'INTERNAL_SERVER_ERROR',
        `The payment order could not be saved (order ${order.id}). Please do not pay. Try again.`,
        500
      );
    }

    // 2. MongoDB audit copy: best effort, never awaited, never fails the request
    safeMongoInsert('raw_gateway_replies', {
      pnr: String(pnr),
      type: 'order_create',
      orderId: order.id,
      amount: amountInPaise,
      reply: order
    });

    // Do NOT insert into PAYMENT table
    return res.status(200).json({
      success: true,
      data: {
        orderId: order.id,
        amount: amountInPaise,
        currency: 'INR',
        keyId: config.RAZORPAY_KEY_ID,
        pnr: String(pnr)
      }
    });

  } catch (error) {
    next(error);
  }
}

/**
 * Build the passenger list for a success response
 */
async function loadPassengers(pnr) {
  const [passengers] = await pool.query(
    `SELECT pb.passenger_no, pb.name,
            c.coach_code AS coachNumber,
            s.seat_number AS seatNumber,
            s.berth_type AS berthType,
            r.status, r.queue_position
     FROM PASSENGER_BOOKING pb
     JOIN RESERVATION r ON pb.pnr = r.pnr AND pb.passenger_no = r.passenger_no
     LEFT JOIN SEAT s ON r.seat_id = s.seat_id
     LEFT JOIN COACH c ON s.coach_id = c.coach_id
     WHERE pb.pnr = ?
     ORDER BY pb.passenger_no ASC`,
    [pnr]
  );
  return passengers.map(p => {
    const item = {
      passengerNo: p.passenger_no,
      name: p.name,
      coachNumber: p.coachNumber || null,
      seatNumber: p.seatNumber || null,
      berthType: p.berthType || null,
      status: p.status
    };
    if (p.queue_position) item.queuePosition = p.queue_position;
    return item;
  });
}

/**
 * 4.3.2 Verify Gateway Payment Signature & Issue Ticket
 * POST /api/payments/razorpay/verify
 * The order is read from MySQL (PAYMENT_ORDER), never from MongoDB.
 */
async function verifyPayment(req, res, next) {
  try {
    // Release any expired holds first
    await releaseExpiredHolds();

    const userId = req.user.user_id || req.user.userId;
    const { pnr, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    if (!pnr || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      throw new AppError('VALIDATION_ERROR', 'pnr, razorpayOrderId, razorpayPaymentId, and razorpaySignature are required', 400);
    }

    // Verify booking ownership
    const [bookingRows] = await pool.query(
      'SELECT pnr, user_id, total_fare, status FROM BOOKING WHERE pnr = ?',
      [pnr]
    );

    if (bookingRows.length === 0) {
      throw new AppError('NOT_FOUND', 'Booking not found', 404);
    }

    const booking = bookingRows[0];
    if (Number(booking.user_id) !== Number(userId)) {
      throw new AppError('FORBIDDEN', 'Access denied: you do not own this booking', 403);
    }

    // The saved order must exist in MySQL for THIS PNR, and its amount must equal the booking fare in paise
    const [orderRows] = await pool.query(
      'SELECT * FROM PAYMENT_ORDER WHERE order_id = ? AND pnr = ?',
      [String(razorpayOrderId), String(pnr)]
    );
    if (orderRows.length === 0) {
      throw new AppError('BAD_REQUEST', 'Order not found for this PNR in payment records', 400);
    }
    const order = orderRows[0];
    if (Number(order.amount_paise) !== toPaise(booking.total_fare)) {
      throw new AppError('BAD_REQUEST', 'Order amount mismatch', 400);
    }

    if (!config.RAZORPAY_KEY_SECRET) {
      throw new AppError('SERVICE_UNAVAILABLE', 'Payment gateway configuration missing. Check Razorpay keys.', 503);
    }

    // Signature verification using crypto.timingSafeEqual with length check
    const generatedSignature = crypto
      .createHmac('sha256', config.RAZORPAY_KEY_SECRET)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    const sigBuf = Buffer.from(String(razorpaySignature), 'utf8');
    const genBuf = Buffer.from(generatedSignature, 'utf8');

    if (sigBuf.length !== genBuf.length || !crypto.timingSafeEqual(sigBuf, genBuf)) {
      throw new AppError('BAD_REQUEST', 'Invalid payment signature', 400);
    }

    // The same confirm path as reconcile and webhook (sp_confirm_payment is the only code that confirms)
    const confirmed = await confirmOrderPayment(order, razorpayPaymentId);

    // Handle LATE payment: HTTP 200 with success:false and HOLD_EXPIRED, as before
    if (confirmed.late) {
      safeMongoInsert('raw_gateway_replies', {
        pnr: String(pnr), type: 'verify_late', paymentId: confirmed.paymentId,
        gatewayPaymentId: String(razorpayPaymentId), status: 'LATE'
      });
      return res.status(200).json({
        success: false,
        error: {
          code: 'HOLD_EXPIRED',
          message: 'Payment arrived after the seat hold expired (HOLD_MINUTES). No seats were assigned. Your payment has been refunded in full automatically.'
        },
        data: {
          bookingStatus: 'FAILED',
          refund: confirmed.refund
        }
      });
    }

    // Normal payment success (CONFIRMED, RAC, WAITING_LIST)
    const outStatus = confirmed.bookingStatus;
    const outPaymentId = confirmed.paymentId;
    safeMongoInsert('raw_gateway_replies', {
      pnr: String(pnr), type: 'verify_success', paymentId: outPaymentId,
      gatewayPaymentId: String(razorpayPaymentId), status: outStatus
    });

    const [paymentRows] = await pool.query(
      'SELECT payment_id, pnr, amount, method, status, gateway_payment_id, paid_at FROM PAYMENT WHERE payment_id = ?',
      [outPaymentId]
    );
    if (paymentRows.length === 0) {
      throw new AppError('INTERNAL_SERVER_ERROR', 'Payment record not found', 500);
    }
    const paymentRecord = paymentRows[0];
    const paidAt = String(paymentRecord.paid_at);

    createNotification({
      userId: Number(booking.user_id),
      type: 'BOOKING_CONFIRMATION',
      title: 'Booking Confirmed',
      message: `Your booking for PNR ${pnr} is ${outStatus}.`,
      referenceId: String(pnr)
    });

    logActivity({
      userId: Number(userId),
      action: 'PAYMENT',
      tableName: 'PAYMENT',
      recordId: String(outPaymentId),
      newValue: { pnr: String(pnr), amount: Number(booking.total_fare), status: paymentRecord.status }
    });

    logActivity({
      userId: Number(userId),
      action: 'BOOKING',
      tableName: 'BOOKING',
      recordId: String(pnr),
      newValue: { pnr: String(pnr), status: outStatus }
    });

    return res.status(200).json({
      success: true,
      data: {
        paymentId: paymentRecord.payment_id,
        pnr: String(pnr),
        paymentStatus: paymentRecord.status,
        gatewayPaymentId: String(razorpayPaymentId),
        paidAt,
        bookingStatus: outStatus,
        passengers: await loadPassengers(pnr)
      }
    });

  } catch (error) {
    next(error);
  }
}

// One reconcile call per PNR every 10 seconds (in memory)
const RECONCILE_MIN_GAP_MS = 10000;
const lastReconcileByPnr = new Map();

/**
 * POST /api/payments/razorpay/reconcile  { pnr }
 * PASSENGER owner only. Asks Razorpay about every CREATED order of the PNR and finishes the ones that were paid
 * (confirmed ticket inside the hold, automatic refund after it). Returns the booking status.
 */
async function reconcilePayment(req, res, next) {
  try {
    const userId = req.user.user_id || req.user.userId;
    const { pnr } = req.body;
    if (!pnr) {
      throw new AppError('VALIDATION_ERROR', 'PNR is required', 400);
    }

    const [bookingRows] = await pool.query('SELECT pnr, user_id, status FROM BOOKING WHERE pnr = ?', [String(pnr)]);
    if (bookingRows.length === 0) {
      throw new AppError('NOT_FOUND', 'Booking not found', 404);
    }
    if (Number(bookingRows[0].user_id) !== Number(userId)) {
      throw new AppError('FORBIDDEN', 'Access denied: you do not own this booking', 403);
    }

    const now = Date.now();
    const last = lastReconcileByPnr.get(String(pnr)) || 0;
    if (now - last < RECONCILE_MIN_GAP_MS) {
      throw new AppError('TOO_MANY_REQUESTS', 'Please wait a few seconds before checking this payment again.', 429);
    }
    lastReconcileByPnr.set(String(pnr), now);
    if (lastReconcileByPnr.size > 5000) {
      for (const [k, t] of lastReconcileByPnr) {
        if (now - t > RECONCILE_MIN_GAP_MS) lastReconcileByPnr.delete(k);
      }
    }

    const results = await reconcilePnr(pnr);

    const [[fresh]] = await pool.query('SELECT status FROM BOOKING WHERE pnr = ?', [String(pnr)]);
    const [orderRows] = await pool.query('SELECT status FROM PAYMENT_ORDER WHERE pnr = ?', [String(pnr)]);
    const hasPaid = orderRows.some(o => o.status === 'PAID');
    const hasLate = orderRows.some(o => o.status === 'LATE_PAID');
    const lateResult = results.find(r => r.outcome === 'LATE');

    return res.status(200).json({
      success: true,
      data: {
        pnr: String(pnr),
        bookingStatus: fresh ? fresh.status : bookingRows[0].status,
        paymentReceived: hasPaid || hasLate,
        paidAfterHoldExpired: hasLate,
        ordersChecked: results.length,
        ...(lateResult && lateResult.result && lateResult.result.refund ? { refund: lateResult.result.refund } : {})
      }
    });
  } catch (error) {
    next(error);
  }
}

let webhookSecretWarned = false;

/**
 * POST /api/payments/razorpay/webhook
 * Mounted in app.js BEFORE express.json() with express.raw, because the signature is over the RAW body.
 * - empty RAZORPAY_WEBHOOK_SECRET -> 503 (one warning in the log)
 * - bad signature -> 400
 * - good signature -> 200 (even for unknown orders); repeated deliveries change nothing.
 */
async function razorpayWebhook(req, res) {
  const secret = config.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    if (!webhookSecretWarned) {
      console.warn('[WEBHOOK] RAZORPAY_WEBHOOK_SECRET is not set: webhook requests are refused with 503.');
      webhookSecretWarned = true;
    }
    return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Webhook is not configured.' } });
  }

  const rawBody = req.body;
  const signature = req.get('X-Razorpay-Signature');
  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Invalid webhook signature.' } });
  }

  let event = null;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch (_) {
    // A valid signature with an unreadable body: nothing to do, answer 200 so Razorpay does not retry forever
    return res.status(200).json({ success: true, data: { handled: false, reason: 'UNREADABLE_BODY' } });
  }

  // Do the work, but never keep Razorpay waiting long: answer after 4 seconds even if still working.
  const work = handleWebhookEvent(event)
    .catch(err => {
      console.error(`[WEBHOOK] ${event && event.event} failed:`, err.message);
      return { handled: false, reason: 'ERROR' };
    });
  let timer = null;
  const result = await Promise.race([
    work,
    new Promise(resolve => { timer = setTimeout(() => resolve({ handled: true, reason: 'ACCEPTED' }), 4000); })
  ]);
  clearTimeout(timer);
  return res.status(200).json({ success: true, data: { handled: Boolean(result && result.handled) } });
}

module.exports = {
  createOrder,
  verifyPayment,
  reconcilePayment,
  razorpayWebhook
};
