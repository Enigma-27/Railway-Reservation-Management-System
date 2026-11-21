const pool = require('../config/mysql');
const AppError = require('../utils/appError');

/**
 * GET /api/admin/fares/calculate?classCode=3A&distanceKm=1384&trainType=RAJDHANI&quota=GENERAL&concession=NONE
 * Admin fare calculator: the REAL fare, from fn_calculate_fare (the function every booking uses), for one passenger
 * with insurance. The function needs a train (for the superfast charge and the premium concession group), so a real
 * train of the chosen type is used. Read only.
 */
async function calculateAdminFare(req, res, next) {
  try {
    const classCode = String(req.query.classCode || '').toUpperCase();
    const distance = parseInt(req.query.distanceKm, 10);
    const trainType = String(req.query.trainType || 'RAJDHANI').toUpperCase();
    const quota = String(req.query.quota || 'GENERAL').toUpperCase();
    const concession = String(req.query.concession || 'NONE').toUpperCase();

    if (!classCode) throw new AppError('VALIDATION_ERROR', 'classCode is required', 400);
    if (!Number.isInteger(distance) || distance < 1 || distance > 10000) throw new AppError('VALIDATION_ERROR', 'distanceKm must be a whole number from 1 to 10000', 400);
    if (!['GENERAL', 'LADIES', 'TATKAL', 'SENIOR_CITIZEN', 'DIVYAANG'].includes(quota)) throw new AppError('VALIDATION_ERROR', 'Unknown quota', 400);
    if (!['NONE', 'DIVYAANG', 'SENIOR_CITIZEN'].includes(concession)) throw new AppError('VALIDATION_ERROR', 'concession must be NONE, DIVYAANG or SENIOR_CITIZEN', 400);

    const [[cls]] = await pool.query('SELECT class_id FROM SEAT_CLASS WHERE class_code = ?', [classCode]);
    if (!cls) throw new AppError('VALIDATION_ERROR', `Unknown class ${classCode}`, 400);
    const [trains] = await pool.query(
      `SELECT t.train_id, ts.schedule_id FROM TRAIN t JOIN TRAIN_SCHEDULE ts ON ts.train_id = t.train_id
        WHERE t.train_type = ? ORDER BY ts.journey_date DESC LIMIT 1`,
      [trainType]
    );
    if (trains.length === 0) throw new AppError('VALIDATION_ERROR', `No train of type ${trainType}`, 400);

    const [[row]] = await pool.query('SELECT fn_calculate_fare(?, ?, ?, ?, ?, 1, ?) AS fare', [cls.class_id, trains[0].train_id, distance, quota, concession, trains[0].schedule_id]);
    const f = typeof row.fare === 'string' ? JSON.parse(row.fare) : row.fare;
    return res.status(200).json({
      success: true,
      data: {
        classCode, distanceKm: distance, trainType, quota, concession,
        baseFare: Number(f.base_fare), concessionDiscount: Number(f.concession_discount),
        reservationCharge: Number(f.reservation_charge), superfastCharge: Number(f.superfast_charge),
        tatkalCharge: Number(f.tatkal_charge), dynamicSurcharge: Number(f.dynamic_surcharge),
        gst: Number(f.gst), insurance: Number(f.insurance), totalFare: Number(f.total_fare)
      }
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { calculateAdminFare };
