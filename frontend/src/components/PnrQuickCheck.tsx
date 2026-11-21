import React, { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { publicApi } from '../services/publicApi';
import { statusChip } from '../ui/status';

/**
 * PNR quick check (landing page and Train Info). Uses the PUBLIC status endpoint GET /api/pnr-status/:pnr:
 * no sign-in, and the answer holds only the ticket status (overall status, train, date, route, class and each passenger's
 * CNF / RAC / WL). It never shows names, ages, ID proofs, contact data, fares or seats; those stay in the signed-in screens.
 * The endpoint is rate limited, so a "too many lookups" answer is shown in plain words.
 */
export const PnrQuickCheck: React.FC<{ initialPnr?: string; compact?: boolean }> = ({ initialPnr = '' }) => {
  const [pnr, setPnr] = useState(initialPnr);
  const [data, setData] = useState<any | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const look = async (value = pnr) => {
    setData(null); setMsg(null);
    if (!/^\d{10}$/.test(value.trim())) return setMsg('Please enter a 10-digit PNR.');
    setBusy(true);
    try { setData(await publicApi.pnrStatus(value.trim())); }
    catch (err: any) { setMsg(err.status === 404 ? `No booking was found for PNR ${value}.` : err.status === 429 ? err.message : err.message || 'The PNR could not be checked.'); }
    finally { setBusy(false); }
  };

  useEffect(() => { if (/^\d{10}$/.test(initialPnr)) look(initialPnr); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <div className="pnrq">
      <form className="pnrq-form" onSubmit={(e) => { e.preventDefault(); look(); }}>
        <input className="rrms-input mono" inputMode="numeric" maxLength={10} placeholder="10-digit PNR" value={pnr} onChange={(e) => setPnr(e.target.value.replace(/\D/g, ''))} aria-label="PNR number" />
        <button className="rrms-btn rrms-btn-accent" type="submit" disabled={busy}><Search size={16} aria-hidden="true" /> {busy ? 'Looking up...' : 'Check status'}</button>
      </form>
      <div className="info-result" aria-live="polite">
        {msg && <div className="rrms-alert-error" role="alert">{msg}</div>}
        {data && (
          <>
            <p><span className={`rrms-badge ${statusChip(data.bookingStatus)}`}>{String(data.bookingStatus || '').replace('_', ' ')}</span> <strong className="mono">PNR {data.pnr}</strong></p>
            <p>{data.trainNumber} {data.trainName}<br />{data.boardingStation?.stationCode} to {data.destinationStation?.stationCode} on {data.journeyDate} ({data.classType})
              {data.delayMinutes > 0 && <><br /><span className="rrms-badge rrms-badge-delayed">Train late by {data.delayMinutes} min</span></>}</p>
            {Array.isArray(data.passengers) && data.passengers.length > 0 && (
              <ul className="pnrq-pax" aria-label="Passenger status">
                {data.passengers.map((p: any) => (
                  <li key={p.passengerNo}>
                    <span>Passenger {p.passengerNo}</span>
                    <span className={`rrms-badge ${statusChip(p.status)}`}>{p.shortStatus}{p.queuePosition ? ` ${p.queuePosition}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="live-sub">Status only. Names and seat details are shown after you sign in.</p>
          </>
        )}
      </div>
    </div>
  );
};
