const pool = require('../config/mysql');
const AppError = require('../utils/appError');

/**
 * The booking rules a passenger needs to see BEFORE booking, read from the database (SETTING, CONCESSION_RULE),
 * plus the same checks the booking procedure makes, so the screen can tell the passenger what will be refused.
 * The procedure sp_create_booking stays the one that really decides; nothing here replaces it.
 */

const SETTING_DEFAULTS = {
  MAX_PASSENGERS_PER_PNR: '6',
  MAX_PASSENGERS_PER_PNR_TATKAL: '4',
  HOLD_MINUTES: '10',
  BOOKING_WINDOW_DAYS: '7',
  SENIOR_AGE_MALE: '60',
  SENIOR_AGE_FEMALE: '45',
  CONCESSION_SENIOR_ENABLED: 'false',
  GST_RATE_AC: '0.05',
  INSURANCE_PREMIUM_PER_PASSENGER: '0.45',
  DYNAMIC_FARE_ENABLED: 'false'
};

async function loadSettings() {
  const [rows] = await pool.query('SELECT setting_key, setting_value FROM SETTING');
  const map = { ...SETTING_DEFAULTS };
  for (const r of rows) map[r.setting_key] = r.setting_value;
  return map;
}

function limitsFrom(settings) {
  return {
    maxPassengers: parseInt(settings.MAX_PASSENGERS_PER_PNR, 10) || 6,
    maxPassengersTatkal: parseInt(settings.MAX_PASSENGERS_PER_PNR_TATKAL, 10) || 4,
    seniorAgeMale: parseInt(settings.SENIOR_AGE_MALE, 10) || 60,
    seniorAgeFemale: parseInt(settings.SENIOR_AGE_FEMALE, 10) || 45
  };
}

/** Maximum passengers for a quota (Tatkal has its own, lower, limit). */
function maxPassengersFor(quota, settings) {
  const l = limitsFrom(settings);
  return String(quota).toUpperCase() === 'TATKAL' ? l.maxPassengersTatkal : l.maxPassengers;
}

/**
 * Refuse a booking with more passengers than the quota allows. This is the API side of the limit the screen
 * shows (6 for every quota, 4 for Tatkal), read from SETTING, so the screen and the API cannot disagree.
 */
async function assertPassengerLimit(quota, count) {
  const settings = await loadSettings();
  const max = maxPassengersFor(quota, settings);
  if (count > max) {
    const q = String(quota).toUpperCase() === 'TATKAL' ? 'Tatkal bookings allow' : 'A booking allows';
    throw new AppError('VALIDATION_ERROR', `${q} at most ${max} passengers per PNR.`, 400);
  }
}

const QUOTA_RULES = [
  { quota: 'GENERAL', label: 'General', rule: 'Open to everyone. Seats that are full go to RAC, then the waiting list.' },
  { quota: 'LADIES', label: 'Ladies', rule: 'Every passenger aged 12 or more must be female. Children under 12 may travel with them.' },
  { quota: 'TATKAL', label: 'Tatkal', rule: 'Higher fare (Tatkal charge on top of the base fare). No concession on Tatkal. At most 4 passengers per PNR.' },
  { quota: 'SENIOR_CITIZEN', label: 'Senior citizen', rule: 'Every passenger must meet the senior age (see below). Lower berths are kept for this quota.' },
  { quota: 'DIVYAANG', label: 'Divyaang', rule: 'Every passenger needs a disability proof (type and number).' }
];

const CONCESSION_TEXT = {
  NONE: { label: 'No concession', description: 'Full fare. No proof needed.' },
  DIVYAANG: { label: 'Divyaang (person with disability)', description: 'A discount on the base fare. Needs a disability proof: type and number.' },
  SENIOR_CITIZEN: { label: 'Senior citizen', description: 'A discount on the base fare when the senior concession is switched on. Needs an ID proof.' }
};

