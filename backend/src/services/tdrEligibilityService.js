const pool = require('../config/mysql');

/**
 * Which TDR reasons a passenger can use right now, with a plain reason when one cannot be used.
 * This repeats the checks of sp_file_tdr (database/mysql/03_procedures.sql) so the screen can tell the passenger
 * BEFORE filing. sp_file_tdr stays the one that really decides.
 *
 * Rules of sp_file_tdr:
 *   TRAIN_DELAYED_OVER_3_HOURS  ticket CONFIRMED or RAC, schedule delay_minutes >= 180, train not yet departed
 *                               (scheduled departure of the boarding stop + delay)
 *   TRAIN_DIVERTED              ticket CONFIRMED or RAC, train not yet departed. (There is no "diverted" flag in the
 *                               data: the admin checks the claim when reviewing.)
 *   the other four reasons      ticket CONFIRMED, RAC or BOARDED, train already departed, evidence reference required,
 *                               filed within deadline_hours (72) after the destination arrival + delay
 *   every reason                no open TDR for the passenger (FILED, UNDER_REVIEW, APPROVED, REFUND_PROCESSED)
 */

const REASON_LABELS = {
  TRAIN_DELAYED_OVER_3_HOURS: 'Train delayed over 3 hours',
  TRAIN_DIVERTED: 'Train diverted (you do not want to travel)',
  CLASS_DOWNGRADED: 'Class downgraded (you do not want to travel)',
  AC_FAILURE: 'AC failure in the coach',
  COACH_NOT_ATTACHED: 'Reserved coach not attached',
  TRAIN_TERMINATED_SHORT: 'Train terminated short of your destination'
};

const STATUS_WORDS = { CONFIRMED: 'confirmed', RAC: 'RAC', WAITING_LIST: 'on the waiting list', BOARDED: 'boarded', NO_SHOW: 'marked no-show', CANCELLED: 'cancelled' };

function fmtDelay(min) {
  if (min < 60) return `${min} minutes`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} hours`;
}

/** Load everything needed for one PNR: the train run, the clock, the passengers, the rules and the open TDRs. */
async function loadContext(pnr) {
  const [[booking]] = await pool.query(
    `SELECT b.pnr, b.user_id, b.status AS booking_status, t.train_number, t.display_name,
            ts.journey_date, ts.delay_minutes, ts.status AS run_status,
            sf.station_code AS from_code, st.station_code AS to_code,
            TIMESTAMP(ts.journey_date, rf.departure_time) + INTERVAL rf.day_offset DAY AS sched_dep,
            TIMESTAMP(ts.journey_date, rf.departure_time) + INTERVAL rf.day_offset DAY + INTERVAL ts.delay_minutes MINUTE AS dep_dt,
            TIMESTAMP(ts.journey_date, rt.arrival_time) + INTERVAL rt.day_offset DAY + INTERVAL ts.delay_minutes MINUTE AS arr_dt,
            COALESCE(@as_of_time, NOW()) AS now_dt
       FROM BOOKING b
       JOIN TRAIN_SCHEDULE ts ON ts.schedule_id = b.schedule_id
       JOIN TRAIN t ON t.train_id = ts.train_id
       JOIN ROUTE_STOP rf ON rf.stop_id = b.from_stop_id JOIN STATION sf ON sf.station_id = rf.station_id
       JOIN ROUTE_STOP rt ON rt.stop_id = b.to_stop_id JOIN STATION st ON st.station_id = rt.station_id
      WHERE b.pnr = ?`,
    [String(pnr)]
  );
  if (!booking) return null;
  const [passengers] = await pool.query(
    `SELECT pb.passenger_no, pb.name, pb.age, pb.gender, r.status AS res_status
       FROM PASSENGER_BOOKING pb JOIN RESERVATION r ON r.pnr = pb.pnr AND r.passenger_no = pb.passenger_no
      WHERE pb.pnr = ? ORDER BY pb.passenger_no`,
    [String(pnr)]
  );
  const [rules] = await pool.query('SELECT reason_code, description, deadline_hours, requires_verification, refund_pct FROM TDR_RULE ORDER BY rule_id');
  const [open] = await pool.query(
    `SELECT tdr_ref_no, passenger_no, status, reason FROM TDR_FILING
      WHERE pnr = ? AND status IN ('FILED', 'UNDER_REVIEW', 'APPROVED', 'REFUND_PROCESSED')`,
    [String(pnr)]
  );
  return { booking, passengers, rules, open };
}

/** One passenger, one reason: { eligible, why } (why is plain text, set when not eligible). */
function evaluate(ctx, passenger, rule) {
  const b = ctx.booking;
  const now = new Date(b.now_dt).getTime();
  const dep = new Date(b.dep_dt).getTime();
  const arr = new Date(b.arr_dt).getTime();
  const delay = Number(b.delay_minutes) || 0;
  const status = passenger.res_status;
  const code = rule.reason_code;

  const existing = ctx.open.find((t) => t.passenger_no === null || t.passenger_no === passenger.passenger_no);
  if (existing) {
    return { eligible: false, why: `A TDR (${existing.tdr_ref_no}) is already ${existing.status.toLowerCase().replace('_', ' ')} for this passenger.` };
  }
  if (b.booking_status === 'PAYMENT_PENDING' || b.booking_status === 'FAILED') {
    return { eligible: false, why: 'This booking was never paid, so there is nothing to claim.' };
  }

  if (code === 'TRAIN_DELAYED_OVER_3_HOURS' || code === 'TRAIN_DIVERTED') {
    if (!['CONFIRMED', 'RAC'].includes(status)) {
      return { eligible: false, why: `This passenger's ticket is ${STATUS_WORDS[status] || status}. Only confirmed or RAC tickets can claim this.` };
    }
    if (code === 'TRAIN_DELAYED_OVER_3_HOURS' && delay < 180) {
      return { eligible: false, why: delay === 0 ? 'The train is not delayed. At least 3 hours (180 minutes) of delay are needed.' : `The train is delayed by ${fmtDelay(delay)}. At least 3 hours (180 minutes) are needed.` };
    }
    if (now >= dep) {
      return { eligible: false, why: 'The train has already left the boarding station. This reason must be filed before departure.' };
    }
    return { eligible: true, why: null };
  }

  // The four reasons about what happened on the journey
  if (!['CONFIRMED', 'RAC', 'BOARDED'].includes(status)) {
    return { eligible: false, why: `This passenger's ticket is ${STATUS_WORDS[status] || status}. Only confirmed, RAC or boarded tickets can claim this.` };
  }
  if (now < dep) {
    return { eligible: false, why: 'The train has not left yet. This reason can be filed after the train departs.' };
  }
  const deadline = arr + Number(rule.deadline_hours) * 3600000;
  if (now > deadline) {
    return { eligible: false, why: `The filing deadline has passed (${rule.deadline_hours} hours after the train reaches the destination).` };
  }
  return { eligible: true, why: null };
}

