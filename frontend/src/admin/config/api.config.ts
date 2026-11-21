/// <reference types="vite/client" />
export const API_CONFIG = {
  USE_MOCK: import.meta.env.VITE_USE_MOCK === 'true',
  BASE_URL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000',
  STORAGE_KEYS: {
    // ONE session for every role (see src/auth/session.ts): the same two keys hold the token and the user.
    TOKEN: 'rrms_token',
    USER: 'rrms_user',
    STAFF_TOKEN: 'rrms_token',
    STAFF_USER: 'rrms_user',
  },
  DEFAULT_MOCK_LATENCY_MS: 300,
  SERVICE_MOCK: {
    // Services without real backend endpoints remain on mock
    notifications: true,
    groundReports: true,

    // Real services backed by live backend endpoints
    quotas: false,
    auth: false,
    dashboard: false,
    reports: false,
    bookings: false,
    tdr: false,
    schedules: false,
    chartPreparation: false,
    auditLogs: false,
    users: false,
    platforms: false,
    fines: false,
    refundTransactions: false,
    incidents: false,
    settings: false,
    complaints: false,
    grievances: false,
    staff: false,
    masterData: false,
  },
} as const;

export function isServiceMock(serviceKey: keyof typeof API_CONFIG.SERVICE_MOCK): boolean {
  if (API_CONFIG.USE_MOCK) return true;
  return API_CONFIG.SERVICE_MOCK[serviceKey] ?? false;
}

