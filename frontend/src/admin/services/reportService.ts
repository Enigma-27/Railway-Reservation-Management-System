import { API_CONFIG, isServiceMock } from '../config/api.config';
import {
  BookingTrendItem,
  CancellationReportItem,
  DashboardMetrics,
  DelayPunctualityItem,
  FineSummaryItem,
  GrievanceMetricsItem,
  OccupancyReportItem,
  RevenueReportItem,
} from '../types/report';
import { httpRequest } from './http.client';
import { mockStore, simulateLatency } from './mock.client';

export interface RankReportsResponse {
  busiestTrains: any[];
  topRoutes: any[];
  stationRanking: any[];
  classRevenue: any[];
  quotaUtilization: any[];
  reports?: { reportKey: string; name: string; data: any[] }[];
}


export const reportService = {
  /** REAL totals for the Reports and Notifications pages: GET /api/admin/analytics/summary */
  async getSummary(): Promise<{ bookings: number; confirmed: number; rac: number; waiting: number; cancelled: number; revenue: number; refunded: number; pendingRefunds: number; occupancyPct: number; pendingTdr: number; totalTdr: number }> {
    return httpRequest('/api/admin/analytics/summary');
  },
  async getNotificationStats(): Promise<{ total: number; unread: number; byType: Record<string, number> }> {
    return httpRequest('/api/admin/analytics/notifications');
  },

  async getDashboardMetrics(): Promise<DashboardMetrics> {
    await simulateLatency(50);
    const bookings = mockStore.getBookings();
    const payments = mockStore.getPayments();
    const cancellations = mockStore.getCancellations();
    const trains = mockStore.getTrains();
    const grievances = mockStore.getGrievances();
    const tdr = mockStore.getTdr();
    const incidents = mockStore.getIncidents();
    const schedules = mockStore.getSchedules();

    const totalRevenue = payments
      .filter((p) => p.paymentStatus === 'SUCCESS')
      .reduce((sum, p) => sum + p.amount, 0);

    return {
      totalBookings: bookings.length,
      totalRevenue,
      totalCancellations: cancellations.length,
      activeTrainsCount: trains.filter((t) => t.status === 'ACTIVE').length,
      openGrievancesCount: grievances.filter((g) => g.status === 'SUBMITTED' || g.status === 'IN_PROGRESS').length,
      pendingTdrCount: tdr.filter((t) => t.status === 'FILED' || t.status === 'UNDER_REVIEW').length,
      openIncidentsCount: incidents.filter((i) => i.status === 'REPORTED' || i.status === 'ACKNOWLEDGED').length,
      delayedTrainsCount: schedules.filter((s) => s.status === 'DELAYED').length,
    };
  },

  /** REAL data: GET /api/admin/analytics/revenue (MySQL) */
  async getRevenueReport(): Promise<RevenueReportItem[]> {
    return httpRequest<RevenueReportItem[]>('/api/admin/analytics/revenue');
  },

  /** REAL data: GET /api/admin/analytics/bookings (MySQL) */
  async getBookingTrends(): Promise<BookingTrendItem[]> {
    return httpRequest<BookingTrendItem[]>('/api/admin/analytics/bookings');
  },

  /** REAL data: GET /api/admin/analytics/cancellations (MySQL) */
  async getCancellationReport(): Promise<CancellationReportItem[]> {
    return httpRequest<CancellationReportItem[]>('/api/admin/analytics/cancellations');
  },

  /** REAL data: GET /api/admin/analytics/occupancy (MySQL) */
  async getOccupancyReport(): Promise<OccupancyReportItem[]> {
    return httpRequest<OccupancyReportItem[]>('/api/admin/analytics/occupancy');
  },

  async getFineSummary(): Promise<FineSummaryItem[]> {
    await simulateLatency(50);
    const fines = mockStore.getFines();
    const trains = mockStore.getTrains();
    const tMap = new Map(trains.map((t) => [t.trainId, t]));

    return fines.map((f) => {
      const train = f.trainId ? tMap.get(f.trainId) : null;
      return {
        fineId: f.fineId,
        trainNumber: train ? train.trainNumber : 'Station Offense',
        reason: f.reason,
        amount: f.amount,
        paymentStatus: f.paymentStatus,
        issuedAt: f.issuedAt,
      };
    });
  },

  /** REAL data: GET /api/admin/analytics/delays (MySQL) */
  async getDelayReport(): Promise<DelayPunctualityItem[]> {
    return httpRequest<DelayPunctualityItem[]>('/api/admin/analytics/delays');
  },

  /** REAL data: GET /api/admin/analytics/complaints (MySQL + MongoDB) */
  async getComplaintsReport(): Promise<GrievanceMetricsItem[]> {
    return httpRequest<GrievanceMetricsItem[]>('/api/admin/analytics/complaints');
  },

  async getAnalyticalReport<T = any>(reportKey: string): Promise<{
    reportId: number;
    reportKey: string;
    reportType: string;
    generatedAt: string;
    rowCount: number;
    rows: T[];
  }> {
    return httpRequest(`/api/admin/reports/${reportKey}`);
  },

  async getRankReports(): Promise<RankReportsResponse> {
    if (isServiceMock('reports')) {
      await simulateLatency();
      return {
        busiestTrains: [
          { rank_pos: 1, dense_rank_pos: 1, train_id: 1, train_number: '12301', train_name: 'Howrah Rajdhani Express (12301)', train_type: 'RAJDHANI', total_runs_conducted: 6, total_passengers_booked: 850, total_revenue: 1733650.0 },
          { rank_pos: 2, dense_rank_pos: 2, train_id: 2, train_number: '12951', train_name: 'Mumbai Rajdhani Express (12951)', train_type: 'RAJDHANI', total_runs_conducted: 5, total_passengers_booked: 720, total_revenue: 1540000.0 },
          { rank_pos: 3, dense_rank_pos: 3, train_id: 3, train_number: '12002', train_name: 'Bhopal Shatabdi Express (12002)', train_type: 'SHATABDI', total_runs_conducted: 7, total_passengers_booked: 690, total_revenue: 980000.0 },
        ],
        topRoutes: [
          { revenue_rank: 1, origin_code: 'HWH', origin_station: 'Howrah Jn', destination_code: 'NDLS', destination_station: 'New Delhi', total_bookings_count: 420, gross_route_revenue: 890000.0, avg_fare_per_passenger: 2119.05 },
          { revenue_rank: 2, origin_code: 'MMCT', origin_station: 'Mumbai Central', destination_code: 'NDLS', destination_station: 'New Delhi', total_bookings_count: 380, gross_route_revenue: 812000.0, avg_fare_per_passenger: 2136.84 },
        ],
        stationRanking: [
          { station_rank: 1, station_id: 1, station_code: 'NDLS', station_name: 'New Delhi', city: 'New Delhi', state: 'Delhi', total_boarding_passengers: 1200, originating_revenue: 2400000.0 },
          { station_rank: 2, station_id: 2, station_code: 'HWH', station_name: 'Howrah Jn', city: 'Kolkata', state: 'West Bengal', total_boarding_passengers: 950, originating_revenue: 1950000.0 },
        ],
        classRevenue: [
          { class_code: '3A', class_name: 'AC 3 Tier', total_passengers: 600, class_revenue: 1200000.0, running_cumulative_revenue: 1200000.0, revenue_pct_share: 45.5 },
          { class_code: '2A', class_name: 'AC 2 Tier', total_passengers: 300, class_revenue: 900000.0, running_cumulative_revenue: 2100000.0, revenue_pct_share: 34.1 },
          { class_code: 'SL', class_name: 'Sleeper', total_passengers: 500, class_revenue: 537300.0, running_cumulative_revenue: 2637300.0, revenue_pct_share: 20.4 },
        ],
        quotaUtilization: [
          { quota: 'GENERAL', total_bookings: 500, total_passengers: 750, total_fare_collected: 1500000.0, avg_passenger_fare: 2000.0, quota_popularity_rank: 1 },
          { quota: 'TATKAL', total_bookings: 180, total_passengers: 240, total_fare_collected: 680000.0, avg_passenger_fare: 2833.33, quota_popularity_rank: 2 },
          { quota: 'LADIES', total_bookings: 50, total_passengers: 60, total_fare_collected: 120000.0, avg_passenger_fare: 2000.0, quota_popularity_rank: 3 },
        ],
      };
    }
    return httpRequest<RankReportsResponse>('/api/admin/reports/rank');
  },
};

