import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RefreshCw, X } from 'lucide-react';
import { Select } from '../ui/Select';
import { DatePicker } from '../ui/DatePicker';
import { SkeletonRows } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { statusChip } from '../ui/status';
import { toast } from '../ui/toast';
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
  NOT_STARTED: 'rrms-badge-info', RUNNING: 'rrms-badge-confirmed', DELAYED: 'rrms-badge-delayed',
  COMPLETED: 'rrms-badge-info', CANCELLED: 'rrms-badge-cancelled',
};
const SEAT_BADGE: Record<string, string> = {
  AVAILABLE: 'rrms-badge-confirmed', RAC: 'rrms-badge-rac', WL: 'rrms-badge-waiting', 'NOT AVAILABLE': 'rrms-badge-cancelled',
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
      <div className="live-bar-fill" style={{ transform: `scaleX(${safe / 100})` }} />
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

export interface LiveTrainsViewProps {
  /** where the page is shown: the public page, or inside one of the three portals */
  context: 'public' | 'passenger' | 'staff' | 'admin';
}

/**
 * The Live Trains window: every train run of one date with live seat numbers.
 * Used by the public page (/live-trains) AND by the passenger, staff and admin portals (same data, filters, detail panel,
 * 15 second auto refresh and "Book this train" button). Inside the passenger portal the button continues straight into
 * booking; on the public page it goes through the sign-in; staff and admin also see the chart state and occupancy.
 * Data: GET /api/live-trains and GET /api/live-trains/:scheduleId (seat numbers from SCHEDULE_CLASS_INVENTORY).
 */
export function LiveTrainsView({ context }: LiveTrainsViewProps) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const canSeeStaff = !!session && (session.role === 'STAFF' || session.role === 'ADMIN');

  const [stations, setStations] = useState<Station[]>([]);
  const [date, setDate] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [type, setType] = useState('');
  const [cls, setCls] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState(params.get('q') || '');
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

  // a Ctrl+K train search lands here with ?q=
  const urlQ = params.get('q');
  useEffect(() => { if (urlQ !== null) { setQ(urlQ); setPage(1); } }, [urlQ]);

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
    if (session && session.role === 'PASSENGER') {
      // inside the passenger portal the button continues straight into booking
      navigate('/passenger/book', { state: { continuePending: Date.now() } });
    } else if (session) toast('Booking is for passenger accounts. Sign out, then sign in as Passenger to book.', 'warning');
    else navigate('/', { state: { signInForBooking: true } });
  };

  const setFilter = (fn: () => void) => { fn(); setPage(1); setSelected(null); setDetail(null); };
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const stationOpts = [{ value: '', label: 'Any' }, ...stations.map((s) => ({ value: s.stationCode, label: `${s.stationCode} - ${s.stationName}` }))];
  const typeOpts = [{ value: '', label: 'All types' }, ...TYPES.map((t) => ({ value: t, label: t.charAt(0) + t.slice(1).toLowerCase() }))];
  const classOpts = [{ value: '', label: 'All classes' }, ...CLASS_CODES.map((c) => ({ value: c, label: c }))];
  const statusOpts = [{ value: '', label: 'All' }, { value: 'NOT_STARTED', label: 'Not started' }, { value: 'RUNNING', label: 'Running' }, { value: 'DELAYED', label: 'Delayed' }, { value: 'COMPLETED', label: 'Completed' }, { value: 'CANCELLED', label: 'Cancelled' }];

  return (
    <div className="live-view" data-context={context}>
      <div className="live-head">
        <p className="info-lead" style={{ margin: 0 }}>
          Every train run of the day with its seats right now. Seat numbers come from the booking database and refresh every 15 seconds.
          {data && <> Showing {data.date} (database time {data.asOf}).</>}
        </p>
        <span className="live-stamp" role="status"><span className="rrms-dot rrms-dot-live" aria-hidden="true" /> Live · last updated {fmtClock(updated)}</span>
      </div>

      <form className="rrms-card live-filters" onSubmit={(e) => { e.preventDefault(); refreshNow(); }} aria-label="Filters" style={{ marginTop: 16 }}>
        <DatePicker label="Date" value={date || (data?.date ?? '')} onChange={(v) => setFilter(() => setDate(v))} />
        <Select label="From station" value={from} onChange={(v) => setFilter(() => setFrom(v))} options={stationOpts} />
        <Select label="To station" value={to} onChange={(v) => setFilter(() => setTo(v))} options={stationOpts} />
        <Select label="Train type" value={type} onChange={(v) => setFilter(() => setType(v))} options={typeOpts} />
        <Select label="Class" value={cls} onChange={(v) => setFilter(() => setCls(v))} options={classOpts} />
        <Select label="Running status" value={status} onChange={(v) => setFilter(() => setStatus(v))} options={statusOpts} />
        <label className="rrms-field live-search">Train number or name
          <input className="rrms-input" type="search" placeholder="for example 12221 or Rajdhani" value={q} onChange={(e) => setFilter(() => setQ(e.target.value))} />
        </label>
        <div className="live-refresh">
          <button type="submit" className="rrms-btn rrms-btn-primary" disabled={loading}><RefreshCw size={16} aria-hidden="true" /> {loading ? 'Refreshing...' : 'Refresh'}</button>
        </div>
      </form>

      {error && <div className="rrms-alert-error" role="alert" style={{ margin: '12px 0' }}>{error}</div>}

      <div className={selected ? 'live-layout with-detail' : 'live-layout'}>
        <section className="live-list" aria-label="Trains">
          {!data && !error && <SkeletonRows rows={6} h={72} label="Loading live trains" />}
          {data && <p className="live-sub live-count">{data.total} train{data.total === 1 ? '' : 's'} found</p>}
          {data && data.trains.length === 0 && !error && <div className="rrms-card"><EmptyState art="train" title="No trains match" text="No train runs match these filters on this date. Try another date or clear a filter." /></div>}
          <ul className="live-rows">
            {data?.trains.map((t) => (
              <li key={t.scheduleId}>
                <button type="button" className={selected === t.scheduleId ? 'live-row active' : 'live-row'} onClick={() => open(t)} aria-pressed={selected === t.scheduleId}>
                  <span className="live-train">
                    <strong>{t.trainNumber}</strong> <span>{t.trainName.replace(/ \(\d+\)$/, '')}</span>
                    <small className="mono">{t.origin.code} {t.origin.departureTime} to {t.destination.code} {t.destination.arrivalTime}</small>
                  </span>
                  <span className="live-status">
                    <span className={`rrms-badge ${RUN_BADGE[t.runStatus]}`}>{RUN_LABEL[t.runStatus]}</span>
                    {t.delayMinutes > 0 && <span className="live-delay">{t.delayMinutes} min late</span>}
                    {canSeeStaff && <small>{t.chartPrepared ? 'Chart prepared' : 'Chart not prepared'} - {t.occupancyPct}% full</small>}
                  </span>
                  <span className="live-chips">
                    {t.classes.map((c) => (
                      <span key={c.classCode} className={`rrms-badge ${SEAT_BADGE[c.status] || statusChip(c.status)}`}>{c.classCode} {classChip(c)}</span>
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
            {!detail && !detailError && <div className="rrms-card"><SkeletonRows rows={4} h={48} label="Loading seat details" /></div>}
            {detail && <DetailPanel run={detail} onClose={() => { setSelected(null); setDetail(null); }} onBook={book} canSeeStaff={canSeeStaff} />}
          </div>
        )}
      </div>
    </div>
  );
}

/** /live-trains : the public, read only page (inside the public layout). */
export default function LiveTrainsPage() {
  return (
    <PublicLayout title="Live Trains">
      <main className="info-main live-main" id="main">
        <h1 className="t-display">Live <em>Trains</em></h1>
        <LiveTrainsView context="public" />
      </main>
    </PublicLayout>
  );
}
