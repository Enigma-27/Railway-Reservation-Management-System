const pool = require('../config/mysql');
const AppError = require('../utils/appError');
const { upsertLiveStatus } = require('../services/liveStatusService');
const { createNotification } = require('../services/notificationService');
const { getOrConnectMongoDb } = require('../config/mongodb');
const { getAdminComplaints } = require('../services/complaintService');

/**
 * POST /api/admin/schedules/:scheduleId/delay   (ADMIN)
 * Body: { delayMinutes: 0..1440, reason?: string }   delayMinutes 0 clears the delay.
 *
 * Writes the SAME place station staff write (TRAIN_SCHEDULE.delay_minutes and status, plus the MongoDB live status), so the
 * public Alerts strip, Live Trains and Track your train show it at once. Every change is written to AUDIT_LOG with the admin.
 * Passengers with a CONFIRMED or RAC ticket on the run get a notification.
 */
async function setScheduleDelay(req, res, next) {
  try {
    const scheduleId = Number(req.params.scheduleId);
    if (!Number.isInteger(scheduleId) || scheduleId <= 0) throw new AppError('VALIDATION_ERROR', 'Valid scheduleId is required', 400);

    const mins = Number(req.body && req.body.delayMinutes);
    if (!Number.isInteger(mins) || mins < 0 || mins > 1440) {
      throw new AppError('VALIDATION_ERROR', 'delayMinutes must be an integer between 0 and 1440 (0 clears the delay)', 400);
    }
    const reason = req.body && typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 200) : '';

    const [rows] = await pool.query('SELECT schedule_id, status, delay_minutes FROM TRAIN_SCHEDULE WHERE schedule_id = ?', [scheduleId]);
    if (rows.length === 0) throw new AppError('NOT_FOUND', 'Train schedule not found', 404);
    const old = rows[0];
    if (old.status === 'CANCELLED') throw new AppError('CONFLICT', 'A cancelled run cannot get a delay', 409);
    if (old.status === 'COMPLETED') throw new AppError('CONFLICT', 'A completed run cannot get a delay', 409);

    const newStatus = mins > 0 ? 'DELAYED' : 'ON_TIME';
    await pool.query('UPDATE TRAIN_SCHEDULE SET delay_minutes = ?, status = ? WHERE schedule_id = ?', [mins, newStatus, scheduleId]);
    await upsertLiveStatus(scheduleId, { delayMinutes: mins, status: newStatus });

    await pool.query(
      `INSERT INTO AUDIT_LOG (user_id, action, table_name, record_id, old_value, new_value, logged_at)
       VALUES (?, ?, 'TRAIN_SCHEDULE', ?, ?, ?, NOW())`,
      [
        req.user.userId,
        mins > 0 ? 'UPDATE_SCHEDULE_DELAY' : 'CLEAR_SCHEDULE_DELAY',
        String(scheduleId),
        JSON.stringify({ status: old.status, delayMinutes: Number(old.delay_minutes || 0) }),
        JSON.stringify({ status: newStatus, delayMinutes: mins, reason: reason || null }),
      ]
    );

    let notified = 0;
    try {
      const [users] = await pool.query(
        `SELECT DISTINCT b.user_id FROM RESERVATION r JOIN BOOKING b ON r.pnr = b.pnr
          WHERE r.schedule_id = ? AND r.status IN ('CONFIRMED', 'RAC')`,
        [scheduleId]
      );
      for (const u of users) {
        await createNotification({
          userId: Number(u.user_id), type: 'DELAY', title: mins > 0 ? 'Train Delay Update' : 'Train Back On Time',
          message: mins > 0 ? `Train schedule ${scheduleId} is delayed by ${mins} minutes.${reason ? ' ' + reason : ''}` : `Train schedule ${scheduleId} is running on time again.`,
          referenceId: String(scheduleId),
        });
        notified++;
      }
    } catch (_) { /* notifications are best effort */ }

    res.status(200).json({ success: true, data: { scheduleId, delayMinutes: mins, status: newStatus, previousDelayMinutes: Number(old.delay_minutes || 0), passengersNotified: notified } });
  } catch (error) {
    next(error);
  }
}

