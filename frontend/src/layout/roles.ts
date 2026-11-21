import { useEffect } from 'react';
import { Role } from '../auth/session';

/**
 * How each role looks and where its pages live. Used by the shared shell, the command palette and the page title.
 * Passenger = blue, Station staff = green, Admin = amber (same colours as --role-* in public/rrms-theme.css).
 */
export const ROLE_META: Record<Role, { badge: string; sidebar: string; tab: string; color: string; home: string; live: string }> = {
  PASSENGER: { badge: 'Passenger', sidebar: 'Passenger', tab: 'Passenger', color: '#4c86f0', home: '/passenger', live: '/passenger/live-trains' },
  STAFF: { badge: 'Station staff', sidebar: 'Station staff', tab: 'Staff', color: '#34d399', home: '/staff', live: '/staff?tab=live-trains' },
  ADMIN: { badge: 'Admin', sidebar: 'ADMIN MODE', tab: 'Admin', color: '#f5a524', home: '/admin', live: '/admin/live-trains' },
};

const faviconFor = (color: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#0f1729"/><rect x="14" y="16" width="36" height="30" rx="8" fill="${color}"/><rect x="19" y="22" width="11" height="9" rx="2" fill="#0f1729"/><rect x="34" y="22" width="11" height="9" rx="2" fill="#0f1729"/><circle cx="23" cy="52" r="4" fill="#fff"/><circle cx="41" cy="52" r="4" fill="#fff"/></svg>`,
  )}`;

/** Page title per page ("RRMS - Admin | Trains") and a tab icon in the colour of the role. */
export function usePageMeta(title: string, role?: Role | null) {
  useEffect(() => {
    document.title = role ? `RRMS - ${ROLE_META[role].tab} | ${title}` : `${title} | RRMS`;
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (link) link.href = role ? faviconFor(ROLE_META[role].color) : '/favicon.svg';
  }, [title, role]);
}
