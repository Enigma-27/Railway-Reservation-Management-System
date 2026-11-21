import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import {
  Staff,
  Station,
  Train,
  RouteStop,
  Schedule,
  ManifestPassenger,
  Vacancy,
  Fine,
  Incident,
  CrowdReport,
  CleanlinessReport,
  BoardingStatus,
  VerificationStatus
} from '../types';
import {
  staffApiService,
  StaffAssignment,
  ChartPassenger
} from '../services/staffApiService';
import { API_CONFIG } from '../admin/config/api.config';
import { nowIndiaDateTime } from '../utils/formatters';
import { toast as sharedToast } from '../ui/toast';

/**
 * Staff portal state.
 *
 * Everything here comes from the server (login session, current duty assignment, chart, stations, train route,
 * live status). There are no built-in sample records and nothing is stored in the browser.
 *
 * Lists that have no staff read endpoint (fines, incidents, crowd reports, cleanliness reports, vacancies) stay
 * empty: after a successful save the portal shows a success message only. The server has POST routes for these
 * but no GET route for staff.
 */

// Old versions saved sample data under this key. It is removed once so stale fixtures can never reappear.
const LEGACY_STORAGE_KEY = 'RRMS_STAFF_REACT_STATE_V1';

interface StaffData {
  staffList: Staff[];
  stations: Station[];
  trains: Train[];
  routes: RouteStop[];
  schedules: Schedule[];
  manifest: ManifestPassenger[];
  vacancies: Vacancy[];
  fines: Fine[];
  incidents: Incident[];
  crowdReports: CrowdReport[];
  cleanlinessReports: CleanlinessReport[];
}

const EMPTY_DATA: StaffData = {
  staffList: [],
  stations: [],
  trains: [],
  routes: [],
  schedules: [],
  manifest: [],
  vacancies: [],
  fines: [],
  incidents: [],
  crowdReports: [],
  cleanlinessReports: []
};

type MaintenanceStatus = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

interface BoardingOutcome {
  boardingStatus: BoardingStatus;
  verificationStatus?: VerificationStatus;
  verificationNotes?: string;
  verifiedAt?: string;
}

interface StaffSession {
  staffId?: number;
  userId?: number;
  employeeId?: string;
  name?: string;
  designation?: string;
}

function readStaffSession(): StaffSession | null {
  try {
    const raw = localStorage.getItem(API_CONFIG.STORAGE_KEYS.STAFF_USER);
    // The session is shared by all roles: only a STAFF session counts here (a passenger or admin must not call staff routes)
    const parsed = raw ? (JSON.parse(raw) as StaffSession & { role?: string }) : null;
    return parsed && parsed.role === 'STAFF' ? parsed : null;
  } catch {
    return null;
  }
}

// "2026-11-19 14:00:00" -> "14:00" (India time text from the server, never converted)
function hhmm(dateTime: string | null | undefined): string {
  if (!dateTime || typeof dateTime !== 'string') return '';
  const m = dateTime.match(/(\d{2}:\d{2})/);
  return m ? m[1] : '';
}

function buildActiveStaff(session: StaffSession | null, assignment: StaffAssignment | null): Staff {
  const shift = assignment && assignment.shiftStart && assignment.shiftEnd
    ? `${String(assignment.shiftStart).slice(0, 10)}  ${hhmm(String(assignment.shiftStart))} - ${hhmm(String(assignment.shiftEnd))}`
    : 'No shift assigned';
  return {
    staffId: session?.staffId ?? 0,
    userId: session?.userId ?? 0,
    employeeId: session?.employeeId ?? '—',
    name: session?.name ?? 'Staff member',
    designation: session?.designation ?? 'Staff',
    assignedStationId: assignment?.stationId ?? 0,
    assignedTrainId: assignment?.schedule?.trainId ?? null,
    assignedCoaches: [],
    shift,
    status: assignment?.isActive ? 'ON_DUTY' : 'OFF_DUTY'
  };
}

