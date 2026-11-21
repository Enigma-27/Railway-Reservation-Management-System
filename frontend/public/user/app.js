/**
 * RRMS – Passenger area (Railway Reservation & Management System)
 * Main controller for the signed-in passenger pages. Sign-in lives on the landing page ("/").
 */

import * as Service from './services/apiService.js';
import { createPassengerStep } from './passenger-step.js';

// ════════════════════════════════════════════════════════════════ STATE
const State = {
  user: null,
  stations: [],
  allBookings: [],
  savedPassengers: [],
  notifications: [],
  bookingFlow: {
    step: 1,
    searchParams: {},
    searchResults: [],
    selectedTrain: null,
    selectedClass: null,
    selectedPassengers: [],
    holdToken: null,
    holdExpiry: null,
    holdTimerInterval: null,
    bookingId: null,
    pnr: null,
    totalFare: 0,
    fareBreakdown: {}
  }
};

// ════════════════════════════════════════════════════════════════ SESSION (shared with the whole site)
// ONE session for every role: the landing page signs in and stores rrms_token + rrms_user in localStorage
// (frontend/src/auth/session.ts). This area never shows a login form. No session, or another role: back to "/".
function readSession() {
  try {
    const token = localStorage.getItem('rrms_token');
    const user = JSON.parse(localStorage.getItem('rrms_user') || 'null');
    if (!token || !user || user.role !== 'PASSENGER') return null;
    return { token, user };
  } catch (_) {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem('rrms_token');
  localStorage.removeItem('rrms_user');
}

function redirectToLanding() {
  window.location.replace('/');
}

function saveUser() {
  localStorage.setItem('rrms_user', JSON.stringify({ ...State.user, role: 'PASSENGER' }));
}

// A search typed on the landing page is kept in sessionStorage; run it now and show the results.
async function continuePendingSearch() {
  let pending = null;
  try {
    pending = JSON.parse(sessionStorage.getItem('rrms_pending_search') || 'null');
    sessionStorage.removeItem('rrms_pending_search');
  } catch (_) {
    pending = null;
  }
  if (!pending || !pending.fromId || !pending.toId || !pending.date) return;
  document.getElementById('search-from').value = String(pending.fromId);
  document.getElementById('search-to').value = String(pending.toId);
  document.getElementById('search-date').value = pending.date;
  document.getElementById('search-class').value = pending.classType || '';
  navigateTo('search');
  await handleSearchTrains(new Event('submit', { cancelable: true }));
  // Coming from Live Trains "Book this train": select that train and class in the results
  if (pending.trainId) {
    const card = document.getElementById(`train-card-${pending.trainId}`);
    if (card) {
      const chip = Array.from(card.querySelectorAll('.class-chip')).find(c => c.querySelector('.class-type')?.textContent.trim() === pending.classType);
      if (chip) await selectClassForTrain(pending.trainId, pending.classType, chip);
      card.classList.add('preselected');
      card.scrollIntoView({ block: 'center' });
      showToast('The train and class you chose on Live Trains are selected. Press "Book Now" to continue.', 'info');
    } else {
      showToast('That train has no seats to show for this search. Pick another train below.', 'info');
    }
  }
}

const passengerStep = createPassengerStep({ State, Service, showToast: (m, t) => window.showToast(m, t), escapeHtml, formatMoney });

// ════════════════════════════════════════════════════════════════ INIT
window.addEventListener('DOMContentLoaded', async () => {
  setCurrentDate();
  setGreeting();

  const session = readSession();
  if (!session) {
    redirectToLanding();
    return;
  }
  State.user = session.user;

  await populateStationDropdowns();
  setDefaultDate();

  try {
    const profile = await Service.getProfile();
    State.user = { ...session.user, ...profile, token: session.token };
    saveUser();
    await enterDashboard();
    await continuePendingSearch();
  } catch (err) {
    if (err.status === 401 || err.code === 'UNAUTHORIZED') {
      clearSession();
      redirectToLanding();
      return;
    }
    // Server problem (for example the backend is down): stay signed in and show the message
    showToast(err.message || 'Could not load your account.', 'error');
    await enterDashboard();
  }
});

function setCurrentDate() {
  const now = new Date();
  const options = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
  document.getElementById('current-date').textContent = now.toLocaleDateString('en-IN', options);
}

function setGreeting() {
  const h = new Date().getHours();
  const greeting = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  const el = document.getElementById('time-greeting');
  if (el) el.textContent = greeting;
}

function setDefaultDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const today = `${y}-${m}-${d}`;

  const maxD = new Date(y, now.getMonth(), now.getDate() + 7);
  const maxY = maxD.getFullYear();
  const maxM = String(maxD.getMonth() + 1).padStart(2, '0');
  const maxDay = String(maxD.getDate()).padStart(2, '0');
  const maxDate = `${maxY}-${maxM}-${maxDay}`;

  ['qs-date', 'search-date'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.value = today;
      el.min = today;
      el.max = maxDate;
    }
  });
}

// ════════════════════════════════════════════════════════════════ STATIONS
async function populateStationDropdowns() {
  try {
    State.stations = await Service.getStations();
    const stationOptions = State.stations.map(s =>
      `<option value="${s.stationId}">${s.stationCode} – ${s.stationName} (${s.city})</option>`
    ).join('');

    const fromDropdownIds = ['qs-from', 'search-from'];
    const toDropdownIds = ['qs-to', 'search-to'];

    [...fromDropdownIds, ...toDropdownIds].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = stationOptions;
    });

    // Set default selections by stationCode: 'BCT' (Mumbai Central) and 'NDLS' (New Delhi)
    const bct = State.stations.find(s => s.stationCode === 'BCT');
    const ndls = State.stations.find(s => s.stationCode === 'NDLS');

    if (bct) {
      fromDropdownIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = String(bct.stationId);
      });
    }
    if (ndls) {
      toDropdownIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = String(ndls.stationId);
      });
    }
  } catch (e) {
    console.error('Could not load stations', e);
  }
}

// ════════════════════════════════════════════════════════════════ SIGN OUT
// Sign out removes the one shared session and returns to the landing page.
window.handleLogout = () => {
  clearSession();
  sessionStorage.removeItem('rrms_pending_search');
  State.user = null;
  window.location.replace('/');
};


// ════════════════════════════════════════════════════════════════ ENTER DASHBOARD

async function enterDashboard() {
  document.getElementById('dashboard-container').classList.remove('hidden');

  const { user } = State;
  const initials = user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  // Update UI with user info
  document.getElementById('sidebar-avatar').textContent = initials;
  document.getElementById('sidebar-name').textContent = user.name;
  document.getElementById('topbar-avatar').textContent = initials;
  document.getElementById('topbar-username').textContent = user.name.split(' ')[0];
  document.getElementById('profile-avatar').textContent = initials;
  document.getElementById('welcome-name').textContent = user.name.split(' ')[0];

  // Load data in parallel
  showLoading('Loading your dashboard...');
  try {
    const [bookings, savedPax, notifications] = await Promise.all([
      Service.getUserBookings().catch(err => {
        console.error('Failed to load user bookings:', err);
        return [];
      }),
      Service.getSavedPassengers(user.userId).catch(err => {
        console.error('Failed to load saved passengers:', err);
        return [];
      }),
      Service.getUserNotifications(user.userId).catch(err => {
        console.error('Failed to load user notifications:', err);
        return [];
      })
    ]);

    State.allBookings = Array.isArray(bookings) ? bookings : [];
    State.savedPassengers = Array.isArray(savedPax) ? savedPax : [];
    State.notifications = Array.isArray(notifications) ? notifications : [];

    renderHomeStats();
    renderRecentBookings();
    renderHomeAlerts();
    loadProfileData();
    updateNotifBadge();
    updateBookingBadge();
    setGreeting();
  } catch (err) {
    console.error('Dashboard load error:', err);
  } finally {
    hideLoading();
  }

  navigateTo('home');
}

// ════════════════════════════════════════════════════════════════ NAVIGATION

window.navigateTo = (page) => {
  // Update pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById(`page-${page}`);
  if (target) {
    target.classList.remove('hidden');
    target.classList.add('active');
  }

  // Update nav items
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
  const navItem = document.getElementById(`nav-${page}`);
  if (navItem) navItem.classList.add('active');

  // Update breadcrumb
  const labels = {
    home: 'Home', search: 'Book Tickets', bookings: 'My Bookings',
    pnr: 'PNR Enquiry', profile: 'My Profile', passengers: 'Saved Passengers',
    tdr: 'TDR / Refunds', grievances: 'Grievances', alerts: 'Alerts'
  };
  document.getElementById('page-breadcrumb').textContent = labels[page] || page;

  // Lazy load page content
  switch (page) {
    case 'bookings': renderBookingsPage(); break;
    case 'passengers': renderPassengersPage(); break;
    case 'tdr': renderTDRPage(); break;
    case 'grievances': renderGrievancesPage(); break;
    case 'alerts':
      renderAlertsPage();
      refreshNotifications().then(() => renderAlertsPage());
      break;
    case 'search': resetBookingFlow(); break;
  }

  // Close sidebar on mobile
  if (window.innerWidth <= 768) {
    closeSidebar();
  }
};

// Reload own notifications from the server (new ones are created by bookings, payments, cancellations and TDR decisions)
async function refreshNotifications() {
  try {
    State.notifications = await Service.getUserNotifications();
    renderHomeAlerts();
    updateNotifBadge();
  } catch (err) {
    console.error('Failed to refresh notifications:', err);
  }
}

window.toggleSidebar = () => {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  sidebar.classList.toggle('open');
  overlay.classList.toggle('hidden');
};

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.add('hidden');
}

// ════════════════════════════════════════════════════════════════ HOME PAGE

function renderHomeStats() {
  const confirmed = State.allBookings.filter(b => b.bookingStatus === 'CONFIRMED').length;
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const upcoming = State.allBookings.filter(b =>
    b.bookingStatus === 'CONFIRMED' && (b.journeyDate >= todayStr)
  ).length;
  const unread = State.notifications.filter(n => !n.isRead).length;
  const totalSpent = State.allBookings
    .filter(b => b.bookingStatus === 'CONFIRMED')
    .reduce((sum, b) => sum + b.totalFare, 0);

  const stats = [
    { icon: 'ticket', label: 'Total Bookings', value: State.allBookings.length, colorClass: 'blue',
      svg: '<path fill-rule="evenodd" d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z"/><path fill-rule="evenodd" d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z" clip-rule="evenodd"/>' },
    { icon: 'upcoming', label: 'Upcoming Trips', value: upcoming, colorClass: 'green',
      svg: '<path fill-rule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clip-rule="evenodd"/>' },
    { icon: 'passengers', label: 'Saved Passengers', value: State.savedPassengers.length, colorClass: 'purple',
      svg: '<path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z"/>' },
    { icon: 'alerts', label: 'Unread Alerts', value: unread, colorClass: 'amber',
      svg: '<path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z"/>' }
  ];

  document.getElementById('home-stats').innerHTML = stats.map(s => `
    <div class="stat-card">
      <div class="stat-icon ${s.colorClass}">
        <svg viewBox="0 0 20 20" fill="currentColor">${s.svg}</svg>
      </div>
      <div class="stat-body">
        <div class="stat-value">${s.value}</div>
        <div class="stat-label-text">${s.label}</div>
      </div>
    </div>
  `).join('');
}

