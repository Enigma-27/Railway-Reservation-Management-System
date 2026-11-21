import React, { useState } from 'react';
import { useStaff } from '../context/StaffContext';
import { StatusBadge } from '../components/StatusBadge';
import { FileText, Printer } from 'lucide-react';
import { Fine } from '../types';
import { formatIndiaDateTime, formatCurrency } from '../utils/formatters';

interface FinesPageProps {
  prefillName?: string;
  prefillIdRef?: string;
  prefillReason?: string;
}

// The four reasons the database accepts (FINE.reason)
const FINE_REASONS: Array<{ value: string; label: string }> = [
  { value: 'TICKETLESS_TRAVEL', label: 'Ticketless Travel' },
  { value: 'UNAUTHORIZED_CLASS', label: 'Travelling in Higher Class without Upgrade' },
  { value: 'UNBOOKED_LUGGAGE', label: 'Unbooked / Excess Luggage' },
  { value: 'SMOKING_NUISANCE', label: 'Smoking / Public Nuisance' },
];

function normalizeReason(reason: string): string {
  if (reason === 'TRAVELLING_IN_HIGHER_CLASS_WITHOUT_UPGRADE') return 'UNAUTHORIZED_CLASS';
  return FINE_REASONS.some(r => r.value === reason) ? reason : 'TICKETLESS_TRAVEL';
}

export const FinesPage: React.FC<FinesPageProps> = ({
  prefillName = '',
  prefillIdRef = '',
  prefillReason = 'TICKETLESS_TRAVEL'
}) => {
  const { activeStaff, issueFine, setSelectedReceiptFine } = useStaff();

  const [passengerName, setPassengerName] = useState(prefillName);
  const [idProofReference, setIdProofReference] = useState(prefillIdRef);
  const [reason, setReason] = useState(normalizeReason(prefillReason));
  const [amount, setAmount] = useState<string>('');
  const [paymentStatus, setPaymentStatus] = useState<'PAID' | 'UNPAID'>('PAID');
  const [submitting, setSubmitting] = useState(false);
  // The challan just saved on the server (the server has no list route for staff, so only this one is shown)
  const [lastFine, setLastFine] = useState<Fine | null>(null);

  const hasRun = Boolean(activeStaff.assignedTrainId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numericAmount = Number(amount);
    if (!passengerName.trim() || !idProofReference.trim() || !(numericAmount > 0) || !activeStaff.assignedTrainId || submitting) return;

    setSubmitting(true);
    try {
      const fine = await issueFine({
        staffId: activeStaff.staffId,
        trainId: activeStaff.assignedTrainId,
        passengerName: passengerName.trim(),
        idProofReference: idProofReference.trim(),
        reason,
        amount: numericAmount,
        paymentStatus
      });
      setLastFine(fine);
      setPassengerName('');
      setIdProofReference('');
      setAmount('');
    } catch {
      // The error message was already shown; the form keeps what was typed
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Issue Fine Form */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
        <h3 className="text-base font-bold text-slate-900 mb-1 flex items-center gap-2">
          <FileText className="w-5 h-5 text-orange-600" />
          <span>Issue On-Spot Penalty Challan</span>
        </h3>
        <p className="text-xs text-slate-500 mb-5">
          Enter passenger identification and violation details. The challan is saved on the server and a receipt is shown only after the server accepts it.
        </p>

        {!hasRun && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs">
            No train run is assigned to you, so a penalty cannot be issued.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Offending Passenger Name *</label>
              <input
                type="text"
                required
                value={passengerName}
                onChange={(e) => setPassengerName(e.target.value)}
                placeholder="Full passenger name"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 outline-none focus:border-orange-500 focus:bg-white transition-all"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">ID Proof / Phone Number *</label>
              <input
                type="text"
                required
                value={idProofReference}
                onChange={(e) => setIdProofReference(e.target.value)}
                placeholder="e.g. AADHAAR-1920 or Phone"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 outline-none focus:border-orange-500 focus:bg-white transition-all"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Violation Category *</label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none focus:border-orange-500 focus:bg-white cursor-pointer"
              >
                {FINE_REASONS.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Penalty Amount (₹) *</label>
              <input
                type="number"
                required
                min={1}
                step={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Amount as per the rule book"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 font-mono outline-none focus:border-orange-500 focus:bg-white transition-all"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Settlement Status *</label>
              <select
                value={paymentStatus}
                onChange={(e) => setPaymentStatus(e.target.value as 'PAID' | 'UNPAID')}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none focus:border-orange-500 focus:bg-white cursor-pointer"
              >
                <option value="PAID">PAID (Cash / UPI collected)</option>
                <option value="UNPAID">UNPAID (Challan issued)</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={submitting || !hasRun}
              className="px-5 py-2.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-xs flex items-center gap-2 transition-all"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>{submitting ? 'Saving Challan...' : 'Issue Official Challan'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Last challan saved on the server */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
        <h3 className="text-base font-bold text-slate-900 mb-1">Last Challan Saved</h3>
        <p className="text-xs text-slate-500 mb-4">
          The server does not give officers a list of past penalties, so only the challan you just issued is shown here.
        </p>
        {lastFine ? (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold tracking-wider border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Receipt No.</th>
                  <th className="py-3 px-4">Passenger</th>
                  <th className="py-3 px-4">Offense</th>
                  <th className="py-3 px-4">Amount</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Saved At</th>
                  <th className="py-3 px-4 text-right">Receipt</th>
                </tr>
              </thead>
              <tbody>
                <tr className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3 px-4 font-mono font-bold text-orange-600">{lastFine.receiptNumber}</td>
                  <td className="py-3 px-4 font-semibold text-slate-800">{lastFine.passengerName}</td>
                  <td className="py-3 px-4 text-slate-700">{lastFine.reason.replace(/_/g, ' ')}</td>
                  <td className="py-3 px-4 font-mono font-bold text-slate-900">{formatCurrency(lastFine.amount)}</td>
                  <td className="py-3 px-4"><StatusBadge status={lastFine.paymentStatus} size="sm" /></td>
                  <td className="py-3 px-4 text-slate-500 text-[11px]">{formatIndiaDateTime(lastFine.issuedAt)}</td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => setSelectedReceiptFine(lastFine)}
                      className="px-2.5 py-1 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold ml-auto flex items-center gap-1.5 transition-all"
                    >
                      <Printer className="w-3 h-3 text-slate-500" />
                      <span>Receipt</span>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-6 text-center text-xs text-slate-400">No challan issued in this session yet.</div>
        )}
      </div>
    </div>
  );
};
