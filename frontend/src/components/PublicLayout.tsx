import React, { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Bell, Search, Train } from 'lucide-react';
import { publicApi, ServiceAlert } from '../services/publicApi';
import { useAuth } from '../admin/auth/AuthContext';
import { HOME_PATH } from '../auth/session';
import { ThemeToggle } from '../theme/ThemeProvider';
import { useContact } from '../ui/ContactDrawer';
import { useCommandPalette, useCommands } from '../ui/CommandPalette';
import { ROLE_META, usePageMeta } from '../layout/roles';
import './public.css';

/** Header navigation: Home, Train Info and Live Trains. */
export const PUBLIC_NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/train-info', label: 'Train Info', end: false },
  { to: '/live-trains', label: 'Live Trains', end: false },
];

export const BRAND_NAME = 'Railway Reservation & Management System';
export const BRAND_SHORT = 'RRMS';

export function BrandMark() {
  return (
    <Link to="/" className="pub-brand">
      <span className="pub-logo" aria-hidden="true"><Train size={20} /></span>
      <span className="pub-brand-text">
        <strong>{BRAND_SHORT}</strong>
        <small>Railway Reservation &amp; Management</small>
      </span>
    </Link>
  );
}

/**
 * Header (logo, Home / Train Info / Live Trains, Ctrl+K, Contact, alerts bell, theme toggle, sign-in or "My portal"),
 * the visible alerts strip, the page content and the footer.
 */
export const PublicLayout: React.FC<{ children: React.ReactNode; title?: string }> = ({ children, title = 'Railway tickets, live trains and PNR' }) => {
  const { session } = useAuth();
  const contact = useContact();
  const palette = useCommandPalette();
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<ServiceAlert[] | null>(null);
  const [alertError, setAlertError] = useState(false);

  usePageMeta(title, null);
  useCommands('public', [
    { id: 'p-home', group: 'Pages', label: 'Home', run: () => navigate('/') },
    { id: 'p-info', group: 'Pages', label: 'Train Info', run: () => navigate('/train-info') },
    { id: 'p-live', group: 'Pages', label: 'Live Trains', run: () => navigate('/live-trains') },
    { id: 'p-contact', group: 'Pages', label: 'Contact us', run: contact.open },
  ]);

  useEffect(() => {
    let live = true;
    publicApi.alerts().then((a) => live && setAlerts(a)).catch(() => live && setAlertError(true));
    return () => { live = false; };
  }, []);

  const count = alerts ? alerts.length : 0;

  return (
    <div className="pub-page">
      <header className="pub-header">
        <BrandMark />
        <nav className="pub-nav" aria-label="Main navigation">
          {PUBLIC_NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'pub-nav-link active' : 'pub-nav-link')}>
              {n.label}
            </NavLink>
          ))}
          <button type="button" className="pub-nav-link pub-nav-btn" onClick={contact.open}>Contact</button>
        </nav>
        <div className="pub-actions">
          <button type="button" className="rrms-icon-btn" onClick={palette.open} aria-label="Search pages, trains or PNR (Ctrl+K)" title="Search (Ctrl+K)"><Search size={18} aria-hidden="true" /></button>
          <a className="rrms-icon-btn pub-bell" href="#service-alerts" aria-label={`Service alerts: ${count}`}>
            <Bell size={18} aria-hidden="true" />
            <span className={count > 0 ? 'pub-bell-count has' : 'pub-bell-count'}>{count}</span>
          </a>
          <ThemeToggle />
          {session && (
            <Link className={`pub-portal pub-portal-${session.role.toLowerCase()}`} to={HOME_PATH[session.role]}>
              {ROLE_META[session.role].badge} portal
            </Link>
          )}
        </div>
      </header>

      <section id="service-alerts" className="pub-alerts" aria-label="Service alerts" aria-live="polite">
        <span className="pub-alerts-title"><Bell size={15} aria-hidden="true" /> Service alerts</span>
        {alertError && <span className="pub-alerts-empty">Alerts are not available right now.</span>}
        {!alertError && alerts === null && <span className="pub-alerts-empty">Checking alerts...</span>}
        {!alertError && alerts && alerts.length === 0 && (
          <span className="pub-alerts-empty">No service alerts. Every train of the next 7 days is on time.</span>
        )}
        {alerts && alerts.length > 0 && (
          <ul className="pub-alerts-list">
            {alerts.slice(0, 4).map((a) => (
              <li key={a.scheduleId} className={a.severity === 'CRITICAL' ? 'crit' : 'warn'}>
                <strong className="mono">{a.trainNumber}</strong> {a.message}
              </li>
            ))}
            {alerts.length > 4 && <li className="more">and {alerts.length - 4} more</li>}
          </ul>
        )}
      </section>

      {children}

      <footer className="pub-footer">
        <div className="pub-footer-in">
          <div>
            <BrandMark />
            <p>Search schedules, book seats, follow live trains and manage your journey in one place.</p>
          </div>
          <nav aria-label="Footer">
            <span className="t-label">Explore</span>
            <Link to="/">Home</Link>
            <Link to="/train-info">Train Info</Link>
            <Link to="/live-trains">Live Trains</Link>
          </nav>
          <nav aria-label="Help">
            <span className="t-label">Help</span>
            <button type="button" onClick={contact.open}>Contact</button>
            <a href="#service-alerts">Service alerts</a>
            <Link to="/train-info">PNR enquiry</Link>
          </nav>
        </div>
        <p className="pub-copy">RRMS demo system. Fares and helpline are demo values.</p>
      </footer>
    </div>
  );
};
