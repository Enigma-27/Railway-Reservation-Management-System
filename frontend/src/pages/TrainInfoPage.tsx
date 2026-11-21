import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PublicLayout } from '../components/PublicLayout';
import { useAuth } from '../admin/auth/AuthContext';
import { RouteStop, RunStatus, TrainDetail, TrainSummary, publicApi, todayIso } from '../services/publicApi';

const STATUS_BADGE: Record<string, string> = { ON_TIME: 'rrms-badge-success', DELAYED: 'rrms-badge-warning', CANCELLED: 'rrms-badge-danger', COMPLETED: 'rrms-badge-info' };

function useTrains() {
  const [trains, setTrains] = useState<TrainSummary[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    publicApi.trains().then((t) => live && setTrains(t)).catch(() => live && setError(true));
    return () => { live = false; };
  }, []);
  return { trains, error };
}

function TrainSelect({ trains, value, onChange }: { trains: TrainSummary[]; value: string; onChange: (v: string) => void }) {
  return (
    <select className="rrms-select" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Train">
      <option value="">Choose a train</option>
      {trains.map((t) => <option key={t.trainId} value={t.trainId}>{t.trainNumber} - {t.displayName}</option>)}
    </select>
  );
}

function ScheduleCard({ trains }: { trains: TrainSummary[] }) {
  const [trainId, setTrainId] = useState('');
  const [detail, setDetail] = useState<TrainDetail | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const view = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trainId) return setMsg('Please choose a train.');
    setBusy(true); setMsg(null); setDetail(null);
    try { setDetail(await publicApi.train(trainId)); } catch (err: any) { setMsg(err.message); } finally { setBusy(false); }
  };

  return (
    <article className="rrms-card info-card">
      <h2>Train schedule</h2>
      <p className="sub">Stops, timings and running days</p>
      <form className="info-form" onSubmit={view}>
        <TrainSelect trains={trains} value={trainId} onChange={setTrainId} />
        <button className="rrms-btn rrms-btn-primary" type="submit" disabled={busy}>{busy ? 'Loading...' : 'View schedule'}</button>
      </form>
      <div className="info-result" aria-live="polite">
        {msg && <div className="rrms-alert-error" role="alert">{msg}</div>}
        {detail && (
          <>
            <p><strong>{detail.trainNumber} {detail.displayName}</strong><br />Runs on: {detail.runningDays.join(', ')}</p>
            <div className="info-scroll">
              <table className="rrms-table">
                <thead><tr><th>#</th><th>Station</th><th>Arr</th><th>Dep</th></tr></thead>
                <tbody>
                  {detail.route.map((s: RouteStop) => (
                    <tr key={s.stopSequence}><td>{s.stopSequence}</td><td>{s.stationCode}<br /><small>{s.stationName}</small></td><td>{s.arrivalTime}</td><td>{s.departureTime}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </article>
  );
}

/** Estimate the last scheduled stop from the clock and the timetable plus the delay (there is no live GPS). */
function lastStopPassed(run: RunStatus): string {
  const base = new Date(run.journeyDate + 'T00:00:00');
  const now = Date.now();
  let last: string | null = null;
  for (const s of run.stops) {
    const [h, m] = s.departureTime.split(':').map(Number);
    const t = new Date(base.getTime() + s.dayOffset * 86400000 + (h * 60 + m + run.delayMinutes) * 60000).getTime();
    if (t <= now) last = `${s.stationName} (${s.stationCode})`;
  }
  if (run.status === 'CANCELLED') return 'The run is cancelled.';
  return last ? `Last scheduled stop passed: ${last}` : 'The train has not left its first station yet.';
}

function TrackCard({ trains }: { trains: TrainSummary[] }) {
  const [trainId, setTrainId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [run, setRun] = useState<RunStatus | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const track = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trainId) return setMsg('Please choose a train.');
    setBusy(true); setMsg(null); setRun(null);
    try { setRun(await publicApi.runStatus(trainId, date)); }
    catch (err: any) { setMsg(err.status === 404 ? 'This train has no run on that date. Try another date (today to 7 days ahead).' : err.message); }
    finally { setBusy(false); }
  };

  return (
    <article className="rrms-card info-card">
      <h2>Track your train</h2>
      <p className="sub">Run status and delay</p>
      <form className="info-form" onSubmit={track}>
        <TrainSelect trains={trains} value={trainId} onChange={setTrainId} />
        <input className="rrms-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Journey date" />
        <button className="rrms-btn rrms-btn-primary" type="submit" disabled={busy}>{busy ? 'Checking...' : 'Track train'}</button>
      </form>
      <div className="info-result" aria-live="polite">
        {msg && <div className="rrms-alert-error" role="alert">{msg}</div>}
        {run && (
          <>
            <p><span className={`rrms-badge ${STATUS_BADGE[run.status] || 'rrms-badge-info'}`}>{run.status.replace('_', ' ')}</span>{' '}
              <strong>{run.delayMinutes > 0 ? `${run.delayMinutes} min late` : 'No delay recorded'}</strong></p>
            <p>{run.trainNumber} {run.trainName}<br />Departs {run.departureTime} on {run.journeyDate}</p>
            <p>{lastStopPassed(run)}</p>
            <p><small>There is no live GPS. The position is worked out from the timetable and the recorded delay.</small></p>
          </>
        )}
      </div>
    </article>
  );
}

function PnrCard() {
  const { session } = useAuth();
  const [pnr, setPnr] = useState('');
  const [data, setData] = useState<any | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const look = async (e: React.FormEvent) => {
    e.preventDefault();
    setData(null); setMsg(null);
    if (!/^\d{10}$/.test(pnr.trim())) return setMsg('Please enter a 10-digit PNR.');
    setBusy(true);
    try { setData(await publicApi.pnr(pnr.trim())); }
    catch (err: any) { setMsg(err.status === 404 ? `No booking was found for PNR ${pnr}.` : err.status === 403 ? 'You can only check your own PNR.' : err.message); }
    finally { setBusy(false); }
  };

  return (
    <article className="rrms-card info-card">
      <h2>PNR enquiry</h2>
      <p className="sub">Check the status of a ticket</p>
      {!session ? (
        <div className="rrms-alert-info" role="status">
          A PNR shows a passenger's private ticket, so it needs a sign-in. <Link to="/" style={{ fontWeight: 700, textDecoration: 'underline' }}>Go to Home to sign in</Link>.
        </div>
      ) : (
        <form className="info-form" onSubmit={look}>
          <input className="rrms-input" inputMode="numeric" maxLength={10} placeholder="10-digit PNR" value={pnr} onChange={(e) => setPnr(e.target.value)} aria-label="PNR" />
          <button className="rrms-btn rrms-btn-primary" type="submit" disabled={busy}>{busy ? 'Looking up...' : 'Check status'}</button>
        </form>
      )}
      <div className="info-result" aria-live="polite">
        {msg && <div className="rrms-alert-error" role="alert">{msg}</div>}
        {data && (
          <>
            <p><span className="rrms-badge rrms-badge-info">{String(data.bookingStatus || '').replace('_', ' ')}</span> <strong>PNR {data.pnr}</strong></p>
            <p>{data.trainNumber} {data.trainName}<br />{data.boardingStation?.stationCode} to {data.destinationStation?.stationCode} on {data.journeyDate} ({data.classType})</p>
            {Array.isArray(data.passengers) && data.passengers.length > 0 && (
              <table className="rrms-table">
                <thead><tr><th>Passenger</th><th>Status</th><th>Seat</th></tr></thead>
                <tbody>
                  {data.passengers.map((p: any) => (
                    <tr key={p.passengerNo}><td>{p.name}</td><td>{String(p.status || '').replace('_', ' ')}{p.queuePosition ? ` (${p.queuePosition})` : ''}</td><td>{p.coachNumber ? `${p.coachNumber}/${p.seatNumber}` : '-'}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </article>
  );
}

/** "/train-info": Train schedule, Track your train, PNR enquiry. All from the real API. */
export default function TrainInfoPage() {
  const { trains, error } = useTrains();
  return (
    <PublicLayout>
      <main className="info-main">
        <h1>Train Info</h1>
        <p className="info-lead">Check a timetable, see if a train is running late, or look up a ticket.</p>
        {error && <div className="rrms-alert-error" role="alert" style={{ marginBottom: 16 }}>The train list could not be loaded. Check that the backend is running.</div>}
        <div className="info-grid">
          <ScheduleCard trains={trains} />
          <TrackCard trains={trains} />
          <PnrCard />
        </div>
      </main>
    </PublicLayout>
  );
}
