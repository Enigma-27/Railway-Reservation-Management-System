import React, { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, ShieldCheck, Train, Route, Calendar, Building2, Layers, Armchair, DollarSign, PieChart, Ticket,
  FileCheck2, AlertOctagon, LifeBuoy, BarChart3, History, Bell, Settings, Radio, Search,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { ADMIN_ROUTES } from '../constants/routes';
import { notificationService } from '../services/notificationService';
import { GlobalPnrSearchModal } from '../components/GlobalPnrSearchModal';
import { NavItem, NavSection, PortalShell } from '../../layout/PortalShell';

const LIVE_PATH = '/admin/live-trains';

/** Pages of the admin portal: label, route, help text ("what is this page?") and icon, grouped like the old menu. */
const GROUPS: { title: string; items: { label: string; path: string; description: string; icon: React.ElementType }[] }[] = [
  { title: 'Overview', items: [
    { label: 'Dashboard', path: ADMIN_ROUTES.DASHBOARD, description: 'Key numbers of the whole system: bookings, revenue, occupancy and open work.', icon: LayoutDashboard },
    { label: 'Live Trains', path: LIVE_PATH, description: 'Every run of the day with live seats, the chart state and occupancy. Refreshes every 15 seconds.', icon: Radio },
  ] },
  { title: 'Users & Personnel', items: [
    { label: 'Passenger Accounts', path: ADMIN_ROUTES.USERS, description: 'User registry, KYC and profiles', icon: Users },
    { label: 'Staff & Conductors', path: ADMIN_ROUTES.STAFF, description: 'Duty rosters, TCs and field personnel', icon: ShieldCheck },
  ] },
  { title: 'Trains & Routes', items: [
    { label: 'Train Master', path: ADMIN_ROUTES.TRAINS, description: 'Train fleet, classes and configurations', icon: Train },
    { label: 'Route Stops', path: ADMIN_ROUTES.ROUTES, description: 'Station sequences, halts and distances', icon: Route },
    { label: 'Schedules', path: ADMIN_ROUTES.SCHEDULES, description: 'Timetables, run dates and delay logs', icon: Calendar },
    { label: 'Stations Master', path: ADMIN_ROUTES.STATIONS, description: 'Station codes, divisions and zones', icon: Building2 },
    { label: 'Platforms & Tracks', path: ADMIN_ROUTES.PLATFORMS, description: 'Platform allocation and track occupancy', icon: Layers },
  ] },
  { title: 'Coaches & Fares', items: [
    { label: 'Coaches Master', path: ADMIN_ROUTES.COACHES, description: 'Rake compositions and coach tiers', icon: Layers },
    { label: 'Seats & Berths', path: ADMIN_ROUTES.SEATS, description: 'Seat matrices and layout maps', icon: Armchair },
    { label: 'Fares & Dynamic Pricing', path: ADMIN_ROUTES.FARES, description: 'Base tariffs, distance slabs and tatkal', icon: DollarSign },
    { label: 'Quota Rules', path: ADMIN_ROUTES.QUOTAS, description: 'General, Ladies, Senior, Tatkal quotas', icon: PieChart },
  ] },
  { title: 'Operations', items: [
    { label: 'Reservations & PNR', path: ADMIN_ROUTES.BOOKINGS, description: 'PNR ledger, tickets and statuses', icon: Ticket },
    { label: 'TDR Adjudication', path: ADMIN_ROUTES.TDR, description: 'Ticket deposit refunds and claims', icon: FileCheck2 },
    { label: 'Fines & Penalties', path: ADMIN_ROUTES.FINES, description: 'TC on-spot fines and unauthorized travel', icon: DollarSign },
    { label: 'Refund Transactions', path: ADMIN_ROUTES.REFUND_TRANSACTIONS, description: 'Refund money: pending, processed, failed and retry', icon: FileCheck2 },
    { label: 'Incidents & SOS', path: ADMIN_ROUTES.INCIDENTS, description: 'Safety dispatches and operational alerts', icon: AlertOctagon },
    { label: 'Grievances', path: ADMIN_ROUTES.GRIEVANCES, description: 'Passenger support and rail madad complaints', icon: LifeBuoy },
    { label: 'Contact Messages', path: ADMIN_ROUTES.CONTACT_MESSAGES, description: 'Messages from the Contact form: read, mark done', icon: LifeBuoy },
  ] },
  { title: 'Analytics & Logs', items: [
    { label: 'Operational Reports', path: ADMIN_ROUTES.REPORTS, description: 'Occupancy, revenue and delay analytics', icon: BarChart3 },
    { label: 'Forensic Audit Logs', path: ADMIN_ROUTES.AUDIT_LOGS, description: 'Admin change trail and security records', icon: History },
  ] },
  { title: 'System', items: [
    { label: 'Broadcast Alerts', path: ADMIN_ROUTES.NOTIFICATIONS, description: 'Passenger and staff push broadcasts', icon: Bell },
    { label: 'System Configuration', path: ADMIN_ROUTES.SETTINGS, description: 'Global parameters and mock toggles', icon: Settings },
  ] },
];

/** The admin portal in the shared shell: same top bar, sidebar, breadcrumb and footer as the passenger and staff portals. */
export const AdminLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [unread, setUnread] = useState(0);
  const [pnrOpen, setPnrOpen] = useState(false);

  useEffect(() => {
    notificationService.getNotifications().then((n) => setUnread(n.filter((x) => !x.isRead).length)).catch(() => {});
  }, [location.pathname]);

  // Ctrl+K "look up a PNR" opens the global PNR search of the admin
  useEffect(() => {
    const open = () => setPnrOpen(true);
    window.addEventListener('rrms:open-pnr', open);
    return () => window.removeEventListener('rrms:open-pnr', open);
  }, []);

  const sections: NavSection[] = GROUPS.map((g) => ({
    title: g.title,
    items: g.items.map<NavItem>((i) => ({ key: i.path, label: i.label, icon: i.icon, to: i.path, end: i.path === ADMIN_ROUTES.DASHBOARD })),
  }));

  const flat = GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.title })));
  const here = flat.find((i) => location.pathname === i.path || (i.path !== ADMIN_ROUTES.DASHBOARD && location.pathname.startsWith(i.path + '/'))) || flat[0];

  return (
    <>
      <PortalShell
        role="ADMIN"
        sections={sections}
        page={{ title: here.label, section: here.group, help: here.description }}
        user={{ name: user?.name || 'Administrator', sub: String((user as any)?.email || 'admin@rrms.in') }}
        onSignOut={() => { logout(); navigate('/'); }}
        bell={{ count: unread, onClick: () => navigate(ADMIN_ROUTES.NOTIFICATIONS) }}
        topExtra={<button type="button" className="rrms-btn rrms-btn-secondary rrms-btn-sm admin-pnr-btn" onClick={() => setPnrOpen(true)}><Search size={14} aria-hidden="true" /> PNR search</button>}
      >
        <Outlet />
      </PortalShell>
      <GlobalPnrSearchModal isOpen={pnrOpen} onClose={() => setPnrOpen(false)} />
    </>
  );
};
