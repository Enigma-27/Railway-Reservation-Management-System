const pool = require('../config/mysql');
const { getTdrEligibility, explainTdrRefusal, REASON_LABELS } = require('../services/tdrEligibilityService');

/**
 * Middleware: Enforce PASSENGER role
 */
function requirePassengerRole(req, res, next) {
  if (!req.user || req.user.role !== 'PASSENGER') {
    return res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Access denied: PASSENGER role required'
      }
    });
  }
  next();
}

/**
 * Maps a sp_file_tdr status code to the HTTP error returned to the client.
 */
function tdrFailure(outStatus, passengerNo) {
  switch (outStatus) {
    case 'NOT_FOUND':
      return { status: 404, code: 'NOT_FOUND', message: `Booking or passenger ${passengerNo} not found` };
    case 'FORBIDDEN':
      return { status: 403, code: 'FORBIDDEN', message: 'You can only file a TDR for your own bookings' };
    case 'DUPLICATE_TDR':
      return { status: 400, code: 'BAD_REQUEST', message: `A TDR is already filed, under review, approved or refunded for passenger ${passengerNo}` };
    case 'PASSENGER_REQUIRED':
      return { status: 400, code: 'BAD_REQUEST', message: 'A passenger number is required to file a TDR' };
    case 'NOT_ELIGIBLE':
      return { status: 400, code: 'BAD_REQUEST', message: 'Passenger reservation status or train delay is not eligible for this TDR reason' };
    case 'EVIDENCE_REQUIRED':
      return { status: 400, code: 'BAD_REQUEST', message: 'Evidence reference is required for this TDR reason' };
    case 'DEADLINE_EXCEEDED':
      return { status: 400, code: 'BAD_REQUEST', message: 'TDR filing deadline has passed or train has already departed' };
    case 'INVALID_REASON':
      return { status: 400, code: 'BAD_REQUEST', message: 'Invalid TDR reason code' };
    default:
      return { status: 500, code: 'INTERNAL_SERVER_ERROR', message: 'Failed to file TDR' };
  }
}

/**
 * POST /api/tdr
 * Contract 4.6: File a TDR claim.
 * Creates one TDR_FILING row per passenger, all-or-nothing (one transaction).
 */
