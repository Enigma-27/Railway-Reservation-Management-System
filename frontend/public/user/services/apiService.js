/**
 * Central API Service Layer - RRMS passenger area (Railway Reservation & Management System)
 * Real REST API client implementing docs/API_CONTRACT.md for E1 features.
 * All data comes from the real backend API.
 */

// ─── HTTP Client Helper ───────────────────────────────────────────────────────

async function request(method, path, body = null, needsAuth = false) {
  const baseUrl = (window.RRMS_CONFIG && window.RRMS_CONFIG.API_BASE_URL) || 'http://localhost:5000';
  const url = `${baseUrl}${path}`;

  // ONE session for the whole site: the landing page stores the token under rrms_token
  let token = null;
  try {
    token = localStorage.getItem('rrms_token') || null;
  } catch (_) {
    token = null;
  }

  const headers = {};
  if (body !== null && (method === 'POST' || method === 'PUT')) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const options = {
    method,
    headers
  };

  if (body !== null && (method === 'POST' || method === 'PUT')) {
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, options);
  } catch (netErr) {
    const error = new Error('Cannot reach the server. Please check that the backend is running.');
    error.code = 'NETWORK_ERROR';
    error.status = 0;
    throw error;
  }

  let payload;
  try {
    payload = await response.json();
  } catch (_) {
    payload = null;
  }

  if (response.status === 401 && token) {
    // Expired or bad token: drop the shared session; the page then sends the user back to the landing page
    localStorage.removeItem('rrms_token');
    localStorage.removeItem('rrms_user');
    const err = new Error(payload?.error?.message || 'Unauthorized');
    err.code = payload?.error?.code || 'UNAUTHORIZED';
    err.status = 401;
    err.data = payload?.data;
    throw err;
  }

  if (!response.ok || !payload?.success) {
    const msg = payload?.error?.message || `Request failed with status ${response.status}`;
    const err = new Error(msg);
    err.code = payload?.error?.code || 'REQUEST_FAILED';
    err.status = response.status;
    // Keep the full reply body: a late payment is HTTP 200 with success:false and data.refund
    err.data = payload?.data;
    err.payload = payload;
    throw err;
  }

  return payload.data;
}

// ─── Real E1 Service Implementations ──────────────────────────────────────────

/**
 * 1. Station list: GET /api/stations
 * Keys: stationId, stationCode, stationName, city, state
 */
export async function getStations() {
  return request('GET', '/api/stations');
}

/**
 * 2. Public trains list: GET /api/trains
 * Adds trainName = displayName to every item (keeps other keys)
 */
export async function getAllTrains() {
  const trains = await request('GET', '/api/trains');
  return trains.map(t => ({
    ...t,
    trainName: t.displayName
  }));
}

/**
 * 3. Train schedule: GET /api/trains/:trainId
 * Maps response to { trainId, trainNumber, trainName (= displayName), trainType, runningDays, route: [ { station: { stationName, stationCode }, arrivalTime, departureTime, platformNumber (= platformNo), distanceFromOrigin (= distanceFromOriginKm), dayOffset } ] }
 */
export async function getTrainSchedule(trainId) {
  const data = await request('GET', `/api/trains/${encodeURIComponent(trainId)}`);
  if (!data) return null;

  return {
    trainId: data.trainId,
    trainNumber: data.trainNumber,
    trainName: data.displayName,
    trainType: data.trainType,
    runningDays: data.runningDays,
    route: (data.route || []).map(stop => ({
      station: {
        stationName: stop.stationName,
        stationCode: stop.stationCode
      },
      arrivalTime: stop.arrivalTime,
      departureTime: stop.departureTime,
      platformNumber: stop.platformNo,
      distanceFromOrigin: stop.distanceFromOriginKm,
      dayOffset: stop.dayOffset
    }))
  };
}

/**
 * 4. Train Search: GET /api/trains/search
 * Omits classType when empty.
 * Returns empty array if no trains (or error NOT_FOUND or TRAIN_NOT_RUNNING).
 */
