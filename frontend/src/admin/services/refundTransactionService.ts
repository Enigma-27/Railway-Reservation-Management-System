import { isServiceMock } from '../config/api.config';
import { httpRequest } from './http.client';

export type RefundTransactionStatus = 'PENDING' | 'PROCESSED' | 'FAILED';

export interface RefundTransaction {
  refundId: number;
  pnr: string | null;
  passengerNo: number | null;
  passengerName: string | null;
  amount: number;
  reason: string;
  status: RefundTransactionStatus;
  attempts: number;
  failureReason: string | null;
  gatewayRefundId: string | null;
  createdAt: string | null;
  lastAttemptAt: string | null;
  processedAt: string | null;
}

export interface RefundRetryResult {
  refundId: number;
  status: RefundTransactionStatus;
  gatewayRefund: string;
  message: string | null;
  refund: RefundTransaction | null;
}

// Refund transactions are money movements (REFUND rows). This is NOT the refund rules page.
export const refundTransactionService = {
  async list(params: { status?: string; pnr?: string } = {}): Promise<RefundTransaction[]> {
    if (isServiceMock('refundTransactions')) {
      throw new Error('Refund transactions need the live backend (mock mode is on).');
    }
    const q = new URLSearchParams();
    if (params.status) q.set('status', params.status);
    if (params.pnr) q.set('pnr', params.pnr);
    const qs = q.toString();
    return httpRequest<RefundTransaction[]>(`/api/admin/refund-transactions${qs ? `?${qs}` : ''}`);
  },

  async retry(refundId: number): Promise<RefundRetryResult> {
    if (isServiceMock('refundTransactions')) {
      throw new Error('Refund transactions need the live backend (mock mode is on).');
    }
    return httpRequest<RefundRetryResult>(`/api/admin/refund-transactions/${refundId}/retry`, { method: 'POST' });
  },
};