function renderRecentBookings() {
  const recent = State.allBookings.slice(0, 3);
  const container = document.getElementById('recent-bookings-list');

  if (!recent.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🎫</div><div class="empty-title">No bookings yet</div><div class="empty-sub">Book your first train ticket!</div></div>`;
    return;
  }

  container.innerHTML = recent.map(b => {
    const trainDisplayName = b.trainName || (b.trainNumber ? `Train ${b.trainNumber}` : (b.train?.trainName || 'N/A'));
    return `
    <div class="booking-mini-card" onclick="navigateTo('bookings')">
      <div class="mini-card-header">
        <div class="mini-pnr">PNR: ${b.pnr}</div>
        <span class="status-badge ${b.bookingStatus}">${b.bookingStatus.replace('_', ' ')}</span>
      </div>
      <div class="mini-route">
        <div class="mini-station">${b.boardingStation?.stationCode || '—'}</div>
        <div class="mini-arrow">→</div>
        <div class="mini-station">${b.destinationStation?.stationCode || '—'}</div>
      </div>
      <div class="mini-train">${trainDisplayName}</div>
      <div class="mini-date">📅 ${formatDate(b.journeyDate)} | 🚃 ${b.classType}</div>
    </div>
  `;
  }).join('');
}

function renderHomeAlerts() {
  const userNotifs = State.notifications.slice(0, 3);
  const container = document.getElementById('home-alerts');

  if (!userNotifs.length) {
    container.innerHTML = `<div class="empty-state" style="padding:24px"><div class="empty-icon">🔔</div><p class="empty-sub">No alerts at the moment</p></div>`;
    return;
  }

  container.innerHTML = userNotifs.map(n => `
    <div class="alert-item ${escapeHtml(n.type)} ${n.isRead ? '' : 'unread'}">
      <div class="alert-icon">${getAlertIcon(n.type)}</div>
      <div class="alert-content">
        <div class="alert-title">${escapeHtml(n.title)}</div>
        <div class="alert-msg">${escapeHtml(n.message)}</div>
        <div class="alert-time">${timeAgo(n.createdAt)}</div>
      </div>
      ${!n.isRead ? '<div class="unread-dot"></div>' : ''}
    </div>
  `).join('');
}

function updateNotifBadge() {
  const unread = State.notifications.filter(n => !n.isRead).length;
  const dot = document.getElementById('notif-dot');
  const badge = document.getElementById('alerts-badge');
  if (dot) dot.style.display = unread ? 'block' : 'none';
  if (badge) {
    badge.textContent = unread;
    badge.classList.toggle('unread', unread > 0);
    badge.style.display = unread ? 'inline-flex' : 'none';
  }
}

function updateBookingBadge() {
  const active = State.allBookings.filter(b =>
    ['CONFIRMED', 'RAC', 'WAITING_LIST'].includes(b.bookingStatus)
  ).length;
  const badge = document.getElementById('booking-count-badge');
  if (badge) badge.textContent = active;
}

// ════════════════════════════════════════════════════════════════ QUICK SEARCH

window.swapQuickSearch = () => {
  const from = document.getElementById('qs-from');
  const to = document.getElementById('qs-to');
  [from.value, to.value] = [to.value, from.value];
};

window.goToSearch = () => {
  // Copy quick search values to search page
  document.getElementById('search-from').value = document.getElementById('qs-from').value;
  document.getElementById('search-to').value = document.getElementById('qs-to').value;
  document.getElementById('search-date').value = document.getElementById('qs-date').value;
  document.getElementById('search-class').value = document.getElementById('qs-class').value;
  navigateTo('search');
  // Auto-search
  setTimeout(() => handleSearchTrains(new Event('submit', {cancelable: true})), 100);
};

// ════════════════════════════════════════════════════════════════ BOOKING FLOW

function resetBookingFlow() {
  // Stop the old hold countdown and clear anything left over from the previous attempt
  if (State.bookingFlow && State.bookingFlow.holdTimerInterval) {
    clearInterval(State.bookingFlow.holdTimerInterval);
  }
  ['hold-timer', 'hold-timer-4', 'hold-timer-5'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
  const payBtn = document.getElementById('pay-now-btn');
  if (payBtn) payBtn.disabled = false;
  const finalNotice = document.getElementById('payment-final-notice');
  if (finalNotice) finalNotice.innerHTML = '';

  State.bookingFlow = {
    step: 1, searchParams: {}, searchResults: [], selectedTrain: null,
    selectedClass: null, selectedPassengers: [], holdToken: null, holdExpiry: null,
    holdTimerInterval: null, bookingId: null, pnr: null, totalFare: 0, fareBreakdown: {}
  };
  goToStep(1);
}

/**
 * "Start over": forget the whole booking attempt and go back to search.
 * The seats of the old hold are released by the server when the hold expires (10 minutes after it was made).
 */
window.startOverBooking = () => {
  const oldPnr = State.bookingFlow.pnr;
  navigateTo('search'); // resets State.bookingFlow and returns to step 1
  showToast(
    oldPnr
      ? `Booking cleared. The seats held for PNR ${oldPnr} will be released automatically when that 10-minute hold expires.`
      : 'Booking cleared. You can search again.',
    'info'
  );
};

window.goToStep = (stepNum) => {
  // Hide all steps
  document.querySelectorAll('.booking-step').forEach(s => s.classList.remove('active'));
  const stepEl = document.getElementById(`booking-step-${stepNum}`);
  if (stepEl) {
    stepEl.classList.remove('hidden');
    stepEl.classList.add('active');
  }

  // Update step indicators
  for (let i = 1; i <= 6; i++) {
    const indicator = document.getElementById(`step-${i}`);
    if (!indicator) continue;
    indicator.classList.remove('active', 'done');
    if (i < stepNum) indicator.classList.add('done');
    else if (i === stepNum) indicator.classList.add('active');
  }

  // Update connecting lines
  document.querySelectorAll('.step-line').forEach((line, idx) => {
    line.classList.toggle('done', idx < stepNum - 1);
  });

  State.bookingFlow.step = stepNum;

  if (stepNum === 3) { initPassengerStep(); }
  if (stepNum === 4) { initSummaryStep(); }
  if (stepNum === 5) {
    const lbl = document.getElementById('pay-pnr-label');
    if (lbl) lbl.textContent = State.bookingFlow.pnr || '';
  }
};

window.swapSearchStations = () => {
  const from = document.getElementById('search-from');
  const to = document.getElementById('search-to');
  [from.value, to.value] = [to.value, from.value];
};

window.handleSearchTrains = async (e) => {
  if (e && e.preventDefault) e.preventDefault();

  const fromId = parseInt(document.getElementById('search-from').value);
  const toId = parseInt(document.getElementById('search-to').value);
  const date = document.getElementById('search-date').value;
  const classType = document.getElementById('search-class').value;
  const quota = document.getElementById('search-quota').value;

  if (fromId === toId) {
    showToast('Source and destination cannot be the same', 'error');
    return;
  }

  if (!date) {
    showToast('Please select a journey date', 'error');
    return;
  }

  State.bookingFlow.searchParams = { fromId, toId, date, classType, quota };

  const btn = document.getElementById('search-trains-btn');
  btn.textContent = 'Searching...';
  btn.disabled = true;

  showLoading('Searching for available trains...');

  try {
    const results = await Service.searchTrains({
      sourceStationId: fromId,
      destinationStationId: toId,
      journeyDate: date,
      classType, quota
    });

    State.bookingFlow.searchResults = results;
    renderSearchResults(results);
    goToStep(2);
  } catch (err) {
    console.error('Failed to search trains:', err);
    showToast('Failed to search trains. Please try again.', 'error');
    const container = document.getElementById('train-results');
    if (container) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title" style="color:var(--clr-danger, #ef4444);">Train search failed</div><div class="empty-sub" style="color:var(--clr-danger, #ef4444);">${err?.message || 'Please check stations and date'}</div></div>`;
    }
  } finally {
    hideLoading();
    btn.textContent = 'Search Trains';
    btn.disabled = false;
  }
};

/**
 * What a class offers right now, from the numbers the server sends:
 * AVAILABLE (seats free), RAC (no seats, RAC slots open), WL (no seats, waiting list open), WL_FULL (waiting list full).
 * If the server does not send capacities, the old rule is used (RAC if some are in RAC, otherwise WL).
 */
function classWaitKind(a) {
  const seats = Number(a.availableSeats) || 0;
  if (seats > 0) return 'AVAILABLE';
  const racCount = Number(a.racCount) || 0;
  const wlCount = Number(a.waitingListCount) || 0;
  const hasRacCap = a.racCapacity !== undefined && a.racCapacity !== null;
  const hasWlCap = a.waitingListCapacity !== undefined && a.waitingListCapacity !== null;
  const racOpen = hasRacCap ? racCount < Number(a.racCapacity) : racCount > 0;
  if (racOpen) return 'RAC';
  if (a.waitingListFull === true || (hasWlCap && wlCount >= Number(a.waitingListCapacity))) return 'WL_FULL';
  return 'WL';
}

