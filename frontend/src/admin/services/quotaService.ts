import { QuotaOverview } from '../types/quota';
import { httpRequest } from './http.client';

/** Quotas are read from the live API (rules and usage). The seat shares are built into the booking procedure, so they are not editable here. */
export const quotaService = {
  getQuotas(): Promise<QuotaOverview[]> {
    return httpRequest<QuotaOverview[]>('/api/admin/quotas');
  },
};
