import React, { useEffect, useState } from 'react';
import { refundTransactionService, RefundTransaction } from '../../services/refundTransactionService';
import { DataTable, Column } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { PageHeader } from '../../components/PageHeader';
import { formatCurrency, formatDateTime } from '../../utils/format';

const STATUS_FILTERS = ['', 'PENDING', 'PROCESSED', 'FAILED'];

export const RefundTransactionsPage: React.FC = () => {
  const [rows, setRows] = useState<RefundTransaction[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await refundTransactionService.list({ status: statusFilter || undefined }));
    } catch (err: any) {
      setError(err?.message || 'Failed to load refund transactions.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const handleRetry = async (row: RefundTransaction) => {
    setRetryingId(row.refundId);
    setNotice(null);
    try {
      const res = await refundTransactionService.retry(row.refundId);
      setNotice(`Refund #${row.refundId} is now ${res.status}.${res.message ? ' ' + res.message : ''}`);
      await load();
    } catch (err: any) {
      setNotice(err?.message || 'Retry failed.');
    } finally {
      setRetryingId(null);
    }
  };

  const columns: Column<RefundTransaction>[] = [
    {
      header: 'Refund',
      accessorKey: 'refundId',
      sortable: true,
      cell: (row) => <span className="font-mono font-bold text-slate-900">#{row.refundId}</span>,
    },
    {
      header: 'PNR / Passenger',
      cell: (row) => (
        <div>
          <div className="font-mono text-xs font-semibold text-slate-900">{row.pnr || '-'}</div>
          <div className="text-meta">{row.passengerName || (row.passengerNo ? `Passenger ${row.passengerNo}` : 'Whole booking')}</div>
        </div>
      ),
    },
    {
      header: 'Reason',
      accessorKey: 'reason',
      sortable: true,
      cell: (row) => <span className="text-xs text-slate-700">{row.reason.replace(/_/g, ' ')}</span>,
    },
    {
      header: 'Amount',
      accessorKey: 'amount',
      sortable: true,
      cell: (row) => <span className="font-mono font-bold text-xs text-slate-900">{formatCurrency(row.amount)}</span>,
    },
    {
      header: 'Status',
      accessorKey: 'status',
      sortable: true,
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      header: 'Attempts',
      accessorKey: 'attempts',
      sortable: true,
      cell: (row) => <span className="font-mono text-xs">{row.attempts}</span>,
    },
    {
      header: 'Note / Failure Reason',
      cell: (row) => (
        <span className={`text-xs ${row.status === 'FAILED' ? 'text-rose-700 font-semibold' : 'text-slate-500'}`}>
          {row.failureReason || (row.gatewayRefundId ? `Gateway id ${row.gatewayRefundId}` : '-')}
        </span>
      ),
    },
    {
      header: 'Last Attempt / Done',
      cell: (row) => (
        <span className="text-xs text-slate-500">
          {row.processedAt
            ? `Done ${formatDateTime(row.processedAt)}`
            : row.lastAttemptAt
              ? `Tried ${formatDateTime(row.lastAttemptAt)}`
              : 'Not tried yet'}
        </span>
      ),
    },
    {
      header: 'Action',
      cell: (row) =>
        row.status === 'PENDING' || row.status === 'FAILED' ? (
          <button
            type="button"
            disabled={retryingId === row.refundId}
            onClick={() => handleRetry(row)}
            className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            {retryingId === row.refundId ? 'Retrying...' : 'Retry'}
          </button>
        ) : (
          <span className="text-xs text-slate-400">-</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Refund Transactions"
        description="Every refund is PENDING when created, then PROCESSED (gateway done) or FAILED (will be retried automatically). Money is paid out only when PROCESSED."
        actions={
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-600" htmlFor="refund-status-filter">Status</label>
            <select
              id="refund-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white"
            >
              {STATUS_FILTERS.map((s) => (
                <option key={s || 'ALL'} value={s}>{s || 'All'}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={load}
              className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-50"
            >
              Refresh
            </button>
          </div>
        }
      />

      {notice && (
        <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-800">{notice}</div>
      )}

      <p className="text-xs text-slate-500">
        Seeded and simulated payments never move real money. Their refunds are marked PROCESSED with the note SIMULATED_PAYMENT.
      </p>

      <DataTable
        data={rows}
        columns={columns}
        loading={loading}
        error={error}
        onRetry={load}
        searchPlaceholder="Search by PNR, passenger, reason..."
        emptyMessage="No refund transactions found."
      />
    </div>
  );
};
