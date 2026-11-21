import React, { useEffect, useState } from 'react';
import { Shield, KeyRound, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { authService } from '../../services/authService';
import { PageHeader } from '../../components/PageHeader';

// SETTING keys that the database functions and procedures do NOT read.
// Changing them is saved and audited, but fare and refund results do not change.
// Only the settings the database does NOT read yet carry the "Reference only" badge.
// GST_RATE_AC, INSURANCE_PREMIUM_PER_PASSENGER, DYNAMIC_FARE_ENABLED, CONCESSION_SENIOR_ENABLED,
// MIN_CHARGEABLE_DISTANCE_KM, BOOKING_WINDOW_DAYS and CLERKAGE_PER_PASSENGER now drive the fare and refund
// functions, so a change here changes the next fare or refund.
const REFERENCE_ONLY_SETTING_KEYS = new Set([
  'MAX_PASSENGERS_PER_PNR',
  'MAX_PASSENGERS_PER_PNR_TATKAL',
  'CHART_HOURS_BEFORE_ORIGIN_DEPARTURE',
]);

export const SettingsPage: React.FC = () => {
  const { user } = useAuth();
  const [email, setEmail] = useState<string | null>(null);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSubmitting, setPwSubmitting] = useState(false);

  // Real email of the logged-in admin, from the server
  useEffect(() => {
    let cancelled = false;
    authService
      .getOwnProfile()
      .then((p) => {
        if (!cancelled) setEmail(p.email);
      })
      .catch(() => {
        if (!cancelled) setEmail(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(false);
    if (newPw.length < 8) {
      setPwError('The new password must be at least 8 characters long.');
      return;
    }
    if (newPw !== confirmPw) {
      setPwError('The new password and its confirmation do not match.');
      return;
    }
    setPwSubmitting(true);
    try {
      await authService.changePassword(currentPw, newPw);
      setPwSuccess(true);
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      setTimeout(() => setPwSuccess(false), 6000);
    } catch (err: any) {
      setPwError(err?.message || 'The password could not be changed.');
    } finally {
      setPwSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        title="Administrator Settings & Configuration"
        description="Manage your administrator profile, your password, and the system operating parameters."
      />

      {/* Admin Profile Overview */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
        <div className="flex items-center gap-4 pb-6 border-b border-slate-100">
          <div className="w-16 h-16 rounded-2xl bg-orange-600 text-white font-bold flex items-center justify-center text-2xl shadow-md shadow-orange-950/20">
            {user?.name ? user.name[0].toUpperCase() : 'A'}
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">{user?.name || 'Administrator'}</h3>
            <p className="text-xs text-slate-500 font-mono mt-0.5">Admin ID: #{user?.userId ?? '—'}</p>
            <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-orange-50 border border-orange-200 text-orange-700 text-xs font-semibold">
              <Shield className="w-3.5 h-3.5" />
              <span>Full System Authority (ADMIN)</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-6 text-xs">
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
            <span className="text-slate-400 font-semibold block uppercase">Official Email</span>
            <span className="text-slate-900 font-mono font-medium text-sm">
              {email ?? '—'}
            </span>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
            <span className="text-slate-400 font-semibold block uppercase">Assigned Division</span>
            <span className="text-slate-900 font-medium text-sm">
              Ministry of Railways / Central Operations
            </span>
          </div>
        </div>
      </div>

      {/* System Settings & Business Parameters (Contract 7.1) */}
      <SystemSettingsSection />

      {/* Password Change Security Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 rounded-xl bg-orange-50 text-orange-600">
            <KeyRound className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">Security Credentials</h3>
            <p className="text-xs text-slate-500">Update administrative password.</p>
          </div>
        </div>

        {pwSuccess && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>Password updated successfully. Use the new password the next time you sign in.</span>
          </div>
        )}

        {pwError && (
          <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600" />
            <span>{pwError}</span>
          </div>
        )}

        <form onSubmit={handlePasswordSubmit} className="space-y-4 max-w-md">
          <div>
            <label className="form-label">
              Current Password *
            </label>
            <input
              type="password"
              required
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              className="w-full text-sm border border-slate-300 rounded-lg p-2.5 font-mono focus:ring-2 focus:ring-orange-500 focus:outline-none"
              placeholder="••••••••••••"
            />
          </div>

          <div>
            <label className="form-label">
              New Password *
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              className="w-full text-sm border border-slate-300 rounded-lg p-2.5 font-mono focus:ring-2 focus:ring-orange-500 focus:outline-none"
              placeholder="••••••••••••"
            />
          </div>

          <div>
            <label className="form-label">
              Confirm New Password *
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              className="w-full text-sm border border-slate-300 rounded-lg p-2.5 font-mono focus:ring-2 focus:ring-orange-500 focus:outline-none"
              placeholder="••••••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={pwSubmitting}
            className="px-5 py-2.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors"
          >
            {pwSubmitting ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  );
};

const SystemSettingsSection: React.FC = () => {
  const [settings, setSettings] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editingKey, setEditingKey] = React.useState<string | null>(null);
  const [editValue, setEditValue] = React.useState('');
  const [saveLoading, setSaveLoading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const data = await import('../../services/settingService').then((m) => m.settingService.getSettings());
      setSettings(data);
    } catch (err: any) {
      console.error('Failed to load settings:', err);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    loadSettings();
  }, []);

  const handleSave = async (key: string) => {
    setSaveLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const service = await import('../../services/settingService').then((m) => m.settingService);
      await service.updateSetting(key, editValue);
      setSuccessMessage(`Setting ${key} updated successfully.`);
      setEditingKey(null);
      await loadSettings();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to update setting.');
    } finally {
      setSaveLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
      <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
        <div>
          <h3 className="text-base font-bold text-slate-900">System Operating Parameters (SETTING)</h3>
          <p className="text-xs text-slate-500">Live operational rules, holding timers, clerkage fees, and quota limits.</p>
          <p className="text-[11px] text-amber-700 mt-1">
            Fare and refund settings (GST, insurance premium, clerkage, minimum chargeable distance, dynamic fare, senior concession, booking window) are read by the database: a change applies to the next fare or refund. Rows marked "Reference only" are saved and audited, but the booking and chart rules still use built-in numbers for them.
          </p>
        </div>
        <button
          onClick={loadSettings}
          className="px-3 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
        >
          Refresh
        </button>
      </div>

      {successMessage && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800">
          {successMessage}
        </div>
      )}

      {errorMessage && (
        <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800">
          {errorMessage}
        </div>
      )}

      {loading ? (
        <div className="py-8 text-center text-xs text-slate-400">Loading system parameters...</div>
      ) : (
        <div className="divide-y divide-slate-100 text-xs">
          {settings.map((s) => (
            <div key={s.settingKey} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="max-w-md">
                <span className="font-mono font-bold text-slate-800">{s.settingKey}</span>
                {REFERENCE_ONLY_SETTING_KEYS.has(s.settingKey) && (
                  <span className="ml-2 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-semibold align-middle">
                    Reference only
                  </span>
                )}
                <p className="text-slate-500 text-[11px] mt-0.5">{s.description || 'System configuration parameter'}</p>
                {REFERENCE_ONLY_SETTING_KEYS.has(s.settingKey) && (
                  <p className="text-amber-700 text-[11px]">Reference only. The booking and chart rules still use built-in numbers for this value.</p>
                )}
                {s.updatedAt && (
                  <span className="text-[10px] text-slate-400 font-mono">Updated: {s.updatedAt}</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {editingKey === s.settingKey ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="px-2.5 py-1 text-xs border border-orange-500 rounded font-mono focus:outline-none"
                    />
                    <button
                      onClick={() => handleSave(s.settingKey)}
                      disabled={saveLoading}
                      className="px-2.5 py-1 bg-orange-600 text-white rounded font-semibold text-xs hover:bg-orange-700"
                    >
                      {saveLoading ? '...' : 'Save'}
                    </button>
                    <button
                      onClick={() => setEditingKey(null)}
                      className="px-2 py-1 text-slate-500 hover:bg-slate-100 rounded text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-bold px-2.5 py-1 rounded bg-slate-100 text-slate-800">
                      {s.settingValue}
                    </span>
                    <button
                      onClick={() => {
                        setEditingKey(s.settingKey);
                        setEditValue(s.settingValue);
                        setErrorMessage(null);
                        setSuccessMessage(null);
                      }}
                      className="text-xs text-orange-600 hover:text-orange-700 font-semibold"
                    >
                      Edit
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

