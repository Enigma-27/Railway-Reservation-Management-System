import { lazy } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import TrainInfoPage from './pages/TrainInfoPage';
import LiveTrainsPage from './pages/LiveTrainsPage';
import { RoleRoute } from './auth/RoleRoute';
import { RootLayout, PortalLiveTrains } from './layout/RootLayout';
const PassengerPortal = lazy(() => import('./passenger/PassengerPortal').then((m) => ({ default: m.PassengerPortal })));
const AdminLayout = lazy(() => import('./admin/layouts/AdminLayout').then((m) => ({ default: m.AdminLayout })));
const DashboardPage = lazy(() => import('./admin/pages/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const UsersPage = lazy(() => import('./admin/pages/users/UsersPage').then((m) => ({ default: m.UsersPage })));
const StaffPage = lazy(() => import('./admin/pages/staff/StaffPage').then((m) => ({ default: m.StaffPage })));
const TrainsPage = lazy(() => import('./admin/pages/trains/TrainsPage').then((m) => ({ default: m.TrainsPage })));
const RoutesPage = lazy(() => import('./admin/pages/routes/RoutesPage').then((m) => ({ default: m.RoutesPage })));
const SchedulesPage = lazy(() => import('./admin/pages/schedules/SchedulesPage').then((m) => ({ default: m.SchedulesPage })));
const StationsPage = lazy(() => import('./admin/pages/stations/StationsPage').then((m) => ({ default: m.StationsPage })));
const PlatformsPage = lazy(() => import('./admin/pages/platforms/PlatformsPage').then((m) => ({ default: m.PlatformsPage })));
const CoachesPage = lazy(() => import('./admin/pages/coaches/CoachesPage').then((m) => ({ default: m.CoachesPage })));
const SeatsPage = lazy(() => import('./admin/pages/seats/SeatsPage').then((m) => ({ default: m.SeatsPage })));
const FaresPage = lazy(() => import('./admin/pages/fares/FaresPage').then((m) => ({ default: m.FaresPage })));
const QuotasPage = lazy(() => import('./admin/pages/quotas/QuotasPage').then((m) => ({ default: m.QuotasPage })));
const BookingsPage = lazy(() => import('./admin/pages/bookings/BookingsPage').then((m) => ({ default: m.BookingsPage })));
const TdrPage = lazy(() => import('./admin/pages/tdr/TdrPage').then((m) => ({ default: m.TdrPage })));
const FinesPage = lazy(() => import('./admin/pages/fines/FinesPage').then((m) => ({ default: m.FinesPage })));
const RefundTransactionsPage = lazy(() => import('./admin/pages/refundTransactions/RefundTransactionsPage').then((m) => ({ default: m.RefundTransactionsPage })));
const IncidentsPage = lazy(() => import('./admin/pages/incidents/IncidentsPage').then((m) => ({ default: m.IncidentsPage })));
const GrievancesPage = lazy(() => import('./admin/pages/grievances/GrievancesPage').then((m) => ({ default: m.GrievancesPage })));
const ContactMessagesPage = lazy(() => import('./admin/pages/contactMessages/ContactMessagesPage').then((m) => ({ default: m.ContactMessagesPage })));
const ReportsPage = lazy(() => import('./admin/pages/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const AuditLogsPage = lazy(() => import('./admin/pages/auditLogs/AuditLogsPage').then((m) => ({ default: m.AuditLogsPage })));
const NotificationsPage = lazy(() => import('./admin/pages/notifications/NotificationsPage').then((m) => ({ default: m.NotificationsPage })));
const SettingsPage = lazy(() => import('./admin/pages/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const StaffPortalApp = lazy(() => import('./StaffPortalApp').then((m) => ({ default: m.StaffPortalApp })));

/**
 * One router for the site.
 *   /            landing page (the only place to sign in)
 *   /train-info  Train Info (schedule, track your train, PNR enquiry)
 *   /live-trains Live Trains (public, read only: every run of a date with live seat numbers)
 *   /passenger/* passenger portal (role PASSENGER only): home, book, bookings, pnr, profile, tdr, grievances, alerts, live-trains
 *   /staff       staff portal   (role STAFF only)
 *   /admin/*     admin portal   (role ADMIN only, includes /admin/live-trains)
 * Opening a protected address while signed out (or with another role) goes to the landing page.
 */
export const router = createBrowserRouter([{ element: <RootLayout />, children: [
  { path: '/', element: <LandingPage /> },
  { path: '/train-info', element: <TrainInfoPage /> },
  { path: '/live-trains', element: <LiveTrainsPage /> },
  // Passenger portal: the page controller is mounted once by PassengerPortal; the routes only choose the page
  {
    path: '/passenger',
    element: <RoleRoute role="PASSENGER" />,
    children: [
      {
        element: <PassengerPortal />,
        children: [
          { index: true, element: null },
          { path: 'book', element: null },
          { path: 'bookings', element: null },
          { path: 'pnr', element: null },
          { path: 'profile', element: null },
          { path: 'tdr', element: null },
          { path: 'grievances', element: null },
          { path: 'alerts', element: null },
          { path: 'passengers', element: null },
          { path: 'live-trains', element: <PortalLiveTrains context="passenger" /> },
        ],
      },
    ],
  },
  // the old standalone passenger app lived at /user/index.html
  { path: '/user/*', element: <Navigate to="/passenger" replace /> },
  { path: '/admin/login', element: <Navigate to="/" replace /> },

  // Staff / Conductor Operations Terminal
  {
    path: '/staff',
    element: <RoleRoute role="STAFF" />,
    children: [{ index: true, element: <StaffPortalApp /> }],
  },

  // Admin Master Management Dashboard & 21 submodules (Soham's Branch)
  {
    path: '/admin',
    element: <RoleRoute role="ADMIN" />,
    children: [
      {
        element: <AdminLayout />,
        children: [
          {
            index: true,
            element: <DashboardPage />,
          },
          {
            path: 'users',
            element: <UsersPage />,
          },
          {
            path: 'staff',
            element: <StaffPage />,
          },
          {
            path: 'trains',
            element: <TrainsPage />,
          },
          {
            path: 'routes',
            element: <RoutesPage />,
          },
          {
            path: 'schedules',
            element: <SchedulesPage />,
          },
          {
            path: 'stations',
            element: <StationsPage />,
          },
          {
            path: 'platforms',
            element: <PlatformsPage />,
          },
          {
            path: 'coaches',
            element: <CoachesPage />,
          },
          {
            path: 'seats',
            element: <SeatsPage />,
          },
          {
            path: 'fares',
            element: <FaresPage />,
          },
          {
            path: 'quotas',
            element: <QuotasPage />,
          },
          {
            path: 'bookings',
            element: <BookingsPage />,
          },
          {
            path: 'tdr',
            element: <TdrPage />,
          },
          {
            path: 'fines',
            element: <FinesPage />,
          },
          {
            path: 'refund-transactions',
            element: <RefundTransactionsPage />,
          },
          {
            path: 'incidents',
            element: <IncidentsPage />,
          },
          {
            path: 'grievances',
            element: <GrievancesPage />,
          },
          {
            path: 'contact-messages',
            element: <ContactMessagesPage />,
          },
          {
            path: 'reports',
            element: <ReportsPage />,
          },
          {
            path: 'audit-logs',
            element: <AuditLogsPage />,
          },
          {
            path: 'notifications',
            element: <NotificationsPage />,
          },
          {
            path: 'settings',
            element: <SettingsPage />,
          },
        ],
      },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
] }]);
