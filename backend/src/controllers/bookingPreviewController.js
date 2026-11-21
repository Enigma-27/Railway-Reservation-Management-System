const pool = require('../config/mysql');
const AppError = require('../utils/appError');
const { loadSettings, getBookingRules, checkPassengers } = require('../services/bookingRulesService');
const { expireAbandonedOrders } = require('../services/paymentOrderService');
const { logActivity } = require('../services/activityLogService');

/** GET /api/booking-rules (public): the real booking rules and the concession list, read from the database. */
async function bookingRules(req, res, next) {
  try {
    return res.status(200).json({ success: true, data: await getBookingRules() });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/bookings/fare-preview (login required, read only: nothing is held or saved)
 * Body: the same fields as POST /api/bookings (trainId, journeyDate, boardingStationId, destinationStationId,
 * classType, quota, passengers[]). Answers with the problems the booking would run into and, for each passenger,
 * the fare lines from fn_calculate_fare (the same function the booking uses) and the status the passenger
 * would probably get. The status is an estimate: the real one is decided when the seats are held.
 */
async function farePreview(req, res, next) {
  try {
    const { trainId, journeyDate, boardingStationId, destinationStationId, classType, quota = 'GENERAL', passengers } = req.body || {};
    if (!trainId || !journeyDate || !boardingStationId || !destinationStationId || !classType) {
      throw new AppError('VALIDATION_ERROR', 'trainId, journeyDate, boardingStationId, destinationStationId and classType are required', 400);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(journeyDate))) {
      throw new AppError('VALIDATION_ERROR', 'journeyDate must be in YYYY-MM-DD format', 400);
    }
    const requestedQuota = String(quota).toUpperCase();
    const list = Array.isArray(passengers) ? passengers : [];

    const [stopRows] = await pool.query(
      'SELECT stop_id, station_id, stop_sequence, day_offset FROM ROUTE_STOP WHERE train_id = ? AND station_id IN (?, ?) ORDER BY stop_sequence ASC',
      [trainId, boardingStationId, destinationStationId]
    );
    const fromStop = stopRows.find((s) => Number(s.station_id) === Number(boardingStationId));
    const toStop = stopRows.find((s) => Number(s.station_id) === Number(destinationStationId));
    if (!fromStop || !toStop || fromStop.stop_sequence >= toStop.stop_sequence) {
      throw new AppError('VALIDATION_ERROR', 'Invalid boarding or destination station for this train route', 400);
    }
    const [[origin]] = await pool.query('SELECT DATE_SUB(?, INTERVAL ? DAY) AS origin_date', [journeyDate, fromStop.day_offset]);
    const [schedRows] = await pool.query('SELECT schedule_id, chart_prepared_at, status FROM TRAIN_SCHEDULE WHERE train_id = ? AND journey_date = ?', [trainId, origin.origin_date]);
    if (schedRows.length === 0) throw new AppError('TRAIN_NOT_RUNNING', 'The train does not run on that date.', 400);
    const schedule = schedRows[0];
    const [classRows] = await pool.query('SELECT class_id, has_berths FROM SEAT_CLASS WHERE class_code = ?', [String(classType).toUpperCase()]);
    if (classRows.length === 0) throw new AppError('VALIDATION_ERROR', `Invalid classType: ${classType}`, 400);
    const classId = classRows[0].class_id;

    const settings = await loadSettings();
    const [concRows] = await pool.query(
      `SELECT concession_type, MAX(CASE WHEN is_active = 1 THEN discount_pct ELSE 0 END) AS pct FROM CONCESSION_RULE WHERE class_id = ? GROUP BY concession_type`,
      [classId]
    );
    const concessionDiscounts = {};
    for (const r of concRows) concessionDiscounts[r.concession_type] = Number(r.pct);
    const { errors, warnings } = checkPassengers(list, requestedQuota, settings, concessionDiscounts);
    if (schedule.chart_prepared_at) errors.push({ code: 'CHART_PREPARED', message: 'The chart for this train is already prepared. New bookings are closed.' });
    if (schedule.status === 'CANCELLED') errors.push({ code: 'TRAIN_NOT_RUNNING', message: 'This train run is cancelled.' });

    const [[dist]] = await pool.query('SELECT fn_calculate_distance(?, ?) AS km', [fromStop.stop_id, toStop.stop_id]);
    const distance = Number(dist.km);

    // Seats of this class and quota right now, to estimate each passenger's status (same rules as the booking)
    const [[inv]] = await pool.query(
      'SELECT total_seats, available_seats, rac_capacity, rac_count, wl_capacity, wl_count FROM SCHEDULE_CLASS_INVENTORY WHERE schedule_id = ? AND class_id = ?',
      [schedule.schedule_id, classId]
    );
    let free = 0;
    let racLeft = 0;
    let wlLeft = 0;
    if (inv) {
      const total = Number(inv.total_seats);
      const [[coach]] = await pool.query('SELECT COUNT(*) AS n FROM COACH WHERE train_id = ? AND class_id = ?', [trainId, classId]);
      const cap = {
        TATKAL: Math.round(total * 0.1),
        LADIES: Math.round(total * 0.1),
        DIVYAANG: [3, 4, 5, 7].includes(classId) ? 4 : 0,
        SENIOR_CITIZEN: ({ 4: 6, 3: 4, 2: 3 }[classId] || 0) * Number(coach.n)
      };
      cap.GENERAL = Math.max(0, total - cap.TATKAL - cap.LADIES - cap.DIVYAANG - cap.SENIOR_CITIZEN);
      const [[booked]] = await pool.query(
        `SELECT COUNT(r.res_id) AS n FROM BOOKING b JOIN RESERVATION r ON r.pnr = b.pnr
          WHERE b.schedule_id = ? AND b.class_id = ? AND b.quota = ? AND r.status IN ('CONFIRMED', 'BOARDED')`,
        [schedule.schedule_id, classId, requestedQuota]
      );
      free = Math.min(Math.max(0, (cap[requestedQuota] || 0) - Number(booked.n)), Number(inv.available_seats));
      racLeft = classRows[0].has_berths && ['GENERAL', 'TATKAL'].includes(requestedQuota) ? Math.max(0, Number(inv.rac_capacity) - Number(inv.rac_count)) : 0;
      wlLeft = ['GENERAL', 'TATKAL'].includes(requestedQuota) ? Math.max(0, Number(inv.wl_capacity) - Number(inv.wl_count)) : 0;
    }

    const lines = [];
    let total = 0;
    for (let i = 0; i < list.length && i < 12; i++) {
      const p = list[i];
      const conc = ['DIVYAANG', 'SENIOR_CITIZEN'].includes(p.concessionType) ? p.concessionType : 'NONE';
      const [[row]] = await pool.query('SELECT fn_calculate_fare(?, ?, ?, ?, ?, 1, ?) AS fare', [classId, trainId, distance, requestedQuota, conc, schedule.schedule_id]);
      const f = typeof row.fare === 'string' ? JSON.parse(row.fare) : row.fare;
      let projectedStatus = 'NOT AVAILABLE';
      if (i < free) projectedStatus = 'CONFIRMED';
      else if (i < free + racLeft) projectedStatus = 'RAC';
      else if (i < free + racLeft + wlLeft) projectedStatus = 'WAITING_LIST';
      const line = {
        index: i, name: p.name || null, concessionType: conc, projectedStatus,
        baseFare: Number(f.base_fare), concessionDiscount: Number(f.concession_discount),
        reservationCharge: Number(f.reservation_charge), superfastCharge: Number(f.superfast_charge),
        tatkalCharge: Number(f.tatkal_charge), dynamicSurcharge: Number(f.dynamic_surcharge),
        gst: Number(f.gst), insurance: Number(f.insurance), totalFare: Number(f.total_fare)
      };
      total += line.totalFare;
      lines.push(line);
    }

    return res.status(200).json({
      success: true,
      data: {
        valid: errors.length === 0,
        errors,
        warnings,
        quota: requestedQuota,
        distanceKm: distance,
        passengers: lines,
        totalFare: Math.round(total * 100) / 100,
        estimate: true,
        note: 'This is a preview. Nothing is held or charged. The final fare and each passenger\'s status are set when the seats are held.'
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/bookings/:pnr/cancel-unpaid (PASSENGER owner only)
 * Gives up a booking that is still PAYMENT_PENDING: the seats go back at once (sp_cancel_unpaid_booking), the
 * booking ends as FAILED like an expired hold, and its open payment orders are checked at Razorpay and closed.
 * A booking that is already paid, released or cancelled answers 409.
 */
async function cancelUnpaidBooking(req, res, next) {
  try {
    const userId = req.user.user_id || req.user.userId;
    if ((req.user.role || '').toUpperCase() !== 'PASSENGER') {
      throw new AppError('FORBIDDEN', 'Only the passenger who made the booking can cancel it.', 403);
    }
    const { pnr } = req.params;
    const conn = await pool.getConnection();
    let status;
    try {
      await conn.query('CALL sp_cancel_unpaid_booking(?, ?, 1, @out_status)', [String(pnr), userId]);
      const [[row]] = await conn.query('SELECT @out_status AS status');
      status = row && row.status;
    } finally {
      conn.release();
    }
    if (status === 'NOT_FOUND') throw new AppError('NOT_FOUND', 'Booking not found', 404);
    if (status === 'FORBIDDEN') throw new AppError('FORBIDDEN', 'Access denied: you do not own this booking', 403);
    if (status === 'NOT_PENDING') throw new AppError('CONFLICT', 'This booking is not waiting for payment any more (it is paid, released or already cancelled).', 409);
    if (status !== 'RELEASED') throw new AppError('INTERNAL_SERVER_ERROR', 'The booking could not be released.', 500);

    // Close this booking's open payment orders. A payment that already went through at Razorpay is finished first.
    const closed = await expireAbandonedOrders(pnr).catch(() => ({ checked: 0, expired: 0, finished: 0 }));
    logActivity({ userId, action: 'CANCEL_UNPAID', tableName: 'BOOKING', recordId: String(pnr) });
    return res.status(200).json({ success: true, data: { pnr: String(pnr), bookingStatus: 'FAILED', released: true, ordersClosed: closed.expired } });
  } catch (error) {
    next(error);
  }
}

module.exports = { bookingRules, farePreview, cancelUnpaidBooking };
