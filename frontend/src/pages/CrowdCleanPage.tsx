import React, { useState } from 'react';
import { useStaff } from '../context/StaffContext';
import { Users, Sparkles } from 'lucide-react';

export const CrowdCleanPage: React.FC = () => {
  const { activeStaff, addCrowdReport, addCleanlinessReport } = useStaff();

  // Crowd Form State
  const [platform, setPlatform] = useState(1);
  const [crowdLevel, setCrowdLevel] = useState<'LOW' | 'MODERATE' | 'HIGH' | 'OVERCROWDED'>('MODERATE');
  const [headCount, setHeadCount] = useState<string>('');

  // Clean Form State
  const [issueType, setIssueType] = useState('TOILET_DIRTY');
  const [description, setDescription] = useState('');
  const [crowdSubmitting, setCrowdSubmitting] = useState(false);
  const [cleanSubmitting, setCleanSubmitting] = useState(false);

  const handleCrowdSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (crowdSubmitting || !activeStaff.assignedStationId) return;
    setCrowdSubmitting(true);
    try {
      await addCrowdReport({
        stationId: activeStaff.assignedStationId,
        platformNumber: platform,
        crowdLevel,
        headCount: Number(headCount),
        recordedBy: activeStaff.staffId
      });
      setHeadCount('');
    } catch {
      // The error message was already shown
    } finally {
      setCrowdSubmitting(false);
    }
  };

  const handleCleanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim() || cleanSubmitting) return;
    setCleanSubmitting(true);
    try {
      await addCleanlinessReport({
        reportedBy: activeStaff.staffId,
        trainId: activeStaff.assignedTrainId ?? null,
        coachId: null,
        stationId: activeStaff.assignedStationId || null,
        platformNumber: null,
        issueType,
        description: description.trim()
      });
      setDescription('');
    } catch {
      // The error message was already shown
    } finally {
      setCleanSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Crowd Monitoring Card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-5">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-5 h-5 text-orange-600" />
            <span>Platform Crowd Assessment</span>
          </h3>
          <p className="text-xs text-slate-500 mt-1">Record live passenger density levels and headcounts.</p>
          {!activeStaff.assignedStationId && (
            <p className="text-[11px] text-amber-700 mt-1">No station is assigned to you, so a crowd report cannot be saved.</p>
          )}
        </div>

        <form onSubmit={handleCrowdSubmit} className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-slate-700 block mb-1">Platform #</label>
              <input
                type="number"
                min={1}
                max={24}
                value={platform}
                onChange={(e) => setPlatform(Number(e.target.value))}
                className="w-full bg-white border border-slate-200 focus:border-orange-500 rounded-lg px-3 py-1.5 text-xs text-slate-800 outline-none font-mono"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-700 block mb-1">Density Grade</label>
              <select
                value={crowdLevel}
                onChange={(e) => setCrowdLevel(e.target.value as any)}
                className="w-full bg-white border border-slate-200 focus:border-orange-500 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 outline-none cursor-pointer"
              >
                <option value="LOW">LOW</option>
                <option value="MODERATE">MODERATE</option>
                <option value="HIGH">HIGH</option>
                <option value="OVERCROWDED">OVERCROWDED</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-slate-700 block mb-1">Estimated Pax Headcount *</label>
            <input
              type="number"
              required
              min={0}
              value={headCount}
              onChange={(e) => setHeadCount(e.target.value)}
              className="w-full bg-white border border-slate-200 focus:border-orange-500 rounded-lg px-3 py-1.5 text-xs text-slate-800 outline-none font-mono"
            />
          </div>

          <button
            type="submit"
            disabled={crowdSubmitting || !activeStaff.assignedStationId}
            className="w-full py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-xs transition-all mt-1"
          >
            {crowdSubmitting ? 'Recording Assessment...' : 'Record Crowd Assessment'}
          </button>
        </form>

        <p className="text-[11px] text-slate-400">
          Reports are saved on the server. The server does not give officers a list of past reports, so none are shown here.
        </p>
      </div>

      {/* Cleanliness / Hygiene Card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-5">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-orange-600" />
            <span>Housekeeping & Hygiene Tickets</span>
          </h3>
          <p className="text-xs text-slate-500 mt-1">Dispatch cleaning crews for washroom, litter, or AC complaints.</p>
        </div>

        <form onSubmit={handleCleanSubmit} className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
          <div>
            <label className="text-[11px] font-semibold text-slate-700 block mb-1">Issue Category</label>
            <select
              value={issueType}
              onChange={(e) => setIssueType(e.target.value)}
              className="w-full bg-white border border-slate-200 focus:border-orange-500 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 outline-none cursor-pointer"
            >
              <option value="TOILET_DIRTY">TOILET_DIRTY (Washroom unsanitary)</option>
              <option value="LITTER">LITTER (Garbage accumulation)</option>
              <option value="WATER_SHORTAGE">WATER_SHORTAGE (Water tank empty)</option>
              <option value="LINEN_SOILED">LINEN_SOILED (Soiled bed linen)</option>
              <option value="PESTS">PESTS (Insects or rodents)</option>
              <option value="SPILLAGE">SPILLAGE (Liquid or food spill)</option>
            </select>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-slate-700 block mb-1">Location Details & Description *</label>
            <textarea
              required
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Coach B1 toilet water pressure issue, passenger reported..."
              className="w-full bg-white border border-slate-200 focus:border-orange-500 rounded-lg p-2.5 text-xs text-slate-800 outline-none placeholder:text-slate-400 resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={cleanSubmitting}
            className="w-full py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-xs transition-all"
          >
            {cleanSubmitting ? 'Dispatching Ticket...' : 'Dispatch Housekeeping Ticket'}
          </button>
        </form>

        <p className="text-[11px] text-slate-400">
          Tickets are saved on the server. The server does not give officers a list of past tickets, so none are shown here.
        </p>
      </div>
    </div>
  );
};