function renderSearchResults(results) {
  const { fromId, toId, date, quota } = State.bookingFlow.searchParams;
  const fromStation = State.stations.find(s => s.stationId === fromId);
  const toStation = State.stations.find(s => s.stationId === toId);

  document.getElementById('results-summary').innerHTML =
    `🔍 ${results.length} train(s) found: ${fromStation?.stationCode || '?'} → ${toStation?.stationCode || '?'} on ${formatDate(date)}`;

  const container = document.getElementById('train-results');

  if (!results.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🚂</div>
        <div class="empty-title">No trains found for this route and date</div>
        <div class="empty-sub">Try different dates or stations</div>
      </div>`;
    return;
  }

  container.innerHTML = results.map(train => {
    const avail = train.availability || [];
    const days = ['MON','TUE','WED','THU','FRI','SAT','SUN'];

    const classChips = avail.map(a => {
      const kind = classWaitKind(a);
      const available = kind === 'AVAILABLE';
      const racOnly = kind === 'RAC';
      const waitlist = kind === 'WL';
      const wlFull = kind === 'WL_FULL';
      let availClass = 'green', availText = `${a.availableSeats} AVL`, badgeClass = '';
      if (racOnly) { availClass = 'amber'; availText = `RAC ${a.racCount}`; badgeClass = ' badge'; }
      if (waitlist) { availClass = 'orange'; availText = `WL ${a.waitingListCount}`; badgeClass = ' badge'; }
      if (wlFull) { availClass = 'red'; availText = 'Waiting list full'; badgeClass = ' badge'; }

      const fareAmount = a.estimatedTotalFare != null ? a.estimatedTotalFare : (a.baseFare != null ? a.baseFare : 0);
      const chipClasses = ['class-chip'];
      if (racOnly || waitlist) chipClasses.push('waitlist');
      if (wlFull) chipClasses.push('wl-full');

      return `
        <div class="${chipClasses.join(' ')}" ${wlFull ? 'aria-disabled="true" title="Waiting list full"' : `onclick="selectClassForTrain(${train.trainId}, '${a.classType}', this)"`}>
          <div class="class-type">${a.classType}</div>
          <div class="class-avail ${availClass}${badgeClass}">${availText}</div>
          <div class="class-fare">from ${formatMoney(fareAmount)}</div>
        </div>
      `;
    }).join('');

    const dayBadges = days.map(d => `
      <div class="day-badge ${train.runningDays?.includes(d) ? 'active-day' : ''}">${d[0]}</div>
    `).join('');

    const departureDisplay = train.departureTime || '—';
    const arrivalDisplay = train.arrivalTime || '—';
    const durationDisplay = train.duration || '—';

    return `
      <div class="train-result-card" id="train-card-${train.trainId}">
        <div class="train-card-header">
          <div class="train-name-section">
            <div class="train-number">Train No. ${train.trainNumber}</div>
            <div class="train-full-name">${train.trainName}</div>
          </div>
          <span class="train-type-badge ${train.trainType}">${train.trainType.replace('_', ' ')}</span>
        </div>

        <div class="train-timing">
          <div class="time-station">
            <div class="time-display">${departureDisplay}</div>
            <div class="station-code">${fromStation?.stationCode || '?'}</div>
          </div>
          <div class="duration-section">
            <div class="duration-line">
              <div class="h-line"></div>
            </div>
            <div class="duration-text">${durationDisplay}</div>
          </div>
          <div class="time-station">
            <div class="time-display">${arrivalDisplay}</div>
            <div class="station-code">${toStation?.stationCode || '?'}</div>
          </div>
        </div>

        <div class="classes-row">${classChips || '<span style="color:var(--clr-text-3);font-size:13px;">No availability data</span>'}</div>
        <div class="fallback-notice-msg" style="display:none; font-size:12px; color:var(--clr-accent-2); margin-top:8px; padding:6px 10px; background:rgba(255,184,0,0.1); border-radius:4px;"></div>
        <div class="class-wait-note"></div>

        <div class="train-card-footer">
          <div class="running-days">${dayBadges}</div>
          <button class="btn-primary" onclick="proceedWithTrain(${train.trainId})">
            Book Now →
          </button>
        </div>
      </div>
    `;
  }).join('');
}

window.selectClassForTrain = async (trainId, classType, el) => {
  // Deselect all in this card
  const card = document.getElementById(`train-card-${trainId}`);
  if (card) {
    card.querySelectorAll('.class-chip').forEach(c => c.classList.remove('selected'));
  }
  el.classList.add('selected');

  State.bookingFlow.selectedTrain = State.bookingFlow.searchResults.find(t => t.trainId === trainId);
  State.bookingFlow.selectedClass = classType;

  // Step 9: Call real getAvailability
  const journeyDate = State.bookingFlow.searchParams?.date;
  const quota = State.bookingFlow.searchParams?.quota || 'GENERAL';

  try {
    const availReply = await Service.getAvailability(trainId, journeyDate, classType, quota, 1);
    if (availReply) {
      const seats = availReply.availableSeats ?? 0;
      const rac = availReply.racCount ?? 0;
      const wl = availReply.waitingListCount ?? 0;

      const availEl = el.querySelector('.class-avail');
      if (availEl) {
        let availClass = 'green', availText = `${seats} AVL`;
        if (seats === 0 && rac > 0) { availClass = 'amber'; availText = `RAC ${rac}`; }
        else if (seats === 0 && rac === 0) { availClass = 'red'; availText = `WL ${wl}`; }
        availEl.className = `class-avail ${availClass}`;
        availEl.textContent = availText;
      }

      // Short note when this class would put the passenger on RAC or the waiting list
      const waitNoteEl = card?.querySelector('.class-wait-note');
      if (waitNoteEl) {
        let waitKind = null;
        if (availReply.fallbackOffered) {
          const projected = availReply.generalQuotaStatus?.projectedStatus;
          if (projected === 'RAC') waitKind = 'RAC';
          else if (projected === 'WAITING_LIST') waitKind = 'waiting list';
        } else {
          // Use the fresh seat numbers with the capacities from the search result for this class
          const searched = (State.bookingFlow.searchResults.find(t => t.trainId === trainId)
            ?.availability || []).find(x => x.classType === classType) || {};
          const kind = classWaitKind({ ...searched, availableSeats: seats, racCount: rac, waitingListCount: wl });
          if (kind === 'RAC') waitKind = 'RAC';
          else if (kind === 'WL' || kind === 'WL_FULL') waitKind = 'waiting list';
        }
        if (waitKind) {
          waitNoteEl.textContent = `You will be on the ${waitKind}; your seat is confirmed only if others cancel.`;
          waitNoteEl.style.display = 'block';
        } else {
          waitNoteEl.textContent = '';
          waitNoteEl.style.display = 'none';
        }
      }

      if (availReply.fallbackOffered && availReply.fallbackNotice) {
        showToast(availReply.fallbackNotice, 'info');
        const noticeEl = card?.querySelector('.fallback-notice-msg');
        if (noticeEl) {
          noticeEl.textContent = availReply.fallbackNotice;
          noticeEl.style.display = 'block';
        }
      } else {
        const noticeEl = card?.querySelector('.fallback-notice-msg');
        if (noticeEl) {
          noticeEl.textContent = '';
          noticeEl.style.display = 'none';
        }
      }
    }
  } catch (err) {
    showToast(err?.message || 'Failed to check class availability.', 'error');
  }
};

window.proceedWithTrain = async (trainId) => {
  const train = State.bookingFlow.searchResults.find(t => t.trainId === trainId);
  if (!train) return;

  State.bookingFlow.selectedTrain = train;
  if (!State.bookingFlow.selectedClass && train.availability?.length) {
    State.bookingFlow.selectedClass = train.availability[0].classType;
  }

  // Picking a train again abandons any earlier hold; say so (the server releases it when it expires)
  if (State.bookingFlow.pnr) {
    showToast(`Your earlier seat hold (PNR ${State.bookingFlow.pnr}) will be released automatically when its 10-minute timer ends.`, 'info');
  }

  // Clear any existing hold token or timer from previous attempts
  if (State.bookingFlow.holdTimerInterval) {
    clearInterval(State.bookingFlow.holdTimerInterval);
    State.bookingFlow.holdTimerInterval = null;
  }
  State.bookingFlow.holdToken = null;
  State.bookingFlow.holdExpiry = null;
  State.bookingFlow.secondsRemaining = 0;
  State.bookingFlow.pnr = null;

  goToStep(3);
};

// Step 3 - Who is travelling? The passenger step itself lives in passenger-step.js
function initPassengerStep() {
  // Once seats are on hold (PNR exists) the passenger list is read-only. The only way to
  // change passengers is "Start over". A hold is never silently reused with different passengers.
  const holdLocked = !!State.bookingFlow.pnr;
  const stepEl = document.getElementById('booking-step-3');
  if (stepEl) stepEl.classList.toggle('hold-locked', holdLocked);
  document.getElementById('hold-lock-notice')?.classList.toggle('hidden', !holdLocked);
  document.querySelectorAll('#booking-step-3 .preferences-grid input').forEach(i => { i.disabled = holdLocked; });
  if (holdLocked) {
    const lockText = document.getElementById('hold-lock-text');
    if (lockText) {
      lockText.textContent = `Your seats are on hold for PNR ${State.bookingFlow.pnr}, so travellers and preferences can no longer be changed. ` +
        'To change them, press "Start over". The old hold is released automatically when its 10-minute timer ends.';
    }
  }

  // Ladies quota: show the fallback consent
  const fallbackContainer = document.getElementById('fallback-consent-container');
  if (fallbackContainer) {
    fallbackContainer.style.display = (State.bookingFlow.searchParams?.quota === 'LADIES') ? 'flex' : 'none';
  }

  renderSelectedJourneyInfo();
  passengerStep.init();
}

window.proceedToSummary = () => {
  if (!passengerStep.canProceed()) {
    const first = passengerStep.problems()[0];
    showToast(first || 'Add at least one traveller first.', 'warning');
    return;
  }
  goToStep(4);
};

/**
 * The booking API refuses with a short code. These are the same refusals in plain words for the passenger.
 * Messages the server already writes in plain words (VALIDATION_ERROR) are shown as they are.
 */
function plainBookingError(err) {
  const map = {
    SEAT_NOT_AVAILABLE: 'There are no seats left in this quota for the whole group. Try another class, quota or date.',
    WAITING_LIST_FULL: 'The waiting list for this class is full. Try another class or date.',
    NOT_ALL_CONFIRMED: 'Not every traveller would get a confirmed seat, and you asked for confirmed seats only.',
    QUOTA_NOT_ELIGIBLE: 'One or more travellers do not meet the rules of the quota you chose. Check the rules at the top of this step.',
    CONCESSION_PROOF_REQUIRED: 'A concession needs an ID proof type and number for that traveller.',
    NO_ADULT_PASSENGER: 'Every PNR needs at least one traveller aged 18 or more.',
    MONTHLY_LIMIT_EXCEEDED: 'You have reached the monthly limit of tickets for your account.',
    CHART_PREPARED: 'The chart for this train is already prepared, so new bookings are closed.',
    JOURNEY_PAST: 'This train has already left the boarding station.',
    OUTSIDE_BOOKING_WINDOW: 'This date is too far ahead. Tickets open only a few days before the journey.',
    TRAIN_NOT_RUNNING: 'This train does not run on that date.',
    INVALID_STOPS: 'The boarding and destination stations are not valid for this train.',
    BERTH_PREFERENCE_NOT_MET: 'A traveller could not get the berth they asked for, and you chose "book only if the berth is given". Untick "Berth Condition" or change the berth choice.',
    HOLD_EXPIRED: 'The 10-minute hold ran out before payment.'
  };
  return map[err?.code] || err?.message || 'The booking could not be made. Please try again.';
}

function renderSelectedJourneyInfo() {
  const { selectedTrain, selectedClass, searchParams } = State.bookingFlow;
  const fromStation = State.stations.find(s => s.stationId === searchParams.fromId);
  const toStation = State.stations.find(s => s.stationId === searchParams.toId);

  document.getElementById('selected-journey-info').innerHTML = `
    <div class="journey-info-grid">
      <div class="info-row">
        <div class="info-label">Train</div>
        <div class="info-value">${selectedTrain?.trainName || 'N/A'}</div>
      </div>
      <div class="info-row">
        <div class="info-label">Class</div>
        <div class="info-value">${selectedClass || 'N/A'}</div>
      </div>
      <div class="info-row">
        <div class="info-label">From</div>
        <div class="info-value">${fromStation?.stationCode || '?'}</div>
      </div>
      <div class="info-row">
        <div class="info-label">To</div>
        <div class="info-value">${toStation?.stationCode || '?'}</div>
      </div>
      <div class="info-row">
        <div class="info-label">Date</div>
        <div class="info-value">${formatDate(searchParams.date)}</div>
      </div>
      <div class="info-row">
        <div class="info-label">Quota</div>
        <div class="info-value">${searchParams.quota}</div>
      </div>
    </div>
  `;
}

function startHoldTimer(initialSeconds) {
  if (State.bookingFlow.holdTimerInterval) {
    clearInterval(State.bookingFlow.holdTimerInterval);
    State.bookingFlow.holdTimerInterval = null;
  }

  let remaining = typeof initialSeconds === 'number' ? initialSeconds : (State.bookingFlow.secondsRemaining || 0);
  if (remaining <= 0) return;

  const renderTimerText = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const text = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    ['hold-countdown', 'hold-countdown-4', 'hold-countdown-5'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    });
    const timerBox = document.getElementById('hold-timer');
    if (timerBox) timerBox.classList.remove('hidden');
    const timerBox4 = document.getElementById('hold-timer-4');
    if (timerBox4) timerBox4.classList.remove('hidden');
    const timerBox5 = document.getElementById('hold-timer-5');
    if (timerBox5) timerBox5.classList.remove('hidden');
  };

  renderTimerText(remaining);

  State.bookingFlow.holdTimerInterval = setInterval(() => {
    remaining -= 1;
    State.bookingFlow.secondsRemaining = remaining;
    if (remaining <= 0) {
      clearInterval(State.bookingFlow.holdTimerInterval);
      State.bookingFlow.holdTimerInterval = null;
      renderTimerText(0);
      showToast('Seat hold expired. Please reselect your journey and passengers.', 'error');
      const payBtn = document.getElementById('pay-now-btn');
      if (payBtn) payBtn.disabled = true;
    } else {
      renderTimerText(remaining);
    }
  }, 1000);
}

// Step 4 - Summary
async function initSummaryStep() {
  const { selectedTrain, selectedClass, selectedPassengers, searchParams } = State.bookingFlow;
  if (!selectedTrain) return;

  const fromStation = State.stations.find(s => s.stationId === searchParams.fromId);
  const toStation = State.stations.find(s => s.stationId === searchParams.toId);

  // Validate passenger requirements
  if (!selectedPassengers || selectedPassengers.length === 0) {
    showToast('Please select or add at least one passenger before proceeding', 'error');
    goToStep(3);
    return;
  }

  // The same checks the API makes (limits, adult, concession proof, quota eligibility), in plain words
  const problems = State.bookingFlow.pnr ? [] : passengerStep.problems();
  if (problems.length) {
    showToast(problems[0], 'error');
    goToStep(3);
    return;
  }

  // Render static details first
  document.getElementById('summary-journey-card').innerHTML = `
    <div class="card-header"><h3>Journey Details</h3></div>
    <div class="train-timing" style="margin-bottom:0;">
      <div class="time-station">
        <div class="time-display">${selectedTrain.departureTime || '—'}</div>
        <div class="station-code">${fromStation?.stationCode || '?'}</div>
        <div style="font-size:12px;color:var(--clr-text-2)">${fromStation?.stationName || ''}</div>
      </div>
      <div class="duration-section" style="flex:1;text-align:center;">
        <div class="duration-text">${selectedTrain.duration || '—'}</div>
        <div class="h-line" style="margin:6px 0;"></div>
        <div style="font-size:12px;color:var(--clr-text-3)">${selectedTrain.trainName} | ${selectedClass}</div>
      </div>
      <div class="time-station">
        <div class="time-display">${selectedTrain.arrivalTime || '—'}</div>
        <div class="station-code">${toStation?.stationCode || '?'}</div>
        <div style="font-size:12px;color:var(--clr-text-2)">${toStation?.stationName || ''}</div>
      </div>
    </div>
  `;

  renderSummaryPassengers();

  // If a booking hold has not yet been initiated for this passenger set, call real createBooking to hold seats
  if (!State.bookingFlow.pnr) {
    showLoading('Reserving seats & calculating authoritative fare...');
    try {
      const fallbackConsent = document.getElementById('pref-fallback-consent')?.checked || false;
      const berthCondition = document.getElementById('pref-berth-condition')?.checked || false;

      const bookingPayload = {
        trainId: selectedTrain.trainId,
        journeyDate: searchParams.date,
        boardingStationId: searchParams.fromId,
        destinationStationId: searchParams.toId,
        classType: selectedClass,
        quota: searchParams.quota || 'GENERAL',
        requestedQuota: searchParams.quota || 'GENERAL',
        continueWithGeneralQuota: fallbackConsent,
        passengers: selectedPassengers.map(p => {
          const passenger = {
            name: p.name,
            age: Number(p.age),
            gender: p.gender,
            berthPreference: p.berthPreference || 'NO_BERTH',
            concessionType: p.concessionType || 'NONE',
            disabilityType: p.disabilityType || 'NONE'
          };
          // Saved passenger: send its id (the server checks it belongs to this user)
          if (p.passengerId) passenger.savedPassengerId = p.passengerId;
          // ID proof only when the passenger really has a concession or the user filled the proof in.
          // No placeholder values are sent.
          const hasConcession = passenger.concessionType !== 'NONE';
          const proofFilled = Boolean(p.idProofType && p.idProofReference);
          if (hasConcession || proofFilled) {
            if (p.idProofType) passenger.idProofType = p.idProofType;
            if (p.idProofReference) passenger.idProofReference = p.idProofReference;
          }
          return passenger;
        }),
        // Only the berth condition is used by the server. Insurance is always included in the fare.
        preferences: {
          berthCondition
        }
      };

      const bookingRes = await Service.createBooking(bookingPayload);
      State.bookingFlow.pnr = bookingRes.pnr;
      State.bookingFlow.bookingStatus = bookingRes.bookingStatus;
      State.bookingFlow.projectedStatus = bookingRes.projectedStatus;
      State.bookingFlow.totalFare = Number(bookingRes.totalFare);
      State.bookingFlow.fareBreakdown = bookingRes.fareBreakdown || [];
      State.bookingFlow.secondsRemaining = Number(bookingRes.secondsRemaining) || 600;
      try {
        const held = await Service.enquirePNR(bookingRes.pnr);
        State.bookingFlow.passengerStatuses = held?.passengers || [];
      } catch (_) {
        State.bookingFlow.passengerStatuses = [];
      }

      startHoldTimer(State.bookingFlow.secondsRemaining);
      showToast(`Seats reserved on hold! PNR: ${bookingRes.pnr}`, 'info');
    } catch (err) {
      console.error('Failed to reserve seats on hold:', err);
      hideLoading();
      showToast(plainBookingError(err), 'error');
      goToStep(3);
      return;
    } finally {
      hideLoading();
    }
  }

  // Render server-authoritative fare breakdown and the per-traveller lines
  renderSummaryPassengers();
  renderServerFareBreakdown();
}

/**
 * Summary: every traveller by name with their own fare lines and the status they get. The fare lines and statuses
 * are the server's (the booking reply and the PNR), never worked out here. Before the seats are held there are none yet.
 */
function renderSummaryPassengers() {
  const { selectedPassengers, fareBreakdown, passengerStatuses } = State.bookingFlow;
  const lines = Array.isArray(fareBreakdown) ? fareBreakdown : [];
  const known = lines.length > 0;
  const rows = selectedPassengers.map((p, i) => {
    const f = lines.find(l => Number(l.passengerNo) === i + 1);
    const st = (passengerStatuses || []).find(s => Number(s.passengerNo) === i + 1);
    const status = st ? `${String(st.status).replace(/_/g, ' ')}${st.queuePosition ? ' (' + escapeHtml(st.queuePosition) + ')' : ''}` : (known ? '—' : 'Decided when seats are held');
    const money = (v) => (f ? formatMoney(v) : '—');
    return `
      <tr>
        <td><strong>${escapeHtml(p.name)}</strong><br><small>${escapeHtml(p.age)} yrs, ${escapeHtml(String(p.gender).toLowerCase())} · ${escapeHtml(p.berthPreference && p.berthPreference !== 'NO_BERTH' ? p.berthPreference.replace(/_/g, ' ').toLowerCase() : 'no berth preference')}</small></td>
        <td>${p.concessionType && p.concessionType !== 'NONE' ? escapeHtml(p.concessionType.replace(/_/g, ' ').toLowerCase()) : 'none'}</td>
        <td><strong>${status}</strong></td>
        <td class="num">${money(f?.baseFare)}</td>
        <td class="num">${f && f.concessionDiscount > 0 ? '-' + formatMoney(f.concessionDiscount) : '—'}</td>
        <td class="num">${money(f ? f.reservationCharge + f.superfastCharge + f.tatkalCharge + f.dynamicSurcharge : 0)}</td>
        <td class="num">${money(f?.gst)}</td>
        <td class="num">${money(f?.insurance)}</td>
        <td class="num"><strong>${money(f?.totalFare)}</strong></td>
      </tr>`;
  }).join('');
  document.getElementById('summary-passengers-card').innerHTML = `
    <div class="card-header"><h3>Travellers (${selectedPassengers.length})</h3></div>
    <div class="sum-table-wrap">
      <table class="sum-table">
        <thead><tr><th>Traveller</th><th>Concession</th><th>Status</th><th class="num">Base fare</th><th class="num">Discount</th><th class="num">Charges*</th><th class="num">GST</th><th class="num">Insurance</th><th class="num">Fare</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="pax-note">* Reservation, superfast and Tatkal charges. All amounts come from the booking.</p>`;
}

function renderServerFareBreakdown() {
  const breakdownList = Array.isArray(State.bookingFlow.fareBreakdown) ? State.bookingFlow.fareBreakdown : [];
  const total = State.bookingFlow.totalFare || 0;

  let sumBase = 0, sumReservation = 0, sumSuperfast = 0, sumTatkal = 0, sumDynamic = 0, sumGst = 0, sumInsurance = 0, sumDiscount = 0;
  breakdownList.forEach(item => {
    sumBase += Number(item.baseFare) || 0;
    sumReservation += Number(item.reservationCharge) || 0;
    sumSuperfast += Number(item.superfastCharge) || 0;
    sumTatkal += Number(item.tatkalCharge) || 0;
    sumDynamic += Number(item.dynamicSurcharge) || 0;
    sumGst += Number(item.gst) || 0;
    sumInsurance += Number(item.insurance) || 0;
    sumDiscount += Number(item.concessionDiscount) || 0;
  });

  document.getElementById('fare-breakdown').innerHTML = `
    <div class="fare-row"><span class="fare-label">Base Fare</span><span class="fare-amount">${formatMoney(sumBase)}</span></div>
    <div class="fare-row"><span class="fare-label">Reservation Charge</span><span class="fare-amount">${formatMoney(sumReservation)}</span></div>
    ${sumSuperfast > 0 ? `<div class="fare-row"><span class="fare-label">Superfast Surcharge</span><span class="fare-amount">${formatMoney(sumSuperfast)}</span></div>` : ''}
    ${sumTatkal > 0 ? `<div class="fare-row"><span class="fare-label">Tatkal Charge</span><span class="fare-amount">${formatMoney(sumTatkal)}</span></div>` : ''}
    ${sumDynamic > 0 ? `<div class="fare-row"><span class="fare-label">Dynamic Surcharge</span><span class="fare-amount">${formatMoney(sumDynamic)}</span></div>` : ''}
    ${sumGst > 0 ? `<div class="fare-row"><span class="fare-label">GST</span><span class="fare-amount">${formatMoney(sumGst)}</span></div>` : ''}
    ${sumInsurance > 0 ? `<div class="fare-row"><span class="fare-label">Travel Insurance</span><span class="fare-amount">${formatMoney(sumInsurance)}</span></div>` : ''}
    ${sumDiscount > 0 ? `<div class="fare-row"><span class="fare-label">Concession Discount</span><span class="fare-amount fare-discount">-${formatMoney(sumDiscount)}</span></div>` : ''}
    <div class="fare-total">
      <span>Total Payable (Server Authoritative)</span>
      <span class="fare-total-amount">${formatMoney(total)}</span>
    </div>
  `;

  document.getElementById('payment-total-amount').textContent = formatMoney(total);
}

// Step 5 - Razorpay TEST Payment Gateway
window.processPaymentFlow = async () => {
  const pnr = State.bookingFlow.pnr;
  if (!pnr) {
    showToast('No active seat hold found. Please return to summary to reserve your seats.', 'error');
    goToStep(4);
    return;
  }

  if (State.bookingFlow.secondsRemaining <= 0) {
    showToast('Your seat hold timer has expired. Please restart the booking.', 'error');
    goToStep(1);
    return;
  }

  if (typeof window.Razorpay === 'undefined' || window.__rzp_load_failed) {
    showToast('Payment window could not load. Check internet and retry.', 'error');
    return;
  }

  const btn = document.getElementById('pay-now-btn');
  btn.textContent = '⏳ Launching Gateway...';
  btn.disabled = true;

  showLoading('Connecting to Razorpay gateway...');

  try {
    // 1. Create real order on backend
    const orderData = await Service.createRazorpayOrder(pnr);
    hideLoading();

    // The server found that this booking was already paid (the answer was lost earlier): nothing to pay
    if (orderData && orderData.alreadyPaid) {
      btn.disabled = false;
      btn.textContent = 'Pay now';
      showToast(`This booking is already paid. It is ${String(orderData.bookingStatus).replace(/_/g, ' ')}.`, 'success');
      navigateTo('bookings');
      return;
    }

    if (!orderData || !orderData.orderId || !orderData.keyId) {
      throw new Error('Invalid gateway order response from server');
    }

    if (typeof window.Razorpay === 'undefined' || window.__rzp_load_failed) {
      throw new Error('Payment window could not load. Check internet and retry.');
    }

    // 2. Open official Razorpay modal
    const options = {
      key: orderData.keyId,
      amount: orderData.amount,
      currency: orderData.currency || 'INR',
      name: 'Railway Reservation & Management System',
      description: `Payment for PNR ${pnr}`,
      order_id: orderData.orderId,
      prefill: {
        name: State.user?.name || '',
        email: State.user?.email || '',
        contact: State.user?.phone || ''
      },
      theme: {
        color: '#1a56db'
      },
      modal: {
        ondismiss: function () {
          btn.innerHTML = '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd"/></svg> Pay now';
          btn.disabled = false;
          showToast('Payment window closed. Your hold remains active until the timer expires.', 'warning');
        }
      },
      handler: async function (response) {
        showLoading('Verifying payment signature with server...');
        try {
          // 3. Server verification POST /api/payments/razorpay/verify
          const verifyPayload = {
            pnr,
            razorpayOrderId: response.razorpay_order_id,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySignature: response.razorpay_signature
          };

          const verifyRes = await Service.verifyRazorpayPayment(verifyPayload);
          hideLoading();

          // Successful payment confirmation
          // (a late payment is HTTP 200 with success:false, so it is thrown by the API helper and handled in the catch below)
          if (State.bookingFlow.holdTimerInterval) {
            clearInterval(State.bookingFlow.holdTimerInterval);
            State.bookingFlow.holdTimerInterval = null;
          }

          renderConfirmationPage(verifyRes.data);
          goToStep(6);
          showToast(`Payment verified! Booking confirmed with PNR ${pnr} 🎉`, 'success');

          // Refresh My Bookings
          Service.getUserBookings().then(b => {
            State.allBookings = Array.isArray(b) ? b : [];
            updateBookingBadge();
          }).catch(() => {});

        } catch (vErr) {
          hideLoading();

          // Final error: the payment arrived after the hold expired. The server has already refunded it.
          // Pay stays disabled: the seats are gone and a second payment would only be refunded again.
          if (vErr?.code === 'HOLD_EXPIRED') {
            if (State.bookingFlow.holdTimerInterval) {
              clearInterval(State.bookingFlow.holdTimerInterval);
              State.bookingFlow.holdTimerInterval = null;
            }
            renderExpiredRefundNotice(vErr.data?.refund, vErr.message);
            showToast('Payment arrived after your hold expired. It has been refunded.', 'error');
            btn.disabled = true;
            return;
          }

          // Not a clear "no": the payment may have gone through at Razorpay even though the answer was lost.
          // Network error, a server error, or "being processed" -> ask the server to check with Razorpay. Never pay again.
          if (isUnsureVerifyError(vErr)) {
            await confirmPaymentAfterLostAnswer(pnr, btn);
            return;
          }

          // Final error (for example a bad signature): let the user try again
          showToast(vErr?.message || 'Payment verification failed on server.', 'error');
          btn.innerHTML = '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd"/></svg> Pay now';
          btn.disabled = false;
        }
      }
    };

    const rzp = new window.Razorpay(options);
    rzp.on('payment.failed', function (resp) {
      hideLoading();
      btn.innerHTML = '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd"/></svg> Pay now';
      btn.disabled = false;
      showToast(`Gateway error: ${resp.error?.description || 'Transaction declined'}`, 'error');
    });

    rzp.open();

  } catch (err) {
    hideLoading();
    btn.innerHTML = '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd"/></svg> Pay now';
    btn.disabled = false;
    const msg = (typeof window.Razorpay === 'undefined' || window.__rzp_load_failed || err?.message?.includes('Checkout SDK') || err?.message?.includes('Payment window'))
      ? 'Payment window could not load. Check internet and retry.'
      : (err?.message || 'Payment window could not load. Check internet and retry.');
    showToast(msg, 'error');
  }
};

// True when we cannot tell if the money was taken: no answer from the server, or a server-side problem.
function isUnsureVerifyError(err) {
  const status = Number(err?.status);
  if (err?.code === 'NETWORK_ERROR' || status === 0) return true;
  return status >= 500 || status === 429;
}

/**
 * The browser paid at Razorpay but /verify gave no clear answer. Ask the server to check the order.
 * Shows "We are confirming your payment. Please do not pay again." then the result.
 */
async function confirmPaymentAfterLostAnswer(pnr, btn) {
  if (btn) btn.disabled = true; // never allow a second payment while we check
  const notice = document.getElementById('payment-final-notice');
  if (notice) {
    notice.innerHTML = '<div class="warning-box" style="margin:12px 0;"><strong>We are confirming your payment.</strong><p style="margin:6px 0 0 0;font-size:13px;">Please do not pay again.</p></div>';
  }
  showLoading('We are confirming your payment. Please do not pay again.');

  let result = null;
  // The server may need a moment (rate limit is one check per 10 seconds); try a few times
  for (let attempt = 0; attempt < 4 && !result; attempt++) {
    try {
      result = await Service.reconcilePayment(pnr);
    } catch (rErr) {
      if (rErr?.status === 429 || rErr?.code === 'NETWORK_ERROR' || Number(rErr?.status) >= 500) {
        await new Promise(r => setTimeout(r, 10500));
      } else {
        break;
      }
    }
  }
  hideLoading();

  if (State.bookingFlow.holdTimerInterval) {
    clearInterval(State.bookingFlow.holdTimerInterval);
    State.bookingFlow.holdTimerInterval = null;
  }

  Service.getUserBookings().then(b => {
    State.allBookings = Array.isArray(b) ? b : [];
    updateBookingBadge();
  }).catch(() => {});

  if (result && result.paidAfterHoldExpired) {
    renderExpiredRefundNotice(result.refund, 'Your payment arrived after the seat hold expired, so no ticket was issued. The full amount is being refunded.');
    showToast('Payment arrived after your hold expired. It is being refunded.', 'error');
    return;
  }
  if (result && result.paymentReceived && ['CONFIRMED', 'RAC', 'WAITING_LIST'].includes(result.bookingStatus)) {
    showToast(`Payment confirmed! Booking ${pnr} is ${result.bookingStatus.replace(/_/g, ' ')}.`, 'success');
    if (notice) notice.innerHTML = '';
    navigateTo('bookings');
    return;
  }
  // Still not confirmed: keep Pay disabled and tell the passenger what to do
  if (notice) {
    notice.innerHTML = '<div class="warning-box" style="margin:12px 0;"><strong>We could not confirm your payment yet.</strong><p style="margin:6px 0 0 0;font-size:13px;">Please do not pay again. Open My Bookings and press "Check payment status" in a minute. If the money was taken, your ticket is issued or the amount is refunded automatically.</p></div>';
  }
  showToast('We could not confirm your payment yet. Please do not pay again.', 'warning');
}

window.checkPaymentStatus = async (pnr, btn) => {
  if (btn) { btn.disabled = true; btn.textContent = 'Checking...'; }
  try {
    const res = await Service.reconcilePayment(pnr);
    if (res.paidAfterHoldExpired) {
      showToast('Your payment arrived after the hold expired. It is being refunded.', 'warning');
    } else if (res.paymentReceived) {
      showToast(`Payment confirmed! Booking ${pnr} is ${String(res.bookingStatus).replace(/_/g, ' ')}.`, 'success');
    } else {
      showToast('No payment received yet for this booking.', 'info');
    }
  } catch (err) {
    showToast(err?.message || 'Could not check the payment status.', 'error');
  }
  try {
    const b = await Service.getUserBookings();
    State.allBookings = Array.isArray(b) ? b : [];
    updateBookingBadge();
    renderBookingsPage();
  } catch (_) { /* ignore */ }
};

function renderExpiredRefundNotice(refund, serverMessage) {
  const container = document.getElementById('payment-final-notice');
  if (container) {
    container.innerHTML = `
      <div class="warning-box" style="margin:12px 0;background:rgba(239,68,68,0.1);border:1px solid var(--clr-danger);color:var(--clr-text-1);">
        <strong>⚠️ Payment arrived after your hold expired</strong>
        <p style="margin:6px 0 0 0;font-size:13px;">${escapeHtml(serverMessage || 'Your seats were released before the payment was received, so no ticket was issued. The full amount is being refunded to your payment method.')}</p>
        ${refund ? `<div style="font-size:13px;margin-top:8px;color:var(--clr-text-2);">
          <div><strong>Refund amount:</strong> ${refund.amount != null ? formatMoney(refund.amount) : '—'}</div>
          <div><strong>Refund status:</strong> ${refund.status === 'PROCESSED' ? 'Processed' : 'Being processed'}</div>
          ${refund.refundId ? `<div><strong>Refund ID:</strong> ${escapeHtml(refund.refundId)}</div>` : ''}
        </div>` : ''}
        <button type="button" class="btn-primary" style="margin-top:10px;" onclick="startOverBooking()">Start a new booking</button>
      </div>
    `;
  }
}

function renderConfirmationPage(confirmation) {
  const { selectedTrain, selectedClass, selectedPassengers, searchParams } = State.bookingFlow;
  const fromStation = State.stations.find(s => s.stationId === searchParams.fromId);
  const toStation = State.stations.find(s => s.stationId === searchParams.toId);
  const pnr = confirmation?.pnr || State.bookingFlow.pnr;
  const bookingStatus = confirmation?.bookingStatus || 'CONFIRMED';
  const passengers = confirmation?.passengers || selectedPassengers;

  document.getElementById('e-ticket-card').innerHTML = `
    <div class="ticket-header">
      <h3>🚆 Official E-Ticket</h3>
      <div class="ticket-pnr">PNR: ${pnr}</div>
    </div>
    <div class="ticket-body">
      <div class="ticket-route">
        <div class="ticket-station">
          <div class="tk-time">${selectedTrain?.departureTime || '—'}</div>
          <div class="tk-code">${fromStation?.stationCode || '?'}</div>
          <div class="tk-name">${fromStation?.stationName || ''}</div>
        </div>
        <div class="ticket-arrow">
          ──────── ${selectedTrain?.duration || '—'} ────────→
        </div>
        <div class="ticket-station">
          <div class="tk-time">${selectedTrain?.arrivalTime || '—'}</div>
          <div class="tk-code">${toStation?.stationCode || '?'}</div>
          <div class="tk-name">${toStation?.stationName || ''}</div>
        </div>
      </div>
      <div class="ticket-meta">
        <div class="ticket-meta-item">
          <div class="tmeta-label">Train</div>
          <div class="tmeta-value">${selectedTrain?.trainNumber} - ${selectedTrain?.trainName}</div>
        </div>
        <div class="ticket-meta-item">
          <div class="tmeta-label">Date</div>
          <div class="tmeta-value">${formatDate(searchParams.date)}</div>
        </div>
        <div class="ticket-meta-item">
          <div class="tmeta-label">Class</div>
          <div class="tmeta-value">${selectedClass}</div>
        </div>
        <div class="ticket-meta-item">
          <div class="tmeta-label">Booking Status</div>
          <div class="tmeta-value" style="color:var(--clr-accent)">${bookingStatus.replace(/_/g, ' ')}</div>
        </div>
        <div class="ticket-meta-item">
          <div class="tmeta-label">Quota</div>
          <div class="tmeta-value">${searchParams.quota}</div>
        </div>
        <div class="ticket-meta-item">
          <div class="tmeta-label">Total Fare Paid</div>
          <div class="tmeta-value" style="color:var(--clr-primary)">${formatMoney(State.bookingFlow.totalFare)}</div>
        </div>
      </div>
    </div>
    <div class="ticket-footer">
      <div class="ticket-passengers">
        ${passengers.map((p, i) => `
          <div class="ticket-pax-row">
            <span class="ticket-pax-name">${p.name || selectedPassengers[i]?.name || 'Passenger ' + (i + 1)}</span>
            <span class="ticket-pax-berth">
              ${p.status ? p.status.replace(/_/g, ' ') : ''} ${p.coachNumber ? `· Coach ${p.coachNumber}` : ''} ${p.seatNumber ? `· Seat ${p.seatNumber}` : ''} ${p.berthType ? `· ${p.berthType}` : ''} ${p.queuePosition ? `· Position #${p.queuePosition}` : ''}
            </span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

window.printTicket = () => window.print();

window.bookAnotherTicket = () => {
  resetBookingFlow();
  navigateTo('search');
};

// ════════════════════════════════════════════════════════════════ MY BOOKINGS

function renderBookingsPage() {
  try {
    renderFilteredBookings(State.allBookings);
  } catch (err) {
    console.error('Failed to render bookings:', err);
    const container = document.getElementById('bookings-list');
    if (container) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title" style="color:var(--clr-danger, #ef4444);">Failed to load bookings</div><div class="empty-sub" style="color:var(--clr-danger, #ef4444);">${err?.message || 'Please refresh'}</div></div>`;
    }
  }
}

window.filterBookings = (status, btn) => {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const filtered = status === 'all' ? State.allBookings
    : State.allBookings.filter(b => b.bookingStatus === status);
  renderFilteredBookings(filtered);
};

function renderFilteredBookings(bookings) {
  const container = document.getElementById('bookings-list');

  if (!bookings.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🎫</div><div class="empty-title">No bookings found</div><div class="empty-sub">Try a different filter</div></div>`;
    return;
  }

  container.innerHTML = bookings.map(b => {
    const canCancel = ['CONFIRMED', 'RAC', 'WAITING_LIST'].includes(b.bookingStatus);
    const canTDR = ['CONFIRMED', 'RAC'].includes(b.bookingStatus);
    // Hold still running: the passenger may have paid and lost the answer. Expired holds get nothing new.
    const canCheckPayment = b.bookingStatus === 'PAYMENT_PENDING' && Number(b.holdSecondsRemaining) > 0;
    const unpaid = b.bookingStatus === 'PAYMENT_PENDING';
    const holdLeft = Number(b.holdSecondsRemaining) || 0;
    const trainDisplayName = b.trainName || (b.trainNumber ? `Train ${b.trainNumber}` : (b.train?.trainName || 'Train'));
    const paxCountText = b.passengerCount ? ` · ${b.passengerCount} passenger${b.passengerCount > 1 ? 's' : ''}` : '';
    const fareDisplay = b.totalFare != null ? formatMoney(b.totalFare) : '—';

    return `
      <div class="booking-full-card">
        <div class="bfc-header">
          <div>
            <div class="bfc-pnr">PNR: ${b.pnr}</div>
            <div style="font-size:12px;color:var(--clr-text-3);margin-top:2px;">Booked on ${formatDate(b.createdAt)}${paxCountText}</div>
          </div>
          <span class="status-badge ${b.bookingStatus}">${b.bookingStatus.replace(/_/g, ' ')}</span>
        </div>
        <div class="bfc-body">
          <div class="bfc-route">
            <div class="bfc-station">
              <div class="bfc-time">${b.boardingStation?.stationCode || '?'}</div>
              <div class="bfc-station-name">${b.boardingStation?.stationName || ''}</div>
            </div>
            <div style="padding:0 16px;color:var(--clr-text-3);font-size:20px;">→</div>
            <div class="bfc-station">
              <div class="bfc-time">${b.destinationStation?.stationCode || '?'}</div>
              <div class="bfc-station-name">${b.destinationStation?.stationName || ''}</div>
            </div>
          </div>
          <div class="bfc-mid" style="text-align:center;">
            <div class="bfc-train-name">🚂 ${trainDisplayName}</div>
            <div class="bfc-date">📅 ${formatDate(b.journeyDate)}</div>
            <div class="bfc-class">Class: ${b.classType} | ${b.quota}</div>
          </div>
          <div style="text-align:right;">
            <div class="bfc-fare-label">Total Fare</div>
            <div class="bfc-fare">${fareDisplay}</div>
          </div>
        </div>
        ${unpaid ? `
        <div class="pay-pending-box" data-unpaid-pnr="${b.pnr}">
          <span><strong>Not paid yet.</strong> ${holdLeft > 0 ? 'Your seats are held for' : 'The hold has ended. The seats are released automatically.'}</span>
          ${holdLeft > 0 ? `<span class="hold-left" data-hold-end="${Date.now() + holdLeft * 1000}" aria-label="Time left on the seat hold">${formatHold(holdLeft)}</span>` : ''}
          ${holdLeft > 0 ? `<button class="btn-primary" onclick="resumePayment('${b.pnr}')">Pay now</button>
          <button class="btn-secondary-sm" style="color:var(--clr-danger);" onclick="cancelUnpaidBooking('${b.pnr}')">Cancel unpaid booking</button>` : ''}
        </div>
        <p class="pay-test-note" style="margin:-6px 20px 12px;">${holdLeft > 0 ? 'Test mode: use Netbanking or UPI. International cards are not accepted.' : ''}</p>` : ''}
        <div class="bfc-footer">
          <button class="btn-secondary-sm" onclick="viewPNRDetails('${b.pnr}')">View Details</button>
          ${canCancel ? `<button class="btn-secondary-sm" style="color:var(--clr-danger);" onclick="openCancelModal('${b.pnr}')">Cancel</button>` : ''}
          ${canTDR ? `<button class="btn-secondary-sm" onclick="openTDRPrefill('${b.pnr}')">File TDR</button>` : ''}
          ${canCheckPayment ? `<button class="btn-secondary-sm" onclick="checkPaymentStatus('${b.pnr}', this)">Check payment status</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
  startUnpaidTicker();
}

function formatHold(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// One timer for every unpaid booking shown on My Bookings: counts down, and at zero turns the card into "hold ended"
let unpaidTicker = null;
function startUnpaidTicker() {
  if (unpaidTicker) return;
  unpaidTicker = setInterval(() => {
    const spans = document.querySelectorAll('#bookings-list .hold-left[data-hold-end]');
    if (!spans.length) { clearInterval(unpaidTicker); unpaidTicker = null; return; }
    let expired = false;
    spans.forEach(el => {
      const left = (Number(el.dataset.holdEnd) - Date.now()) / 1000;
      if (left <= 0) expired = true; else el.textContent = formatHold(left);
    });
    if (expired) {
      clearInterval(unpaidTicker); unpaidTicker = null;
      Service.getUserBookings().then(b => { State.allBookings = Array.isArray(b) ? b : []; updateBookingBadge(); renderBookingsPage(); }).catch(() => {});
    }
  }, 1000);
}

/**
 * "Pay now" for a booking that is still PAYMENT_PENDING: rebuild the payment step from the booking (read from the
 * server) and open it with the remaining hold time. Paying reuses the open Razorpay order of the booking.
 */
window.resumePayment = async (pnr) => {
  showLoading('Opening your unpaid booking...');
  try {
    const b = await Service.enquirePNR(pnr);
    hideLoading();
    if (!b || b.bookingStatus !== 'PAYMENT_PENDING') {
      showToast('This booking is not waiting for payment any more.', 'info');
      const list = await Service.getUserBookings(); State.allBookings = Array.isArray(list) ? list : []; renderBookingsPage();
      return;
    }
    const secs = Number(b.holdSecondsRemaining) || 0;
    if (secs <= 0) { showToast('The seat hold has ended. Please book again.', 'error'); return; }

    navigateTo('search'); // clears the old flow
    const stationId = (code) => State.stations.find(s => s.stationCode === code)?.stationId;
    const flow = State.bookingFlow;
    flow.pnr = b.pnr;
    flow.totalFare = Number(b.totalFare);
    flow.selectedClass = b.classType;
    flow.searchParams = { fromId: stationId(b.boardingStation?.stationCode), toId: stationId(b.destinationStation?.stationCode), date: String(b.journeyDate).slice(0, 10), classType: b.classType, quota: b.quota };
    flow.selectedTrain = { trainNumber: b.trainNumber, trainName: b.trainName, departureTime: '—', arrivalTime: '—', duration: '—' };
    flow.selectedPassengers = (b.passengers || []).map(p => ({ name: p.name, age: p.age, gender: p.gender, concessionType: p.concessionType || 'NONE', berthPreference: 'NO_BERTH' }));
    flow.fareBreakdown = (b.passengers || []).map(p => ({ passengerNo: p.passengerNo, name: p.name, ...(p.fare || {}) }));
    flow.passengerStatuses = b.passengers || [];
    flow.secondsRemaining = secs;
    goToStep(5);
    startHoldTimer(secs);
    renderServerFareBreakdown();
    document.getElementById('payment-final-notice').innerHTML = '';
  } catch (err) {
    hideLoading();
    showToast(err?.message || 'Could not open this booking.', 'error');
  }
};

/** "Cancel unpaid booking": give up the hold. The seats go back at once and any open payment order is closed. */
window.cancelUnpaidBooking = async (pnr) => {
  if (!window.confirm(`Cancel the unpaid booking ${pnr}? Your held seats will be released.`)) return;
  showLoading('Releasing your seats...');
  try {
    await Service.cancelUnpaidBooking(pnr);
    hideLoading();
    showToast(`Booking ${pnr} was cancelled. Your seats are released. You were not charged.`, 'success');
  } catch (err) {
    hideLoading();
    showToast(err?.message || 'Could not cancel the booking.', 'error');
  }
  try {
    const list = await Service.getUserBookings();
    State.allBookings = Array.isArray(list) ? list : [];
    updateBookingBadge();
    renderBookingsPage();
  } catch (_) { /* ignore */ }
};

// Same button on the payment step of the booking flow
window.cancelUnpaidFromFlow = async () => {
  const pnr = State.bookingFlow.pnr;
  if (!pnr) { startOverBooking(); return; }
  if (State.bookingFlow.holdTimerInterval) { clearInterval(State.bookingFlow.holdTimerInterval); State.bookingFlow.holdTimerInterval = null; }
  await window.cancelUnpaidBooking(pnr);
  navigateTo('bookings');
};

window.viewPNRDetails = (pnr) => {
  document.getElementById('pnr-input').value = pnr;
  navigateTo('pnr');
  setTimeout(() => searchPNR(), 100);
};

// ════════════════════════════════════════════════════════════════ PNR ENQUIRY

window.searchPNR = async () => {
  const pnr = document.getElementById('pnr-input').value.trim();
  if (!pnr || pnr.length < 10) {
    showToast('Please enter a valid 10-digit PNR', 'error');
    return;
  }

  showLoading('Fetching PNR details...');
  try {
    const result = await Service.enquirePNR(pnr);
    hideLoading();

    const container = document.getElementById('pnr-result');
    container.classList.remove('hidden');

    if (!result) {
      container.innerHTML = `
        <div class="card" style="text-align:center;padding:40px;">
          <div style="font-size:48px;margin-bottom:16px;">🔍</div>
          <h3 style="margin-bottom:8px;">PNR Not Found</h3>
          <p style="color:var(--clr-text-2);">No booking found for PNR: ${pnr}</p>
        </div>`;
      return;
    }

    const trainDisplayName = result.trainName || (result.trainNumber ? `Train ${result.trainNumber}` : (result.train?.trainName || 'Train'));
    const paxRows = result.passengers?.map(p => {
      const pStatus = p.status || p.passengerStatus || 'UNKNOWN';
      const seatInfo = (p.coachNumber && p.seatNumber)
        ? `${p.coachNumber} / Seat ${p.seatNumber}${p.berthType ? ` (${p.berthType})` : ''}`
        : (p.queuePosition ? `Position #${p.queuePosition}` : 'Seat not yet assigned');

      return `
        <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--clr-border);">
          <div>
            <div style="font-weight:600;">${p.name || p.passengerInfo?.name || 'Passenger'}</div>
            <div style="font-size:12px;color:var(--clr-text-2);">${p.age != null ? p.age : (p.passengerInfo?.age || '—')} yrs | ${p.gender || p.passengerInfo?.gender || '—'}</div>
          </div>
          <div style="text-align:right;">
            <span class="status-badge ${pStatus}">${pStatus.replace(/_/g, ' ')}</span>
            <div style="font-size:12px;color:var(--clr-text-2);margin-top:4px;">
              ${seatInfo}
            </div>
          </div>
        </div>
      `;
    }).join('') || '<div style="color:var(--clr-text-3);padding:10px 0;">No passenger details available.</div>';

    container.innerHTML = `
      <div class="booking-full-card">
        <div class="bfc-header">
          <div>
            <div class="bfc-pnr">PNR: ${result.pnr}</div>
            <div style="font-size:12px;color:var(--clr-text-3);">Booked on ${formatDate(result.createdAt)}</div>
          </div>
          <span class="status-badge ${result.bookingStatus}">${result.bookingStatus.replace(/_/g, ' ')}</span>
        </div>
        <div class="bfc-body">
          <div class="bfc-route">
            <div class="bfc-station">
              <div class="bfc-time">${result.boardingStation?.stationCode || '?'}</div>
              <div class="bfc-station-name">${result.boardingStation?.stationName || ''}</div>
            </div>
            <div style="padding:0 16px;font-size:20px;color:var(--clr-text-3);">→</div>
            <div class="bfc-station">
              <div class="bfc-time">${result.destinationStation?.stationCode || '?'}</div>
              <div class="bfc-station-name">${result.destinationStation?.stationName || ''}</div>
            </div>
          </div>
          <div class="bfc-mid">
            <div class="bfc-train-name">🚂 ${trainDisplayName}</div>
            <div class="bfc-date">📅 ${formatDate(result.journeyDate)} | ${result.classType} | ${result.quota}</div>
          </div>
          <div style="text-align:right;">
            <div class="bfc-fare-label">Total Fare</div>
            <div class="bfc-fare">${result.totalFare != null ? formatMoney(result.totalFare) : '—'}</div>
          </div>
        </div>
        <div style="padding:16px 20px;border-top:1px solid var(--clr-border);">
          <h4 style="font-size:14px;font-weight:600;margin-bottom:12px;">Passengers (${result.passengerCount || result.passengers?.length || 0})</h4>
          ${paxRows}
        </div>
      </div>
    `;
  } catch (err) {
    console.error('PNR enquiry error:', err);
    hideLoading();
    const container = document.getElementById('pnr-result');
    if (container) {
      container.classList.remove('hidden');
      const errorMsg = (err?.status === 404 || err?.code === 'NOT_FOUND')
        ? `No booking found for PNR: ${pnr}`
        : (err?.message || 'Failed to fetch PNR details');
      container.innerHTML = `
        <div class="card" style="text-align:center;padding:40px;border-color:var(--clr-danger, #ef4444);">
          <div style="font-size:48px;margin-bottom:16px;">⚠️</div>
          <h3 style="margin-bottom:8px;color:var(--clr-danger, #ef4444);">PNR Enquiry Failed</h3>
          <p style="color:var(--clr-danger, #ef4444);">${errorMsg}</p>
        </div>`;
    }
    showToast(err?.message || 'Failed to fetch PNR details', 'error');
  }
};

// ════════════════════════════════════════════════════════════════ PROFILE

function loadProfileData() {
  if (!State.user) return;
  document.getElementById('profile-name').value = State.user.name;
  document.getElementById('profile-email').value = State.user.email;
  document.getElementById('profile-phone').value = State.user.phone;
  document.getElementById('profile-since').value = formatDate(State.user.createdAt);
  document.getElementById('profile-name-display').textContent = State.user.name;
}

window.updateProfile = async (e) => {
  e.preventDefault();
  showLoading('Saving changes...');
  try {
    State.user = await Service.updateProfile(State.user.userId, {
      name: document.getElementById('profile-name').value.trim(),
      phone: document.getElementById('profile-phone').value.trim()
    });
    saveUser();
  } catch (error) {
    hideLoading();
    if (error?.code === 'NOT_AVAILABLE') {
      showToast(error.message, 'info');
    } else {
      showToast('Could not save profile changes.', 'error');
    }
    return;
  }
  hideLoading();
  document.getElementById('profile-name-display').textContent = State.user.name;
  document.getElementById('sidebar-name').textContent = State.user.name;
  document.getElementById('welcome-name').textContent = State.user.name.split(' ')[0];
  showToast('Profile updated successfully!', 'success');
};

// ════════════════════════════════════════════════════════════════ SAVED PASSENGERS

function renderPassengersPage() {
  const container = document.getElementById('passengers-grid');
  try {
    if (!State.savedPassengers.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">👥</div><div class="empty-title">No saved passengers</div><div class="empty-sub">Add frequently travelling passengers for quick booking</div></div>`;
      return;
    }

    container.innerHTML = State.savedPassengers.map(p => `
      <div class="passenger-card">
        <div class="pax-card-header">
          <div class="pax-avatar">${escapeHtml(getInitials(p.name))}</div>
          <div>
            <div class="pax-card-name">${escapeHtml(p.name)}</div>
            <div class="pax-card-sub">${escapeHtml(p.age)} yrs | ${escapeHtml(p.gender)}</div>
          </div>
        </div>
        <div class="pax-details">
          <div class="pax-detail-row">
            <span class="pax-detail-label">ID Proof</span>
            <span class="pax-detail-value">${escapeHtml(p.idProofType)}: ${escapeHtml(p.idProofReference)}</span>
          </div>
          <div class="pax-detail-row">
            <span class="pax-detail-label">Berth Pref.</span>
            <span class="pax-detail-value">${escapeHtml(p.berthPreference)}</span>
          </div>
          ${p.disabilityType && p.disabilityType !== 'NONE' ? `
            <div class="pax-detail-row">
              <span class="pax-detail-label">Disability</span>
              <span class="pax-detail-value">${escapeHtml(p.disabilityType)}</span>
            </div>` : ''}
        </div>
        <div class="pax-card-footer">
          <button class="btn-secondary-sm" onclick="editPassenger(${p.passengerId})">Edit</button>
          <button class="btn-secondary-sm" style="color:var(--clr-danger);" onclick="deletePassenger(${p.passengerId})">Remove</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to render passengers:', err);
    if (container) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title" style="color:var(--clr-danger, #ef4444);">Failed to load passengers</div><div class="empty-sub" style="color:var(--clr-danger, #ef4444);">${err?.message || 'Error'}</div></div>`;
    }
  }
}

let editingPassengerId = null;

window.openAddPassengerModal = () => {
  editingPassengerId = null;
  document.getElementById('passenger-modal-title').textContent = 'Add Passenger';
  document.getElementById('passenger-modal-submit').textContent = 'Save Passenger';
  document.querySelector('#modal-add-passenger form').reset();
  openModal('modal-add-passenger');
};

window.editPassenger = (id) => {
  const passenger = State.savedPassengers.find(item => item.passengerId === id);
  if (!passenger) return;
  editingPassengerId = id;
  document.getElementById('passenger-modal-title').textContent = 'Edit Passenger';
  document.getElementById('passenger-modal-submit').textContent = 'Save Changes';
  document.getElementById('modal-pax-name').value = passenger.name;
  document.getElementById('modal-pax-age').value = passenger.age;
  document.getElementById('modal-pax-gender').value = passenger.gender;
  document.getElementById('modal-pax-id-type').value = passenger.idProofType;
  document.getElementById('modal-pax-id-ref').value = passenger.idProofReference;
  document.getElementById('modal-pax-berth').value = passenger.berthPreference || 'NO_BERTH';
  document.getElementById('modal-pax-disability').value = passenger.disabilityType || 'NONE';
  openModal('modal-add-passenger');
};

window.savePassenger = async (e) => {
  e.preventDefault();
  // Concession is chosen per booking, not stored on a saved passenger
  const newPax = {
    name: document.getElementById('modal-pax-name').value.trim(),
    age: parseInt(document.getElementById('modal-pax-age').value, 10),
    gender: document.getElementById('modal-pax-gender').value,
    idProofType: document.getElementById('modal-pax-id-type').value,
    idProofReference: document.getElementById('modal-pax-id-ref').value.trim(),
    disabilityType: document.getElementById('modal-pax-disability').value,
    berthPreference: document.getElementById('modal-pax-berth').value
  };

  try {
    if (editingPassengerId) {
      const updated = await Service.updatePassenger(editingPassengerId, newPax);
      State.savedPassengers = State.savedPassengers.map(item => item.passengerId === editingPassengerId ? updated : item);
      showToast(`${updated.name} updated`, 'success');
    } else {
      const saved = await Service.savePassenger(newPax);
      State.savedPassengers.push(saved);
      showToast(`${saved.name} added to saved passengers`, 'success');
    }
    editingPassengerId = null;
    renderPassengersPage();
    renderHomeStats();
    closeModal('modal-add-passenger');
    e.target.reset();
  } catch (error) {
    showToast(error?.message || 'Could not save passenger details.', 'error');
  }
};

window.deletePassenger = async (id) => {
  try {
    await Service.deletePassenger(id);
    State.savedPassengers = State.savedPassengers.filter(p => p.passengerId !== id);
    renderPassengersPage();
    renderHomeStats();
    showToast('Passenger removed', 'success');
  } catch (error) {
    // A 409 means the passenger is used in a booking; the server message explains it
    showToast(error?.message || 'Could not remove passenger.', 'error');
  }
};

// ════════════════════════════════════════════════════════════════ TDR

// ════════════════════════════════════════════════════════════════ TDR

async function renderTDRPage() {
  const container = document.getElementById('tdr-list');
  try {
    const tdrs = await Service.getUserTDRs();

    if (!Array.isArray(tdrs) || !tdrs.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">No TDR requests</div><div class="empty-sub">File a Ticket Deposit Receipt if you couldn't travel due to railway delays, diversions, or short terminations</div></div>`;
      return;
    }

    const refundWord = { PENDING: 'Refund is being sent', PROCESSED: 'Refund sent to your payment method', FAILED: 'Refund failed, it will be retried' };
    const statusWord = { FILED: 'Filed, waiting for review', UNDER_REVIEW: 'Under review', APPROVED: 'Approved', REJECTED: 'Rejected', REFUND_PROCESSED: 'Approved and refunded' };
    container.innerHTML = tdrs.map(t => `
      <div class="tdr-card">
        <div>
          <div class="tdr-pnr">${escapeHtml(t.passengerName || 'Passenger ' + (t.passengerNo || ''))} · PNR ${escapeHtml(t.pnr)}</div>
          <div class="tdr-reason">${escapeHtml(t.reasonLabel || (t.reason || '').replace(/_/g, ' '))}</div>
          <div class="tdr-date">${escapeHtml(t.trainNumber || '')} ${escapeHtml(t.trainName || '')} · journey ${formatDate(t.journeyDate)}</div>
          <div class="tdr-date">Reference ${escapeHtml(t.tdrRefNo)} · filed ${formatDate(t.filedAt ? t.filedAt.split(/[T ]/)[0] : '')}</div>
          ${t.remarks ? `<div style="font-size:12px;color:var(--clr-text-2);margin-top:4px;">Note from the reviewer: ${escapeHtml(t.remarks)}</div>` : ''}
        </div>
        <div style="text-align:right;">
          <span class="status-badge ${t.status}">${escapeHtml((t.status || 'FILED').replace(/_/g, ' '))}</span>
          <div style="font-size:12px;color:var(--clr-text-2);margin-top:6px;">${escapeHtml(statusWord[t.status] || '')}</div>
          ${t.refundAmount != null ? `
            <div class="tdr-refund" style="margin-top:8px;">${formatMoney(t.refundAmount)}</div>
            <div class="tdr-refund-label">Refund amount</div>
            <div style="font-size:12px;margin-top:4px;color:var(--clr-text);"><strong>${escapeHtml(t.refundStatus ? (refundWord[t.refundStatus] || t.refundStatus) : 'Refund not started')}</strong></div>
          ` : `<div style="font-size:12px;color:var(--clr-text-2);margin-top:8px;">${t.status === 'REJECTED' ? 'No refund' : 'Refund amount is set when the review is done'}</div>`}
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load TDR data:', err);
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title" style="color:var(--clr-danger, #ef4444);">Failed to load TDR data</div><div class="empty-sub" style="color:var(--clr-danger, #ef4444);">${err?.message || 'Please refresh'}</div></div>`;
  }
}

let tdrData = null;

window.openFileTDRModal = () => {
  tdrData = null;
  document.getElementById('tdr-pnr').value = '';
  document.getElementById('tdr-dynamic').innerHTML = '<p class="pax-note">Type the 10-digit PNR and press "Check this PNR". You will see which reasons you can use for each passenger.</p>';
  document.getElementById('tdr-error').hidden = true;
  document.getElementById('tdr-submit').disabled = true;
  openModal('modal-file-tdr');
};

window.openTDRPrefill = (pnr) => {
  window.openFileTDRModal();
  document.getElementById('tdr-pnr').value = pnr;
  window.loadTdrEligibility();
};

/** Load the PNR with the train's current delay, the passengers (names) and, per passenger, which TDR reasons can be used now. */
window.loadTdrEligibility = async () => {
  const pnr = document.getElementById('tdr-pnr').value.trim();
  const box = document.getElementById('tdr-dynamic');
  document.getElementById('tdr-error').hidden = true;
  if (!/^\d{10}$/.test(pnr)) { box.innerHTML = '<p class="tdr-error">Enter a 10-digit PNR.</p>'; return; }
  box.innerHTML = '<p class="pax-note">Checking the PNR...</p>';
  try {
    tdrData = await Service.getTdrEligibility(pnr);
    renderTdrForm();
  } catch (err) {
    tdrData = null;
    box.innerHTML = `<p class="tdr-error">${escapeHtml(err?.status === 404 ? 'No booking found for this PNR.' : err?.status === 403 ? 'This PNR belongs to another account.' : (err?.message || 'The PNR could not be checked.'))}</p>`;
    document.getElementById('tdr-submit').disabled = true;
  }
};

function tdrSelectedNos() {
  return Array.from(document.querySelectorAll('#tdr-dynamic input[name="tdr-pax"]:checked')).map(i => Number(i.value));
}

/** For the chosen passengers (or all, if none is ticked yet): can this reason be used, and if not, why in one line. */
function tdrReasonState(reasonCode) {
  const nos = tdrSelectedNos();
  const group = tdrData.passengers.filter(p => nos.length ? nos.includes(p.passengerNo) : true);
  const states = group.map(p => ({ p, r: p.reasons.find(x => x.code === reasonCode) }));
  const bad = states.filter(x => !x.r || !x.r.eligible);
  if (nos.length) return bad.length ? { ok: false, why: bad.map(x => `${x.p.name}: ${x.r ? x.r.why : 'not available'}`).join(' ') } : { ok: true };
  return bad.length === states.length ? { ok: false, why: bad[0] && bad[0].r ? (states.length > 1 ? 'Not available for any passenger of this PNR. ' : '') + bad[0].r.why : 'Not available.' } : { ok: true };
}

function renderTdrForm() {
  const d = tdrData;
  const box = document.getElementById('tdr-dynamic');
  const prevReason = (document.querySelector('#tdr-dynamic input[name="tdr-reason"]:checked') || {}).value;
  const prevNos = tdrSelectedNos();
  const delayText = d.delayMinutes > 0 ? `<strong>${d.delayMinutes} minutes late</strong>${d.delayMinutes >= 180 ? ' (3 hours or more)' : ' (less than 3 hours)'}` : '<strong>on time</strong>';
  box.innerHTML = `
    <div class="tdr-train-box">
      <div><strong>${escapeHtml(d.trainNumber)} ${escapeHtml(d.trainName)}</strong> · ${escapeHtml(d.from)} to ${escapeHtml(d.to)} · ${formatDate(d.journeyDate)}</div>
      <div>The train is ${delayText}. ${d.departed ? 'It has left the boarding station.' : 'It has not left the boarding station yet.'}</div>
    </div>
    <fieldset class="tdr-fieldset"><legend>Passengers</legend>
      ${d.passengers.map(p => `
        <label class="tdr-pax">
          <input type="checkbox" name="tdr-pax" value="${p.passengerNo}" ${prevNos.includes(p.passengerNo) ? 'checked' : ''}>
          <span><strong>${escapeHtml(p.name)}</strong> <span class="pax-meta" style="display:inline;">(passenger ${p.passengerNo}, ${escapeHtml(p.age)} yrs, ${escapeHtml(String(p.gender).toLowerCase())}) · ticket: ${escapeHtml(String(p.reservationStatus).replace(/_/g, ' '))}</span></span>
        </label>`).join('')}
    </fieldset>
    <fieldset class="tdr-fieldset"><legend>Reason</legend>
      ${d.reasons.map(r => {
        const st = tdrReasonState(r.code);
        return `
        <label class="tdr-reason-opt ${st.ok ? '' : 'disabled'}">
          <input type="radio" name="tdr-reason" value="${r.code}" ${st.ok ? '' : 'disabled'} ${st.ok && prevReason === r.code ? 'checked' : ''} data-evidence="${r.evidenceRequired ? 1 : 0}">
          <span><strong>${escapeHtml(r.label)}</strong>
            <span class="pax-meta">${st.ok ? escapeHtml(r.description) + (r.refundPct < 100 ? ` Refund: ${r.refundPct}% of the fare.` : '') : 'Not available: ' + escapeHtml(st.why)}</span>
          </span>
        </label>`;
      }).join('')}
    </fieldset>
    <div class="form-group" id="tdr-evidence-row" hidden>
      <label class="form-label" for="tdr-evidence">Evidence reference *</label>
      <input type="text" class="form-input" id="tdr-evidence" placeholder="e.g. TTE certificate number or station memo" />
    </div>`;
  box.querySelectorAll('input').forEach(i => i.addEventListener('change', onTdrChange));
  onTdrChange({ target: { name: 'init' } });
}

function onTdrChange(e) {
  // Changing the passengers changes which reasons are usable
  if (e && e.target && e.target.name === 'tdr-pax') { renderTdrForm(); return; }
  const reason = document.querySelector('#tdr-dynamic input[name="tdr-reason"]:checked');
  const needsEvidence = reason && reason.dataset.evidence === '1';
  const evRow = document.getElementById('tdr-evidence-row');
  if (evRow) evRow.hidden = !needsEvidence;
  document.getElementById('tdr-submit').disabled = !(reason && tdrSelectedNos().length > 0);
}

window.submitTDR = async (e) => {
  e.preventDefault();
  const errBox = document.getElementById('tdr-error');
  errBox.hidden = true;
  if (!tdrData) { errBox.textContent = 'Check the PNR first.'; errBox.hidden = false; return; }
  const reason = (document.querySelector('#tdr-dynamic input[name="tdr-reason"]:checked') || {}).value;
  const passengerNos = tdrSelectedNos();
  const evidenceReference = document.getElementById('tdr-evidence')?.value?.trim() || null;
  if (!passengerNos.length) { errBox.textContent = 'Tick at least one passenger.'; errBox.hidden = false; return; }
  if (!reason) { errBox.textContent = 'Choose a reason.'; errBox.hidden = false; return; }
  if (document.querySelector('#tdr-dynamic input[name="tdr-reason"]:checked').dataset.evidence === '1' && !evidenceReference) {
    errBox.textContent = 'This reason needs an evidence reference.'; errBox.hidden = false; return;
  }

  showLoading('Submitting TDR request...');
  try {
    const result = await Service.fileTDR({ pnr: tdrData.pnr, reason, passengerNos, evidenceReference });
    hideLoading();
    closeModal('modal-file-tdr');
    const refDisplay = result.tdrRefNo || (result.tdrRefNos ? result.tdrRefNos.join(', ') : 'Filed');
    showToast(`TDR filed. Reference: ${refDisplay}`, 'success');
    renderTDRPage();
  } catch (err) {
    hideLoading();
    // The server's message already says exactly why (passenger, reason, delay or deadline)
    errBox.textContent = err?.message || 'The TDR could not be filed.';
    errBox.hidden = false;
    try { tdrData = await Service.getTdrEligibility(tdrData.pnr); renderTdrForm(); } catch (_) { /* keep the old view */ }
  }
};

// ════════════════════════════════════════════════════════════════ GRIEVANCES

async function renderGrievancesPage() {
  const container = document.getElementById('grievances-list');
  try {
    const grievances = await Service.getUserGrievances(State.user.userId);

    if (!grievances.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">📝</div><div class="empty-title">No grievances filed</div><div class="empty-sub">Report issues for quick resolution</div></div>`;
      return;
    }

    container.innerHTML = grievances.map(g => `
      <div class="grievance-card">
        <div class="grievance-header">
          <span class="grievance-category">${g.category.replace(/_/g, ' ')}</span>
          <div style="display:flex;align-items:center;gap:10px;">
            <span class="status-badge ${g.status}">${g.status.replace('_', ' ')}</span>
            <span style="font-size:12px;color:var(--clr-text-3);">${timeAgo(g.createdAt)}</span>
          </div>
        </div>
        <div class="grievance-subject">${g.subject}</div>
        <div class="grievance-desc">${g.description}</div>
        ${g.response ? `
          <div class="grievance-response">
            <strong>Official Response:</strong>
            ${g.response}
          </div>` : ''}
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load grievances:', err);
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title" style="color:var(--clr-danger, #ef4444);">Failed to load grievances</div><div class="empty-sub" style="color:var(--clr-danger, #ef4444);">${err?.message || 'Please refresh'}</div></div>`;
  }
}

window.openFileGrievanceModal = () => openModal('modal-file-grievance');

window.submitGrievance = async (e) => {
  e.preventDefault();
  showLoading('Filing complaint...');
  try {
    await Service.fileGrievance({
      userId: State.user.userId,
      category: document.getElementById('griev-category').value,
      subject: document.getElementById('griev-subject').value.trim(),
      description: document.getElementById('griev-desc').value.trim()
    });
    hideLoading();
    closeModal('modal-file-grievance');
    showToast('Complaint filed successfully!', 'success');
    renderGrievancesPage();
    e.target.reset();
  } catch (err) {
    console.error('Failed to file complaint:', err);
    hideLoading();
    showToast(err?.message || 'Failed to file complaint', 'error');
  }
};

// ════════════════════════════════════════════════════════════════ ALERTS

function renderAlertsPage() {
  const container = document.getElementById('alerts-list');
  try {
    if (!State.notifications.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔔</div><div class="empty-title">No notifications</div><div class="empty-sub">You're all caught up!</div></div>`;
      return;
    }

    // notificationId is a text id from the server, so it must be quoted inside onclick
    container.innerHTML = State.notifications.map(n => `
      <div class="alert-item ${escapeHtml(n.type)} ${n.isRead ? '' : 'unread'}" id="alert-${escapeHtml(n.notificationId)}">
        <div class="alert-icon">${getAlertIcon(n.type)}</div>
        <div class="alert-content">
          <div class="alert-title">${escapeHtml(n.title)}</div>
          <div class="alert-msg">${escapeHtml(n.message)}</div>
          <div class="alert-time">${timeAgo(n.createdAt)}</div>
        </div>
        ${!n.isRead ? `
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;">
            <div class="unread-dot"></div>
            <button class="btn-secondary-sm" data-notification-id="${escapeHtml(n.notificationId)}" onclick="markRead(this.dataset.notificationId)">Mark Read</button>
          </div>` : ''}
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to render alerts:', err);
    if (container) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title" style="color:var(--clr-danger, #ef4444);">Failed to load alerts</div><div class="empty-sub" style="color:var(--clr-danger, #ef4444);">${err?.message || 'Error'}</div></div>`;
    }
  }
}

window.markRead = async (id) => {
  try {
    await Service.markNotificationRead(id);
  } catch (err) {
    showToast(err?.message || 'Could not mark the notification as read.', 'error');
    return;
  }
  const notif = State.notifications.find(n => String(n.notificationId) === String(id));
  if (notif) notif.isRead = true;
  renderAlertsPage();
  renderHomeAlerts();
  renderHomeStats();
  updateNotifBadge();
};

window.markAllRead = async () => {
  const unread = State.notifications.filter(notification => !notification.isRead);
  if (!unread.length) {
    showToast('No unread notifications', 'info');
    return;
  }
  // Mark only the ones the server accepted, so the unread count stays correct if one fails
  const results = await Promise.allSettled(unread.map(n => Service.markNotificationRead(n.notificationId)));
  let failed = 0;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') unread[i].isRead = true;
    else failed++;
  });
  renderAlertsPage();
  renderHomeAlerts();
  renderHomeStats();
  updateNotifBadge();
  if (failed) showToast(`${failed} notification(s) could not be marked as read.`, 'error');
  else showToast('All notifications marked as read', 'success');
};

// ════════════════════════════════════════════════════════════════ CANCEL BOOKING

let pendingCancelPNR = null;
let currentRefundEstimate = null;

window.openCancelModal = async (pnr) => {
  pendingCancelPNR = pnr;
  const booking = State.allBookings.find(b => b.pnr === pnr);

  const trainDisplayName = booking?.trainName || (booking?.trainNumber ? `Train ${booking.trainNumber}` : (booking?.train?.trainName || 'Train'));
  const journeyDateStr = booking?.journeyDate ? formatDate(booking.journeyDate) : '—';

  document.getElementById('cancel-booking-info').innerHTML = `
    <div style="padding:12px;background:var(--clr-surface-2);border-radius:var(--radius-md);margin-bottom:12px;">
      <div style="font-weight:700;margin-bottom:4px;">PNR: ${pnr}</div>
      <div style="font-size:13px;color:var(--clr-text-2);">${trainDisplayName} | ${journeyDateStr}</div>
    </div>
  `;

  document.getElementById('cancel-charge').textContent = 'Calculating...';
  document.getElementById('cancel-refund').textContent = 'Calculating...';
  const paxContainer = document.getElementById('cancel-passengers-container');
  if (paxContainer) {
    paxContainer.innerHTML = '<div style="font-size:12px;color:var(--clr-text-3);">Fetching authoritative refund estimate from server...</div>';
  }

  const confirmBtn = document.getElementById('btn-confirm-cancel');
  if (confirmBtn) confirmBtn.disabled = true;

  openModal('modal-cancel-booking');

  try {
    // 1. Fetch real server refund estimate
    const estimate = await Service.getRefundEstimate(pnr);
    currentRefundEstimate = estimate;

    document.getElementById('cancel-charge').textContent = formatMoney(estimate.totalCancellationCharge);
    document.getElementById('cancel-refund').textContent = formatMoney(estimate.totalRefundAmount);

    // Render individual passenger selection
    if (paxContainer && Array.isArray(estimate.passengers) && estimate.passengers.length > 0) {
      paxContainer.innerHTML = `
        <div style="margin-top:8px;">
          <div style="font-size:12px;font-weight:600;margin-bottom:6px;color:var(--clr-text-2);">Select Passengers to Cancel:</div>
          ${estimate.passengers.map(p => `
            <label style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--clr-border);font-size:13px;cursor:pointer;">
              <div style="display:flex;align-items:center;gap:8px;">
                <input type="checkbox" class="cancel-pax-chk" value="${p.passengerNo}" checked onchange="recalculateSelectedCancellationRefund()" />
                <span><strong>#${p.passengerNo}</strong> ${p.name}</span>
              </div>
              <span style="color:var(--clr-text-3);">Refund: ${formatMoney(p.refundAmount)}</span>
            </label>
          `).join('')}
        </div>
      `;
    } else if (paxContainer) {
      paxContainer.innerHTML = '';
    }

    if (confirmBtn) confirmBtn.disabled = false;
  } catch (err) {
    console.error('Cancel modal estimate error:', err);
    document.getElementById('cancel-charge').textContent = '—';
    document.getElementById('cancel-refund').textContent = '—';
    if (paxContainer) {
      paxContainer.innerHTML = `<div style="font-size:12px;color:var(--clr-danger);">${err?.message || 'Failed to estimate refund'}</div>`;
    }
    showToast(err?.message || 'Could not fetch refund estimate', 'error');
  }
};

window.recalculateSelectedCancellationRefund = async () => {
  if (!pendingCancelPNR || !currentRefundEstimate) return;
  const checkboxes = Array.from(document.querySelectorAll('.cancel-pax-chk:checked'));
  const selectedNos = checkboxes.map(cb => parseInt(cb.value, 10));

  if (selectedNos.length === 0) {
    document.getElementById('cancel-charge').textContent = formatMoney(0);
    document.getElementById('cancel-refund').textContent = formatMoney(0);
    const confirmBtn = document.getElementById('btn-confirm-cancel');
    if (confirmBtn) confirmBtn.disabled = true;
    return;
  }

  try {
    const freshEstimate = await Service.getRefundEstimate(pendingCancelPNR, selectedNos);
    document.getElementById('cancel-charge').textContent = formatMoney(freshEstimate.totalCancellationCharge);
    document.getElementById('cancel-refund').textContent = formatMoney(freshEstimate.totalRefundAmount);
    const confirmBtn = document.getElementById('btn-confirm-cancel');
    if (confirmBtn) confirmBtn.disabled = false;
  } catch (err) {
    console.error('Recalculate refund error:', err);
    showToast('Failed to update refund estimate for selection', 'warning');
  }
};

// Say "processed" only when the server says the refund really is PROCESSED. PENDING or FAILED (retried later) = "being processed".
function cancelRefundMessage(result) {
  const amount = Number(result.refundAmount || 0);
  if (!(amount > 0)) return 'Cancellation successful. No refund is due for this cancellation.';
  const gw = result.gatewayRefund;
  const rowStatus = result.refund && result.refund.status;
  const done = (gw === 'PROCESSED' || gw === 'SKIPPED') && rowStatus === 'PROCESSED';
  return done
    ? `Cancellation successful! Refund of ${formatMoney(amount)} processed.`
    : `Cancellation successful! Refund of ${formatMoney(amount)} is being processed.`;
}

window.confirmCancellation = async () => {
  if (!pendingCancelPNR) return;

  const checkboxes = Array.from(document.querySelectorAll('.cancel-pax-chk:checked'));
  const selectedNos = checkboxes.length > 0 ? checkboxes.map(cb => parseInt(cb.value, 10)) : null;

  const confirmBtn = document.getElementById('btn-confirm-cancel');
  if (confirmBtn) confirmBtn.disabled = true;

  showLoading('Processing cancellation with railway server...');
  try {
    const result = await Service.cancelBooking(pendingCancelPNR, selectedNos);
    hideLoading();
    closeModal('modal-cancel-booking');
    showToast(cancelRefundMessage(result), 'success');

    // Reload bookings to reflect updated statuses
    const updatedBookings = await Service.getUserBookings();
    State.allBookings = Array.isArray(updatedBookings) ? updatedBookings : [];
    pendingCancelPNR = null;
    currentRefundEstimate = null;

    renderBookingsPage();
    updateBookingBadge();
  } catch (err) {
    console.error('Cancellation error:', err);
    hideLoading();
    if (confirmBtn) confirmBtn.disabled = false;
    showToast(err?.message || 'Cancellation failed. Please try again.', 'error');
  }
};

// ════════════════════════════════════════════════════════════════ MODAL HELPERS

window.openModal = (id) => {
  document.getElementById(id)?.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
};

window.closeModal = (id) => {
  document.getElementById(id)?.classList.add('hidden');
  document.body.style.overflow = '';
};

// Close on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.classList.add('hidden');
      document.body.style.overflow = '';
    }
  });
});

