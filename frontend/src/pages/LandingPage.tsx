import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { PublicLayout } from '../components/PublicLayout';
import { SignInCard } from '../components/SignInCard';
import { useAuth } from '../admin/auth/AuthContext';
import { HOME_PATH, Role } from '../auth/session';
import { PENDING_SEARCH_KEY, PendingSearch, Station, publicApi, todayIso } from '../services/publicApi';

const CLASSES = [
  { value: '', label: 'All classes' },
  { value: '1A', label: 'AC First (1A)' },
  { value: '2A', label: 'AC 2 Tier (2A)' },
  { value: '3A', label: 'AC 3 Tier (3A)' },
  { value: 'SL', label: 'Sleeper (SL)' },
  { value: 'CC', label: 'Chair Car (CC)' },
  { value: 'EC', label: 'Executive Chair (EC)' },
];

/**
 * "/" : the landing page, the first page anyone sees.
 * Header (logo + name, Home, Train Info), alerts strip, hero with the train search, and ONE sign-in card.
 * A search goes straight into the booking flow; a signed-out visitor is asked to sign in as Passenger first
 * and continues where they left off (the search is kept in sessionStorage and picked up by the passenger area).
 */
export default function LandingPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [role, setRole] = useState<Role>('PASSENGER');
  const [notice, setNotice] = useState<string | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [stationError, setStationError] = useState(false);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [classType, setClassType] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // Coming from Live Trains "Book this train" while signed out: ask for the passenger sign-in
  useEffect(() => {
    if ((location.state as { signInForBooking?: boolean } | null)?.signInForBooking && !session) {
      setRole('PASSENGER');
      setNotice('Sign in as a Passenger to book this train. Your choice (train, date and class) opens right after you sign in.');
    }
  }, [location.state, session]);

  useEffect(() => {
    let live = true;
    publicApi.stations().then((s) => {
      if (!live) return;
      setStations(s);
      const bct = s.find((x) => x.stationCode === 'BCT');
      const ndls = s.find((x) => x.stationCode === 'NDLS');
      if (bct) setFromId(String(bct.stationId));
      if (ndls) setToId(String(ndls.stationId));
    }).catch(() => live && setStationError(true));
    return () => { live = false; };
  }, []);

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!fromId || !toId) return setFormError('Please choose both stations.');
    if (fromId === toId) return setFormError('From and To stations must be different.');
    if (!date) return setFormError('Please choose a journey date.');
    const pending: PendingSearch = { fromId: Number(fromId), toId: Number(toId), date, classType };
    try { sessionStorage.setItem(PENDING_SEARCH_KEY, JSON.stringify(pending)); } catch { /* storage off: search is not kept */ }

    if (session && session.role === 'PASSENGER') {
      navigate(HOME_PATH.PASSENGER);
    } else if (session) {
      setNotice('Booking is for passenger accounts. Sign out, then sign in as Passenger to book.');
    } else {
      setRole('PASSENGER');
      setNotice('Sign in as a Passenger to continue with your search. It will open right after you sign in.');
    }
  };

  return (
    <PublicLayout>
      <main className="land-hero">
        <div className="land-grid">
          <div className="land-copy">
            <span className="land-kicker">Railway Reservation &amp; Management System</span>
            <h1>Fast &amp; Easy<br />Train Bookings</h1>
            <p>Search schedules, book seats, and manage your journey, all in one place.</p>

            <form className="land-search" onSubmit={search} aria-label="Search trains">
              <h2>Search trains</h2>
              <div className="land-search-grid">
                <label className="rrms-field">From
                  <select className="rrms-select" value={fromId} onChange={(e) => setFromId(e.target.value)} disabled={stationError}>
                    {stations.map((s) => <option key={s.stationId} value={s.stationId}>{s.stationCode} - {s.stationName}</option>)}
                  </select>
                </label>
                <label className="rrms-field">To
                  <select className="rrms-select" value={toId} onChange={(e) => setToId(e.target.value)} disabled={stationError}>
                    {stations.map((s) => <option key={s.stationId} value={s.stationId}>{s.stationCode} - {s.stationName}</option>)}
                  </select>
                </label>
              </div>
              <div className="land-search-row2">
                <label className="rrms-field">Date
                  <input className="rrms-input" type="date" value={date} min={todayIso()} max={todayIso(7)} onChange={(e) => setDate(e.target.value)} />
                </label>
                <label className="rrms-field">Class
                  <select className="rrms-select" value={classType} onChange={(e) => setClassType(e.target.value)}>
                    {CLASSES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </label>
                <button type="submit" className="rrms-btn rrms-btn-primary"><Search size={16} aria-hidden="true" /> Search</button>
              </div>
              {stationError && <p className="rrms-alert-error" style={{ marginTop: 10 }} role="alert">Stations could not be loaded. Check that the backend is running.</p>}
              {formError && <p className="rrms-alert-error" style={{ marginTop: 10 }} role="alert">{formError}</p>}
            </form>
          </div>

          <SignInCard role={role} onRoleChange={(r) => { setRole(r); setNotice(null); }} notice={notice} />
        </div>
      </main>
    </PublicLayout>
  );
}
