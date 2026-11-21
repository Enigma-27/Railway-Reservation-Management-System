const pool = require('../config/mysql');
const AppError = require('../utils/appError');

/**
 * Live Trains (public, read only).
 *
 *   GET /api/live-trains                  list of dated runs on one date, one SQL query per page
 *   GET /api/live-trains/:scheduleId      detail of one run: per class and per quota
 *
 * Seat numbers come from SCHEDULE_CLASS_INVENTORY (the single source of truth). Delay and run state come
 * from TRAIN_SCHEDULE, the same source as the Alerts strip. "Now" is COALESCE(@as_of_time, NOW()), the
 * project test clock. Nothing is calculated in the browser.
 */

const NOW_SQL = 'COALESCE(@as_of_time, NOW())';
const RUN_STATUSES = ['NOT_STARTED', 'RUNNING', 'DELAYED', 'COMPLETED', 'CANCELLED'];
const QUOTAS = ['GENERAL', 'TATKAL', 'LADIES', 'SENIOR_CITIZEN', 'DIVYAANG'];

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const hhmm = (v) => String(v || '').slice(0, 5);
const dateStr = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

/** Plain status of a class (or quota) from its numbers. */
function plainStatus({ available, racCount, racCapacity, wlCount, wlCapacity }) {
  if (available > 0) return 'AVAILABLE';
  if (racCapacity > 0 && racCount < racCapacity) return 'RAC';
  if (wlCapacity > 0 && wlCount < wlCapacity) return 'WL';
  return 'NOT AVAILABLE';
}

// The shared SELECT: one row per run with its class inventory as JSON (one round trip, no N+1)
const RUN_SELECT = `
  SELECT ts.schedule_id, t.train_id, t.train_number, t.display_name, t.train_type,
         ts.journey_date, ts.status AS schedule_status, ts.delay_minutes, ts.chart_prepared_at,
         o.departure_time AS origin_dep, so.station_id AS origin_id, so.station_code AS origin_code, so.station_name AS origin_name,
         d.arrival_time AS dest_arr, d.day_offset AS dest_day_offset, sd.station_id AS dest_id, sd.station_code AS dest_code, sd.station_name AS dest_name,
         TIMESTAMP(ts.journey_date, o.departure_time) + INTERVAL ts.delay_minutes MINUTE AS dep_dt,
         TIMESTAMP(ts.journey_date, d.arrival_time) + INTERVAL d.day_offset DAY + INTERVAL ts.delay_minutes MINUTE AS arr_dt,
         ${NOW_SQL} AS now_dt,
         (SELECT JSON_ARRAYAGG(JSON_OBJECT(
                   'classCode', sc.class_code, 'className', sc.class_name,
                   'total', i.total_seats, 'available', i.available_seats,
                   'racCount', i.rac_count, 'racCapacity', i.rac_capacity,
                   'wlCount', i.wl_count, 'wlCapacity', i.wl_capacity))
            FROM SCHEDULE_CLASS_INVENTORY i JOIN SEAT_CLASS sc ON sc.class_id = i.class_id
           WHERE i.schedule_id = ts.schedule_id) AS classes
    FROM TRAIN_SCHEDULE ts
    JOIN TRAIN t ON t.train_id = ts.train_id
    JOIN ROUTE_STOP o ON o.train_id = t.train_id AND o.stop_sequence = 1
    JOIN STATION so ON so.station_id = o.station_id
    JOIN ROUTE_STOP d ON d.train_id = t.train_id
         AND d.stop_sequence = (SELECT MAX(x.stop_sequence) FROM ROUTE_STOP x WHERE x.train_id = t.train_id)
    JOIN STATION sd ON sd.station_id = d.station_id`;