// ════════════════════════════════════════════════════════════════ TOAST

window.showToast = (msg, type = 'success') => {
  const toast = document.getElementById('toast');
  const icon = document.getElementById('toast-icon');
  const message = document.getElementById('toast-message');

  const icons = { success: '✓', error: '✕', warning: '⚠' };
  icon.textContent = icons[type] || '✓';
  message.textContent = msg;

  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');

  setTimeout(() => toast.classList.add('hidden'), 4000);
};

function showLoading(text = 'Loading...') {
  document.getElementById('loading-text').textContent = text;
  document.getElementById('loading-overlay').classList.remove('hidden');
}

function hideLoading() {
  document.getElementById('loading-overlay').classList.add('hidden');
}

// ════════════════════════════════════════════════════════════════ UTILITIES

function formatDate(dateStr) {
  if (!dateStr) return '—';
  if (typeof Service !== 'undefined' && Service.formatIndiaDateTime) {
    return Service.formatIndiaDateTime(dateStr);
  }
  const str = String(dateStr).trim();
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!match) return str;
  const [, year, month, day, hour, min] = match;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = months[parseInt(month, 10) - 1] || month;
  const dayNum = parseInt(day, 10);
  if (hour !== undefined && min !== undefined) {
    return `${dayNum} ${monthName} ${year}, ${hour}:${min}`;
  }
  return `${dayNum} ${monthName} ${year}`;
}

