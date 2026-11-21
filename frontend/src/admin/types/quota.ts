import { Quota } from '../constants/enums';

export interface QuotaRule {
  quotaRuleId: number;
  quota: Quota;
  allocatedPercentage: number;
  description: string;
}

/** One row of GET /api/admin/quotas: a quota with its real rules and real usage (upcoming runs). */
export interface QuotaOverview {
  quota: Quota;
  label: string;
  seatShare: string;
  rule: string;
  maxPassengers: number;
  concession: string;
  queue: string;
  confirmedPassengers: number;
  racPassengers: number;
  waitingListPassengers: number;
}