function shapeRun(r) {
  const classes = (typeof r.classes === 'string' ? JSON.parse(r.classes) : r.classes) || [];
  const cancelled = r.schedule_status === 'CANCELLED';
  const now = new Date(r.now_dt).getTime();
  const departed = !cancelled && now >= new Date(r.dep_dt).getTime();
  const completed = !cancelled && (r.schedule_status === 'COMPLETED' || now >= new Date(r.arr_dt).getTime());
  const delay = Number(r.delay_minutes) || 0;
  let runStatus = 'NOT_STARTED';
  if (cancelled) runStatus = 'CANCELLED';
  else if (completed) runStatus = 'COMPLETED';
  else if (delay > 0 || r.schedule_status === 'DELAYED') runStatus = 'DELAYED';
  else if (departed) runStatus = 'RUNNING';

  const shapedClasses = classes.map((c) => {
    const total = Number(c.total), available = Number(c.available);
    const base = {
      classCode: c.classCode, className: c.className,
      totalSeats: total, availableSeats: available, bookedSeats: total - available,
      racCount: Number(c.racCount), racCapacity: Number(c.racCapacity),
      waitingListCount: Number(c.wlCount), waitingListCapacity: Number(c.wlCapacity)
    };
    return { ...base, status: plainStatus({ available, racCount: base.racCount, racCapacity: base.racCapacity, wlCount: base.waitingListCount, wlCapacity: base.waitingListCapacity }) };
  }).sort((a, b) => a.classCode.localeCompare(b.classCode));

  const totalSeats = shapedClasses.reduce((s, c) => s + c.totalSeats, 0);
  const bookedSeats = shapedClasses.reduce((s, c) => s + c.bookedSeats, 0);
  return {
    scheduleId: r.schedule_id,
    trainId: r.train_id,
    trainNumber: r.train_number,
    trainName: r.display_name,
    trainType: r.train_type,
    journeyDate: dateStr(r.journey_date),
    origin: { stationId: r.origin_id, code: r.origin_code, name: r.origin_name, departureTime: hhmm(r.origin_dep) },
    destination: { stationId: r.dest_id, code: r.dest_code, name: r.dest_name, arrivalTime: hhmm(r.dest_arr), dayOffset: r.dest_day_offset },
    runStatus,
    departed,
    delayMinutes: delay,
    chartPrepared: Boolean(r.chart_prepared_at),
    occupancyPct: totalSeats > 0 ? Math.round((bookedSeats / totalSeats) * 1000) / 10 : 0,
    classes: shapedClasses
  };
}

/**
 * GET /api/live-trains?date=&from=&to=&type=&class=&status=&q=&page=&pageSize=
 */
