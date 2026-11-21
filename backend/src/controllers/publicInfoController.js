const pool = require('../config/mysql');
const AppError = require('../utils/appError');
const { getOrConnectMongoDb } = require('../config/mongodb');

function isValidDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * GET /api/alerts  (public)
 * Real service alerts: dated train runs of the next 7 days (today to today + 6) that are delayed or cancelled.
 * Read-only. An empty list means every run is on time.
 */
async function getAlerts(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT ts.schedule_id, t.train_number, t.display_name, ts.journey_date, ts.departure_time, ts.status, ts.delay_minutes
       FROM TRAIN_SCHEDULE ts
       JOIN TRAIN t ON t.train_id = ts.train_id
       WHERE ts.journey_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 6 DAY)
         AND (ts.status IN ('DELAYED', 'CANCELLED') OR ts.delay_minutes > 0)
       ORDER BY ts.journey_date ASC, ts.departure_time ASC
       LIMIT 20`
    );
    const data = rows.map((r) => {
      const date = String(r.journey_date).slice(0, 10);
      const cancelled = r.status === 'CANCELLED';
      return {
        scheduleId: r.schedule_id,
        trainNumber: r.train_number,
        trainName: r.display_name,
        journeyDate: date,
        departureTime: String(r.departure_time).slice(0, 5),
        status: r.status,
        delayMinutes: Number(r.delay_minutes) || 0,
        severity: cancelled ? 'CRITICAL' : 'WARNING',
        message: cancelled
          ? `${r.display_name} on ${date} is cancelled.`
          : `${r.display_name} on ${date} is running ${Number(r.delay_minutes)} minutes late.`
      };
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/trains/:trainId/run-status?journeyDate=YYYY-MM-DD  (public)
 * Run status and timetable of one dated run, for "Track your train". There is no live GPS: the status comes from
 * TRAIN_SCHEDULE (ON_TIME, DELAYED, CANCELLED, COMPLETED and the delay in minutes).
 */
async function getRunStatus(req, res, next) {
  try {
    const { trainId } = req.params;
    const { journeyDate } = req.query;
    if (!journeyDate || !isValidDateString(journeyDate)) {
      throw new AppError('VALIDATION_ERROR', 'journeyDate (YYYY-MM-DD) is required', 400);
    }
    const [runs] = await pool.query(
      `SELECT ts.schedule_id, t.train_id, t.train_number, t.display_name, ts.journey_date, ts.departure_time,
              ts.status, ts.delay_minutes, ts.chart_prepared_at
       FROM TRAIN_SCHEDULE ts JOIN TRAIN t ON t.train_id = ts.train_id
       WHERE (t.train_id = ? OR t.train_number = ?) AND ts.journey_date = ?`,
      [trainId, trainId, journeyDate]
    );
    if (runs.length === 0) {
      throw new AppError('NOT_FOUND', 'No run of this train on that date', 404);
    }
    const run = runs[0];
    const [stops] = await pool.query(
      `SELECT rs.stop_sequence, s.station_code, s.station_name, rs.arrival_time, rs.departure_time, rs.day_offset
       FROM ROUTE_STOP rs JOIN STATION s ON s.station_id = rs.station_id
       WHERE rs.train_id = ? ORDER BY rs.stop_sequence ASC`,
      [run.train_id]
    );
    return res.status(200).json({
      success: true,
      data: {
        trainId: run.train_id,
        trainNumber: run.train_number,
        trainName: run.display_name,
        journeyDate: String(run.journey_date).slice(0, 10),
        departureTime: String(run.departure_time).slice(0, 5),
        status: run.status,
        delayMinutes: Number(run.delay_minutes) || 0,
        chartPrepared: Boolean(run.chart_prepared_at),
        stops: stops.map((x) => ({
          stopSequence: x.stop_sequence,
          stationCode: x.station_code,
          stationName: x.station_name,
          arrivalTime: String(x.arrival_time).slice(0, 5),
          departureTime: String(x.departure_time).slice(0, 5),
          dayOffset: x.day_offset
        }))
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/contact-info  (public)
 * The helpline, e-mail and address shown in the Contact Us panel, read from SETTING
 * (CONTACT_HELPLINE, CONTACT_EMAIL, CONTACT_ADDRESS). Change them in Admin, Settings: one place for both portals.
 */
async function getContactInfo(req, res, next) {
  try {
    const [rows] = await pool.query(
      "SELECT setting_key, setting_value FROM SETTING WHERE setting_key IN ('CONTACT_HELPLINE', 'CONTACT_EMAIL', 'CONTACT_ADDRESS')"
    );
    const m = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
    return res.status(200).json({
      success: true,
      data: { helpline: m.CONTACT_HELPLINE || null, email: m.CONTACT_EMAIL || null, address: m.CONTACT_ADDRESS || null }
    });
  } catch (error) {
    next(error);
  }
}

// POST /api/contact: at most 5 messages per address every 10 minutes (in memory)
const contactHits = new Map();
const CONTACT_WINDOW_MS = 10 * 60 * 1000;
const CONTACT_MAX = 5;

/**
 * POST /api/contact  (public)
 * Saves a short message from the Contact Us panel in MongoDB (collection contact_messages).
 * Answers 503 when MongoDB is down.
 */
async function submitContact(req, res, next) {
  try {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const recent = (contactHits.get(ip) || []).filter((t) => now - t < CONTACT_WINDOW_MS);
    if (recent.length >= CONTACT_MAX) {
      throw new AppError('TOO_MANY_REQUESTS', 'Too many messages. Please try again in a few minutes.', 429);
    }

    const body = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (name.length < 2 || name.length > 80) throw new AppError('VALIDATION_ERROR', 'name is required (2 to 80 characters)', 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 120) throw new AppError('VALIDATION_ERROR', 'A valid e-mail address is required', 400);
    if (message.length < 5 || message.length > 1000) throw new AppError('VALIDATION_ERROR', 'message is required (5 to 1000 characters)', 400);

    const db = await getOrConnectMongoDb();
    const doc = { name, email, message, createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19), status: 'NEW' };
    const result = await db.collection('contact_messages').insertOne(doc);
    recent.push(now);
    contactHits.set(ip, recent);
    return res.status(201).json({ success: true, data: { received: true, messageId: String(result.insertedId) } });
  } catch (error) {
    next(error);
  }
}

module.exports = { getAlerts, getRunStatus, submitContact, getContactInfo };