export async function searchTrains({ sourceStationId, destinationStationId, journeyDate, classType, quota = 'GENERAL' }) {
  const params = new URLSearchParams();
  params.set('sourceStationId', String(sourceStationId));
  params.set('destinationStationId', String(destinationStationId));
  params.set('journeyDate', journeyDate);
  if (classType) {
    params.set('classType', classType);
  }
  if (quota) {
    params.set('quota', quota);
  }

  let trainList;
  try {
    trainList = await request('GET', `/api/trains/search?${params.toString()}`);
  } catch (err) {
    if (err.code === 'NOT_FOUND' || err.code === 'TRAIN_NOT_RUNNING') {
      return [];
    }
    throw err;
  }

  if (!Array.isArray(trainList) || trainList.length === 0) {
    return [];
  }

  return trainList.map(train => {
    const availClasses = (train.availableClasses || []).map(ac => ({
      classType: ac.classType,
      availableSeats: ac.availableSeats,
      racCount: ac.racCount,
      waitingListCount: ac.waitingListCount,
      baseFare: ac.baseFare,
      estimatedTotalFare: ac.estimatedTotalFare,
      // Capacities from the server decide RAC open / waiting list open / waiting list full
      racCapacity: ac.racCapacity,
      waitingListCapacity: ac.waitingListCapacity,
      waitingListFull: ac.waitingListFull,
      quota: quota
    }));

    return {
      ...train,
      trainName: train.displayName,
      departureTime: train.boardingStation?.departureTime || '—:—',
      arrivalTime: train.destinationStation?.arrivalTime || '—:—',
      boardingDate: train.boardingStation?.boardingDate || train.originDate,
      arrivalDate: train.destinationStation?.arrivalDate || train.originDate,
      duration: train.duration,
      distanceKm: train.distanceKm,
      availability: availClasses
    };
  });
}

/**
 * 5. Quota Availability: GET /api/trains/:trainId/availability
 */
export async function getAvailability(trainId, journeyDate, classType, quota = 'GENERAL', passengerCount = 1) {
  const params = new URLSearchParams();
  params.set('journeyDate', journeyDate);
  if (classType) params.set('classType', classType);
  if (quota) params.set('quota', quota);
  if (passengerCount) params.set('passengerCount', String(passengerCount));

  return request('GET', `/api/trains/${encodeURIComponent(trainId)}/availability?${params.toString()}`);
}

/**
 * 8. Profile: GET /api/auth/me
 */
export async function getProfile() {
  return request('GET', '/api/auth/me', null, true);
}

/**
 * 9. My Bookings: GET /api/bookings
 * Query parameters optional: status, limit
 */
export async function getUserBookings(status = null, limit = 50) {
  const params = new URLSearchParams();
  if (status && status !== 'all') params.set('status', status);
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  return request('GET', `/api/bookings${qs ? '?' + qs : ''}`, null, true);
}

/**
 * 10. PNR Status Lookup: GET /api/bookings/:pnr
 */
export async function enquirePNR(pnr) {
  if (!pnr) return null;
  return request('GET', `/api/bookings/${encodeURIComponent(pnr.trim())}`, null, true);
}

/**
 * 11. Create Booking: POST /api/bookings
 * Initiates booking with p_hold_for_payment = 1 and returns PNR, projectedStatus, fareBreakdown, and hold secondsRemaining.
 */
export async function createBooking(payload) {
  return request('POST', '/api/bookings', payload, true);
}

/** Real booking rules (limits, senior ages, Tatkal rules, concession list): GET /api/booking-rules (public) */
export async function getBookingRules() {
  return request('GET', '/api/booking-rules', null, false);
}

/** Read-only fare lines, rule problems and estimated status per passenger: POST /api/bookings/fare-preview */
export async function farePreview(payload) {
  return request('POST', '/api/bookings/fare-preview', payload, true);
}

/** Give up a booking that is still waiting for payment: POST /api/bookings/:pnr/cancel-unpaid */
export async function cancelUnpaidBooking(pnr) {
  return request('POST', `/api/bookings/${encodeURIComponent(String(pnr).trim())}/cancel-unpaid`, {}, true);
}

/** Which TDR reasons each passenger of the PNR can use right now: GET /api/tdr/eligibility/:pnr */
export async function getTdrEligibility(pnr) {
  return request('GET', `/api/tdr/eligibility/${encodeURIComponent(String(pnr).trim())}`, null, true);
}

