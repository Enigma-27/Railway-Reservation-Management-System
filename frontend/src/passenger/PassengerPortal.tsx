import React, { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Bell, Home, IdCard, LifeBuoy, ReceiptText, Search, Ticket, Train, UserRound } from 'lucide-react';
import { useAuth } from '../admin/auth/AuthContext';
import { NavSection, PortalShell } from '../layout/PortalShell';
import pagesHtml from './legacy/pages.html?raw';
import './legacy/legacy.css';
import './passenger.css';

/** URL segment <-> page id of the legacy page controller (src/passenger/legacy/app.js) */
const SEGMENT_TO_PAGE: Record<string, string> = {
  '': 'home', book: 'search', bookings: 'bookings', pnr: 'pnr', profile: 'profile', tdr: 'tdr', grievances: 'grievances', alerts: 'alerts', passengers: 'passengers',
};
const PAGE_TO_PATH: Record<string, string> = {
  home: '/passenger', search: '/passenger/book', bookings: '/passenger/bookings', pnr: '/passenger/pnr', profile: '/passenger/profile',
  tdr: '/passenger/tdr', grievances: '/passenger/grievances', alerts: '/passenger/alerts', passengers: '/passenger/passengers',
};

const PAGE_INFO: Record<string, { title: string; section: string; help: string }> = {
  home: { title: 'Home', section: 'Main', help: 'Your dashboard: quick train search, your latest bookings and the newest alerts.' },
  search: { title: 'Book Tickets', section: 'Main', help: 'Search trains, choose a class, add travellers, check the fare and pay. Seats are held for 10 minutes while you book.' },
  bookings: { title: 'My Bookings', section: 'Main', help: 'All your tickets. Pay a waiting booking, resume payment, cancel a ticket or open its details.' },
  pnr: { title: 'PNR Enquiry', section: 'Main', help: 'Type the 10-digit PNR of one of your tickets to see its status and seats.' },
  'live-trains': { title: 'Live Trains', section: 'Main', help: 'Every run of the day with seats, RAC and waiting list. Open a train and press Book this train to continue straight into booking.' },
  profile: { title: 'My Profile', section: 'My Account', help: 'Your name and phone number. The email is your sign-in and cannot be changed here.' },
  tdr: { title: 'TDR / Refunds', section: 'My Account', help: 'File a Ticket Deposit Receipt when you could not travel, and follow the refund decision.' },
  passengers: { title: 'Saved Passengers', section: 'My Account', help: 'Travellers you saved for faster booking.' },
  grievances: { title: 'Grievances', section: 'Support', help: 'Report a problem with a ticket, a train, a station or the staff. You can follow the answer here.' },
  alerts: { title: 'Alerts', section: 'Support', help: 'Messages about your bookings, payments, delays and refunds.' },
};

/**
 * The passenger portal, inside the React app: same shell, theme, toasts, Ctrl+K and motion as staff and admin.
 * Routes: /passenger (home), /book, /bookings, /pnr, /profile, /tdr, /grievances, /alerts, /live-trains.
 *
 * What is React here: the shell (sidebar, top bar, breadcrumb, footer), the URLs, the sign-out and the Live Trains page.
 * What stays as it was: the page controller src/passenger/legacy/app.js (booking steps, Razorpay checkout, Pay now / resume /
 * cancel unpaid, My Bookings, TDR, saved passengers, PNR enquiry, every API call). It runs unchanged inside <LegacyHost>;
 * only its shell wiring (boot, navigation, toast) was adapted. See docs/ARCHITECTURE.md.
 */
