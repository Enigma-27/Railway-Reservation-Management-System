const pool = require('../config/mysql');
const AppError = require('../utils/appError');
const { processRefundById, summarizeGatewayResult } = require('../services/gatewayRefundService');

const VALID_STATUSES = ['PENDING', 'PROCESSED', 'FAILED'];

const SELECT_REFUND_ROWS = `
  SELECT r.refund_id, r.amount, r.reason, r.status, r.attempts, r.failure_reason,
         r.gateway_refund_id, r.last_attempt_at, r.processed_at, r.payment_id,
         COALESCE(c.pnr, t.pnr, p.pnr) AS pnr,
         COALESCE(c.passenger_no, t.passenger_no) AS passenger_no,
         pb.name AS passenger_name,
         COALESCE(c.cancelled_at, t.reviewed_at, p.paid_at) AS created_at
  FROM REFUND r
  JOIN PAYMENT p ON p.payment_id = r.payment_id
  LEFT JOIN CANCELLATION c ON c.cancel_id = r.cancel_id
  LEFT JOIN TDR_FILING t ON t.tdr_ref_no = r.tdr_ref_no
  LEFT JOIN PASSENGER_BOOKING pb
         ON pb.pnr = COALESCE(c.pnr, t.pnr, p.pnr)
        AND pb.passenger_no = COALESCE(c.passenger_no, t.passenger_no)`;

function mapRow(r) {
  return {
    refundId: r.refund_id,
    pnr: r.pnr,
    passengerNo: r.passenger_no,
    passengerName: r.passenger_name,
    amount: Number(r.amount),
    reason: r.reason,
    status: r.status,
    attempts: Number(r.attempts),
    failureReason: r.failure_reason,
    gatewayRefundId: r.gateway_refund_id,
    createdAt: r.created_at,
    lastAttemptAt: r.last_attempt_at,
    processedAt: r.processed_at
  };
}

/**
 * GET /api/admin/refund-transactions?status=&pnr=&limit=
 * Lists REFUND rows (money movements). Not the same as /api/admin/refunds, which is about refund RULES.
 */
async function listRefundTransactions(req, res, next) {
  try {
    const { status, pnr } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);

    const where = [];
    const params = [];
    if (status) {
      const st = String(status).toUpperCase();
      if (!VALID_STATUSES.includes(st)) {
        throw new AppError('BAD_REQUEST', `status must be one of: ${VALID_STATUSES.join(', ')}`, 400);
      }
      where.push('r.status = ?');
      params.push(st);
    }
    if (pnr) {
      where.push('COALESCE(c.pnr, t.pnr, p.pnr) = ?');
      params.push(String(pnr).trim());
    }

    const [rows] = await pool.query(
      `${SELECT_REFUND_ROWS}
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY r.refund_id DESC
       LIMIT ?`,
      [...params, limit]
    );

    return res.status(200).json({ success: true, data: rows.map(mapRow) });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/admin/refund-transactions/:refundId/retry
 * Only PENDING or FAILED rows can be retried. The gateway service does the work and records the
 * result through sp_set_refund_result. The refund amount always comes from the REFUND row.
 */
async function retryRefundTransaction(req, res, next) {
  try {
    const refundId = parseInt(req.params.refundId, 10);
    if (isNaN(refundId) || refundId <= 0) {
      throw new AppError('BAD_REQUEST', 'A valid refundId is required', 400);
    }

    const [rows] = await pool.query('SELECT status FROM REFUND WHERE refund_id = ?', [refundId]);
    if (rows.length === 0) {
      throw new AppError('NOT_FOUND', 'Refund not found', 404);
    }
    if (!['PENDING', 'FAILED'].includes(rows[0].status)) {
      throw new AppError('BAD_REQUEST', `Only PENDING or FAILED refunds can be retried. This refund is ${rows[0].status}.`, 400);
    }

    const result = await processRefundById(refundId);
    const [fresh] = await pool.query(`${SELECT_REFUND_ROWS} WHERE r.refund_id = ?`, [refundId]);

    return res.status(200).json({
      success: true,
      data: {
        refundId,
        status: fresh[0] ? fresh[0].status : result.refundStatus,
        gatewayRefund: summarizeGatewayResult([result]),
        message: result.message || null,
        refund: fresh[0] ? mapRow(fresh[0]) : null
      }
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { listRefundTransactions, retryRefundTransaction };
