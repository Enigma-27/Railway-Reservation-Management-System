const pool = require('../config/mysql');
const AppError = require('../utils/appError');

// Allowed values come from SAVED_PASSENGER in database/mysql/01_schema.sql
const GENDERS = ['MALE', 'FEMALE', 'OTHER'];
const ID_PROOF_TYPES = ['SYNTHETIC_TEST_ID', 'AADHAAR', 'PAN', 'PASSPORT', 'VOTER_ID', 'DRIVING_LICENSE', 'GOVT_ID'];
const DISABILITY_TYPES = ['NONE', 'ORTHOPEDIC', 'VISUAL', 'HEARING', 'MENTAL'];
const BERTH_PREFERENCES = ['LOWER', 'MIDDLE', 'UPPER', 'SIDE_LOWER', 'SIDE_UPPER', 'WINDOW', 'AISLE', 'NO_BERTH'];

const SELECT_COLUMNS = `
  passenger_id AS passengerId,
  name,
  age,
  gender,
  id_proof_type AS idProofType,
  id_proof_reference AS idProofReference,
  disability_type AS disabilityType,
  berth_preference AS berthPreference
`;

function currentUserId(req) {
  return req.user.userId || req.user.user_id;
}

/**
 * Validates and normalises the request body. The same rules are used for add and edit
 * (edit replaces all fields, like a normal PUT).
 */
function validateBody(body) {
  const b = body || {};

  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (name.length < 2 || name.length > 128) {
    throw new AppError('VALIDATION_ERROR', 'name is required (2 to 128 characters)', 400);
  }

  const age = Number(b.age);
  if (!Number.isInteger(age) || age < 1 || age > 120) {
    throw new AppError('VALIDATION_ERROR', 'age must be a whole number from 1 to 120', 400);
  }

  const gender = typeof b.gender === 'string' ? b.gender.toUpperCase() : '';
  if (!GENDERS.includes(gender)) {
    throw new AppError('VALIDATION_ERROR', `gender must be one of ${GENDERS.join(', ')}`, 400);
  }

  const idProofType = typeof b.idProofType === 'string' ? b.idProofType.toUpperCase() : '';
  if (!ID_PROOF_TYPES.includes(idProofType)) {
    throw new AppError('VALIDATION_ERROR', `idProofType must be one of ${ID_PROOF_TYPES.join(', ')}`, 400);
  }

  const idProofReference = typeof b.idProofReference === 'string' ? b.idProofReference.trim() : '';
  if (idProofReference.length < 1 || idProofReference.length > 64) {
    throw new AppError('VALIDATION_ERROR', 'idProofReference is required (1 to 64 characters)', 400);
  }

  const disabilityType = b.disabilityType ? String(b.disabilityType).toUpperCase() : 'NONE';
  if (!DISABILITY_TYPES.includes(disabilityType)) {
    throw new AppError('VALIDATION_ERROR', `disabilityType must be one of ${DISABILITY_TYPES.join(', ')}`, 400);
  }

  const berthPreference = b.berthPreference ? String(b.berthPreference).toUpperCase() : 'NO_BERTH';
  if (!BERTH_PREFERENCES.includes(berthPreference)) {
    throw new AppError('VALIDATION_ERROR', `berthPreference must be one of ${BERTH_PREFERENCES.join(', ')}`, 400);
  }

  return { name, age, gender, idProofType, idProofReference, disabilityType, berthPreference };
}

function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError('VALIDATION_ERROR', 'A valid saved passenger id is required', 400);
  }
  return id;
}

/**
 * GET /api/saved-passengers
 * Lists the logged-in passenger's own saved passengers.
 */
async function listSavedPassengers(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT ${SELECT_COLUMNS} FROM SAVED_PASSENGER WHERE user_id = ? ORDER BY passenger_id ASC`,
      [currentUserId(req)]
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/saved-passengers
 * passenger_id has no AUTO_INCREMENT, so the next id is taken inside a transaction.
 */
async function createSavedPassenger(req, res, next) {
  let conn;
  try {
    const userId = currentUserId(req);
    const p = validateBody(req.body);

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [maxRows] = await conn.query(
      'SELECT COALESCE(MAX(passenger_id), 0) + 1 AS next_id FROM SAVED_PASSENGER FOR UPDATE'
    );
    const newId = maxRows[0].next_id;

    await conn.query(
      `INSERT INTO SAVED_PASSENGER
        (passenger_id, user_id, name, age, gender, id_proof_type, id_proof_reference, disability_type, berth_preference)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId, userId, p.name, p.age, p.gender, p.idProofType, p.idProofReference, p.disabilityType, p.berthPreference]
    );

    const [rows] = await conn.query(
      `SELECT ${SELECT_COLUMNS} FROM SAVED_PASSENGER WHERE passenger_id = ? AND user_id = ?`,
      [newId, userId]
    );
    await conn.commit();

    return res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    if (conn) {
      try { await conn.rollback(); } catch (_) {}
    }
    next(error);
  } finally {
    if (conn) conn.release();
  }
}

/**
 * PUT /api/saved-passengers/:id
 * Only the owner can change a saved passenger. Someone else's id looks like "not found".
 */
async function updateSavedPassenger(req, res, next) {
  try {
    const userId = currentUserId(req);
    const id = parseId(req.params.id);
    const p = validateBody(req.body);

    await pool.query(
      `UPDATE SAVED_PASSENGER
          SET name = ?, age = ?, gender = ?, id_proof_type = ?, id_proof_reference = ?,
              disability_type = ?, berth_preference = ?
        WHERE passenger_id = ? AND user_id = ?`,
      [p.name, p.age, p.gender, p.idProofType, p.idProofReference, p.disabilityType, p.berthPreference, id, userId]
    );

    // Read back with the owner filter: no row means the id does not exist or is not the caller's
    const [rows] = await pool.query(
      `SELECT ${SELECT_COLUMNS} FROM SAVED_PASSENGER WHERE passenger_id = ? AND user_id = ?`,
      [id, userId]
    );
    if (rows.length === 0) {
      throw new AppError('NOT_FOUND', 'Saved passenger not found', 404);
    }

    return res.status(200).json({ success: true, data: rows[0] });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/saved-passengers/:id
 * Refused with 409 if any booking still points to this saved passenger. The schema has no
 * "archived" flag, and the foreign key would otherwise silently blank the link in booking history.
 */
async function deleteSavedPassenger(req, res, next) {
  try {
    const userId = currentUserId(req);
    const id = parseId(req.params.id);

    const [owned] = await pool.query(
      'SELECT passenger_id FROM SAVED_PASSENGER WHERE passenger_id = ? AND user_id = ?',
      [id, userId]
    );
    if (owned.length === 0) {
      throw new AppError('NOT_FOUND', 'Saved passenger not found', 404);
    }

    const [refs] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM PASSENGER_BOOKING WHERE saved_passenger_id = ?',
      [id]
    );
    if (Number(refs[0].cnt) > 0) {
      throw new AppError(
        'CONFLICT',
        'This passenger is used in one or more bookings and cannot be removed.',
        409
      );
    }

    await pool.query(
      'DELETE FROM SAVED_PASSENGER WHERE passenger_id = ? AND user_id = ?',
      [id, userId]
    );

    return res.status(200).json({ success: true, data: { passengerId: id, deleted: true } });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listSavedPassengers,
  createSavedPassenger,
  updateSavedPassenger,
  deleteSavedPassenger
};