export const PassengerPortal: React.FC = () => {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [counts, setCounts] = useState({ unread: 0, active: 0 });

  const segment = location.pathname.replace(/^\/passenger\/?/, '').split('/')[0];
  const isLive = segment === 'live-trains';
  const page = isLive ? 'live-trains' : SEGMENT_TO_PAGE[segment] ?? 'home';
  const info = PAGE_INFO[page] || PAGE_INFO.home;

  useEffect(() => {
    const on = (e: Event) => setCounts((e as CustomEvent).detail);
    window.addEventListener('rrms:pax-counts', on);
    return () => window.removeEventListener('rrms:pax-counts', on);
  }, []);

  const sections: NavSection[] = [
    {
      title: 'Main',
      items: [
        { key: 'home', label: 'Home', icon: Home, to: '/passenger', end: true },
        { key: 'book', label: 'Book Tickets', icon: Ticket, to: '/passenger/book' },
        { key: 'bookings', label: 'My Bookings', icon: ReceiptText, to: '/passenger/bookings', badge: counts.active },
        { key: 'pnr', label: 'PNR Enquiry', icon: Search, to: '/passenger/pnr' },
        { key: 'live', label: 'Live Trains', icon: Train, to: '/passenger/live-trains' },
      ],
    },
    { title: 'My Account', items: [
      { key: 'profile', label: 'Profile', icon: UserRound, to: '/passenger/profile' },
      { key: 'tdr', label: 'TDR / Refunds', icon: IdCard, to: '/passenger/tdr' },
    ] },
    { title: 'Support', items: [
      { key: 'grievances', label: 'Grievances', icon: LifeBuoy, to: '/passenger/grievances' },
      { key: 'alerts', label: 'Alerts', icon: Bell, to: '/passenger/alerts', badge: counts.unread, danger: counts.unread > 0 },
    ] },
  ];

  const user = session?.user || { name: 'Passenger' };
  return (
    <PortalShell
      role="PASSENGER"
      sections={sections}
      page={{ title: info.title, section: info.section, help: info.help }}
      user={{ name: String(user.name || 'Passenger'), sub: String((user as any).email || '') }}
      onSignOut={() => { signOut(); navigate('/'); }}
      bell={{ count: counts.unread, onClick: () => navigate('/passenger/alerts') }}
      persist
    >
      <LegacyHost page={isLive ? null : page} pnr={params.get('pnr')} continuePending={(location.state as any)?.continuePending} navKey={location.key} />
      {isLive && <Outlet />}
    </PortalShell>
  );
};

/**
 * Hosts the legacy page controller. The markup is rendered once and stays mounted while the visitor moves between
 * passenger pages (so a booking in progress keeps its state). The controller is loaded on first use.
 */
const LegacyHost: React.FC<{ page: string | null; pnr: string | null; continuePending?: number; navKey: string }> = ({ page, pnr, continuePending, navKey }) => {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const fromLegacy = useRef(false);

  useEffect(() => {
    const el = ref.current as (HTMLDivElement & { __booted?: boolean }) | null;
    if (!el || el.__booted) { if (el?.__booted) setReady(true); return; }
    el.__booted = true;
    let alive = true;
    // Razorpay Checkout (loaded only inside the passenger portal, like the old standalone page did)
    if (!document.getElementById('rzp-checkout-js') && typeof (window as any).Razorpay === 'undefined') {
      const sc = document.createElement('script');
      sc.id = 'rzp-checkout-js';
      sc.src = 'https://checkout.razorpay.com/v1/checkout.js';
      sc.async = true;
      sc.onerror = () => { (window as any).__rzp_load_failed = true; };
      document.head.appendChild(sc);
    }
    (window as any).__rrmsNavigate = (p: string) => { fromLegacy.current = true; navigate(PAGE_TO_PATH[p] || '/passenger'); };
    import('./legacy/app.js').then(async (m: any) => {
      const initial = SEGMENT_TO_PAGE[window.location.pathname.replace(/^\/passenger\/?/, '').split('/')[0]] ?? 'home';
      await m.bootPassengerApp({ initialPage: initial });
      if (alive) setReady(true);
    });
    return () => { alive = false; };
  }, [navigate]);

  // the URL changed: show that page (a no-op when the controller already shows it)
  useEffect(() => {
    if (!ready || !page) return;
    const w = window as any;
    // a click on a sidebar link (even the page already open, e.g. Book Tickets) opens that page fresh; a move made by the
    // page controller itself has already shown the page
    if (fromLegacy.current) fromLegacy.current = false; else w.__rrmsShownPage = null;
    w.__rrmsShowPage?.(page);
    if (continuePending) w.__rrmsContinuePending?.();
    if (page === 'pnr' && pnr) {
      const input = document.getElementById('pnr-input') as HTMLInputElement | null;
      if (input) { input.value = pnr; w.searchPNR?.(); }
    }
  }, [ready, page, continuePending, pnr, navKey]);

  return (
    <div className="pax-legacy" hidden={!page} ref={ref} dangerouslySetInnerHTML={{ __html: pagesHtml }} />
  );
};