/** GET /api/booking-rules payload */
async function getBookingRules() {
  const settings = await loadSettings();
  const l = limitsFrom(settings);
  const [rules] = await pool.query(
    `SELECT cr.concession_type, sc.class_code, cr.train_group, cr.discount_pct, cr.proof_types, cr.is_active
       FROM CONCESSION_RULE cr JOIN SEAT_CLASS sc ON sc.class_id = cr.class_id
      ORDER BY cr.concession_type, sc.class_code, cr.train_group`
  );
  const seniorOn = settings.CONCESSION_SENIOR_ENABLED === 'true';
  const concessions = [{ type: 'NONE', ...CONCESSION_TEXT.NONE, needsProof: false, proofTypes: [], discounts: [] }];
  for (const type of ['DIVYAANG', 'SENIOR_CITIZEN']) {
    const mine = rules.filter((r) => r.concession_type === type);
    const proofTypes = [];
    for (const r of mine) {
      const list = typeof r.proof_types === 'string' ? JSON.parse(r.proof_types) : r.proof_types;
      for (const p of list || []) if (!proofTypes.includes(p)) proofTypes.push(p);
    }
    const discounts = mine.map((r) => ({
      classCode: r.class_code, trainGroup: r.train_group, discountPct: Number(r.discount_pct),
      active: Boolean(r.is_active) && (type === 'DIVYAANG' || seniorOn)
    }));
    const active = discounts.filter((d) => d.active && d.discountPct > 0);
    let description = CONCESSION_TEXT[type].description;
    if (type === 'SENIOR_CITIZEN' && !seniorOn) description = 'The senior concession is switched off at the moment: seniors pay the full fare (the Senior citizen quota still works).';
    else if (active.length) {
      const pcts = [...new Set(active.map((d) => d.discountPct))].sort((a, b) => b - a);
      description += ` Discount: ${pcts.map((p) => `${p}%`).join(' or ')} of the base fare, depending on class and train.`;
    }
    concessions.push({ type, ...CONCESSION_TEXT[type], description, needsProof: true, proofTypes, discounts });
  }

  return {
    limits: {
      maxPassengers: l.maxPassengers,
      maxPassengersTatkal: l.maxPassengersTatkal,
      holdMinutes: parseInt(settings.HOLD_MINUTES, 10) || 10,
      bookingWindowDays: parseInt(settings.BOOKING_WINDOW_DAYS, 10) || 7,
      adultRequired: true,
      minAdultAge: 18
    },
    seniorCitizen: {
      minAgeMale: l.seniorAgeMale,
      minAgeFemale: l.seniorAgeFemale,
      concessionEnabled: seniorOn
    },
    ladiesQuotaFemaleFromAge: 12,
    children: {
      note: 'There is no child fare and no free child seat in this system. Every traveller, including a child, gets a seat and pays the full fare. Each PNR needs at least one adult (18 or older).'
    },
    tatkal: {
      maxPassengers: l.maxPassengersTatkal,
      concessionAllowed: false,
      chargePercentAc: 30,
      chargePercentNonAc: 10,
      rules: [
        `At most ${l.maxPassengersTatkal} passengers per PNR.`,
        'No concession on Tatkal: every passenger pays the full fare.',
        'A Tatkal charge is added to the base fare: 30% in AC classes, 10% in non-AC classes.',
        'Confirmed Tatkal tickets get no refund on a normal cancellation.'
      ]
    },
    fare: {
      gstRateAc: Number(settings.GST_RATE_AC),
      insurancePerPassenger: Number(settings.INSURANCE_PREMIUM_PER_PASSENGER)
    },
    quotas: QUOTA_RULES.map((q) => (q.quota === 'TATKAL' ? { ...q, rule: q.rule.replace('At most 4', `At most ${l.maxPassengersTatkal}`) } : q)),
    concessions
  };
}

/**
 * The same checks sp_create_booking makes on the passenger list, as a list of plain problems.
 * errors: the booking would be refused. warnings: allowed, but the passenger should know (for example no concession).
 */