async function listLiveTrains(req, res, next) {
  try {
    const { date, from, to, type, class: classCode, status, q } = req.query;
    if (date !== undefined && !isValidDate(String(date))) {
      throw new AppError('VALIDATION_ERROR', 'date must be a real date in YYYY-MM-DD format', 400);
    }
    if (status !== undefined && status !== '' && !RUN_STATUSES.includes(String(status).toUpperCase())) {
      throw new AppError('VALIDATION_ERROR', `status must be one of ${RUN_STATUSES.join(', ')}`, 400);
    }
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 25));

    const where = [date ? 'ts.journey_date = ?' : `ts.journey_date = DATE(${NOW_SQL})`];
    const params = date ? [String(date)] : [];

    if (from || to) {
      // Both stations must be stops of the train, "from" before "to". One of them alone is also allowed.
      if (from) {
        where.push(`EXISTS (SELECT 1 FROM ROUTE_STOP fs JOIN STATION fst ON fst.station_id = fs.station_id
                             WHERE fs.train_id = t.train_id AND (fst.station_code = ? OR fst.station_id = ?)
                               ${to ? `AND EXISTS (SELECT 1 FROM ROUTE_STOP ts2 JOIN STATION tst ON tst.station_id = ts2.station_id
                                                     WHERE ts2.train_id = t.train_id AND (tst.station_code = ? OR tst.station_id = ?)
                                                       AND ts2.stop_sequence > fs.stop_sequence)` : ''})`);
        params.push(String(from).toUpperCase(), Number(from) || 0);
        if (to) params.push(String(to).toUpperCase(), Number(to) || 0);
      } else {
        where.push(`EXISTS (SELECT 1 FROM ROUTE_STOP ts2 JOIN STATION tst ON tst.station_id = ts2.station_id
                             WHERE ts2.train_id = t.train_id AND (tst.station_code = ? OR tst.station_id = ?))`);
        params.push(String(to).toUpperCase(), Number(to) || 0);
      }
    }
    if (type) { where.push('t.train_type = ?'); params.push(String(type).toUpperCase()); }
    if (classCode) {
      where.push(`EXISTS (SELECT 1 FROM SCHEDULE_CLASS_INVENTORY ic JOIN SEAT_CLASS sci ON sci.class_id = ic.class_id
                           WHERE ic.schedule_id = ts.schedule_id AND sci.class_code = ?)`);
      params.push(String(classCode).toUpperCase());
    }
    if (q && String(q).trim()) {
      where.push('(t.train_number LIKE ? OR t.display_name LIKE ?)');
      const like = `%${String(q).trim().slice(0, 40)}%`;
      params.push(like, like);
    }

    // The run status is derived in SQL so it can be filtered and counted without reading every row in JS
    const statusExpr = `CASE
        WHEN x.schedule_status = 'CANCELLED' THEN 'CANCELLED'
        WHEN x.schedule_status = 'COMPLETED' OR x.now_dt >= x.arr_dt THEN 'COMPLETED'
        WHEN x.delay_minutes > 0 OR x.schedule_status = 'DELAYED' THEN 'DELAYED'
        WHEN x.now_dt >= x.dep_dt THEN 'RUNNING'
        ELSE 'NOT_STARTED' END`;
    const statusWanted = status ? String(status).toUpperCase() : null;
    // "running" means on the way (also when late); "delayed" means late and not finished
    const outerWhere = statusWanted === 'RUNNING'
      ? `WHERE x.schedule_status <> 'CANCELLED' AND x.schedule_status <> 'COMPLETED' AND x.now_dt >= x.dep_dt AND x.now_dt < x.arr_dt`
      : statusWanted ? `WHERE (${statusExpr}) = ?` : '';
    if (statusWanted && statusWanted !== 'RUNNING') params.push(statusWanted);

    const [rows] = await pool.query(
      `SELECT x.*, COUNT(*) OVER() AS total_rows FROM (${RUN_SELECT} WHERE ${where.join(' AND ')}) x
       ${outerWhere}
       ORDER BY x.dep_dt ASC, x.train_number ASC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    );

    const total = rows.length ? Number(rows[0].total_rows) : 0;
    const [[clock]] = await pool.query(`SELECT ${NOW_SQL} AS now_dt, DATE(${NOW_SQL}) AS today`);
    return res.status(200).json({
      success: true,
      data: {
        date: date ? String(date) : dateStr(clock.today),
        asOf: String(clock.now_dt instanceof Date ? clock.now_dt.toISOString().slice(0, 19).replace('T', ' ') : clock.now_dt),
        page, pageSize, total,
        trains: rows.map(shapeRun)
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/live-trains/:scheduleId[?from=&to=]
 * Detail: every class with its seat numbers, and every quota inside the class.
 * The fare is the current fare for the whole route, or for from..to when both station codes are given.
 */
async function getLiveTrain(req, res, next) {
  try {
    const scheduleId = parseInt(req.params.scheduleId, 10);
    if (!scheduleId || scheduleId < 1) throw new AppError('VALIDATION_ERROR', 'A valid scheduleId is required', 400);

    const [runRows] = await pool.query(`${RUN_SELECT} WHERE ts.schedule_id = ?`, [scheduleId]);
    if (runRows.length === 0) throw new AppError('NOT_FOUND', 'Run not found', 404);
    const run = shapeRun(runRows[0]);

    // Distance for the fare: whole route, or the from..to segment
    let distance;
    let segment = null;
    const [[routeEnd]] = await pool.query('SELECT MAX(distance_from_origin) AS km FROM ROUTE_STOP WHERE train_id = ?', [run.trainId]);
    distance = Number(routeEnd.km) || 0;
    if (req.query.from && req.query.to) {
      const [segRows] = await pool.query(
        `SELECT fs.distance_from_origin AS f_km, ts2.distance_from_origin AS t_km, fst.station_code AS f_code, tst.station_code AS t_code
           FROM ROUTE_STOP fs JOIN STATION fst ON fst.station_id = fs.station_id
           JOIN ROUTE_STOP ts2 ON ts2.train_id = fs.train_id AND ts2.stop_sequence > fs.stop_sequence
           JOIN STATION tst ON tst.station_id = ts2.station_id
          WHERE fs.train_id = ? AND fst.station_code = ? AND tst.station_code = ? LIMIT 1`,
        [run.trainId, String(req.query.from).toUpperCase(), String(req.query.to).toUpperCase()]
      );
      if (segRows.length) {
        distance = Number(segRows[0].t_km) - Number(segRows[0].f_km);
        segment = { from: segRows[0].f_code, to: segRows[0].t_code, distanceKm: distance };
      }
    }

    // Per class and quota: booked and queue counts from the reservations of this run (one query)
    const [quotaRows] = await pool.query(
      `SELECT b.class_id, sc.class_code, b.quota,
              SUM(r.status IN ('CONFIRMED', 'BOARDED')) AS confirmed,
              SUM(r.status = 'RAC') AS rac,
              SUM(r.status = 'WAITING_LIST') AS wl
         FROM BOOKING b JOIN RESERVATION r ON r.pnr = b.pnr JOIN SEAT_CLASS sc ON sc.class_id = b.class_id
        WHERE b.schedule_id = ? AND r.status IN ('CONFIRMED', 'BOARDED', 'RAC', 'WAITING_LIST')
        GROUP BY b.class_id, sc.class_code, b.quota`,
      [scheduleId]
    );
    const [coachRows] = await pool.query(
      'SELECT sc.class_code, COUNT(*) AS coaches FROM COACH c JOIN SEAT_CLASS sc ON sc.class_id = c.class_id WHERE c.train_id = ? GROUP BY sc.class_code',
      [run.trainId]
    );
    const coaches = Object.fromEntries(coachRows.map((c) => [c.class_code, Number(c.coaches)]));

    // Current fare per class and quota (fn_calculate_fare, no concession, one passenger, insurance included)
    const fareParts = [];
    const fareParams = [];
    for (const c of run.classes) for (const quota of QUOTAS) {
      fareParts.push('SELECT ? AS class_code, ? AS quota, fn_calculate_fare(sc.class_id, ?, ?, ?, \'NONE\', 1, ?) AS fare FROM SEAT_CLASS sc WHERE sc.class_code = ?');
      fareParams.push(c.classCode, quota, run.trainId, distance, quota, scheduleId, c.classCode);
    }
    const fares = {};
    if (fareParts.length) {
      const [fareRows] = await pool.query(fareParts.join(' UNION ALL '), fareParams);
      for (const f of fareRows) {
        const parsed = typeof f.fare === 'string' ? JSON.parse(f.fare) : f.fare;
        fares[`${f.class_code}|${f.quota}`] = Number(parsed && parsed.total_fare) || 0;
      }
    }

    const classes = run.classes.map((c) => {
      const cap = {
        TATKAL: Math.round(c.totalSeats * 0.10),
        LADIES: Math.round(c.totalSeats * 0.10),
        DIVYAANG: ['3A', 'SL', 'CC', '2S'].includes(c.classCode) ? 4 : 0,
        SENIOR_CITIZEN: (({ SL: 6, '3A': 4, '2A': 3 })[c.classCode] || 0) * (coaches[c.classCode] || 0)
      };
      cap.GENERAL = Math.max(0, c.totalSeats - cap.TATKAL - cap.LADIES - cap.DIVYAANG - cap.SENIOR_CITIZEN);
      const quotas = QUOTAS.map((quota) => {
        const used = quotaRows.find((x) => x.class_code === c.classCode && x.quota === quota) || {};
        const confirmed = Number(used.confirmed) || 0;
        const hasQueue = ['GENERAL', 'TATKAL'].includes(quota) && c.racCapacity >= 0;
        const available = Math.max(0, Math.min(cap[quota] - confirmed, c.availableSeats));
        const racCount = Number(used.rac) || 0;
        const wlCount = Number(used.wl) || 0;
        return {
          quota,
          totalSeats: cap[quota],
          bookedSeats: confirmed,
          availableSeats: available,
          racCount: hasQueue ? racCount : 0,
          waitingListCount: hasQueue ? wlCount : 0,
          fare: fares[`${c.classCode}|${quota}`] || 0,
          // RAC and waiting list exist only for GENERAL and TATKAL (BR-Q12), and only when the class still has room
          status: plainStatus({
            available,
            racCount: c.racCount, racCapacity: hasQueue ? c.racCapacity : 0,
            wlCount: c.waitingListCount, wlCapacity: hasQueue ? c.waitingListCapacity : 0
          })
        };
      });
      return { ...c, fare: fares[`${c.classCode}|GENERAL`] || 0, quotas };
    });

    return res.status(200).json({
      success: true,
      data: { ...run, classes, fareFor: segment || { from: run.origin.code, to: run.destination.code, distanceKm: distance } }
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { listLiveTrains, getLiveTrain };