/**
 * 12. Hold Status: GET /api/bookings/:pnr/hold
 * Returns hold expiry as string and secondsRemaining computed by MySQL.
 */
export async function getBookingHold(pnr) {
  if (!pnr) return null;
  return request('GET', `/api/bookings/${encodeURIComponent(String(pnr).trim())}/hold`, null, true);
}

/**
 * 13. Razorpay Gateway Order: POST /api/payments/razorpay/order
 */
export async function createRazorpayOrder(pnr) {
  return request('POST', '/api/payments/razorpay/order', { pnr: String(pnr).trim() }, true);
}

/**
 * 14. Razorpay Gateway Signature Verification & Ticket Issuance: POST /api/payments/razorpay/verify
 */
export async function verifyRazorpayPayment({ pnr, razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
  return request('POST', '/api/payments/razorpay/verify', {
    pnr: String(pnr).trim(),
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature
  }, true);
}

/**
 * 14b. Ask the server to check with Razorpay what happened to the orders of a PNR: POST /api/payments/razorpay/reconcile
 * Used when the browser lost the answer after paying, and by the "Check payment status" button.
 */
export async function reconcilePayment(pnr) {
  return request('POST', '/api/payments/razorpay/reconcile', { pnr: String(pnr).trim() }, true);
}

/**
 * 15. Cancellation Refund Estimate: GET /api/bookings/:pnr/refund-estimate
 */
export async function getRefundEstimate(pnr, passengerNos = []) {
  const params = new URLSearchParams();
  if (Array.isArray(passengerNos) && passengerNos.length > 0) {
    params.set('passengerNos', passengerNos.join(','));
  }
  const qs = params.toString();
  return request('GET', `/api/bookings/${encodeURIComponent(String(pnr).trim())}/refund-estimate${qs ? '?' + qs : ''}`, null, true);
}

/**
 * 16. Cancel Booking / Passenger: POST /api/bookings/:pnr/cancel
 */
export async function cancelBooking(pnr, passengerNos = null) {
  const body = {};
  if (Array.isArray(passengerNos) && passengerNos.length > 0) {
    body.passengerNos = passengerNos;
  }
  return request('POST', `/api/bookings/${encodeURIComponent(String(pnr).trim())}/cancel`, body, true);
}

/**
 * 17. TDR Filing: POST /api/tdr
 */
export async function fileTDR({ pnr, passengerNos, reason, remarks, evidenceReference }) {
  const body = {
    pnr: String(pnr).trim(),
    reason,
    passengerNos: Array.isArray(passengerNos) ? passengerNos : [1]
  };
  if (remarks) body.remarks = remarks;
  if (evidenceReference) body.evidenceReference = evidenceReference;
  return request('POST', '/api/tdr', body, true);
}

/**
 * 18. List User TDRs: GET /api/tdr
 */
export async function getUserTDRs() {
  return request('GET', '/api/tdr', null, true);
}

/**
 * 19. File Passenger Complaint: POST /api/complaints
 */
export async function fileGrievance({ category, subject, description }) {
  return request('POST', '/api/complaints', { category, subject, description }, true);
}

/**
 * 20. List Own Complaints: GET /api/complaints (with fallback to /api/complaints/user)
 */
export async function getUserGrievances() {
  try {
    return await request('GET', '/api/complaints', null, true);
  } catch (err) {
    if (err.status === 404) {
      return await request('GET', '/api/complaints/user', null, true);
    }
    console.error('Failed to fetch grievances:', err);
    throw err;
  }
}

/**
 * 21. Live Train Status: GET /api/trains/:trainId/live-status
 */
export async function getTrainLiveStatus(trainId) {
  return request('GET', `/api/trains/${encodeURIComponent(trainId)}/live-status`, null, true);
}

/**
 * 22. Live Train Run Status connected to real backend
 */
export async function getTrainRunStatus(trainId, journeyDate) {
  const numTrainId = Number(trainId);
  const [liveData, train] = await Promise.all([
    request('GET', `/api/trains/${encodeURIComponent(numTrainId)}/live-status`, null, true),
    getTrainSchedule(numTrainId).catch(err => {
      console.error(`Failed to fetch schedule for train ${numTrainId}:`, err);
      return null;
    })
  ]);

  if (!liveData) {
    const err = new Error('No live status found for this train run.');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const delayMins = Number(liveData.delayMinutes || 0);
  const status = liveData.status || (delayMins > 0 ? 'DELAYED' : 'ON_TIME');

  return {
    trainId: numTrainId,
    trainNumber: train?.trainNumber || String(numTrainId),
    trainName: train?.trainName || `Train ${numTrainId}`,
    route: train?.route || [],
    schedule: {
      scheduleId: liveData.scheduleId,
      trainId: numTrainId,
      journeyDate: liveData.journeyDate || journeyDate,
      status,
      delayMinutes: delayMins,
      platformNumber: liveData.platformNumber || 1
    },
    currentStop: {
      station: {
        stationName: `Platform ${liveData.platformNumber || 1}`
      }
    },
    trackingIsSimulated: false
  };
}

// ─── Formatters (India Time String & Indian Currency Grouping) ────────────────

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatIndiaDateTime(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '—';
  const cleaned = dateStr.replace(/Z$/, '').trim();
  const match = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return dateStr;
  const [, year, month, day, hour, min] = match;
  const monthName = MONTH_NAMES[parseInt(month, 10) - 1] || month;
  const dayNum = parseInt(day, 10);
  if (hour !== undefined && min !== undefined) {
    return `${dayNum} ${monthName} ${year}, ${hour}:${min}`;
  }
  return `${dayNum} ${monthName} ${year}`;
}

export function formatCurrency(amount) {
  if (amount === null || amount === undefined || amount === '') return '₹0.00';
  const num = Number(amount);
  if (isNaN(num)) return '₹0.00';
  return '₹' + num.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// ─── Unimplemented Backend Endpoints (Graceful Stubs) ─────────────────────────

export async function updateProfile() {
  const error = new Error('Changing your name or phone number is not available yet. Your profile details are shown for viewing only.');
  error.code = 'NOT_AVAILABLE';
  throw error;
}

// ─── Saved Passengers: /api/saved-passengers ──────────────────────────────────
// The server stores no concession on a saved passenger (concession is chosen per booking),
// so concessionType is always 'NONE' here.

function mapSavedPassenger(p) {
  return {
    passengerId: p.passengerId,
    name: p.name,
    age: p.age,
    gender: p.gender,
    idProofType: p.idProofType,
    idProofReference: p.idProofReference,
    disabilityType: p.disabilityType || 'NONE',
    berthPreference: p.berthPreference || 'NO_BERTH',
    concessionType: 'NONE'
  };
}

function savedPassengerBody(p) {
  return {
    name: p.name,
    age: p.age,
    gender: p.gender,
    idProofType: p.idProofType,
    idProofReference: p.idProofReference,
    disabilityType: p.disabilityType,
    berthPreference: p.berthPreference
  };
}

/** 12a. List own saved passengers: GET /api/saved-passengers */
export async function getSavedPassengers() {
  const list = await request('GET', '/api/saved-passengers', null, true);
  return (Array.isArray(list) ? list : []).map(mapSavedPassenger);
}

/** 12b. Add: POST /api/saved-passengers */
export async function savePassenger(pax) {
  const created = await request('POST', '/api/saved-passengers', savedPassengerBody(pax), true);
  return mapSavedPassenger(created);
}

/** 12c. Edit: PUT /api/saved-passengers/:id */
export async function updatePassenger(id, pax) {
  const updated = await request('PUT', `/api/saved-passengers/${encodeURIComponent(id)}`, savedPassengerBody(pax), true);
  return mapSavedPassenger(updated);
}

/** 12d. Delete: DELETE /api/saved-passengers/:id (409 if used by a booking) */
export async function deletePassenger(id) {
  return request('DELETE', `/api/saved-passengers/${encodeURIComponent(id)}`, null, true);
}

// ─── Notifications: /api/notifications ────────────────────────────────────────

/** Own notifications, newest first: GET /api/notifications */
export async function getUserNotifications() {
  const list = await request('GET', '/api/notifications', null, true);
  return Array.isArray(list) ? list : [];
}

/** Mark one notification read: PUT /api/notifications/:id/read */
export async function markNotificationRead(notificationId) {
  return request('PUT', `/api/notifications/${encodeURIComponent(String(notificationId))}/read`, {}, true);
}
