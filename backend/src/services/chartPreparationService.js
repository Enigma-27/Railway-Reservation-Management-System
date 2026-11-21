const pool = require('../config/mysql');
const AppError = require('../utils/appError');
const { processRefundsByIds } = require('./gatewayRefundService');

/**
 * Reusable Chart Preparation Function
 * Can be called by HTTP admin endpoint or by the daily simulator cron.
 * 
 * Flow:
 * 1. Validates that schedule exists.
 * 2. If chart is already prepared (chart_prepared_at IS NOT NULL), returns existing results safely without re-running.
 * 3. If not prepared:
 *    - Calls sp_prepare_chart(scheduleId, 1, @out_snapshot_count)
 *    - Queries newly generated WAITLIST_PURGE refund records
 *    - Invokes shared gateway refund helper once per Razorpay payment
 *    - Returns Contract 7.2 compliant summary
 * 
 * @param {number|string} scheduleId 
 * @param {number|null} [callerUserId]
 * @returns {Promise<Object>}
 */
async function prepareChartForSchedule(scheduleId, callerUserId = null) {
  const schedId = parseInt(scheduleId, 10);
  if (isNaN(schedId) || schedId <= 0) {
    throw new AppError('BAD_REQUEST', 'Valid numeric scheduleId is required', 400);
  }

  // Check schedule existence and current chart status
  const [schedRows] = await pool.query(
    `SELECT ts.schedule_id, ts.train_id, ts.journey_date, ts.chart_prepared_at,
            t.train_number, t.short_name, t.display_name
     FROM TRAIN_SCHEDULE ts
     JOIN TRAIN t ON ts.train_id = t.train_id
     WHERE ts.schedule_id = ?`,
    [schedId]
  );

  if (schedRows.length === 0) {
    throw new AppError('NOT_FOUND', 'Train schedule not found', 404);
  }

  const sched = schedRows[0];

  // If already prepared, return existing results safely
  if (sched.chart_prepared_at) {
    const [snapCountRows] = await pool.query(
      'SELECT COUNT(*) AS snapshot_count FROM CHART_SNAPSHOT WHERE schedule_id = ?',
      [schedId]
    );

    const [purgeRows] = await pool.query(
      `SELECT COUNT(*) AS purge_count,
              COALESCE(SUM(CASE WHEN r.status = 'PROCESSED' THEN r.amount END), 0) AS purge_amount,
              COALESCE(SUM(CASE WHEN r.status = 'PENDING' THEN r.amount END), 0) AS purge_pending,
              COALESCE(SUM(CASE WHEN r.status = 'FAILED' THEN r.amount END), 0) AS purge_failed
       FROM REFUND r
       JOIN PAYMENT p ON r.payment_id = p.payment_id
       JOIN BOOKING b ON p.pnr = b.pnr
       WHERE b.schedule_id = ? AND r.reason = 'WAITLIST_PURGE'`,
      [schedId]
    );

    return {
      scheduleId: schedId,
      trainNumber: String(sched.train_number),
      journeyDate: String(sched.journey_date),
      chartPreparedAt: sched.chart_prepared_at,
      summary: {
        activeHoldsCancelled: 0,
        waitlistedPassengersCancelled: Number(purgeRows[0].purge_count || 0),
        totalRefundsDisbursed: Number(Number(purgeRows[0].purge_amount || 0).toFixed(2)),
        totalRefundsPending: Number(Number(purgeRows[0].purge_pending || 0).toFixed(2)),
        totalRefundsFailed: Number(Number(purgeRows[0].purge_failed || 0).toFixed(2)),
        chartSnapshotRowsPersisted: Number(snapCountRows[0].snapshot_count || 0)
      }
    };
  }

  // Not prepared yet: measure pre-run state
  const [holdRows] = await pool.query(
    'SELECT COUNT(*) AS hold_count FROM BOOKING WHERE schedule_id = ? AND status = "PAYMENT_PENDING"',
    [schedId]
  );
  const activeHoldsBefore = holdRows[0].hold_count || 0;

  const [wlRows] = await pool.query(
    'SELECT COUNT(*) AS wl_count FROM RESERVATION WHERE schedule_id = ? AND status = "WAITING_LIST"',
    [schedId]
  );
  const wlCountBefore = wlRows[0].wl_count || 0;

  const [maxRefundRows] = await pool.query('SELECT COALESCE(MAX(refund_id), 0) AS max_id FROM REFUND');
  const maxRefundIdBefore = maxRefundRows[0].max_id;

  // Call sp_prepare_chart with p_manage_tx = 1.
  // CALL and SELECT @out must run on the SAME connection (session variables are per connection).
  // sp_prepare_chart rolls back and raises the SQL error if anything fails, so it arrives here as a thrown error.
  let out_snapshot_count;
  const chartConn = await pool.getConnection();
  try {
    await chartConn.query(
      'CALL sp_prepare_chart(?, 1, @out_snapshot_count);',
      [schedId]
    );
    const [[outRow]] = await chartConn.query(
      'SELECT @out_snapshot_count AS out_snapshot_count;'
    );
    out_snapshot_count = outRow.out_snapshot_count;
  } catch (procErr) {
    console.error(`[Chart Preparation] sp_prepare_chart failed for schedule ${schedId}:`, procErr.message);
    throw new AppError(
      'INTERNAL_SERVER_ERROR',
      'Chart preparation failed in the database and was rolled back. No changes were saved.',
      500
    );
  } finally {
    chartConn.release();
  }

  // Fetch updated schedule
  const [updatedSchedRows] = await pool.query(
    'SELECT chart_prepared_at FROM TRAIN_SCHEDULE WHERE schedule_id = ?',
    [schedId]
  );
  const chartPreparedAt = updatedSchedRows[0].chart_prepared_at;

  // Safety net: if the chart time is still empty after the call, nothing was saved: report an error, not success.
  if (!chartPreparedAt || out_snapshot_count === null || out_snapshot_count === undefined) {
    throw new AppError(
      'INTERNAL_SERVER_ERROR',
      'Chart preparation failed in the database and was rolled back. No changes were saved.',
      500
    );
  }

  // Find newly created WAITLIST_PURGE refund rows (SQL wrote them as PENDING)
  const [newRefundRows] = await pool.query(
    `SELECT r.refund_id
     FROM REFUND r
     WHERE r.refund_id > ? AND r.reason = 'WAITLIST_PURGE'
     ORDER BY r.refund_id ASC`,
    [maxRefundIdBefore]
  );

  // Move each row through the gateway service. A failure leaves that row FAILED for the retry timer.
  await processRefundsByIds(newRefundRows.map(r => r.refund_id));

  let totalRefunds = 0;
  let totalPending = 0;
  let totalFailed = 0;
  if (newRefundRows.length > 0) {
    const [moneyRows] = await pool.query(
      `SELECT status, COALESCE(SUM(amount), 0) AS total FROM REFUND WHERE refund_id IN (?) GROUP BY status`,
      [newRefundRows.map(r => r.refund_id)]
    );
    for (const m of moneyRows) {
      if (m.status === 'PROCESSED') totalRefunds = Number(m.total);
      else if (m.status === 'PENDING') totalPending = Number(m.total);
      else if (m.status === 'FAILED') totalFailed = Number(m.total);
    }
  }

  return {
    scheduleId: schedId,
    trainNumber: String(sched.train_number),
    journeyDate: String(sched.journey_date),
    chartPreparedAt,
    summary: {
      activeHoldsCancelled: Number(activeHoldsBefore),
      waitlistedPassengersCancelled: newRefundRows.length > 0 ? newRefundRows.length : Number(wlCountBefore),
      totalRefundsDisbursed: Number(totalRefunds.toFixed(2)),
      totalRefundsPending: Number(totalPending.toFixed(2)),
      totalRefundsFailed: Number(totalFailed.toFixed(2)),
      chartSnapshotRowsPersisted: Number(out_snapshot_count || 0)
    }
  };
}

module.exports = {
  prepareChartForSchedule
};
