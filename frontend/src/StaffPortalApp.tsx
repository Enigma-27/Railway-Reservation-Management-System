import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Armchair, AlertOctagon, Clock, FileText, LayoutDashboard, RotateCcw, Radio, Search, Sparkles, Ticket, Train, Users, Wrench } from 'lucide-react';
import { ReceiptModal } from './components/ReceiptModal';
import { OverviewPage } from './pages/OverviewPage';
import { ManifestPage } from './pages/ManifestPage';
import { ScannerPage } from './pages/ScannerPage';
import { VacanciesPage } from './pages/VacanciesPage';
import { FinesPage } from './pages/FinesPage';
import { OperationsPage } from './pages/OperationsPage';
import { CrowdCleanPage } from './pages/CrowdCleanPage';
import { EmergencyPage } from './pages/EmergencyPage';
import { CounterBookingPage } from './pages/CounterBookingPage';
import { MaintenanceTasksPage } from './pages/MaintenanceTasksPage';
import { PortalLiveTrains } from './layout/RootLayout';
import { NavSection, PortalShell } from './layout/PortalShell';
import { useStaff } from './context/StaffContext';
import { useAuth } from './admin/auth/AuthContext';
import { indiaClockLabel } from './utils/formatters';

/* ─── Nav data ──────────────────────────────────────────────────────────── */
interface PageDef { id: string; label: string; description: string; icon: React.ElementType; badgeKey?: string; isDanger?: boolean }
interface Group { title: string; items: PageDef[] }

const GROUPS: Group[] = [
  { title: 'Overview', items: [
    { id: 'overview', label: 'Duty Dashboard', description: 'Your assigned train, boarding numbers and quick actions for this duty.', icon: LayoutDashboard },
    { id: 'live-trains', label: 'Live Trains', description: 'Every run of the day with live seats, the chart state and occupancy. Refreshes every 15 seconds.', icon: Radio },
  ] },
  { title: 'Onboard Roster & Passengers', items: [
    { id: 'manifest', label: 'Passenger Chart', description: 'Manifest list, boarding status and ID verification', icon: Users, badgeKey: 'unverified' },
    { id: 'scanner', label: 'PNR & ID Scanner', description: 'Scan PNR barcodes, validate tickets and ID proofs', icon: Search },
    { id: 'vacancies', label: 'Vacancies & RAC', description: 'Empty berths, RAC queue and upgrade promotions', icon: Armchair, badgeKey: 'vacancies' },
    { id: 'counter', label: 'Counter Booking', description: 'Station walk-in ticket booking & cash collection', icon: Ticket },
  ] },
  { title: 'Enforcement & Maintenance', items: [
    { id: 'fines', label: 'On-Spot Penalties', description: 'Issue challans for ticketless or irregular travel', icon: FileText, badgeKey: 'fines' },
    { id: 'operations', label: 'Delays & Platform', description: 'Log train delays, platform changes and announcements', icon: Clock },
    { id: 'crowd_clean', label: 'Crowd & Hygiene', description: 'Crowd density reports and cleanliness monitoring', icon: Sparkles },
    { id: 'maintenance', label: 'Maintenance Tasks', description: 'Coach mechanical inspection & job order dispatch', icon: Wrench },
  ] },
  { title: 'Safety & Emergency', items: [
    { id: 'emergency', label: 'Emergency SOS', description: 'Raise safety incidents, SOS alerts and dispatch logs', icon: AlertOctagon, badgeKey: 'emergency', isDanger: true },
  ] },
];
const ALL = GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.title })));

/* ─── Component ─────────────────────────────────────────────────────────── */
/**
 * The staff portal in the shared shell. The page is the ?tab= of the address (so Ctrl+K and links can open any page),
 * for example /staff?tab=scanner&pnr=1234567890.
 */