const Q = {
  revenue: `
    SELECT t.train_number AS trainNumber, t.display_name AS trainName, sc.class_code AS classType,
           COUNT(DISTINCT b.pnr) AS ticketCount, ROUND(SUM(p.amount), 2) AS totalRevenue,
           DATE_FORMAT(MIN(p.paid_at), '%Y-%m') AS period
      FROM PAYMENT p JOIN BOOKING b ON b.pnr = p.pnr
      JOIN TRAIN_SCHEDULE ts ON ts.schedule_id = b.schedule_id JOIN TRAIN t ON t.train_id = ts.train_id
      JOIN SEAT_CLASS sc ON sc.class_id = b.class_id
     WHERE p.status = 'SUCCESS'
     GROUP BY t.train_id, t.train_number, t.display_name, sc.class_code
     ORDER BY totalRevenue DESC LIMIT 200`,
  bookings: `
    SELECT DATE_FORMAT(b.created_at, '%Y-%m-%d') AS date, COUNT(*) AS totalBookings,
           SUM(b.status = 'CONFIRMED') AS confirmedCount, SUM(b.status = 'RAC') AS racCount,
           SUM(b.status = 'WAITING_LIST') AS waitingListCount, SUM(b.status = 'CANCELLED') AS cancelledCount
      FROM BOOKING b WHERE b.status <> 'FAILED'
     GROUP BY DATE_FORMAT(b.created_at, '%Y-%m-%d') ORDER BY date DESC LIMIT 60`,
  cancellations: `
    SELECT c.pnr, t.train_number AS trainNumber, DATE_FORMAT(c.cancelled_at, '%Y-%m-%d %H:%i') AS cancellationDate,
           c.charge AS cancellationCharge,
           COALESCE((SELECT SUM(r.amount) FROM REFUND r WHERE r.cancel_id = c.cancel_id), 0) AS refundAmount,
           COALESCE((SELECT MAX(r.status) FROM REFUND r WHERE r.cancel_id = c.cancel_id), 'NO_REFUND') AS status
      FROM CANCELLATION c JOIN BOOKING b ON b.pnr = c.pnr JOIN TRAIN_SCHEDULE ts ON ts.schedule_id = b.schedule_id
      JOIN TRAIN t ON t.train_id = ts.train_id ORDER BY c.cancelled_at DESC LIMIT 200`,
  occupancy: `
    SELECT t.train_number AS trainNumber, t.display_name AS trainName, DATE_FORMAT(ts.journey_date, '%Y-%m-%d') AS journeyDate,
           sc.class_code AS classType, i.total_seats AS totalCapacity, (i.total_seats - i.available_seats) AS bookedSeats,
           ROUND(100 * (i.total_seats - i.available_seats) / NULLIF(i.total_seats, 0), 1) AS occupancyPercentage
      FROM SCHEDULE_CLASS_INVENTORY i JOIN TRAIN_SCHEDULE ts ON ts.schedule_id = i.schedule_id
      JOIN TRAIN t ON t.train_id = ts.train_id JOIN SEAT_CLASS sc ON sc.class_id = i.class_id
     WHERE ts.status <> 'CANCELLED' ORDER BY occupancyPercentage DESC, ts.journey_date DESC LIMIT 200`,
  delays: `
    SELECT t.train_number AS trainNumber, t.display_name AS trainName, DATE_FORMAT(ts.journey_date, '%Y-%m-%d') AS journeyDate,
           ts.status, ts.delay_minutes AS delayMinutes
      FROM TRAIN_SCHEDULE ts JOIN TRAIN t ON t.train_id = ts.train_id
     WHERE ts.status IN ('DELAYED', 'CANCELLED') OR ts.delay_minutes > 0
     ORDER BY ts.journey_date DESC, ts.delay_minutes DESC LIMIT 200`,
};

/**
 * GET /api/admin/analytics/:tab   (ADMIN)
 * tab = revenue | bookings | cancellations | occupancy | delays | complaints | notifications | summary
 * REAL numbers from the database (MySQL; complaints and notifications from MongoDB), in the row shapes the Reports page uses.
 * Revenue is money received (SUCCESS payments); refunds are in the cancellations tab. Occupancy is seats taken (total - available).
 */
