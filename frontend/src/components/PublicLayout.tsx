import React, { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Bell, Train } from 'lucide-react';
import { publicApi, ServiceAlert } from '../services/publicApi';
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
    <Link to="/" className="pub-brand" aria-label={`${BRAND_NAME} (${BRAND_SHORT}) home`}>
      <span className="pub-logo" aria-hidden="true"><Train size={20} /></span>
      <span className="pub-brand-text">
        <strong>{BRAND_NAME}</strong>
        <small>{BRAND_SHORT}</small>
      </span>
    </Link>
  );
}

/** Header (logo, name, Home, Train Info, alerts bell with count) + the visible alerts strip + page content. */
export const PublicLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [alerts, setAlerts] = useState<ServiceAlert[] | null>(null);
  const [alertError, setAlertError] = useState(false);

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
        </nav>
        <a className="pub-bell" href="#service-alerts" aria-label={`Service alerts: ${count}`}>
          <Bell size={18} aria-hidden="true" />
          <span className={count > 0 ? 'pub-bell-count has' : 'pub-bell-count'}>{count}</span>
        </a>
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
                <strong>{a.trainNumber}</strong> {a.message}
              </li>
            ))}
            {alerts.length > 4 && <li className="more">and {alerts.length - 4} more</li>}
          </ul>
        )}
      </section>

      {children}
    </div>
  );
};