async function fileTdr(req, res, next) {
  try {
    const { pnr, reason, remarks } = req.body;
    const evidenceRef = req.body.evidenceReference || req.body.evidenceRef || null;
    let passengerNos = req.body.passengerNos;

    if (!pnr || typeof pnr !== 'string') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Valid 10-digit PNR is required'
        }
      });
    }

    if (!reason || typeof reason !== 'string') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Reason code is required'
        }
      });
    }

    if (!passengerNos && req.body.passengerNo !== undefined) {
      passengerNos = [req.body.passengerNo];
    }

    if (!Array.isArray(passengerNos) || passengerNos.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'At least one passenger number must be provided in passengerNos'
        }
      });
    }

    // Validate every passenger number before touching the database
    const parsedNos = [];
    for (const pNo of passengerNos) {
      const passengerNo = parseInt(pNo, 10);
      if (isNaN(passengerNo) || passengerNo < 1) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: `Invalid passenger number: ${pNo}`
          }
        });
      }
      parsedNos.push(passengerNo);
    }

    const createdTdrs = [];
    let filedAtStr = null;

    // One connection and one transaction for ALL passengers: all-or-nothing.
    // sp_file_tdr is called with p_manage_tx = 0 so it does not commit by itself.
    const conn = await pool.getConnection();
    let failure = null;
    try {
      await conn.beginTransaction();

      for (const passengerNo of parsedNos) {
        await conn.query(
          'CALL sp_file_tdr(?, ?, ?, ?, ?, ?, 0, @out_tdr_ref_no, @out_status)',
          [pnr, passengerNo, req.user.userId, reason, evidenceRef, remarks || null]
        );

        // Same connection, so the session variables are the ones just set
        const [[{ out_tdr_ref_no, out_status }]] = await conn.query(
          'SELECT @out_tdr_ref_no AS out_tdr_ref_no, @out_status AS out_status'
        );

        if (out_status !== 'FILED') {
          failure = { ...tdrFailure(out_status, passengerNo), outStatus: out_status, passengerNo };
          break;
        }

        createdTdrs.push({
          tdrRefNo: out_tdr_ref_no,
          passengerNo,
          status: 'FILED'
        });
      }

      if (failure) {
        await conn.rollback();
      } else {
        const [rows] = await conn.query(
          'SELECT filed_at FROM TDR_FILING WHERE tdr_ref_no = ?',
          [createdTdrs[0].tdrRefNo]
        );
        if (rows.length > 0 && rows[0].filed_at) {
          filedAtStr = String(rows[0].filed_at);
        }
        await conn.commit();
      }
    } catch (txErr) {
      try { await conn.rollback(); } catch (_) {}
      throw txErr;
    } finally {
      conn.release();
    }

    if (failure) {
      // "Not eligible" is too vague: say exactly why this passenger cannot use this reason right now
      if (failure.outStatus === 'NOT_ELIGIBLE' || failure.outStatus === 'DEADLINE_EXCEEDED') {
        const why = await explainTdrRefusal(pnr, failure.passengerNo, reason).catch(() => null);
        if (why) failure.message = why;
      }
      return res.status(failure.status).json({
        success: false,
        error: { code: failure.code, message: failure.message }
      });
    }

    return res.status(201).json({
      success: true,
      data: {
        tdrRefNo: createdTdrs[0].tdrRefNo,
        pnr,
        reason,
        status: 'FILED',
        filedAt: filedAtStr,
        tdrRefNos: createdTdrs.map(t => t.tdrRefNo),
        tdrs: createdTdrs
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/tdr
 * Retrieve own filed TDRs for logged-in passenger
 */
async function getMyTdrs(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT t.tdr_ref_no, t.pnr, t.passenger_no, t.reason, t.status, t.filed_at, t.refund_amount, t.remarks, t.reviewed_at,
              pb.name AS passenger_name, tr.train_number, tr.display_name AS train_name, ts.journey_date,
              (SELECT rf.status FROM REFUND rf WHERE rf.tdr_ref_no = t.tdr_ref_no ORDER BY rf.refund_id DESC LIMIT 1) AS refund_status,
              (SELECT rf.amount FROM REFUND rf WHERE rf.tdr_ref_no = t.tdr_ref_no ORDER BY rf.refund_id DESC LIMIT 1) AS refund_row_amount
       FROM TDR_FILING t
       JOIN BOOKING b ON t.pnr = b.pnr
       JOIN TRAIN_SCHEDULE ts ON ts.schedule_id = b.schedule_id
       JOIN TRAIN tr ON tr.train_id = ts.train_id
       LEFT JOIN PASSENGER_BOOKING pb ON pb.pnr = t.pnr AND pb.passenger_no = t.passenger_no
       WHERE b.user_id = ?
       ORDER BY t.filed_at DESC, t.tdr_ref_no DESC`,
      [req.user.userId]
    );

    const data = rows.map(r => ({
      tdrRefNo: r.tdr_ref_no,
      pnr: r.pnr,
      passengerNo: r.passenger_no,
      passengerName: r.passenger_name || null,
      trainNumber: r.train_number,
      trainName: r.train_name,
      journeyDate: String(r.journey_date).slice(0, 10),
      reason: r.reason,
      reasonLabel: REASON_LABELS[r.reason] || r.reason,
      status: r.status,
      filedAt: String(r.filed_at),
      reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
      refundAmount: r.refund_amount !== null ? parseFloat(r.refund_amount) : (r.refund_row_amount !== null && r.refund_row_amount !== undefined ? parseFloat(r.refund_row_amount) : null),
      refundStatus: r.refund_status || null,
      remarks: r.remarks
    }));

    return res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/tdr/eligibility/:pnr
 * For the TDR form: the train's current delay, every passenger of the PNR with name and ticket status, and for each
 * TDR reason whether it can be used now (eligible) or the plain reason why not. Own PNR only. Read only.
 */
async function getEligibility(req, res, next) {
  try {
    const result = await getTdrEligibility(req.params.pnr);
    if (!result) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Booking not found' } });
    }
    if (Number(result.ownerUserId) !== Number(req.user.userId)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You can only file a TDR for your own bookings' } });
    }
    return res.status(200).json({ success: true, data: result.data });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/tdr/:tdrRefNo
 * Retrieve single TDR by reference number (own only)
 */
async function getTdrByRefNo(req, res, next) {
  try {
    const { tdrRefNo } = req.params;

    const [rows] = await pool.query(
      `SELECT t.tdr_ref_no, t.pnr, t.passenger_no, t.reason, t.status, t.filed_at, t.refund_amount, t.remarks, b.user_id
       FROM TDR_FILING t
       JOIN BOOKING b ON t.pnr = b.pnr
       WHERE t.tdr_ref_no = ?`,
      [tdrRefNo]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'TDR record not found'
        }
      });
    }

    const row = rows[0];
    if (row.user_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied: You may only view your own TDR filings'
        }
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        tdrRefNo: row.tdr_ref_no,
        pnr: row.pnr,
        passengerNo: row.passenger_no,
        reason: row.reason,
        status: row.status,
        filedAt: String(row.filed_at),
        refundAmount: row.refund_amount !== null ? parseFloat(row.refund_amount) : null,
        remarks: row.remarks
      }
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  requirePassengerRole,
  fileTdr,
  getMyTdrs,
  getEligibility,
  getTdrByRefNo
};
