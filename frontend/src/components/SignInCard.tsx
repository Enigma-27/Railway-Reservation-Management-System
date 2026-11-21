import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../admin/auth/AuthContext';
import { DEMO_ACCOUNTS, HOME_PATH, ROLE_LABEL, Role, registerPassenger } from '../auth/session';

const ROLES: Role[] = ['PASSENGER', 'STAFF', 'ADMIN'];
const ID_LABEL: Record<Role, string> = { PASSENGER: 'Passenger email', STAFF: 'Employee ID', ADMIN: 'Admin email' };
const ID_PLACEHOLDER: Record<Role, string> = { PASSENGER: 'you@example.com', STAFF: 'EMP-TC-101', ADMIN: 'admin@railways.gov.in' };

/**
 * THE sign-in card. It is the only place on the site that signs anybody in.
 * The role tab decides which backend login route is called. Signed in already: shows "Go to my portal".
 */
export const SignInCard: React.FC<{ role: Role; onRoleChange: (r: Role) => void; notice?: string | null }> = ({ role, onRoleChange, notice }) => {
  const { session, signIn, signOut, login } = useAuth();
  const navigate = useNavigate();
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [reg, setReg] = useState({ name: '', phone: '' });

  void login; // kept in the context for the admin screens

  if (session) {
    return (
      <div className="signin-card" aria-label="You are signed in">
        <h2>Welcome back</h2>
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
    <div className="signin-card">
      <h2>{registering ? 'Create passenger account' : 'Sign in'}</h2>
      <p className="signin-sub">{registering ? 'New passengers only' : 'Choose your role to continue'}</p>

      <div className="signin-tabs" role="tablist" aria-label="Sign-in role">
        {ROLES.map((r) => (
          <button key={r} type="button" role="tab" id={`tab-${r}`} aria-selected={role === r} className="signin-tab" onClick={() => pickRole(r)}>
            {ROLE_LABEL[r]}
          </button>
        ))}
      </div>

      {notice && <p className="rrms-alert-info signin-note" role="status">{notice}</p>}

      <form className="signin-form" onSubmit={submit} aria-labelledby={`tab-${role}`} noValidate>
        {registering && (
          <label className="rrms-field">Full name
            <input className="rrms-input" value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value })} autoComplete="name" />
          </label>
        )}
        <label className="rrms-field">{ID_LABEL[role]}
          <input className="rrms-input" value={id} onChange={(e) => setId(e.target.value)} placeholder={ID_PLACEHOLDER[role]} autoComplete="username" />
        </label>
        {registering && (
          <label className="rrms-field">Phone
            <input className="rrms-input" value={reg.phone} onChange={(e) => setReg({ ...reg, phone: e.target.value })} placeholder="+91-9876543210" autoComplete="tel" />
          </label>
        )}
        <label className="rrms-field">Password
          <span className="signin-pass">
            <input className="rrms-input" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={registering ? 'new-password' : 'current-password'} />
            <button type="button" className="signin-toggle" onClick={() => setShow(!show)} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button>
          </span>
        </label>

        <div className="signin-links">
          {!registering ? (
            <button type="button" className="signin-link" onClick={useDemo}>Use demo account</button>
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
