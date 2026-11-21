import { createBrowserRouter, Navigate } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import TrainInfoPage from './pages/TrainInfoPage';
import LiveTrainsPage from './pages/LiveTrainsPage';
import { RoleRoute, PassengerEntry } from './auth/RoleRoute';
import { AdminLayout } from './admin/layouts/AdminLayout';
import { DashboardPage } from './admin/pages/dashboard/DashboardPage';
import { UsersPage } from './admin/pages/users/UsersPage';
import { StaffPage } from './admin/pages/staff/StaffPage';
import { TrainsPage } from './admin/pages/trains/TrainsPage';
import { RoutesPage } from './admin/pages/routes/RoutesPage';
import { SchedulesPage } from './admin/pages/schedules/SchedulesPage';
import { StationsPage } from './admin/pages/stations/StationsPage';
import { PlatformsPage } from './admin/pages/platforms/PlatformsPage';
import { CoachesPage } from './admin/pages/coaches/CoachesPage';
import { SeatsPage } from './admin/pages/seats/SeatsPage';
import { FaresPage } from './admin/pages/fares/FaresPage';
import { QuotasPage } from './admin/pages/quotas/QuotasPage';
import { BookingsPage } from './admin/pages/bookings/BookingsPage';
import { TdrPage } from './admin/pages/tdr/TdrPage';
import { FinesPage } from './admin/pages/fines/FinesPage';
import { RefundTransactionsPage } from './admin/pages/refundTransactions/RefundTransactionsPage';
import { IncidentsPage } from './admin/pages/incidents/IncidentsPage';
import { GrievancesPage } from './admin/pages/grievances/GrievancesPage';
import { ContactMessagesPage } from './admin/pages/contactMessages/ContactMessagesPage';
import { ReportsPage } from './admin/pages/reports/ReportsPage';
import { AuditLogsPage } from './admin/pages/auditLogs/AuditLogsPage';
import { NotificationsPage } from './admin/pages/notifications/NotificationsPage';
import { SettingsPage } from './admin/pages/settings/SettingsPage';
import { StaffPortalApp } from './StaffPortalApp';

/**
 * One router for the site.
 *   /            landing page (the only place to sign in)
 *   /train-info  Train Info (schedule, track your train, PNR enquiry)
 *   /live-trains Live Trains (public, read only: every run of a date with live seat numbers)
 *   /passenger   passenger area: signed-in passengers are sent to /user/index.html, everybody else to /
 *   /staff       staff portal   (role STAFF only)
 *   /admin/*     admin portal   (role ADMIN only)
 * Opening a protected address while signed out (or with another role) goes to the landing page.
 */
export const router = createBrowserRouter([
  { path: '/', element: <LandingPage /> },
  { path: '/train-info', element: <TrainInfoPage /> },
  { path: '/live-trains', element: <LiveTrainsPage /> },
  { path: '/passenger', element: <PassengerEntry /> },
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
]);
