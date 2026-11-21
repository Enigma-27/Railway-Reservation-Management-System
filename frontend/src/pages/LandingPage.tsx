import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Armchair, CalendarSearch, CreditCard, Gauge, Radio, Search, ShieldCheck, Ticket, Train, UserRound, Wrench } from 'lucide-react';
import { PublicLayout } from '../components/PublicLayout';
import { SignInCard } from '../components/SignInCard';
import { PnrQuickCheck } from '../components/PnrQuickCheck';
import { useAuth } from '../admin/auth/AuthContext';
import { HOME_PATH, Role } from '../auth/session';
import { LiveStats, PENDING_SEARCH_KEY, PendingSearch, Station, liveStats, publicApi, todayIso } from '../services/publicApi';
import { Select } from '../ui/Select';
import { DatePicker } from '../ui/DatePicker';
import { CountUp, Reveal, Typed } from '../ui/motion';
import { Skeleton } from '../ui/Skeleton';
import { useContact } from '../ui/ContactDrawer';

const CLASSES = [
  { value: '', label: 'All classes' },
  { value: '1A', label: 'AC First (1A)' },
  { value: '2A', label: 'AC 2 Tier (2A)' },
  { value: '3A', label: 'AC 3 Tier (3A)' },
  { value: 'SL', label: 'Sleeper (SL)' },
  { value: 'CC', label: 'Chair Car (CC)' },
  { value: 'EC', label: 'Executive Chair (EC)' },
];
const TYPED_WORDS = ['Easy', 'Reliable', 'Live', 'Simple'];

const STEPS = [
  { icon: CalendarSearch, title: 'Search', text: 'Pick stations, a date and a class.' },
  { icon: Armchair, title: 'Choose seats', text: 'See live seats, RAC and waiting list.' },
  { icon: CreditCard, title: 'Pay', text: 'Secure payment, ticket in seconds.' },
  { icon: Train, title: 'Travel', text: 'Track the train and show your PNR.' },
];

/**
 * "/" : the landing page, the first page anyone sees.
 * Header, hero (typed headline, train search, ONE sign-in card), stat strip from real Live Trains data, three big cards
 * (Book a ticket, Live Trains, PNR status), "how it works", a short section for passengers / station staff / admins, footer.
 * A search goes straight into the booking flow; a signed-out visitor is asked to sign in as Passenger first and continues where
 * they left off (the search is kept in sessionStorage and picked up by the passenger area).
 */
