import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, X } from 'lucide-react';
import { PublicLayout } from '../components/PublicLayout';
import { useAuth } from '../admin/auth/AuthContext';
import { HOME_PATH } from '../auth/session';
import {
  LiveClass, LiveTrain, PENDING_SEARCH_KEY, PendingSearch, Station, publicApi,
} from '../services/publicApi';

const REFRESH_MS = 15000;
const PAGE_SIZE = 25;

const RUN_LABEL: Record<string, string> = {
  NOT_STARTED: 'Not started', RUNNING: 'Running', DELAYED: 'Delayed', COMPLETED: 'Completed', CANCELLED: 'Cancelled',
};
const RUN_BADGE: Record<string, string> = {
  NOT_STARTED: 'rrms-badge-info', RUNNING: 'rrms-badge-success', DELAYED: 'rrms-badge-warning',
  COMPLETED: 'rrms-badge-info', CANCELLED: 'rrms-badge-danger',
};
const SEAT_BADGE: Record<string, string> = {
  AVAILABLE: 'rrms-badge-success', RAC: 'rrms-badge-warning', WL: 'rrms-badge-warning', 'NOT AVAILABLE': 'rrms-badge-danger',
};
const TYPES = ['RAJDHANI', 'SHATABDI', 'DURONTO'];
const CLASS_CODES = ['1A', '2A', '3A', 'SL', 'CC', 'EC', '2S'];

/** Short chip text for a class in the list: "12 AVL", "RAC 4/10", "WL 7/24" or "Full" with the RAC and WL counts. */
function classChip(c: LiveClass): string {
  // When people are already on the RAC or waiting list, show those counts next to the free seats
  const queue = c.racCount > 0 || c.waitingListCount > 0 ? ` · RAC ${c.racCount}/${c.racCapacity} · WL ${c.waitingListCount}/${c.waitingListCapacity}` : '';
  if (c.status === 'AVAILABLE') return `${c.availableSeats} AVL${queue}`;
  if (c.status === 'RAC') return `RAC ${c.racCount}/${c.racCapacity}`;
  if (c.status === 'WL') return `WL ${c.waitingListCount}/${c.waitingListCapacity}`;
  return `Full (RAC ${c.racCount}, WL ${c.waitingListCount})`;
}

function fmtClock(d: Date | null): string {
  return d ? d.toLocaleTimeString('en-GB') : '-';
}

function OccupancyBar({ pct, label }: { pct: number; label: string }) {
  const safe = Math.max(0, Math.min(100, pct));
  return (
    <div className="live-bar" role="img" aria-label={`${label}: ${safe}% of seats booked`}>
      <div className="live-bar-fill" style={{ width: `${safe}%` }} />
    </div>
  );
}