interface StaffContextType {
  data: StaffData;
  activeStaffId: number;
  activeStaff: Staff;
  activeTrain: Train | undefined;
  activeSchedule: Schedule | undefined;
  currentAssignment: StaffAssignment | null;
  serverChart: ChartPassenger[];
  chartStatus: { loading: boolean; error: string | null; prepared: boolean };
  refreshAssignmentAndChart: () => Promise<void>;
  markPassengerBoarding: (manifestId: number, status: BoardingStatus, verifyStatus?: VerificationStatus, notes?: string) => Promise<void>;
  verifyPassenger: (pnr: string, passengerNo: number, result: 'VALID' | 'INVALID' | 'MISMATCH', remarks?: string) => Promise<{ success: boolean; message: string; verifyId?: number }>;
  boardPassengerApi: (pnr: string, passengerNo: number) => Promise<{ success: boolean; message: string }>;
  noShowPassengerApi: (pnr: string, passengerNo: number) => Promise<{ success: boolean; message: string }>;
  issueFine: (fine: Omit<Fine, 'fineId' | 'receiptNumber' | 'issuedAt'>) => Promise<Fine>;
  updateTrainDelay: (delayMinutes: number) => Promise<void>;
  addCrowdReport: (report: Omit<CrowdReport, 'crowdReportId' | 'recordedAt'>) => Promise<void>;
  addCleanlinessReport: (report: Omit<CleanlinessReport, 'reportId' | 'createdAt' | 'status'>) => Promise<void>;
  reportIncident: (incident: Omit<Incident, 'incidentId' | 'createdAt' | 'status'>) => Promise<void>;
  createMaintenanceTask: (task: {
    coachId?: number;
    platformId?: number;
    stationId?: number;
    type?: string;
    title: string;
    description: string;
    priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  }) => Promise<{ success: boolean; message: string; maintId?: number }>;
  updateMaintenanceStatus: (maintId: number, status: MaintenanceStatus, completionRemarks?: string) => Promise<{ success: boolean; message: string }>;
  createCounterBooking: (payload: any) => Promise<any>;
  selectedReceiptFine: Fine | null;
  setSelectedReceiptFine: (fine: Fine | null) => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  toasts: Array<{ id: number; msg: string; type: 'success' | 'error' | 'info' }>;
}

const StaffContext = createContext<StaffContextType | null>(null);