export default function LandingPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const contact = useContact();
  const searchRef = useRef<HTMLFormElement>(null);
  const [role, setRole] = useState<Role>('PASSENGER');
  const [notice, setNotice] = useState<string | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [stationError, setStationError] = useState(false);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [classType, setClassType] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [statsError, setStatsError] = useState(false);

  // Coming from Live Trains "Book this train" while signed out: ask for the passenger sign-in
  useEffect(() => {
    if ((location.state as { signInForBooking?: boolean } | null)?.signInForBooking && !session) {
      setRole('PASSENGER');
      setNotice('Sign in as a Passenger to book this train. Your choice (train, date and class) opens right after you sign in.');
    }
  }, [location.state, session]);

  useEffect(() => {
    if (location.hash === '#signin') document.getElementById('signin')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [location.hash]);

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
    liveStats().then((s) => live && setStats(s)).catch(() => live && setStatsError(true));
    return () => { live = false; };
  }, []);

  const stationOptions = useMemo(() => stations.map((s) => ({ value: String(s.stationId), label: `${s.stationCode} - ${s.stationName}` })), [stations]);

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!fromId || !toId) return setFormError('Please choose both stations.');
    if (fromId === toId) return setFormError('From and To stations must be different.');
    if (!date) return setFormError('Please choose a journey date.');
    const pending: PendingSearch = { fromId: Number(fromId), toId: Number(toId), date, classType };
    try { sessionStorage.setItem(PENDING_SEARCH_KEY, JSON.stringify(pending)); } catch { /* storage off: search is not kept */ }

    if (session && session.role === 'PASSENGER') {
      navigate('/passenger/book');
    } else if (session) {
      setNotice('Booking is for passenger accounts. Sign out, then sign in as Passenger to book.');
    } else {
      setRole('PASSENGER');
      setNotice('Sign in as a Passenger to continue with your search. It will open right after you sign in.');
      document.getElementById('signin')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const startBooking = () => {
    if (session?.role === 'PASSENGER') navigate('/passenger/book');
    else searchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const pickRole = (r: Role) => {
    setRole(r);
    setNotice(null);
    document.getElementById('signin')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <PublicLayout title="Fast & easy train bookings">
      <main id="main">
        <section className="land-hero" aria-labelledby="land-h1">
          <div className="land-grid">
            <div className="land-copy">
              <span className="land-kicker t-label"><span className="rrms-dot rrms-dot-live" aria-hidden="true" /> Railway Reservation &amp; Management System</span>
              <h1 id="land-h1" className="t-display">Fast &amp; <Typed words={TYPED_WORDS} /><br />Train Bookings</h1>
              <p>Search schedules, book seats, follow live trains and manage your journey, all in one place.</p>

              <form className="land-search rrms-glass" onSubmit={search} aria-label="Search trains" ref={searchRef} id="search">
                <div className="land-search-grid">
                  <Select label="From" value={fromId} onChange={setFromId} options={stationOptions} disabled={stationError} placeholder="From station" />
                  <Select label="To" value={toId} onChange={setToId} options={stationOptions} disabled={stationError} placeholder="To station" />
                </div>
                <div className="land-search-row2">
                  <DatePicker label="Date" value={date} onChange={setDate} min={todayIso()} max={todayIso(7)} />
                  <Select label="Class" value={classType} onChange={setClassType} options={CLASSES} />
                  <button type="submit" className="rrms-btn rrms-btn-accent land-go"><Search size={16} aria-hidden="true" /> Search trains</button>
                </div>
                {stationError && <p className="rrms-alert-error" style={{ marginTop: 10 }} role="alert">Stations could not be loaded. Check that the backend is running.</p>}
                {formError && <p className="rrms-alert-error" style={{ marginTop: 10 }} role="alert">{formError}</p>}
              </form>
            </div>

            <SignInCard role={role} onRoleChange={(r) => { setRole(r); setNotice(null); }} notice={notice} />
          </div>

          <div className="land-stats" aria-label="Today on the network">
            <Stat label="Trains running today" loading={!stats && !statsError} value={stats ? <CountUp value={stats.trainsToday} /> : '-'} />
            <Stat label="Seats available" loading={!stats && !statsError} value={stats ? <CountUp value={stats.seatsAvailable} /> : '-'} />
            <Stat label="On-time" loading={!stats && !statsError} value={stats ? <CountUp value={stats.onTimePct} decimals={1} suffix="%" /> : '-'} />
            <p className="land-stats-note t-mono"><span className="rrms-dot rrms-dot-live" aria-hidden="true" /> {stats ? `Live data, database time ${stats.asOf}` : statsError ? 'Live numbers are not available right now.' : 'Loading live numbers...'}</p>
          </div>
        </section>

        <section className="land-section" aria-labelledby="land-start">
          <Reveal><h2 id="land-start" className="t-display land-h2">Where do you want to <em>start?</em></h2></Reveal>
          <div className="land-cards">
            <Reveal delay={0}>
              <button type="button" className="land-card rrms-glass rrms-hover-lift" onClick={startBooking}>
                <span className="land-card-ic"><Ticket size={22} aria-hidden="true" /></span>
                <h3>Book a ticket</h3>
                <p>Search trains, choose a class, add travellers and pay securely.</p>
                <span className="land-card-go">Start booking <ArrowRight size={16} aria-hidden="true" /></span>
              </button>
            </Reveal>
            <Reveal delay={90}>
              <Link to="/live-trains" className="land-card rrms-glass rrms-hover-lift">
                <span className="land-card-ic"><Radio size={22} aria-hidden="true" /></span>
                <h3>Live Trains <span className="live-tag"><span className="rrms-dot rrms-dot-live" aria-hidden="true" /> LIVE</span></h3>
                <p>Every run of the day with seats, RAC and waiting list, refreshed every 15 seconds.</p>
                <span className="land-card-go">Open live window <ArrowRight size={16} aria-hidden="true" /></span>
              </Link>
            </Reveal>
            <Reveal delay={180}>
              <div className="land-card rrms-glass rrms-hover-lift">
                <span className="land-card-ic"><Gauge size={22} aria-hidden="true" /></span>
                <h3>PNR status</h3>
                <p>Check where your ticket stands right now.</p>
                <PnrQuickCheck compact />
              </div>
            </Reveal>
          </div>
        </section>

        <section className="land-section" aria-labelledby="land-how">
          <Reveal><h2 id="land-how" className="t-display land-h2">How it <em>works</em></h2></Reveal>
          <div className="land-route" aria-hidden="true">
            <div className="land-route-line" />
            <span className="land-route-train"><Train size={20} /></span>
          </div>
          <ol className="land-steps">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <Reveal delay={i * 90}>
                  <div className="land-step">
                    <span className="land-step-no t-mono">0{i + 1}</span>
                    <span className="land-step-ic"><s.icon size={20} aria-hidden="true" /></span>
                    <h3>{s.title}</h3>
                    <p>{s.text}</p>
                  </div>
                </Reveal>
              </li>
            ))}
          </ol>
        </section>

        <section className="land-section" aria-labelledby="land-roles">
          <Reveal><h2 id="land-roles" className="t-display land-h2">One system, <em>three portals</em></h2></Reveal>
          <div className="land-roles">
            <Reveal><RoleCard role="PASSENGER" icon={UserRound} title="For passengers" text="Book and cancel tickets, resume payments, file a TDR, keep saved travellers and follow live trains." onPick={pickRole} /></Reveal>
            <Reveal delay={90}><RoleCard role="STAFF" icon={Wrench} title="For station staff" text="Passenger chart, PNR and ID scanner, vacancies and RAC, penalties, delays and platform changes." onPick={pickRole} /></Reveal>
            <Reveal delay={180}><RoleCard role="ADMIN" icon={ShieldCheck} title="For admins" text="Trains, routes, fares, quotas, refunds, reports and the audit trail in one console." onPick={pickRole} /></Reveal>
          </div>
          <p className="land-help">Need help? <button type="button" className="signin-link" onClick={contact.open}>Contact us</button>{session && <> or <Link className="signin-link" to={HOME_PATH[session.role]}>go to your portal</Link></>}</p>
        </section>
      </main>
    </PublicLayout>
  );
}

const Stat: React.FC<{ label: string; value: React.ReactNode; loading: boolean }> = ({ label, value, loading }) => (
  <div className="land-stat">
    {loading ? <Skeleton w={90} h={34} /> : <strong className="t-display">{value}</strong>}
    <span className="t-label">{label}</span>
  </div>
);

const RoleCard: React.FC<{ role: Role; icon: React.ElementType; title: string; text: string; onPick: (r: Role) => void }> = ({ role, icon: Icon, title, text, onPick }) => (
  <div className={`land-role rrms-glass role-${role.toLowerCase()}`}>
    <span className="land-card-ic"><Icon size={22} aria-hidden="true" /></span>
    <h3>{title}</h3>
    <p>{text}</p>
    <button type="button" className="rrms-btn rrms-btn-secondary" onClick={() => onPick(role)}>Sign in as {role === 'PASSENGER' ? 'passenger' : role === 'STAFF' ? 'staff' : 'admin'} <ArrowRight size={15} aria-hidden="true" /></button>
  </div>
);
