const pool = require('../config/mysql');
const AppError = require('../utils/appError');

/**
 * Public PNR status (no login). It answers ONLY the status of a ticket:
 *   overall status, train, date, route, class, and for each passenger the current status (CNF, RAC or WL) with the queue position.
 * It never returns names, ages, genders, ID proofs, contact data, fares, seats or the owner. Those stay behind the sign-in
 * (GET /api/bookings/:pnr for the owner, GET /api/staff/pnr/:pnr for staff and admin).
 */

// Small in-memory rate limit: at most LIMIT lookups per IP in WINDOW_MS (a 10-digit PNR is guessable, so this slows scanning)
const WINDOW_MS = 60 * 1000;
const LIMIT = 15;
const hits = new Map();

function rateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
  const list = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= LIMIT) {
    const retry = Math.max(1, Math.ceil((WINDOW_MS - (now - list[0])) / 1000));
    res.set('Retry-After', String(retry));
    return res.status(429).json({ success: false, error: { code: 'TOO_MANY_REQUESTS', message: `Too many PNR lookups. Please try again in ${retry} seconds.` } });
  }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  next();
}

const SHORT = { CONFIRMED: 'CNF', RAC: 'RAC', WAITING_LIST: 'WL', CANCELLED: 'CAN' };

async function getPublicPnrStatus(req, res, next) {
  try {
    const pnr = String(req.params.pnr || '').trim();
    if (!/^\d{10}$/.test(pnr)) throw new AppError('VALIDATION_ERROR', 'PNR must be exactly 10 digits', 400);

    const [rows] = await pool.query(
      `SELECT b.pnr, b.status AS bookingStatus, t.train_number AS trainNumber, t.display_name AS trainName,
              ts.journey_date AS journeyDate, ts.status AS runStatus, ts.delay_minutes AS delayMinutes, sc.class_code AS classType,
              s_from.station_code AS fromCode, COALESCE(NULLIF(s_from.display_name, ''), s_from.station_name) AS fromName,
              s_to.station_code AS toCode, COALESCE(NULLIF(s_to.display_name, ''), s_to.station_name) AS toName
         FROM BOOKING b
         JOIN TRAIN_SCHEDULE ts ON b.schedule_id = ts.schedule_id
         JOIN TRAIN t ON ts.train_id = t.train_id
         JOIN SEAT_CLASS sc ON b.class_id = sc.class_id
         JOIN ROUTE_STOP rs_from ON b.from_stop_id = rs_from.stop_id
         JOIN STATION s_from ON rs_from.station_id = s_from.station_id
         JOIN ROUTE_STOP rs_to ON b.to_stop_id = rs_to.stop_id
         JOIN STATION s_to ON rs_to.station_id = s_to.station_id
        WHERE b.pnr = ?`,
      [pnr]
    );
    if (rows.length === 0) throw new AppError('NOT_FOUND', 'No booking was found for this PNR', 404);
    const b = rows[0];

    const [pax] = await pool.query(
      `SELECT pb.passenger_no AS passengerNo,
              CASE WHEN bk.status = 'CANCELLED' OR r.status = 'CANCELLED' THEN 'CANCELLED' ELSE r.status END AS status,
              CASE WHEN bk.status = 'CANCELLED' OR r.status = 'CANCELLED' THEN NULL ELSE r.queue_position END AS queuePosition
         FROM PASSENGER_BOOKING pb
         JOIN BOOKING bk ON bk.pnr = pb.pnr
         JOIN RESERVATION r ON r.pnr = pb.pnr AND r.passenger_no = pb.passenger_no
        WHERE pb.pnr = ?
        ORDER BY pb.passenger_no`,
      [pnr]
    );

    res.status(200).json({
      success: true,
      data: {
        pnr: b.pnr,
        bookingStatus: b.bookingStatus,
        trainNumber: b.trainNumber,
        trainName: b.trainName,
        journeyDate: b.journeyDate,
        classType: b.classType,
        runStatus: b.runStatus,
        delayMinutes: Number(b.delayMinutes || 0),
        boardingStation: { stationCode: b.fromCode, stationName: b.fromName },
        destinationStation: { stationCode: b.toCode, stationName: b.toName },
        passengers: pax.map((p) => ({
          passengerNo: Number(p.passengerNo),
          status: p.status,
          shortStatus: SHORT[p.status] || p.status,
          queuePosition: p.queuePosition || null,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getPublicPnrStatus, rateLimit };
