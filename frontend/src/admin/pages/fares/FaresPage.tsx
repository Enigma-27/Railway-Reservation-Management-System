import React, { useEffect, useState } from 'react';
import { Edit2, Calculator } from 'lucide-react';
import { fareService } from '../../services/fareService';
import { FareRule, RealFareCalculation } from '../../types/fare';
import { DataTable, Column } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { formatCurrency } from '../../utils/format';

// Class codes by class_id (SEAT_CLASS seed)
const CLASS_BY_ID: Record<number, string> = { 1: '1A', 2: '2A', 3: '3A', 4: 'SL', 5: 'CC', 6: 'EC', 7: '2S' };
const CLASS_CODES = ['1A', '2A', '3A', 'SL', 'CC', 'EC', '2S'];

/**
 * Fares. A fare is a list of DISTANCE SLABS per class: min km, max km and a rate per km (table FARE).
 * The base fare of a ticket is distance x the rate of the slab the distance falls in. The reservation charge,
 * superfast charge, Tatkal percent, GST and insurance are added by the database (see docs/BUSINESS_RULES.md).
 * The calculator below asks the database for the real fare, so what you see is what a booking would charge.
 */
export const FaresPage: React.FC = () => {
  const [fares, setFares] = useState<FareRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit slab modal
  const [editing, setEditing] = useState<FareRule | null>(null);
  const [form, setForm] = useState<{ minDistanceKm: number; maxDistanceKm: number; ratePerKm: number }>({ minDistanceKm: 0, maxDistanceKm: 0, ratePerKm: 0 });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Calculator inputs and the answer from the API
  const [calcDistance, setCalcDistance] = useState<number>(1384);
  const [calcClass, setCalcClass] = useState<string>('3A');
  const [calcTrain, setCalcTrain] = useState<string>('RAJDHANI');
  const [calcQuota, setCalcQuota] = useState<string>('GENERAL');
  const [calcConcession, setCalcConcession] = useState<string>('NONE');
  const [calc, setCalc] = useState<RealFareCalculation | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      setFares(await fareService.getFares());
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load fares.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  // Ask the database for the real fare whenever an input changes (short delay while typing)
  useEffect(() => {
    if (!Number.isInteger(calcDistance) || calcDistance < 1 || calcDistance > 10000) {
      setCalc(null);
      setCalcError('Enter a distance from 1 to 10000 km.');
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      fareService
        .calculate({ classCode: calcClass, distanceKm: calcDistance, trainType: calcTrain, quota: calcQuota, concession: calcConcession })
        .then((r) => { if (live) { setCalc(r); setCalcError(null); } })
        .catch((e: any) => { if (live) { setCalc(null); setCalcError(e.message || 'The fare could not be calculated.'); } });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [calcDistance, calcClass, calcTrain, calcQuota, calcConcession]);

  const openEdit = (fare: FareRule) => {
    setEditing(fare);
    setFormError(null);
    setForm({ minDistanceKm: fare.minDistanceKm ?? 0, maxDistanceKm: fare.maxDistanceKm ?? 0, ratePerKm: fare.ratePerKm ?? 0 });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    if (!(form.maxDistanceKm > form.minDistanceKm)) return setFormError('The maximum distance must be larger than the minimum distance.');
    if (!(form.ratePerKm > 0)) return setFormError('The rate per km must be above 0.');
    setSaving(true);
    setFormError(null);
    try {
      await fareService.updateFare(editing.fareId, form);
      await loadData();
      setEditing(null);
    } catch (err: any) {
      setFormError(err.message || 'Failed to update the fare slab.');
    } finally {
      setSaving(false);
    }
  };

  const money = (v?: number) => (typeof v === 'number' ? `₹ ${v.toFixed(2)}` : '—');
  const classOf = (row: FareRule) => row.classType ?? (row.classId ? CLASS_BY_ID[row.classId] : undefined) ?? '—';

  const columns: Column<FareRule>[] = [
    {
      header: 'Travel class',
      accessorKey: 'classId',
      sortable: true,
      cell: (row) => (
        <span className="font-mono font-bold text-slate-900 bg-orange-50 border border-orange-200 px-2.5 py-1 rounded text-xs">{classOf(row)}</span>
      ),
    },
    {
      header: 'Distance slab (km)',
      accessorKey: 'minDistanceKm',
      sortable: true,
      cell: (row) => <span className="font-mono text-xs">{row.minDistanceKm} to {row.maxDistanceKm}</span>,
    },
    {
      header: 'Rate per km',
      accessorKey: 'ratePerKm',
      sortable: true,
      cell: (row) => <span className="font-mono text-xs font-semibold">{money(row.ratePerKm)}</span>,
    },
    {
      header: 'Actions',
      align: 'right',
      cell: (row) => (
        <button onClick={() => openEdit(row)} className="btn-icon" title="Edit this slab" aria-label={`Edit slab ${classOf(row)} ${row.minDistanceKm} to ${row.maxDistanceKm} km`}>
          <Edit2 className="w-4 h-4" />
        </button>
      ),
    },
  ];

  const line = (label: string, value: number, hide = false) => (hide ? null : (
    <div className="flex justify-between text-slate-700">
      <span>{label}</span>
      <span className="font-mono font-semibold text-slate-900">{formatCurrency(value)}</span>
    </div>
  ));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fares and Fare Calculator"
        description="Distance slabs per class (the base rate per km). Reservation, superfast, Tatkal, GST and insurance are added by the database when a ticket is priced."
      />

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 bg-slate-50 border-b border-slate-200 flex items-center gap-2.5">
          <Calculator className="w-6 h-6 text-orange-700" aria-hidden="true" />
          <div>
            <h2 className="text-base font-bold text-slate-900">Fare calculator (real fare)</h2>
            <p className="text-xs text-slate-600">Calculated by the same database function every booking uses, for one passenger with insurance.</p>
          </div>
        </div>

        <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4 content-start">
            <label className="block">
              <span className="form-label">Distance (km)</span>
              <input type="number" min={1} max={10000} value={calcDistance} onChange={(e) => setCalcDistance(Number(e.target.value))} className="form-input mono" />
            </label>
            <label className="block">
              <span className="form-label">Travel class</span>
              <select value={calcClass} onChange={(e) => setCalcClass(e.target.value)} className="form-input">
                {CLASS_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="form-label">Train type (decides the superfast charge)</span>
              <select value={calcTrain} onChange={(e) => setCalcTrain(e.target.value)} className="form-input">
                <option value="RAJDHANI">Rajdhani</option>
                <option value="SHATABDI">Shatabdi</option>
                <option value="DURONTO">Duronto</option>
              </select>
            </label>
            <label className="block">
              <span className="form-label">Quota</span>
              <select value={calcQuota} onChange={(e) => setCalcQuota(e.target.value)} className="form-input">
                <option value="GENERAL">General</option>
                <option value="TATKAL">Tatkal</option>
                <option value="LADIES">Ladies</option>
                <option value="SENIOR_CITIZEN">Senior citizen</option>
                <option value="DIVYAANG">Divyaang</option>
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="form-label">Concession (from the concession rules; none on Tatkal)</span>
              <select value={calcConcession} onChange={(e) => setCalcConcession(e.target.value)} className="form-input">
                <option value="NONE">None</option>
                <option value="DIVYAANG">Divyaang</option>
                <option value="SENIOR_CITIZEN">Senior citizen (only when the senior concession setting is on)</option>
              </select>
            </label>
          </div>

          <div className="lg:col-span-5 bg-slate-50 rounded-xl p-5 border border-slate-200 flex flex-col justify-between" aria-live="polite">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-600">Fare breakdown</span>
                <span className="text-xs font-mono font-semibold text-slate-700">{calcClass}, {calcDistance} km</span>
              </div>
              {calcError && <p className="text-xs text-rose-700" role="alert">{calcError}</p>}
              {calc && (
                <div className="space-y-2 text-xs">
                  {line('Base fare (distance × slab rate)', calc.baseFare)}
                  {line('Concession discount', -calc.concessionDiscount, calc.concessionDiscount === 0)}
                  {line('Reservation charge', calc.reservationCharge)}
                  {line('Superfast charge', calc.superfastCharge, calc.superfastCharge === 0)}
                  {line('Tatkal charge', calc.tatkalCharge, calc.tatkalCharge === 0)}
                  {line('Dynamic surcharge', calc.dynamicSurcharge, calc.dynamicSurcharge === 0)}
                  {line('GST', calc.gst)}
                  {line('Insurance', calc.insurance)}
                </div>
              )}
            </div>
            <div className="mt-4 pt-3 border-t-2 border-slate-300 flex items-baseline justify-between">
              <span className="text-sm font-bold text-slate-900">Total fare</span>
              <span className="text-2xl font-extrabold text-slate-900 font-mono">{calc ? formatCurrency(calc.totalFare) : '—'}</span>
            </div>
          </div>
        </div>
      </div>

      <DataTable
        data={fares}
        columns={columns}
        loading={loading}
        error={error}
        onRetry={loadData}
        pageSize={14}
        searchPlaceholder="Search by class, for example 3A..."
        searchFilter={(row, q) => classOf(row).toLowerCase().includes(q.toLowerCase())}
        emptyMessage="No fare slabs found."
      />

      <Modal isOpen={!!editing} onClose={() => setEditing(null)} title={`Edit fare slab, class ${editing ? classOf(editing) : ''}`} maxWidth="md">
        {editing && (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-xs text-slate-600">
              A slab says: tickets whose distance is between the minimum and the maximum pay this rate for every km. Slabs of one class should not overlap.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className="form-label">Minimum distance (km) *</span>
                <input type="number" min={0} required value={form.minDistanceKm} onChange={(e) => setForm({ ...form, minDistanceKm: Number(e.target.value) })} className="form-input mono" />
              </label>
              <label className="block">
                <span className="form-label">Maximum distance (km) *</span>
                <input type="number" min={1} required value={form.maxDistanceKm} onChange={(e) => setForm({ ...form, maxDistanceKm: Number(e.target.value) })} className="form-input mono" />
              </label>
            </div>
            <label className="block">
              <span className="form-label">Rate per km (₹) *</span>
              <input type="number" step="0.01" min={0.01} required value={form.ratePerKm} onChange={(e) => setForm({ ...form, ratePerKm: Number(e.target.value) })} className="form-input mono" />
            </label>
            {formError && <p className="text-xs text-rose-700" role="alert">{formError}</p>}
            <div className="form-section-divider flex items-center justify-end gap-2.5">
              <button type="button" onClick={() => setEditing(null)} className="btn-ghost">Cancel</button>
              <button type="submit" disabled={saving} className="btn-secondary">{saving ? 'Saving...' : 'Save slab'}</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};