function checkPassengers(passengers, quota, settings, concessionDiscounts) {
  const l = limitsFrom(settings);
  const errors = [];
  const warnings = [];
  const q = String(quota || 'GENERAL').toUpperCase();
  const max = maxPassengersFor(q, settings);

  if (!Array.isArray(passengers) || passengers.length === 0) {
    errors.push({ code: 'NO_PASSENGER', message: 'Add at least one traveller.' });
    return { errors, warnings };
  }
  if (passengers.length > max) {
    errors.push({ code: 'TOO_MANY_PASSENGERS', message: `${q === 'TATKAL' ? 'Tatkal bookings allow' : 'A booking allows'} at most ${max} passengers per PNR. Remove ${passengers.length - max}.` });
  }
  if (!passengers.some((p) => Number(p.age) >= 18)) {
    errors.push({ code: 'NO_ADULT_PASSENGER', message: 'Every PNR needs at least one traveller aged 18 or older.' });
  }

  passengers.forEach((p, i) => {
    const who = p.name ? p.name : `Traveller ${i + 1}`;
    const age = Number(p.age);
    const conc = p.concessionType || p.concession_type || 'NONE';
    const proofType = p.idProofType || p.concessionProofType || p.concession_proof_type;
    const proofRef = p.idProofReference || p.concessionProofRef || p.concession_proof_ref;
    const gender = p.gender;

    if (!p.name || String(p.name).trim().length < 2) errors.push({ index: i, code: 'NAME_REQUIRED', message: `Traveller ${i + 1}: enter the full name.` });
    if (!Number.isFinite(age) || age < 0 || age > 125) errors.push({ index: i, code: 'AGE_INVALID', message: `${who}: enter an age between 0 and 125.` });
    if (conc !== 'NONE' && (!proofType || !proofRef)) {
      errors.push({ index: i, code: 'CONCESSION_PROOF_REQUIRED', message: `${who}: a concession needs an ID proof type and number.` });
    }
    if (q === 'LADIES' && age >= 12 && gender !== 'FEMALE') {
      errors.push({ index: i, code: 'QUOTA_NOT_ELIGIBLE', message: `${who}: the Ladies quota is only for female passengers aged 12 or more.` });
    }
    if (q === 'SENIOR_CITIZEN') {
      const ok = gender === 'FEMALE' ? age >= l.seniorAgeFemale : age >= l.seniorAgeMale;
      if (!ok) {
        errors.push({ index: i, code: 'QUOTA_NOT_ELIGIBLE', message: `${who}: the Senior citizen quota needs age ${l.seniorAgeFemale}+ for women and ${l.seniorAgeMale}+ for men.` });
      }
    }
    if (q === 'DIVYAANG' && (!proofType || !proofRef)) {
      errors.push({ index: i, code: 'QUOTA_NOT_ELIGIBLE', message: `${who}: the Divyaang quota needs a disability proof (type and number).` });
    }
    if (conc !== 'NONE' && q === 'TATKAL') {
      warnings.push({ index: i, code: 'NO_CONCESSION_ON_TATKAL', message: `${who}: there is no concession on Tatkal. The full fare is charged.` });
    } else if (conc === 'SENIOR_CITIZEN' && settings.CONCESSION_SENIOR_ENABLED !== 'true') {
      warnings.push({ index: i, code: 'SENIOR_CONCESSION_OFF', message: `${who}: the senior concession is switched off. The full fare is charged.` });
    } else if (conc !== 'NONE' && concessionDiscounts && concessionDiscounts[conc] === 0) {
      warnings.push({ index: i, code: 'NO_DISCOUNT_FOR_CLASS', message: `${who}: this class has no ${conc === 'DIVYAANG' ? 'Divyaang' : 'senior'} discount. The full fare is charged.` });
    }
  });

  return { errors, warnings };
}

module.exports = {
  loadSettings,
  limitsFrom,
  maxPassengersFor,
  assertPassengerLimit,
  getBookingRules,
  checkPassengers
};
