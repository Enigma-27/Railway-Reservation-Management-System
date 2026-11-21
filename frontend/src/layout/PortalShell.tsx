import React, { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Bell, ChevronDown, CircleHelp, LogOut, Menu, Search, Train, X } from 'lucide-react';
import { Role } from '../auth/session';
import { ThemeToggle } from '../theme/ThemeProvider';
import { useContact } from '../ui/ContactDrawer';
import { useCommandPalette, useCommands } from '../ui/CommandPalette';
import { ROLE_META, usePageMeta } from './roles';
import { useAutoLabel } from './autoLabel';
import { useEnhanceInputs } from '../ui/enhance';
import './shell.css';

export interface NavItem {
  key: string; label: string; icon: React.ElementType;
  /** route (NavLink) ... */
  to?: string; end?: boolean;
  /** ... or a button for state based pages */
  onSelect?: () => void; active?: boolean;
  badge?: number | string; danger?: boolean; description?: string;
}
export interface NavSection { title: string; items: NavItem[] }

export interface PortalShellProps {
  role: Role;
  sections: NavSection[];
  /** the page the visitor is on: drives breadcrumb, help hint and the browser tab title */
  page: { title: string; section?: string; help?: string };
  user: { name: string; sub?: string };
  onSignOut: () => void;
  bell?: { count: number; onClick: () => void };
  /** small extras in the top bar (for example the active train of a staff member) */
  topExtra?: React.ReactNode;
  /** extra rows inside the profile menu */
  profileExtra?: React.ReactNode;
  /** keep the children mounted when the page changes (the passenger portal hosts a page controller that must not be re-created) */
  persist?: boolean;
  children: React.ReactNode;
}

/**
 * ONE layout skeleton for the passenger, staff and admin portals:
 * role colour bar, top bar (Ctrl+K, bell, theme toggle, profile menu with role badge), sidebar with the role label,
 * breadcrumb + "what is this page?" hint, content, footer (Home, Live Trains, Contact).
 * Same things sit in the same places in every portal.
 */
