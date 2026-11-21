import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Sparkles } from 'lucide-react';
import { useAuth } from '../admin/auth/AuthContext';
import { DEMO_ACCOUNTS, HOME_PATH, ROLE_LABEL, Role, registerPassenger } from '../auth/session';
import { Tabs } from '../ui/Tabs';
import { ROLE_META } from '../layout/roles';

const ROLES: Role[] = ['PASSENGER', 'STAFF', 'ADMIN'];
const ID_LABEL: Record<Role, string> = { PASSENGER: 'Passenger email', STAFF: 'Employee ID', ADMIN: 'Admin email' };
const ID_PLACEHOLDER: Record<Role, string> = { PASSENGER: 'you@example.com', STAFF: 'TC101', ADMIN: 'admin@rrms.in' };
const TAB_LABEL: Record<Role, string> = { PASSENGER: 'Passenger', STAFF: 'Staff / TC', ADMIN: 'Admin' };

/**
 * THE sign-in card. It is the only place on the site that signs anybody in.
 * The role tab (sliding indicator) decides which backend login route is called.
 * The fields are EMPTY until the visitor types or presses "Use demo account" (which fills them for the chosen role).
 * Signed in already: shows "Go to my portal".
 */
export const SignInCard: React.FC<{ role: Role; onRoleChange: (r: Role) => void; notice?: string | null }> = ({ role, onRoleChange, notice }) => {
  const { session, signIn, signOut } = useAuth();
  const navigate = useNavigate();
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [reg, setReg] = useState({ name: '', phone: '' });

  if (session) {
    return (
      <div className="signin-card rrms-glass" id="signin" aria-label="You are signed in">
        <h2 className="t-display">Welcome <em>back</em></h2>
        <p className="signin-sub">Signed in as <strong>{String(session.user.name)}</strong> ({ROLE_LABEL[session.role]})</p>
        <div style={{ display: 'grid', gap: 10 }}>
          <button type="button" className="rrms-btn rrms-btn-primary" onClick={() => navigate(HOME_PATH[session.role])}>Go to my portal</button>
          <button type="button" className="rrms-btn rrms-btn-secondary" onClick={() => signOut()}>Sign out</button>
        </div>
      </div>
    );
  }

  const pickRole = (r: Role) => {
    onRoleChange(r);
    setId('');
    setPassword('');
    setError(null);
    setMode('signin');
  };

  const useDemo = () => {
    setId(DEMO_ACCOUNTS[role].id);
    setPassword(DEMO_ACCOUNTS[role].password);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'register') {
        if (reg.name.trim().length < 2) throw new Error('Please enter your full name.');
        if (!id.includes('@')) throw new Error('Please enter a valid email address.');
        if (reg.phone.trim().length < 8) throw new Error('Please enter a valid phone number.');
        if (password.length < 6) throw new Error('Password must be at least 6 characters long.');
        await registerPassenger({ name: reg.name.trim(), email: id.trim(), phone: reg.phone.trim(), password });
        window.dispatchEvent(new Event('storage'));
        navigate(HOME_PATH.PASSENGER);
        return;
      }
      const next = await signIn(role, id, password);
      navigate(HOME_PATH[next.role]);
    } catch (err: any) {
      setError(err && err.message ? err.message : 'Sign-in failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const registering = mode === 'register' && role === 'PASSENGER';

  return (
    <div className="signin-card rrms-glass" id="signin">
      <h2 className="t-display">{registering ? <>Create <em>account</em></> : <>Sign <em>in</em></>}</h2>
      <p className="signin-sub">{registering ? 'New passengers only' : 'Choose your role to continue'}</p>

      <Tabs<Role> label="Sign-in role" idPrefix="signin" value={role} onChange={pickRole} items={ROLES.map((r) => ({ value: r, label: TAB_LABEL[r], accent: r === 'ADMIN' ? '#b45309' : r === 'STAFF' ? '#047857' : undefined }))} />
      <span className="sr-only" aria-live="polite">{ROLE_META[role].badge} sign-in selected</span>

      {notice && <p className="rrms-alert-info signin-note" role="status">{notice}</p>}

      <form className="signin-form" onSubmit={submit} role="tabpanel" aria-labelledby={`signin-tab-${role}`} noValidate>
        {registering && (
          <label className="rrms-field">Full name
            <input className="rrms-input" value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value })} autoComplete="name" />
          </label>
        )}
        <label className="rrms-field">{ID_LABEL[role]}
          <input className="rrms-input" value={id} onChange={(e) => setId(e.target.value)} placeholder={ID_PLACEHOLDER[role]} autoComplete={registering ? 'email' : 'off'} />
        </label>
        {registering && (
          <label className="rrms-field">Phone
            <input className="rrms-input" value={reg.phone} onChange={(e) => setReg({ ...reg, phone: e.target.value })} placeholder="+91-9876543210" autoComplete="tel" />
          </label>
        )}
        <label className="rrms-field">Password
          <span className="signin-pass">
            <input className="rrms-input" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            <button type="button" className="signin-toggle" onClick={() => setShow(!show)} aria-pressed={show} aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
            </button>
          </span>
        </label>

        <div className="signin-links">
          {!registering ? (
            <button type="button" className="signin-link" onClick={useDemo}><Sparkles size={13} aria-hidden="true" /> Use demo account</button>
          ) : <span />}
          {role === 'PASSENGER' && (
            <button type="button" className="signin-link" onClick={() => { setMode(registering ? 'signin' : 'register'); setError(null); }}>
              {registering ? 'I already have an account' : 'New passenger? Create an account'}
            </button>
          )}
        </div>

        {error && <div className="rrms-alert-error" role="alert">{error}</div>}

        <button type="submit" className="rrms-btn rrms-btn-primary" disabled={busy}>
          {busy ? 'Please wait...' : registering ? 'Create account' : `Sign in as ${ROLE_LABEL[role]}`}
        </button>
      </form>
    </div>
  );
};
