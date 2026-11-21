import React, { useEffect, useState } from 'react';
import { quotaService } from '../../services/quotaService';
import { QuotaOverview } from '../../types/quota';
import { DataTable, Column } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';

/**
 * Quotas: the five quotas with their real rules and real usage (passengers of the upcoming runs).
 * Read only: the seat shares (10% Tatkal, 10% Ladies, reserved Senior citizen and Divyaang blocks) are built into the
 * booking procedure. The passenger limits and the senior ages come from Settings.
 */
export const QuotasPage: React.FC = () => {
  const [quotas, setQuotas] = useState<QuotaOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      setQuotas(await quotaService.getQuotas());
    } catch (err: any) {
      setError(err?.message || 'Failed to load the quotas.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const columns: Column<QuotaOverview>[] = [
    { header: 'Quota', accessorKey: 'label', sortable: true, cell: (r) => <span className="font-bold text-slate-900">{r.label}</span> },
    { header: 'Seat share', accessorKey: 'seatShare', cell: (r) => <span className="text-xs text-slate-700">{r.seatShare}</span> },
    { header: 'Rule', accessorKey: 'rule', cell: (r) => <span className="text-xs text-slate-700">{r.rule}</span> },
    { header: 'Max passengers', accessorKey: 'maxPassengers', cell: (r) => <span className="font-mono text-xs">{r.maxPassengers}</span> },
    { header: 'Concession', accessorKey: 'concession', cell: (r) => <span className="text-xs">{r.concession}</span> },
    { header: 'Queue', accessorKey: 'queue', cell: (r) => <span className="text-xs text-slate-700">{r.queue}</span> },
    { header: 'Confirmed', accessorKey: 'confirmedPassengers', sortable: true, cell: (r) => <span className="font-mono text-xs font-semibold">{r.confirmedPassengers}</span> },
    { header: 'RAC', accessorKey: 'racPassengers', cell: (r) => <span className="font-mono text-xs">{r.racPassengers}</span> },
    { header: 'Waiting list', accessorKey: 'waitingListPassengers', cell: (r) => <span className="font-mono text-xs">{r.waitingListPassengers}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quota Rules"
        description="The five quotas, their rules and how many passengers use them on the upcoming runs. Real data. The seat shares are fixed in the booking procedure; passenger limits and senior ages are changed in Settings."
      />
      <DataTable
        data={quotas}
        columns={columns}
        loading={loading}
        error={error}
        onRetry={loadData}
        pageSize={10}
        searchPlaceholder="Search quotas..."
        searchFilter={(r, q) => `${r.label} ${r.rule}`.toLowerCase().includes(q.toLowerCase())}
        emptyMessage="No quotas found."
      />
    </div>
  );
};