/** Full picture of one PNR for the TDR form. Returns null when the PNR does not exist. */
async function getTdrEligibility(pnr) {
  const ctx = await loadContext(pnr);
  if (!ctx) return null;
  const b = ctx.booking;
  const now = new Date(b.now_dt).getTime();
  return {
    ownerUserId: b.user_id,
    data: {
      pnr: b.pnr,
      bookingStatus: b.booking_status,
      trainNumber: b.train_number,
      trainName: b.display_name,
      journeyDate: String(b.journey_date).slice(0, 10),
      from: b.from_code,
      to: b.to_code,
      runStatus: b.run_status,
      delayMinutes: Number(b.delay_minutes) || 0,
      scheduledDeparture: String(b.sched_dep),
      expectedDeparture: String(b.dep_dt),
      departed: now >= new Date(b.dep_dt).getTime(),
      asOf: String(b.now_dt),
      reasons: ctx.rules.map((r) => ({
        code: r.reason_code,
        label: REASON_LABELS[r.reason_code] || r.reason_code,
        description: r.description,
        deadlineHours: Number(r.deadline_hours),
        evidenceRequired: Boolean(r.requires_verification),
        refundPct: Number(r.refund_pct)
      })),
      passengers: ctx.passengers.map((p) => ({
        passengerNo: p.passenger_no,
        name: p.name,
        age: Number(p.age),
        gender: p.gender,
        reservationStatus: p.res_status,
        reasons: ctx.rules.map((r) => ({ code: r.reason_code, ...evaluate(ctx, p, r) }))
      }))
    }
  };
}

/** The plain message for a refusal of sp_file_tdr (NOT_ELIGIBLE, DEADLINE_EXCEEDED): why this passenger and reason fail now. */
async function explainTdrRefusal(pnr, passengerNo, reasonCode) {
  const ctx = await loadContext(pnr);
  if (!ctx) return null;
  const p = ctx.passengers.find((x) => x.passenger_no === Number(passengerNo));
  const rule = ctx.rules.find((r) => r.reason_code === reasonCode);
  if (!p || !rule) return null;
  const res = evaluate(ctx, p, rule);
  const who = `${p.name} (passenger ${p.passenger_no})`;
  return res.eligible ? null : `${who}: ${res.why}`;
}

module.exports = { REASON_LABELS, getTdrEligibility, explainTdrRefusal };