export const PortalShell: React.FC<PortalShellProps> = ({ role, sections, page, user, onSignOut, bell, topExtra, profileExtra, persist, children }) => {
  const meta = ROLE_META[role];
  const location = useLocation();
  const navigate = useNavigate();
  const contact = useContact();
  const palette = useCommandPalette();
  const [menu, setMenu] = useState(false);
  const [profile, setProfile] = useState(false);
  const [help, setHelp] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  usePageMeta(page.title, role);
  useAutoLabel('#main', [role]);
  // native selects and date fields become the same accessible custom controls as on the landing page
  useEnhanceInputs('#main', [role]);

  // page shortcuts for Ctrl+K
  useCommands('portal', sections.flatMap((s) => s.items.map((i) => ({
    id: `nav-${i.key}`, group: s.title, label: i.label, hint: 'Open page',
    run: () => (i.to ? navigate(i.to) : i.onSelect?.()),
  }))));

  useEffect(() => { setMenu(false); setProfile(false); setHelp(false); }, [location.pathname, location.search]);
  useEffect(() => {
    if (!profile) return;
    const down = (e: MouseEvent) => { if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfile(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setProfile(false); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [profile]);

  const initials = (user.name || '?').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  const renderItem = (it: NavItem) => {
    const Icon = it.icon;
    const inner = (
      <>
        <Icon size={17} aria-hidden="true" />
        <span className="shell-nav-label">{it.label}</span>
        {it.badge !== undefined && it.badge !== 0 && <span className={it.danger ? 'shell-badge danger' : 'shell-badge'}>{it.badge}</span>}
      </>
    );
    if (it.to) {
      return <NavLink key={it.key} to={it.to} end={it.end} className={({ isActive }) => `shell-nav-item${isActive ? ' active' : ''}${it.danger ? ' danger' : ''}`}>{inner}</NavLink>;
    }
    return <button key={it.key} type="button" className={`shell-nav-item${it.active ? ' active' : ''}${it.danger ? ' danger' : ''}`} aria-current={it.active ? 'page' : undefined} onClick={it.onSelect}>{inner}</button>;
  };

  return (
    <div className="shell" data-role={role.toLowerCase()}>
      <div className="shell-bar" aria-hidden="true" />
      <aside className={`shell-side${menu ? ' open' : ''}`} aria-label={`${meta.badge} navigation`}>
        <div className="shell-side-head">
          <Link to="/" className="shell-brand">
            <span className="shell-logo" aria-hidden="true"><Train size={18} /></span>
            <span><strong>RRMS</strong><small className="shell-role-label">{meta.sidebar}</small></span>
          </Link>
          <button type="button" className="rrms-icon-btn shell-close" onClick={() => setMenu(false)} aria-label="Close menu"><X size={18} aria-hidden="true" /></button>
        </div>
        <nav className="shell-nav" aria-label="Pages">
          {sections.map((s) => (
            <div key={s.title} className="shell-nav-group">
              <span className="t-label">{s.title}</span>
              {s.items.map(renderItem)}
            </div>
          ))}
        </nav>
      </aside>
      {menu && <button type="button" className="shell-scrim" aria-label="Close menu" onClick={() => setMenu(false)} />}

      <div className="shell-main">
        <header className="shell-top">
          <button type="button" className="rrms-icon-btn shell-burger" onClick={() => setMenu(true)} aria-label="Open menu" aria-expanded={menu}><Menu size={18} aria-hidden="true" /></button>
          <button type="button" className="shell-search" onClick={palette.open}>
            <Search size={16} aria-hidden="true" /><span>Search pages, trains, PNR</span><kbd>Ctrl K</kbd>
          </button>
          {topExtra}
          <div className="shell-spacer" />
          {bell && (
            <button type="button" className="rrms-icon-btn" onClick={bell.onClick} aria-label={`Notifications: ${bell.count} unread`}>
              <Bell size={18} aria-hidden="true" />
              {bell.count > 0 && <span className="shell-bell-count">{bell.count > 99 ? '99+' : bell.count}</span>}
            </button>
          )}
          <ThemeToggle />
          <div className="shell-profile" ref={profileRef}>
            <button type="button" className="shell-profile-btn" onClick={() => setProfile((v) => !v)} aria-haspopup="menu" aria-expanded={profile}>
              <span className="shell-avatar" aria-hidden="true">{initials}</span>
              <span className="shell-who"><strong>{user.name}</strong><span className="shell-role-badge">{meta.badge}</span></span>
              <ChevronDown size={15} aria-hidden="true" className={profile ? 'up' : ''} />
            </button>
            {profile && (
              <div className="shell-menu" role="menu">
                <div className="shell-menu-head">
                  <span className="shell-avatar big" aria-hidden="true">{initials}</span>
                  <div><strong>{user.name}</strong>{user.sub && <small>{user.sub}</small>}<span className="shell-role-badge">{meta.badge}</span></div>
                </div>
                {profileExtra}
                <button type="button" role="menuitem" className="shell-menu-out" onClick={onSignOut}><LogOut size={16} aria-hidden="true" /> Sign out</button>
              </div>
            )}
          </div>
        </header>

        <div className="shell-content">
          <div className="shell-crumbs">
            <nav aria-label="Breadcrumb">
              <ol>
                <li>{meta.badge}</li>
                {page.section && <li>{page.section}</li>}
                <li aria-current="page">{page.title}</li>
              </ol>
            </nav>
            {page.help && (
              <button type="button" className="shell-help-btn" onClick={() => setHelp((v) => !v)} aria-expanded={help} aria-controls="page-help">
                <CircleHelp size={15} aria-hidden="true" /> What is this page?
              </button>
            )}
          </div>
          {help && page.help && <p id="page-help" className="shell-help" role="note">{page.help}</p>}
          <main id="main">{persist ? children : <div className="page-enter" key={`${location.pathname}${location.search}`}>{children}</div>}</main>
        </div>

        <footer className="shell-foot">
          <span>RRMS {meta.badge} portal</span>
          <nav aria-label="Footer">
            <Link to="/">Home</Link>
            <Link to={meta.live.split('?')[0]}>Live Trains</Link>
            <button type="button" onClick={contact.open}>Contact</button>
          </nav>
        </footer>
      </div>
    </div>
  );
};
