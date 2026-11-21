import React, { useState, useEffect, useCallback } from 'react';
import { useStaff } from '../context/StaffContext';
import { StatusBadge } from '../components/StatusBadge';
import { Search, CheckCircle, AlertTriangle, XCircle, FileWarning, Loader2 } from 'lucide-react';
import { staffApiService, PnrBookingDetails } from '../services/staffApiService';

interface ScannerPageProps {
  initialPnr?: string;
  onIssueFinePrefill?: (name: string, idRef: string, reason: string) => void;
}

type PaxRow = PnrBookingDetails['passengers'][number];

/** Boarding state shown for a passenger: BOARDED and NO_SHOW are saved on the reservation in the database. */
function boardingOf(p: PaxRow): 'BOARDED' | 'NO_SHOW' | 'NOT_VERIFIED' {
  return p.status === 'BOARDED' ? 'BOARDED' : p.status === 'NO_SHOW' ? 'NO_SHOW' : 'NOT_VERIFIED';
}

/**
 * PNR and ID scanner. Shows EVERY passenger of the PNR, each with their own verify / board / no-show buttons.
 * Everything shown (ticket status, boarding result, verification stamp) is read from the database, so it is
 * still there after a page reload.
 */
export const ScannerPage: React.FC<ScannerPageProps> = ({ initialPnr = '', onIssueFinePrefill }) => {
  const { data, verifyPassenger, boardPassengerApi, noShowPassengerApi, refreshAssignmentAndChart } = useStaff();
  const [pnrInput, setPnrInput] = useState<string>(initialPnr);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [searching, setSearching] = useState<boolean>(false);
  const [busyNo, setBusyNo] = useState<number | null>(null);
  const [liveBooking, setLiveBooking] = useState<PnrBookingDetails | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (initialPnr) setPnrInput(initialPnr);
  }, [initialPnr]);

  const load = useCallback(async (pnr: string, quiet = false) => {
    if (!quiet) { setSearching(true); setSearchError(null); }
    try {
      const res = await staffApiService.getBookingByPnr(pnr);
      setLiveBooking(res && res.pnr ? res : null);
    } catch (err: any) {
      setLiveBooking(null);
      setSearchError(err.message || 'PNR not found in live system');
    } finally {
      if (!quiet) setSearching(false);
    }
  }, []);

  // Look the PNR up as soon as 10 digits are typed
  useEffect(() => {
    const trimmed = pnrInput.trim();
    if (trimmed.length === 10) {
      load(trimmed);
    } else {
      setLiveBooking(null);
      setSearchError(null);
    }
  }, [pnrInput, load]);

  const decide = async (p: PaxRow, verifyStatus: 'VALID' | 'INVALID' | 'MISMATCH', action: 'BOARD' | 'NO_SHOW' | 'NONE') => {
    if (!liveBooking || busyNo !== null) return;
    setBusyNo(p.passengerNo);
    try {
      const v = await verifyPassenger(liveBooking.pnr, p.passengerNo, verifyStatus, notes[p.passengerNo] || '');
      if (v.success) {
        if (action === 'BOARD') await boardPassengerApi(liveBooking.pnr, p.passengerNo);
        if (action === 'NO_SHOW') await noShowPassengerApi(liveBooking.pnr, p.passengerNo);
      }
    } finally {
      setBusyNo(null);
      // Read the saved result back from the database (and refresh the chart: a no-show promotes the queue)
      await load(liveBooking.pnr, true);
      refreshAssignmentAndChart();
    }
  };

  // Quick picks are the PNRs that really are on this officer's chart (no built-in sample PNRs)
  const chartPnrs = Array.from(new Set(data.manifest.map(m => m.pnr))).slice(0, 4);

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-8 text-center flex flex-col items-center justify-center shadow-xs">
        <div className="w-14 h-14 rounded-full bg-orange-50 text-orange-600 border border-orange-200 flex items-center justify-center mb-3 text-2xl shadow-sm">
          <Search className="w-7 h-7" />
        </div>
        <h3 className="text-xl font-bold text-slate-900">Digital Ticket & PNR Inspection Terminal</h3>
        <p className="text-xs text-slate-500 max-w-lg mt-1 mb-5">
          Scan or input the 10-digit Passenger Name Record (PNR). Every passenger on the ticket is listed so each one can be checked and boarded.
        </p>

        <div className="w-full max-w-md">
          <input
            type="text"
            inputMode="numeric"
            value={pnrInput}
            onChange={(e) => setPnrInput(e.target.value)}
            placeholder="ENTER 10-DIGIT PNR..."
            aria-label="PNR"
            className="w-full bg-slate-50 border border-slate-300 focus:border-orange-500 focus:bg-white rounded-xl px-4 py-3 text-center font-mono text-base font-bold tracking-widest text-slate-900 outline-none shadow-xs transition-all"
          />
        </div>

        <div className="flex items-center gap-2 mt-4 flex-wrap justify-center">
          <span className="text-[11px] text-slate-500 font-medium">
            {chartPnrs.length ? 'PNRs on your chart:' : 'No chart loaded yet: type a PNR.'}
          </span>
          {chartPnrs.map(p => (
            <button
              key={p}
              onClick={() => setPnrInput(p)}
              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-lg text-xs font-mono font-medium transition-all"
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {pnrInput.trim().length >= 4 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 shadow-xs">
          {searching && <div className="text-center py-6 text-sm text-slate-500" role="status">Looking up PNR...</div>}

          {!searching && !liveBooking && (
            <div className="text-center py-8">
              <div className="text-4xl mb-2" aria-hidden="true">⚠️</div>
              <h4 className="text-base font-bold text-rose-600">PNR {pnrInput} Not Found Onboard</h4>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                {searchError || 'Type all 10 digits.'} If a passenger is travelling without a valid booking, issue an on-spot ticketless penalty.
              </p>
              {onIssueFinePrefill && pnrInput.trim().length === 10 && (
                <button
                  onClick={() => onIssueFinePrefill('', pnrInput, 'TICKETLESS_TRAVEL')}
                  className="mt-4 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold shadow-xs"
                >
                  Issue Ticketless Travel Fine
                </button>
              )}
            </div>
          )}

          {!searching && liveBooking && (
            <div className="space-y-5">
              <div className="pb-4 border-b border-slate-100">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-bold text-slate-900">PNR {liveBooking.pnr}</h3>
                  <StatusBadge status={liveBooking.bookingStatus} size="sm" />
                </div>
                <div className="text-xs text-slate-600 mt-1">
                  {liveBooking.trainNumber} {liveBooking.trainName} · {liveBooking.journeyDate} · Class {liveBooking.classType} · Quota {liveBooking.quota}
                </div>
                <div className="text-xs text-slate-600">
                  {liveBooking.boardingStation?.stationName} ➔ {liveBooking.destinationStation?.stationName} · {liveBooking.passengers.length} passenger{liveBooking.passengers.length === 1 ? '' : 's'}
                </div>
              </div>

              <ul className="space-y-4">
                {liveBooking.passengers.map((p) => {
                  const boarding = boardingOf(p);
                  const canBoard = p.status === 'CONFIRMED' || p.status === 'RAC';
                  const busy = busyNo === p.passengerNo;
                  return (
                    <li key={p.passengerNo} className="border border-slate-200 rounded-xl p-4 space-y-3" aria-label={`Passenger ${p.passengerNo}: ${p.name}`}>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-base font-bold text-slate-900">{p.passengerNo}. {p.name}</span>
                            {p.coachNumber && p.seatNumber ? (
                              <span className="font-mono text-sm font-bold bg-orange-50 border border-orange-200 text-orange-700 px-2 py-0.5 rounded-lg">
                                {p.coachNumber}-{p.seatNumber}
                              </span>
                            ) : (
                              <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-lg">{p.queuePosition || 'No berth'}</span>
                            )}
                            <StatusBadge status={p.status} size="sm" />
                          </div>
                          <div className="text-xs text-slate-600 mt-1">
                            {p.age}y / {p.gender} · Berth: {p.berthType || '-'}
                            {p.concessionType && p.concessionType !== 'NONE' ? ` · Concession: ${p.concessionType.replace('_', ' ')}` : ''}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <div><div className="text-[11px] font-semibold text-slate-500 uppercase">Boarding</div><StatusBadge status={boarding} size="sm" /></div>
                          <div><div className="text-[11px] font-semibold text-slate-500 uppercase">Verification</div><StatusBadge status={p.verification?.result || 'UNCHECKED'} size="sm" /></div>
                        </div>
                      </div>

                      {p.verification && (
                        <p className="text-xs text-slate-600">Last check {p.verification.verifiedAt.slice(0, 16)}: {p.verification.remarks || 'no remarks'}</p>
                      )}

                      <label className="block text-xs font-semibold text-slate-700">
                        Inspector remarks for {p.name}
                        <input
                          type="text"
                          value={notes[p.passengerNo] || ''}
                          onChange={(e) => setNotes(prev => ({ ...prev, [p.passengerNo]: e.target.value }))}
                          placeholder="e.g. Original ID inspected, details match"
                          className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none focus:border-orange-500"
                        />
                      </label>

                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          disabled={busyNo !== null || !canBoard}
                          onClick={() => decide(p, 'VALID', 'BOARD')}
                          className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-xs"
                        >
                          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                          <span>ID valid, board</span>
                        </button>
                        <button
                          disabled={busyNo !== null || !canBoard}
                          onClick={() => decide(p, 'INVALID', 'NO_SHOW')}
                          className="px-3 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-xs"
                        >
                          <XCircle className="w-4 h-4" />
                          <span>ID invalid, no-show</span>
                        </button>
                        <button
                          disabled={busyNo !== null}
                          onClick={() => decide(p, 'MISMATCH', 'NONE')}
                          className="px-3 py-2 bg-amber-50 hover:bg-amber-100 disabled:opacity-50 text-amber-800 border border-amber-200 rounded-xl text-xs font-semibold flex items-center gap-2"
                        >
                          <AlertTriangle className="w-4 h-4" />
                          <span>ID mismatch</span>
                        </button>
                        {onIssueFinePrefill && (
                          <button
                            onClick={() => onIssueFinePrefill(p.name, '', 'TRAVELLING_IN_HIGHER_CLASS_WITHOUT_UPGRADE')}
                            className="px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-semibold flex items-center gap-2"
                          >
                            <FileWarning className="w-4 h-4" />
                            <span>Penalty challan</span>
                          </button>
                        )}
                      </div>
                      {!canBoard && boarding === 'NOT_VERIFIED' && (
                        <p className="text-xs text-slate-600">This passenger is {p.status.replace('_', ' ').toLowerCase()}, so boarding is not possible.</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