function DetailPanel({ run, onClose, onBook, canSeeStaff }: { run: LiveTrain; onClose: () => void; onBook: (run: LiveTrain, classCode: string) => void; canSeeStaff: boolean }) {
  const [openClass, setOpenClass] = useState<string | null>(null);
  return (
    <aside className="live-detail rrms-card" aria-label={`Seat details for ${run.trainName}`}>
      <div className="live-detail-head">
        <div>
          <h2>{run.trainNumber} {run.trainName}</h2>
          <p className="live-sub">
            {run.origin.name} ({run.origin.code}) {run.origin.departureTime} to {run.destination.name} ({run.destination.code}) {run.destination.arrivalTime}
            {run.destination.dayOffset > 0 ? ` (+${run.destination.dayOffset} day)` : ''} on {run.journeyDate}
          </p>
          <p>
            <span className={`rrms-badge ${RUN_BADGE[run.runStatus]}`}>{RUN_LABEL[run.runStatus]}</span>{' '}
            {run.delayMinutes > 0 && <span className="live-delay">{run.delayMinutes} min late</span>}
            {run.fareFor && <span className="live-sub"> Fares for {run.fareFor.from} to {run.fareFor.to} ({run.fareFor.distanceKm} km), per passenger with insurance, no concession.</span>}
          </p>
        </div>
        <button type="button" className="rrms-btn rrms-btn-secondary" onClick={onClose} aria-label="Close details"><X size={16} aria-hidden="true" /> Close</button>
      </div>

      {run.classes.map((c) => {
        const pct = c.totalSeats ? Math.round((c.bookedSeats / c.totalSeats) * 1000) / 10 : 0;
        const open = openClass === c.classCode;
        return (
          <section key={c.classCode} className="live-class" aria-label={`Class ${c.classCode}`}>
            <div className="live-class-head">
              <strong>{c.classCode}</strong> <span className="live-sub">{c.className}</span>
              <span className={`rrms-badge ${SEAT_BADGE[c.status]}`}>{c.status}</span>
              <span className="live-fare">{c.fare ? `Rs ${c.fare.toFixed(2)}` : ''}</span>
            </div>
            <OccupancyBar pct={pct} label={`${c.classCode} occupancy`} />
            <dl className="live-nums">
              <div><dt>Total seats</dt><dd>{c.totalSeats}</dd></div>
              <div><dt>Available</dt><dd>{c.availableSeats}</dd></div>
              <div><dt>Confirmed (booked)</dt><dd>{c.bookedSeats}</dd></div>
              <div><dt>RAC</dt><dd>{c.racCount} / {c.racCapacity}</dd></div>
              <div><dt>Waiting list</dt><dd>{c.waitingListCount} / {c.waitingListCapacity}</dd></div>
              {canSeeStaff && <div><dt>Occupancy</dt><dd>{pct}%</dd></div>}
            </dl>
            <div className="live-actions">
              <button type="button" className="rrms-btn rrms-btn-secondary" onClick={() => setOpenClass(open ? null : c.classCode)} aria-expanded={open}>
                {open ? 'Hide quotas' : 'Show quotas'}
              </button>
              {run.runStatus !== 'CANCELLED' && run.runStatus !== 'COMPLETED' && !run.departed && !run.chartPrepared && (
                <button type="button" className="rrms-btn rrms-btn-primary" onClick={() => onBook(run, c.classCode)}>Book this train ({c.classCode})</button>
              )}
            </div>
            {open && c.quotas && (
              <div className="live-scroll">
                <table className="rrms-table">
                  <caption className="live-sub">Quota split of class {c.classCode} (seat share rules BR-Q10)</caption>
                  <thead><tr><th>Quota</th><th>Seats</th><th>Booked</th><th>Available</th><th>RAC</th><th>WL</th><th>Fare</th><th>Status</th></tr></thead>
                  <tbody>
                    {c.quotas.map((q) => (
                      <tr key={q.quota}>
                        <td>{q.quota.replace('_', ' ')}</td><td>{q.totalSeats}</td><td>{q.bookedSeats}</td><td>{q.availableSeats}</td>
                        <td>{q.racCount}</td><td>{q.waitingListCount}</td><td>Rs {q.fare.toFixed(2)}</td>
                        <td><span className={`rrms-badge ${SEAT_BADGE[q.status]}`}>{q.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </aside>
  );
}

/**
 * /live-trains : every train run of one date with live seat numbers. Public and read only.
 * Staff and admin also see the chart state and the occupancy percentage in the table.
 * Data: GET /api/live-trains and GET /api/live-trains/:scheduleId (seat numbers from SCHEDULE_CLASS_INVENTORY).
 * Refreshes by itself every 15 seconds.
 */
export default function LiveTrainsPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const canSeeStaff = !!session && (session.role === 'STAFF' || session.role === 'ADMIN');

  const [stations, setStations] = useState<Station[]>([]);
  const [date, setDate] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [type, setType] = useState('');
  const [cls, setCls] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const [data, setData] = useState<{ trains: LiveTrain[]; total: number; date: string; asOf: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<LiveTrain | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const filters = useRef({ date, from, to, type, cls, status, q, page });
  filters.current = { date, from, to, type, cls, status, q, page };
  const selectedRef = useRef<number | null>(null);
  selectedRef.current = selected;

  const loadList = useCallback(async () => {
    const f = filters.current;
    setLoading(true);
    try {
      const res = await publicApi.liveTrains({ date: f.date, from: f.from, to: f.to, type: f.type, class: f.cls, status: f.status, q: f.q, page: f.page, pageSize: PAGE_SIZE });
      setData({ trains: res.trains, total: res.total, date: res.date, asOf: res.asOf });
      setError(null);
      setUpdated(new Date());
    } catch (e: any) {
      setError(e.message || 'Live trains could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (scheduleId: number) => {
    const f = filters.current;
    try {
      setDetail(await publicApi.liveTrain(scheduleId, f.from || undefined, f.to || undefined));
      setDetailError(null);
    } catch (e: any) {
      setDetailError(e.message || 'Seat details could not be loaded.');
    }
  }, []);

  useEffect(() => { publicApi.stations().then(setStations).catch(() => setStations([])); }, []);

  // Reload when a filter changes (typing in the search box waits a moment)
  useEffect(() => {
    const t = setTimeout(loadList, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [date, from, to, type, cls, status, q, page, loadList]);

  // Auto refresh every 15 seconds: the list and the open detail panel
  useEffect(() => {
    const id = setInterval(() => {
      loadList();
      if (selectedRef.current) loadDetail(selectedRef.current);
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [loadList, loadDetail]);

  const refreshNow = () => { loadList(); if (selected) loadDetail(selected); };

  const open = (run: LiveTrain) => {
    setSelected(run.scheduleId);
    setDetail(null);
    setDetailError(null);
    loadDetail(run.scheduleId);
  };

  const book = (run: LiveTrain, classCode: string) => {
    const pending: PendingSearch = { fromId: run.origin.stationId, toId: run.destination.stationId, date: run.journeyDate, classType: classCode, trainId: run.trainId };
    try { sessionStorage.setItem(PENDING_SEARCH_KEY, JSON.stringify(pending)); } catch { /* storage off */ }
    if (session && session.role === 'PASSENGER') navigate(HOME_PATH.PASSENGER);
    else if (session) window.alert('Booking is for passenger accounts. Sign out, then sign in as Passenger to book.');
    else navigate('/', { state: { signInForBooking: true } });
  };

  const setFilter = (fn: () => void) => { fn(); setPage(1); setSelected(null); setDetail(null); };
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <PublicLayout>
      <main className="info-main live-main">
        <h1>Live Trains</h1>
        <p className="info-lead">
          Every train run of the day with its seats right now. Seat numbers come from the booking database and refresh every 15 seconds.
          {data && <> Showing {data.date} (database time {data.asOf}).</>}
        </p>

        <form className="rrms-card live-filters" onSubmit={(e) => { e.preventDefault(); refreshNow(); }} aria-label="Filters">
          <label className="rrms-field">Date
            <input className="rrms-input" type="date" value={date} onChange={(e) => setFilter(() => setDate(e.target.value))} />
          </label>
          <label className="rrms-field">From station
            <select className="rrms-select" value={from} onChange={(e) => setFilter(() => setFrom(e.target.value))}>
              <option value="">Any</option>
              {stations.map((s) => <option key={s.stationId} value={s.stationCode}>{s.stationCode} - {s.stationName}</option>)}
            </select>
          </label>
          <label className="rrms-field">To station
            <select className="rrms-select" value={to} onChange={(e) => setFilter(() => setTo(e.target.value))}>
              <option value="">Any</option>
              {stations.map((s) => <option key={s.stationId} value={s.stationCode}>{s.stationCode} - {s.stationName}</option>)}
            </select>
          </label>
          <label className="rrms-field">Train type
            <select className="rrms-select" value={type} onChange={(e) => setFilter(() => setType(e.target.value))}>
              <option value="">All types</option>
              {TYPES.map((t) => <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>)}
            </select>
          </label>
          <label className="rrms-field">Class
            <select className="rrms-select" value={cls} onChange={(e) => setFilter(() => setCls(e.target.value))}>
              <option value="">All classes</option>
              {CLASS_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="rrms-field">Running status
            <select className="rrms-select" value={status} onChange={(e) => setFilter(() => setStatus(e.target.value))}>
              <option value="">All</option>
              <option value="NOT_STARTED">Not started</option>
              <option value="RUNNING">Running</option>
              <option value="DELAYED">Delayed</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </label>
          <label className="rrms-field live-search">Train number or name
            <input className="rrms-input" type="search" placeholder="for example 12221 or Rajdhani" value={q} onChange={(e) => setFilter(() => setQ(e.target.value))} />
          </label>
          <div className="live-refresh">
            <button type="submit" className="rrms-btn rrms-btn-primary" disabled={loading}><RefreshCw size={16} aria-hidden="true" /> {loading ? 'Refreshing...' : 'Refresh'}</button>
            <span className="live-sub" role="status">Last updated {fmtClock(updated)}</span>
          </div>
        </form>

        {error && <div className="rrms-alert-error" role="alert" style={{ margin: '12px 0' }}>{error}</div>}

        <div className={selected ? 'live-layout with-detail' : 'live-layout'}>
          <section className="live-list" aria-label="Trains">
            {data && <p className="live-sub live-count">{data.total} train{data.total === 1 ? '' : 's'} found</p>}
            {data && data.trains.length === 0 && !error && <div className="rrms-card">No train runs match these filters on this date.</div>}
            <ul className="live-rows">
              {data?.trains.map((t) => (
                <li key={t.scheduleId}>
                  <button type="button" className={selected === t.scheduleId ? 'live-row active' : 'live-row'} onClick={() => open(t)} aria-pressed={selected === t.scheduleId}>
                    <span className="live-train">
                      <strong>{t.trainNumber}</strong> <span>{t.trainName.replace(/ \(\d+\)$/, '')}</span>
                      <small>{t.origin.code} {t.origin.departureTime} to {t.destination.code} {t.destination.arrivalTime}</small>
                    </span>
                    <span className="live-status">
                      <span className={`rrms-badge ${RUN_BADGE[t.runStatus]}`}>{RUN_LABEL[t.runStatus]}</span>
                      {t.delayMinutes > 0 && <span className="live-delay">{t.delayMinutes} min late</span>}
                      {canSeeStaff && <small>{t.chartPrepared ? 'Chart prepared' : 'Chart not prepared'} - {t.occupancyPct}% full</small>}
                    </span>
                    <span className="live-chips">
                      {t.classes.map((c) => (
                        <span key={c.classCode} className={`rrms-badge ${SEAT_BADGE[c.status]}`}>{c.classCode} {classChip(c)}</span>
                      ))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {data && pages > 1 && (
              <div className="live-pager">
                <button type="button" className="rrms-btn rrms-btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                <span>Page {page} of {pages}</span>
                <button type="button" className="rrms-btn rrms-btn-secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            )}
          </section>

          {selected && (
            <div className="live-detail-wrap">
              {detailError && <div className="rrms-alert-error" role="alert">{detailError}</div>}
              {!detail && !detailError && <div className="rrms-card">Loading seat details...</div>}
              {detail && <DetailPanel run={detail} onClose={() => { setSelected(null); setDetail(null); }} onBook={book} canSeeStaff={canSeeStaff} />}
            </div>
          )}
        </div>
      </main>
    </PublicLayout>
  );
}