async function getAnalytics(req, res, next) {
  try {
    const tab = String(req.params.tab || '').toLowerCase();
    let data;
    if (tab === 'revenue') {
      const [rows] = await pool.query(Q.revenue);
      data = rows.map((r) => ({ ...r, ticketCount: Number(r.ticketCount), totalRevenue: Number(r.totalRevenue) }));
    } else if (tab === 'bookings') {
      const [rows] = await pool.query(Q.bookings);
      data = rows.map((r) => ({ date: r.date, totalBookings: Number(r.totalBookings), confirmedCount: Number(r.confirmedCount), racCount: Number(r.racCount), waitingListCount: Number(r.waitingListCount), cancelledCount: Number(r.cancelledCount) }));
    } else if (tab === 'cancellations') {
      const [rows] = await pool.query(Q.cancellations);
      data = rows.map((r) => ({ ...r, cancellationCharge: Number(r.cancellationCharge), refundAmount: Number(r.refundAmount) }));
    } else if (tab === 'occupancy') {
      const [rows] = await pool.query(Q.occupancy);
      data = rows.map((r) => ({ ...r, totalCapacity: Number(r.totalCapacity), bookedSeats: Number(r.bookedSeats), occupancyPercentage: Number(r.occupancyPercentage || 0) }));
    } else if (tab === 'delays') {
      const [rows] = await pool.query(Q.delays);
      data = rows.map((r) => ({ ...r, delayMinutes: Number(r.delayMinutes) }));
    } else if (tab === 'complaints') {
      const list = await getAdminComplaints({});
      const map = new Map();
      for (const c of list) {
        const m = map.get(c.category) || { category: c.category, totalCount: 0, resolvedCount: 0, inProgressCount: 0, avgResolutionDays: 0 };
        m.totalCount++;
        if (c.status === 'RESOLVED') m.resolvedCount++;
        if (c.status === 'IN_PROGRESS') m.inProgressCount++;
        map.set(c.category, m);
      }
      data = [...map.values()];
    } else if (tab === 'notifications') {
      const db = await getOrConnectMongoDb();
      const docs = db ? await db.collection('notifications').find({}).project({ type: 1, is_read: 1, isRead: 1 }).toArray() : [];
      const byType = {};
      let unread = 0;
      for (const d of docs) {
        byType[d.type || 'OTHER'] = (byType[d.type || 'OTHER'] || 0) + 1;
        if (!(d.is_read !== undefined ? d.is_read : d.isRead)) unread++;
      }
      data = { total: docs.length, unread, byType };
    } else if (tab === 'summary') {
      const [[b]] = await pool.query(`SELECT COUNT(*) AS bookings, SUM(status = 'CONFIRMED') AS confirmed, SUM(status = 'RAC') AS rac, SUM(status = 'WAITING_LIST') AS waiting, SUM(status = 'CANCELLED') AS cancelled FROM BOOKING WHERE status <> 'FAILED'`);
      const [[p]] = await pool.query(`SELECT COALESCE(SUM(amount), 0) AS revenue FROM PAYMENT WHERE status = 'SUCCESS'`);
      const [[r]] = await pool.query(`SELECT COALESCE(SUM(amount), 0) AS refunded, COALESCE(SUM(status = 'PENDING'), 0) AS pending FROM REFUND WHERE status IN ('PROCESSED', 'PENDING')`);
      const [[o]] = await pool.query(`SELECT ROUND(100 * (SUM(i.total_seats) - SUM(i.available_seats)) / NULLIF(SUM(i.total_seats), 0), 1) AS occupancyPct FROM SCHEDULE_CLASS_INVENTORY i JOIN TRAIN_SCHEDULE ts ON ts.schedule_id = i.schedule_id WHERE ts.status <> 'CANCELLED'`);
      const [[d]] = await pool.query(`SELECT COALESCE(SUM(status IN ('FILED', 'UNDER_REVIEW')), 0) AS pendingTdr, COUNT(*) AS totalTdr FROM TDR_FILING`);
      data = {
        bookings: Number(b.bookings || 0), confirmed: Number(b.confirmed || 0), rac: Number(b.rac || 0), waiting: Number(b.waiting || 0), cancelled: Number(b.cancelled || 0),
        revenue: Number(p.revenue), refunded: Number(r.refunded), pendingRefunds: Number(r.pending), occupancyPct: Number(o.occupancyPct || 0),
        pendingTdr: Number(d.pendingTdr), totalTdr: Number(d.totalTdr),
      };
    } else {
      throw new AppError('VALIDATION_ERROR', 'Unknown analytics tab', 400);
    }
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

module.exports = { setScheduleDelay, getAnalytics };