function formatMoney(amount) {
  if (typeof Service !== 'undefined' && Service.formatCurrency) {
    return Service.formatCurrency(amount);
  }
  if (amount === null || amount === undefined || amount === '') return '₹0.00';
  const num = Number(amount);
  if (isNaN(num)) return '₹0.00';
  return '₹' + num.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// Escapes text before it is placed into HTML (names and messages come from the server or the user)
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  // Server times are India-time strings "YYYY-MM-DD HH:MM:SS" (no Z); the space is turned into T so every browser parses them
  const diff = Date.now() - new Date(String(dateStr).replace(' ', 'T')).getTime();
  const d = Math.floor(diff / 86400000);
  const h = Math.floor(diff / 3600000);
  const m = Math.floor(diff / 60000);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return 'Just now';
}

function getInitials(name) {
  return (name || '??').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function getAlertIcon(type) {
  const icons = {
    BOOKING_CONFIRMATION: '🎫', DELAY: '⏱️', STATUS_UPDATE: '📊',
    EMERGENCY: '🚨', CANCELLATION: '❌'
  };
  return icons[type] || '🔔';
}

function getFareForClass(classType) {
  const fares = { '1A': 4200, '2A': 2750, '3A': 1850, 'SL': 650, 'CC': 1200, 'EC': 2100, '2S': 280 };
  return fares[classType] || 1000;
}

function getScheduleTime(train, type) {
  // Mock times based on train type
  const times = {
    RAJDHANI: { departure: '17:00', arrival: '08:32' },
    SHATABDI: { departure: '06:00', arrival: '13:30' },
    VANDE_BHARAT: { departure: '06:00', arrival: '14:00' },
    EXPRESS: { departure: '20:00', arrival: '09:45' }
  };
  return times[train?.trainType]?.[type] || '—:—';
}

function getDuration(train) {
  const durations = {
    RAJDHANI: '15h 32m', SHATABDI: '7h 30m',
    VANDE_BHARAT: '8h 00m', EXPRESS: '13h 45m'
  };
  return durations[train?.trainType] || 'N/A';
}
