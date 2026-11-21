/**
 * Small client for the public routes used by the landing page and the Train Info page.
 * Everything here is real API data (see docs/API_CONTRACT.md): stations, trains, run status, alerts, PNR.
 */
import { API_CONFIG } from '../admin/config/api.config';
import { getSession } from '../auth/session';

async function get<T>(path: string, withToken = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (withToken) {
    const s = getSession();
    if (s) headers.Authorization = `Bearer ${s.token}`;
  }
  let res: Response;
  try {
    res = await fetch(`${API_CONFIG.BASE_URL}${path}`, { headers });
  } catch {
    throw new Error('Cannot reach the server. Please check that the backend is running.');
  }
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok || !json || !json.success) {
    const e: any = new Error((json && json.error && json.error.message) || `Request failed (${res.status})`);
    e.status = res.status;
    e.code = json && json.error && json.error.code;
    throw e;
  }
  return json.data as T;
}

export interface Station { stationId: number; stationCode: string; stationName: string; city: string }
export interface TrainSummary { trainId: number; trainNumber: string; displayName: string; trainType: string }
export interface RouteStop {
  stopSequence: number; stationCode: string; stationName: string; arrivalTime: string; departureTime: string;
  dayOffset: number; distanceFromOriginKm?: number; platformNo?: number | null;
}
export interface TrainDetail extends TrainSummary { runningDays: string[]; route: RouteStop[] }
export interface RunStatus {
  trainId: number; trainNumber: string; trainName: string; journeyDate: string; departureTime: string;
  status: 'ON_TIME' | 'DELAYED' | 'CANCELLED' | 'COMPLETED'; delayMinutes: number; chartPrepared: boolean;
  stops: Array<{ stopSequence: number; stationCode: string; stationName: string; arrivalTime: string; departureTime: string; dayOffset: number }>;
}
export interface ServiceAlert {
  scheduleId: number; trainNumber: string; trainName: string; journeyDate: string; departureTime: string;
  status: string; delayMinutes: number; severity: 'WARNING' | 'CRITICAL'; message: string;
}

export interface LiveQuota {
  quota: string; totalSeats: number; bookedSeats: number; availableSeats: number; racCount: number;
  waitingListCount: number; fare: number; status: string;
}
export interface LiveClass {
  classCode: string; className: string; totalSeats: number; availableSeats: number; bookedSeats: number;
  racCount: number; racCapacity: number; waitingListCount: number; waitingListCapacity: number; status: string;
  fare?: number; quotas?: LiveQuota[];
}
export interface LiveTrain {
  scheduleId: number; trainId: number; trainNumber: string; trainName: string; trainType: string; journeyDate: string;
  origin: { stationId: number; code: string; name: string; departureTime: string };
  destination: { stationId: number; code: string; name: string; arrivalTime: string; dayOffset: number };
  runStatus: 'NOT_STARTED' | 'RUNNING' | 'DELAYED' | 'COMPLETED' | 'CANCELLED';
  departed: boolean; delayMinutes: number; chartPrepared: boolean; occupancyPct: number;
  classes: LiveClass[]; fareFor?: { from: string; to: string; distanceKm: number };
}
export interface LiveTrainsPage { date: string; asOf: string; page: number; pageSize: number; total: number; trains: LiveTrain[] }

export const publicApi = {
  liveTrains: (query: Record<string, string | number>) => {
    const qs = Object.entries(query).filter(([, v]) => v !== '' && v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
    return get<LiveTrainsPage>(`/api/live-trains${qs ? `?${qs}` : ''}`);
  },
  liveTrain: (scheduleId: number, from?: string, to?: string) =>
    get<LiveTrain>(`/api/live-trains/${scheduleId}${from && to ? `?from=${from}&to=${to}` : ''}`),
  stations: () => get<Station[]>('/api/stations'),
  trains: () => get<TrainSummary[]>('/api/trains'),
  train: (id: number | string) => get<TrainDetail>(`/api/trains/${id}`),
  runStatus: (id: number | string, date: string) => get<RunStatus>(`/api/trains/${id}/run-status?journeyDate=${encodeURIComponent(date)}`),
  alerts: () => get<ServiceAlert[]>('/api/alerts'),
  /** Public PNR status: status only, no names or personal data, rate limited (GET /api/pnr-status/:pnr). No sign-in needed. */
  pnrStatus: (pnr: string) => get<any>(`/api/pnr-status/${pnr}`),
  /** Full PNR details need a signed-in user: a passenger sees only their own PNR, staff and admin see any. */
  pnr: (pnr: string) => {
    const s = getSession();
    if (!s) throw new Error('Please sign in to check a PNR.');
    return get<any>(s.role === 'PASSENGER' ? `/api/bookings/${pnr}` : `/api/staff/pnr/${pnr}`, true);
  },
};

export const PENDING_SEARCH_KEY = 'rrms_pending_search';
export interface PendingSearch { fromId: number; toId: number; date: string; classType: string; trainId?: number }

export function todayIso(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Numbers for the landing page stat strip, worked out from GET /api/live-trains (today's runs). */
export interface LiveStats { trainsToday: number; seatsAvailable: number; onTimePct: number; asOf: string }
export async function liveStats(): Promise<LiveStats> {
  const res = await publicApi.liveTrains({ pageSize: 100 });
  const running = res.trains.filter((t) => t.runStatus !== 'CANCELLED');
  const bookable = running.filter((t) => t.runStatus !== 'COMPLETED' && !t.departed);
  const seats = bookable.reduce((sum, t) => sum + t.classes.reduce((s, c) => s + c.availableSeats, 0), 0);
  const onTime = running.length ? running.filter((t) => t.delayMinutes === 0 && t.runStatus !== 'DELAYED').length / running.length : 1;
  return { trainsToday: running.length, seatsAvailable: seats, onTimePct: Math.round(onTime * 1000) / 10, asOf: res.asOf };
}