export const StaffProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [referenceData, setReferenceData] = useState<Pick<StaffData, 'stations' | 'trains' | 'routes' | 'schedules'>>({
    stations: [],
    trains: [],
    routes: [],
    schedules: []
  });
  const [currentAssignment, setCurrentAssignment] = useState<StaffAssignment | null>(null);
  const [serverChart, setServerChart] = useState<ChartPassenger[]>([]);
  // Results of boarding / no-show / verification calls the server accepted (the chart itself is a frozen snapshot)
  const [outcomes, setOutcomes] = useState<Record<string, BoardingOutcome>>({});
  const [chartStatus, setChartStatus] = useState<{ loading: boolean; error: string | null; prepared: boolean }>({
    loading: false,
    error: null,
    prepared: false
  });
  const [selectedReceiptFine, setSelectedReceiptFine] = useState<Fine | null>(null);
  const [toasts, setToasts] = useState<Array<{ id: number; msg: string; type: 'success' | 'error' | 'info' }>>([]);
  const [session, setSession] = useState<StaffSession | null>(() => readStaffSession());

  // Remove sample data saved by older versions
  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // storage not available: nothing to remove
    }
  }, []);

  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    // one toast system for the whole site (src/ui/toast.tsx)
    sharedToast(msg, type);
  };

  // Load the real assignment, chart, stations, train route and live status
  const refreshAssignmentAndChart = useCallback(async () => {
    setSession(readStaffSession());

    let assignment: StaffAssignment | null = null;
    try {
      assignment = await staffApiService.getCurrentAssignment();
      setCurrentAssignment(assignment);
    } catch (err: any) {
      setCurrentAssignment(null);
      setServerChart([]);
      setChartStatus({ loading: false, error: err?.message || 'No duty assignment found', prepared: false });
      return;
    }

    // Stations for code lookups (public route)
    try {
      const stations = await staffApiService.getStations();
      setReferenceData(prev => ({
        ...prev,
        stations: stations.map(s => ({
          stationId: s.stationId,
          stationCode: s.stationCode,
          stationName: s.stationName,
          city: s.city || '',
          state: s.state || ''
        }))
      }));
    } catch (err) {
      console.warn('Could not load stations:', err);
    }

    const scheduleId = assignment?.scheduleId || null;
    const trainId = assignment?.schedule?.trainId || null;

    // Train and its route
    if (trainId) {
      try {
        const train = await staffApiService.getTrain(trainId);
        setReferenceData(prev => ({
          ...prev,
          trains: [{
            trainId: train.trainId,
            trainNumber: train.trainNumber,
            trainName: train.displayName,
            trainType: train.trainType,
            sourceStationId: train.sourceStationId,
            destinationStationId: train.destinationStationId,
            runningDays: train.runningDays || [],
            status: 'ACTIVE'
          }],
          routes: (train.route || []).map(r => ({
            routeId: r.stopId,
            trainId: train.trainId,
            stationId: r.stationId,
            stopSequence: r.stopSequence,
            arrivalTime: r.arrivalTime,
            departureTime: r.departureTime,
            distanceFromOrigin: r.distanceFromOriginKm,
            platformNumber: r.platformNo
          }))
        }));
      } catch (err) {
        console.warn('Could not load train route:', err);
      }
    } else {
      setReferenceData(prev => ({ ...prev, trains: [], routes: [] }));
    }

    // Live status of the run (delay, status, platform)
    if (scheduleId && trainId) {
      try {
        const live = await staffApiService.getLiveStatus(scheduleId);
        setReferenceData(prev => ({
          ...prev,
          schedules: [{
            scheduleId,
            trainId,
            journeyDate: live.journeyDate || assignment?.schedule?.journeyDate || '',
            status: (live.status || 'ON_TIME') as Schedule['status'],
            delayMinutes: Number(live.delayMinutes || 0),
            platformNumber: live.platformNumber
          }]
        }));
      } catch (err) {
        setReferenceData(prev => ({
          ...prev,
          schedules: [{
            scheduleId,
            trainId,
            journeyDate: assignment?.schedule?.journeyDate || '',
            status: 'ON_TIME',
            delayMinutes: 0
          }]
        }));
      }
    } else {
      setReferenceData(prev => ({ ...prev, schedules: [] }));
    }

    // Chart (frozen snapshot, only exists after chart preparation)
    if (scheduleId) {
      setChartStatus({ loading: true, error: null, prepared: false });
      try {
        const chartList = await staffApiService.getScheduleChart(scheduleId);
        if (Array.isArray(chartList)) {
          setServerChart(chartList);
          setChartStatus({ loading: false, error: null, prepared: true });
        } else {
          setServerChart([]);
          setChartStatus({ loading: false, error: 'The chart has not been prepared yet for this run. It is prepared before departure.', prepared: false });
        }
      } catch (chartErr: any) {
        setServerChart([]);
        setChartStatus({
          loading: false,
          error: chartErr?.message || 'Chart has not been prepared yet',
          prepared: false
        });
      }
    } else {
      setServerChart([]);
      setChartStatus({ loading: false, error: null, prepared: false });
    }
  }, []);

  useEffect(() => {
    // Only call the server when a staff session exists (the login page also mounts this provider)
    if (readStaffSession()) {
      refreshAssignmentAndChart();
    }
  }, [refreshAssignmentAndChart]);

  const activeStaff = useMemo(() => buildActiveStaff(session, currentAssignment), [session, currentAssignment]);

  // Manifest rows come straight from the server chart. Missing values stay empty (shown as "-"); nothing is invented.
  const manifest: ManifestPassenger[] = useMemo(() => {
    const assignedTrainId = currentAssignment?.schedule?.trainId ?? 0;
    return serverChart.map(c => {
      const outcome = outcomes[`${c.pnr}-${c.passengerNo}`];
      return {
        manifestId: c.snapshotId,
        bookingId: c.snapshotId,
        pnr: c.pnr,
        trainId: c.trainId ?? assignedTrainId,
        journeyDate: c.journeyDate ?? currentAssignment?.schedule?.journeyDate ?? '',
        boardingStationId: c.fromStationId,
        destinationStationId: c.toStationId,
        passengerId: c.passengerNo,
        name: c.passengerName || '-',
        age: c.passengerAge ?? null,
        gender: c.passengerGender ?? null,
        idProofType: '',
        idProofReference: '',
        coachNumber: c.coachNo || null,
        seatNumber: c.seatNo || null,
        berthType: c.berthType || null,
        classType: c.classType ?? null,
        quota: c.quota ?? null,
        bookingStatus: (c.status as ManifestPassenger['bookingStatus']) || 'CONFIRMED',
        // What the staff member just did wins; after a page reload the saved state comes from the database
        boardingStatus: outcome?.boardingStatus ?? (c.reservationStatus === 'BOARDED' ? 'BOARDED' : c.reservationStatus === 'NO_SHOW' ? 'NO_SHOW' : 'NOT_VERIFIED'),
        verificationStatus: outcome?.verificationStatus ?? c.verificationResult ?? 'UNCHECKED',
        verificationNotes: outcome?.verificationNotes ?? c.verificationRemarks ?? '',
        verifiedAt: outcome?.verifiedAt ?? c.verifiedAt ?? null
      };
    });
  }, [serverChart, outcomes, currentAssignment]);

  const data: StaffData = useMemo(() => ({
    ...EMPTY_DATA,
    staffList: [activeStaff],
    stations: referenceData.stations,
    trains: referenceData.trains,
    routes: referenceData.routes,
    schedules: referenceData.schedules,
    manifest
  }), [activeStaff, referenceData, manifest]);

  const activeTrain = data.trains.find(t => t.trainId === activeStaff.assignedTrainId);
  const activeSchedule = data.schedules[0];

  const recordOutcome = (pnr: string, passengerNo: number, outcome: Partial<BoardingOutcome>) => {
    const key = `${pnr}-${passengerNo}`;
    setOutcomes(prev => ({
      ...prev,
      [key]: { boardingStatus: 'NOT_VERIFIED', ...prev[key], ...outcome }
    }));
  };

  // ─── Real Ticket Verification API Call ────────────────────────────────────
  const verifyPassenger = async (
    pnr: string,
    passengerNo: number,
    result: 'VALID' | 'INVALID' | 'MISMATCH',
    remarks?: string
  ): Promise<{ success: boolean; message: string; verifyId?: number }> => {
    try {
      const res = await staffApiService.verifyTicket({
        pnr,
        passengerNo,
        idChecked: true,
        concessionChecked: true,
        result,
        remarks: remarks || `Verification recorded by ${activeStaff.name}`
      });
      recordOutcome(pnr, passengerNo, {
        verificationStatus: result,
        verificationNotes: remarks || '',
        verifiedAt: nowIndiaDateTime()
      });
      showToast(`Verification stamped: ${result} (ID: ${res.verifyId})`, 'success');
      return { success: true, message: 'Ticket verification recorded successfully', verifyId: res.verifyId };
    } catch (err: any) {
      showToast(`Verification API error: ${err.message}`, 'error');
      return { success: false, message: err.message };
    }
  };

  // ─── Real Boarding API Call ───────────────────────────────────────────────
  const boardPassengerApi = async (pnr: string, passengerNo: number): Promise<{ success: boolean; message: string }> => {
    try {
      const res = await staffApiService.boardPassenger(pnr, passengerNo);
      recordOutcome(pnr, passengerNo, { boardingStatus: 'BOARDED', verifiedAt: nowIndiaDateTime() });
      showToast(`Boarding confirmed: PNR ${pnr} Pax #${passengerNo} (${res.status})`, 'success');
      return { success: true, message: `Status: ${res.status}` };
    } catch (err: any) {
      showToast(`Boarding failed: ${err.message}`, 'error');
      return { success: false, message: err.message };
    }
  };

  // ─── Real No-Show API Call ────────────────────────────────────────────────
  const noShowPassengerApi = async (pnr: string, passengerNo: number): Promise<{ success: boolean; message: string }> => {
    try {
      const res: any = await staffApiService.markNoShow(pnr, passengerNo);
      recordOutcome(pnr, passengerNo, { boardingStatus: 'NO_SHOW', verifiedAt: nowIndiaDateTime() });
      return { success: true, message: `Status: ${res.status}` };
    } catch (err: any) {
      showToast(`No-show failed: ${err.message}`, 'error');
      return { success: false, message: err.message };
    }
  };

  // Verify / board / no-show for one manifest row. The server decides; the screen changes only after it accepts.
  const markPassengerBoarding = async (
    manifestId: number,
    status: BoardingStatus,
    verifyStatus?: VerificationStatus,
    notes?: string
  ) => {
    const target = manifest.find(p => p.manifestId === manifestId);
    if (!target) return;

    const pnr = target.pnr;
    const passengerNo = target.passengerId || 1;

    if (verifyStatus === 'VALID' || verifyStatus === 'INVALID' || verifyStatus === 'MISMATCH') {
      const v = await verifyPassenger(pnr, passengerNo, verifyStatus, notes);
      if (!v.success) return;
    }

    if (status === 'BOARDED') {
      await boardPassengerApi(pnr, passengerNo);
    } else if (status === 'NO_SHOW') {
      const noShowRes = await noShowPassengerApi(pnr, passengerNo);
      if (!noShowRes.success) return;
      showToast(
        `No-show recorded for ${target.name}. The database released the seat and promotes the next RAC / waiting-list passenger.`,
        'success'
      );
      // Re-fetch from the server
      await refreshAssignmentAndChart();
    }
  };

  // ─── Real Fine API Call ───────────────────────────────────────────────────
  // The server has no list route for staff, so the challan is built from the server's reply and only shown as a receipt.
  const issueFine = async (fineInput: Omit<Fine, 'fineId' | 'receiptNumber' | 'issuedAt'>): Promise<Fine> => {
    const allowedReasons: Record<string, 'TICKETLESS_TRAVEL' | 'UNAUTHORIZED_CLASS' | 'SMOKING_NUISANCE' | 'UNBOOKED_LUGGAGE'> = {
      TICKETLESS_TRAVEL: 'TICKETLESS_TRAVEL',
      TRAVELLING_IN_HIGHER_CLASS_WITHOUT_UPGRADE: 'UNAUTHORIZED_CLASS',
      UNAUTHORIZED_CLASS: 'UNAUTHORIZED_CLASS',
      UNBOOKED_EXCESS_LUGGAGE: 'UNBOOKED_LUGGAGE',
      UNBOOKED_LUGGAGE: 'UNBOOKED_LUGGAGE',
      SMOKING_NUISANCE: 'SMOKING_NUISANCE',
      IRREGULAR_TICKET: 'TICKETLESS_TRAVEL'
    };
    const mappedReason = allowedReasons[fineInput.reason] || 'TICKETLESS_TRAVEL';

    try {
      const res: any = await staffApiService.issueFine({
        passengerName: fineInput.passengerName,
        idProofReference: fineInput.idProofReference,
        trainId: fineInput.trainId,
        reason: mappedReason,
        amount: fineInput.amount,
        paymentStatus: fineInput.paymentStatus
      });

      const fine: Fine = {
        fineId: res.fineId,
        staffId: res.staffId ?? fineInput.staffId,
        passengerName: res.passengerName ?? fineInput.passengerName,
        idProofReference: res.idProofReference ?? fineInput.idProofReference,
        trainId: res.trainId ?? fineInput.trainId,
        amount: Number(res.amount ?? fineInput.amount),
        reason: res.reason ?? mappedReason,
        paymentStatus: res.paymentStatus ?? fineInput.paymentStatus,
        issuedAt: String(res.issuedAt ?? ''),
        receiptNumber: `FINE-${res.fineId}`
      };
      showToast(`Penalty saved on the server. Challan ${fine.receiptNumber}.`, 'success');
      setSelectedReceiptFine(fine);
      return fine;
    } catch (err: any) {
      showToast(`Fine was NOT saved: ${err.message}`, 'error');
      throw err;
    }
  };

  // ─── Real Train Delay API Call ────────────────────────────────────────────
  const updateTrainDelay = async (delayMinutes: number) => {
    const scheduleId = currentAssignment?.scheduleId;
    if (!scheduleId) {
      showToast('No train run is assigned to you, so a delay cannot be logged.', 'error');
      return;
    }
    try {
      await staffApiService.logDelay({ scheduleId, delayMinutes });
      showToast(`Delay of ${delayMinutes} min saved for run #${scheduleId}.`, 'success');
      await refreshAssignmentAndChart();
    } catch (err: any) {
      showToast(`Delay was NOT saved: ${err.message}`, 'error');
    }
  };

  // ─── Real Crowd Report API Call ───────────────────────────────────────────
  const addCrowdReport = async (reportInput: Omit<CrowdReport, 'crowdReportId' | 'recordedAt'>) => {
    try {
      await staffApiService.reportCrowd({
        stationId: reportInput.stationId,
        platformNo: reportInput.platformNumber,
        crowdLevel: reportInput.crowdLevel,
        headCount: reportInput.headCount
      });
      showToast('Platform crowd report saved on the server.', 'success');
    } catch (err: any) {
      showToast(`Crowd report was NOT saved: ${err.message}`, 'error');
      throw err;
    }
  };

  // ─── Real Cleanliness Report API Call ─────────────────────────────────────
  const addCleanlinessReport = async (cleanInput: Omit<CleanlinessReport, 'reportId' | 'createdAt' | 'status'>) => {
    const allowedCleanlinessIssues: Record<string, 'TOILET_DIRTY' | 'LITTER' | 'WATER_SHORTAGE' | 'LINEN_SOILED' | 'PESTS' | 'SPILLAGE'> = {
      TOILET_DIRTY: 'TOILET_DIRTY',
      LITTER: 'LITTER',
      WATER_SHORTAGE: 'WATER_SHORTAGE',
      LINEN_SOILED: 'LINEN_SOILED',
      PESTS: 'PESTS',
      SPILLAGE: 'SPILLAGE'
    };
    const mappedIssue = allowedCleanlinessIssues[cleanInput.issueType] || 'TOILET_DIRTY';

    try {
      await staffApiService.reportCleanliness({
        trainId: cleanInput.trainId || null,
        coachId: cleanInput.coachId || null,
        stationId: cleanInput.stationId || null,
        platformNo: cleanInput.platformNumber || null,
        issueType: mappedIssue,
        description: cleanInput.description
      });
      showToast('Cleanliness report saved on the server.', 'success');
    } catch (err: any) {
      showToast(`Cleanliness report was NOT saved: ${err.message}`, 'error');
      throw err;
    }
  };

  // ─── Real Incident SOS API Call ───────────────────────────────────────────
  const reportIncident = async (incInput: Omit<Incident, 'incidentId' | 'createdAt' | 'status'>) => {
    try {
      await staffApiService.reportIncident({
        scheduleId: currentAssignment?.scheduleId || null,
        stationId: incInput.stationId || null,
        type: incInput.type,
        severity: incInput.severity
      });
      showToast('Incident report saved and sent to the control office.', 'success');
    } catch (err: any) {
      showToast(`Incident was NOT saved: ${err.message}`, 'error');
      throw err;
    }
  };

  // ─── Maintenance Tasks API Integration ────────────────────────────────────
  const createMaintenanceTask = async (task: {
    coachId?: number;
    platformId?: number;
    stationId?: number;
    type?: string;
    title: string;
    description: string;
    priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  }): Promise<{ success: boolean; message: string; maintId?: number }> => {
    try {
      const res = await staffApiService.createMaintenanceTask({
        coachId: task.coachId,
        platformId: task.platformId,
        type: task.type || task.title,
        description: task.description
      });
      showToast(`Maintenance task created: #${res.maintId}`, 'success');
      return { success: true, message: res.message || 'Task created', maintId: res.maintId };
    } catch (err: any) {
      showToast(`Maintenance error: ${err.message}`, 'error');
      return { success: false, message: err.message };
    }
  };

  const updateMaintenanceStatus = async (
    maintId: number,
    status: MaintenanceStatus,
    completionRemarks?: string
  ): Promise<{ success: boolean; message: string }> => {
    try {
      const res = await staffApiService.updateMaintenanceTaskStatus(maintId, status, completionRemarks);
      showToast(`Maintenance #${maintId} updated to ${status}`, 'success');
      return { success: true, message: res.message || 'Status updated' };
    } catch (err: any) {
      showToast(`Maintenance status error: ${err.message}`, 'error');
      return { success: false, message: err.message };
    }
  };

  // ─── Counter Booking API Integration ──────────────────────────────────────
  const createCounterBooking = async (payload: any): Promise<any> => {
    try {
      const res = await staffApiService.createCounterBooking(payload);
      showToast(`Counter ticket generated! PNR: ${res?.pnr || 'SUCCESS'}`, 'success');
      return res;
    } catch (err: any) {
      showToast(`Counter booking failed: ${err.message}`, 'error');
      throw err;
    }
  };

  return (
    <StaffContext.Provider
      value={{
        data,
        activeStaffId: activeStaff.staffId,
        activeStaff,
        activeTrain,
        activeSchedule,
        currentAssignment,
        serverChart,
        chartStatus,
        refreshAssignmentAndChart,
        markPassengerBoarding,
        verifyPassenger,
        boardPassengerApi,
        noShowPassengerApi,
        issueFine,
        updateTrainDelay,
        addCrowdReport,
        addCleanlinessReport,
        reportIncident,
        createMaintenanceTask,
        updateMaintenanceStatus,
        createCounterBooking,
        selectedReceiptFine,
        setSelectedReceiptFine,
        showToast,
        toasts
      }}
    >
      {children}
    </StaffContext.Provider>
  );
};

export const useStaff = () => {
  const context = useContext(StaffContext);
  if (!context) throw new Error('useStaff must be used within a StaffProvider');
  return context;
};
