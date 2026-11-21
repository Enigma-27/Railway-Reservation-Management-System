const pool = require('../config/mysql');
const { loadSettings, limitsFrom } = require('../services/bookingRulesService');

/**
 * GET /api/admin/quotas (read only)
 * The five quotas with their real rules and real usage. Usage counts the passengers of the upcoming runs
 * (journey date today or later) that are not cancelled, grouped by the quota they were booked in.
 * The seat shares (10% Tatkal, 10% Ladies, the reserved Senior citizen and Divyaang blocks) are built into the
 * booking procedure (sp_create_booking, BR-Q10), so this page shows them but cannot edit them.
 */
async function listQuotas(req, res, next) {
  try {
    const settings = await loadSettings();
    const l = limitsFrom(settings);
    const [usage] = await pool.query(
      `SELECT b.quota,
              SUM(r.status IN ('CONFIRMED', 'BOARDED')) AS confirmed,
              SUM(r.status = 'RAC') AS rac,
              SUM(r.status = 'WAITING_LIST') AS wl
         FROM BOOKING b
         JOIN RESERVATION r ON r.pnr = b.pnr
         JOIN TRAIN_SCHEDULE ts ON ts.schedule_id = b.schedule_id
        WHERE ts.journey_date >= DATE(COALESCE(@as_of_time, NOW())) AND r.status IN ('CONFIRMED', 'BOARDED', 'RAC', 'WAITING_LIST')
        GROUP BY b.quota`
    );
    const u = (q) => usage.find((x) => x.quota === q) || {};
    const row = (quota, label, seatShare, rule, extra = {}) => ({
      quota, label, seatShare, rule,
      confirmedPassengers: Number(u(quota).confirmed) || 0,
      racPassengers: Number(u(quota).rac) || 0,
      waitingListPassengers: Number(u(quota).wl) || 0,
      ...extra
    });
    const data = [
      row('GENERAL', 'General', 'All seats left after the other quotas', 'Anyone. Full seats go to RAC, then the waiting list.', { maxPassengers: l.maxPassengers, concession: 'Yes', queue: 'RAC and waiting list' }),
      row('TATKAL', 'Tatkal', '10% of the class seats', 'Tatkal charge on top of the base fare (30% AC, 10% non-AC). No concession.', { maxPassengers: l.maxPassengersTatkal, concession: 'No', queue: 'RAC and waiting list' }),
      row('LADIES', 'Ladies', '10% of the class seats', 'Every passenger aged 12 or more must be female.', { maxPassengers: l.maxPassengers, concession: 'Yes', queue: 'None (falls back to General with consent)' }),
      row('SENIOR_CITIZEN', 'Senior citizen', 'Reserved lower berths: SL 6, 3A 4, 2A 3 per coach', `Women aged ${l.seniorAgeFemale}+, men aged ${l.seniorAgeMale}+ (SETTING SENIOR_AGE_FEMALE and SENIOR_AGE_MALE).`, { maxPassengers: l.maxPassengers, concession: settings.CONCESSION_SENIOR_ENABLED === 'true' ? 'Yes' : 'Switched off', queue: 'None (falls back to General with consent)' }),
      row('DIVYAANG', 'Divyaang', 'Reserved block: 4 seats in SL, 3A, CC and 2S', 'Every passenger needs a disability proof (type and number).', { maxPassengers: l.maxPassengers, concession: 'Yes', queue: 'None (falls back to General with consent)' })
    ];
    return res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

module.exports = { listQuotas };