export const StaffPortalApp: React.FC = () => {
  const { data, activeStaff, activeTrain, refreshAssignmentAndChart } = useStaff();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const tabParam = params.get('tab') || 'overview';
  const activeTab = ALL.some((p) => p.id === tabParam) ? tabParam : 'overview';
  const setActiveTab = (tab: string) => setParams(tab === 'overview' ? {} : { tab });

  const [scannerPrefillPnr, setScannerPrefillPnr] = useState<string>('');
  const [finePrefill, setFinePrefill] = useState<{ name: string; idRef: string; reason: string } | null>(null);
  const [timeStr, setTimeStr] = useState('');

  /* Live clock (India time, not the browser's time zone) */
  useEffect(() => {
    const update = () => setTimeStr(indiaClockLabel());
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  /* Load the real assignment, chart and reference data after login */
  useEffect(() => {
    refreshAssignmentAndChart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInspectPassenger = (pnr: string) => { setScannerPrefillPnr(pnr); setActiveTab('scanner'); };
  const handleIssueFinePrefill = (name: string, idRef: string, reason: string) => { setFinePrefill({ name, idRef, reason }); setActiveTab('fines'); };

  /* Badge counts: only counts that really exist on the server chart are shown */
  const badges: Record<string, number> = {
    unverified: data.manifest.filter((m) => m.boardingStatus === 'NOT_VERIFIED').length,
    vacancies: 0, fines: 0, emergency: 0,
  };

  const sections: NavSection[] = useMemo(() => GROUPS.map((g) => ({
    title: g.title,
    items: g.items.map((i) => ({
      key: i.id, label: i.label, icon: i.icon, active: activeTab === i.id, danger: i.isDanger,
      badge: i.badgeKey ? badges[i.badgeKey] || 0 : undefined, onSelect: () => setActiveTab(i.id),
    })),
  })), [activeTab, data.manifest]); // eslint-disable-line react-hooks/exhaustive-deps

  const here = ALL.find((p) => p.id === activeTab) || ALL[0];
  const pnrFromUrl = params.get('pnr') || '';

  return (
    <>
      <PortalShell
        role="STAFF"
        sections={sections}
        page={{ title: here.label, section: here.group, help: here.description }}
        user={{ name: activeStaff.name || 'Station staff', sub: `${activeStaff.designation || 'Staff'} · ${activeStaff.employeeId || ''}` }}
        onSignOut={() => { signOut(); navigate('/'); }}
        topExtra={
          <>
            {activeTrain && (
              <span className="staff-pill"><Train size={14} aria-hidden="true" /><b className="mono">#{activeTrain.trainNumber}</b><span className="staff-pill-name">{activeTrain.trainName?.split(' ').slice(0, 3).join(' ')}</span></span>
            )}
            <span className="staff-clock mono" aria-label="India time"><Clock size={14} aria-hidden="true" /> {timeStr}</span>
          </>
        }
        profileExtra={
          <>
            <div className="shell-menu-row"><span>Status</span><b>{activeStaff.status === 'ON_DUTY' ? 'On duty' : 'Off duty'}</b></div>
            <div className="shell-menu-row"><span>Assigned train</span><b>{activeTrain ? `#${activeTrain.trainNumber}` : 'Station duty'}</b></div>
            <div className="shell-menu-row"><span>Coaches</span><b>{activeStaff.assignedCoaches?.length ? activeStaff.assignedCoaches.join(', ') : 'All'}</b></div>
            <button type="button" role="menuitem" className="shell-menu-out" style={{ color: 'var(--rrms-text-muted)' }} onClick={() => refreshAssignmentAndChart()}><RotateCcw size={16} aria-hidden="true" /> Refresh from server</button>
          </>
        }
      >
        <div className="space-y-6">
          {activeTab === 'overview' && <OverviewPage setActiveTab={setActiveTab} />}
          {activeTab === 'live-trains' && <PortalLiveTrains context="staff" />}
          {activeTab === 'manifest' && <ManifestPage onInspectPassenger={handleInspectPassenger} />}
          {activeTab === 'scanner' && <ScannerPage initialPnr={scannerPrefillPnr || pnrFromUrl} onIssueFinePrefill={handleIssueFinePrefill} />}
          {activeTab === 'vacancies' && <VacanciesPage />}
          {activeTab === 'fines' && (
            <FinesPage prefillName={finePrefill?.name || ''} prefillIdRef={finePrefill?.idRef || ''} prefillReason={finePrefill?.reason || 'TICKETLESS_TRAVEL'} />
          )}
          {activeTab === 'operations' && <OperationsPage />}
          {activeTab === 'crowd_clean' && <CrowdCleanPage />}
          {activeTab === 'emergency' && <EmergencyPage />}
          {activeTab === 'counter' && <CounterBookingPage />}
          {activeTab === 'maintenance' && <MaintenanceTasksPage />}
        </div>
      </PortalShell>
      <ReceiptModal />
    </>
  );
};
