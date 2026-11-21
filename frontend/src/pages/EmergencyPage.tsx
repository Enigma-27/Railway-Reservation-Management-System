import React, { useState } from 'react';
import { useStaff } from '../context/StaffContext';
import { AlertOctagon } from 'lucide-react';
import { Incident } from '../types';

export const EmergencyPage: React.FC = () => {
  const { activeStaff, reportIncident } = useStaff();

  const [type, setType] = useState('MEDICAL_EMERGENCY');
  const [severity, setSeverity] = useState<Incident['severity']>('HIGH');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim() || submitting) return;

    setSubmitting(true);
    try {
      await reportIncident({
        reportedBy: activeStaff.staffId,
        type,
        severity,
        locationType: activeStaff.assignedTrainId ? 'TRAIN' : 'STATION',
        stationId: activeStaff.assignedStationId,
        trainId: activeStaff.assignedTrainId,
        description: description.trim()
      });

      setDescription('');
    } catch {
      // The error message was already shown; the form keeps what was typed
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* SOS Alert Banner & Form - Matching Admin Design */}
      <div className="bg-rose-50/70 border border-rose-200 rounded-2xl p-6 shadow-xs">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-rose-600 text-white flex items-center justify-center shadow-xs">
            <AlertOctagon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-rose-900">Emergency Escalation & SOS Broadcast</h3>
            <p className="text-xs text-rose-700">Direct transmission to Divisional Control Desk, RPF Police, & Medical Responders.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 mt-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-rose-900 block mb-1">Nature of Incident *</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full bg-white border border-rose-200 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none focus:border-rose-500 cursor-pointer"
              >
                <option value="MEDICAL_EMERGENCY">MEDICAL_EMERGENCY (Doctor requested at next halt)</option>
                <option value="THEFT">THEFT / CRIME (RPF squad requested)</option>
                <option value="TECHNICAL_FAILURE">TECHNICAL_FAILURE (Coach / braking / track issue)</option>
                <option value="SECURITY_BREACH">SECURITY_BREACH (Unruly passenger / disturbance)</option>
                <option value="FIRE_SMOKE">FIRE / SMOKE (Immediate emergency stop)</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-rose-900 block mb-1">Threat Severity Level *</label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as Incident['severity'])}
                className="w-full bg-white border border-rose-200 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none focus:border-rose-500 cursor-pointer"
              >
                <option value="HIGH">HIGH (Urgent operational response required)</option>
                <option value="CRITICAL">CRITICAL (Life safety threat / train halt)</option>
                <option value="MEDIUM">MEDIUM (Standard security attention)</option>
                <option value="LOW">LOW (Log record)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-rose-900 block mb-1">Incident Summary & Specific Location Details *</label>
            <textarea
              required
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="State passenger berth, coach number, symptoms, or suspect description..."
              className="w-full bg-white border border-rose-200 rounded-xl p-3 text-xs text-slate-800 outline-none focus:border-rose-500 placeholder:text-slate-400 resize-none"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-xs flex items-center gap-2 transition-all"
            >
              <AlertOctagon className="w-4 h-4" />
              <span>{submitting ? 'Transmitting Alert...' : 'Transmit Critical SOS Alert'}</span>
            </button>
          </div>
        </form>
      </div>

      <p className="text-[11px] text-slate-400">
        Incidents are saved on the server and sent to the control office. The server does not give officers a list of past incidents, so none are shown here.
      </p>
    </div>
  );
};
