import React, { useState, useMemo } from 'react';
import { Skeleton } from '../../ui/Skeleton';
import { EmptyState } from '../../ui/EmptyState';
import { Search, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, AlertCircle, RefreshCw } from 'lucide-react';

export interface Column<T> {
  header: string;
  accessorKey?: keyof T;
  cell?: (row: T) => React.ReactNode;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  searchPlaceholder?: string;
  searchFilter?: (item: T, query: string) => boolean;
  pageSize?: number;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyMessage?: string;
  extraHeaderActions?: React.ReactNode;
}

export function DataTable<T extends Record<string, any>>({
  data,
  columns,
  searchPlaceholder = 'Search records...',
  searchFilter,
  pageSize = 10,
  loading = false,
  error = null,
  onRetry,
  emptyMessage = 'No records found.',
  extraHeaderActions,
}: DataTableProps<T>) {
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortKey, setSortKey] = useState<keyof T | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Filter
  const filteredData = useMemo(() => {
    if (!searchQuery.trim()) return data;
    const query = searchQuery.toLowerCase();

    if (searchFilter) {
      return data.filter((item) => searchFilter(item, query));
    }

    // Default search matches across all string/number fields
    return data.filter((item) =>
      Object.values(item).some((val) => {
        if (val === null || val === undefined) return false;
        return String(val).toLowerCase().includes(query);
      })
    );
  }, [data, searchQuery, searchFilter]);

  // Sort
  const sortedData = useMemo(() => {
    if (!sortKey) return filteredData;

    return [...filteredData].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];

      if (aVal === bVal) return 0;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      let comparison = 0;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        comparison = aVal - bVal;
      } else {
        comparison = String(aVal).localeCompare(String(bVal));
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filteredData, sortKey, sortDirection]);

  // Paginate
  const totalPages = Math.ceil(sortedData.length / pageSize) || 1;
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, currentPage, pageSize]);

  const handleSort = (key?: keyof T) => {
    if (!key) return;
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  return (
    <div className="dt">
      <div className="dt-bar">
        <div className="dt-search">
          <Search className="w-3.5 h-3.5" aria-hidden="true" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="form-input"
          />
        </div>
        {extraHeaderActions && <div className="flex items-center gap-2 flex-wrap">{extraHeaderActions}</div>}
      </div>

      <div className="dt-scroll">
        <table className="dt-table">
          <thead>
            <tr>
              {columns.map((col, idx) => {
                const active = sortKey === col.accessorKey;
                const cls = col.align === 'right' ? 'r' : col.align === 'center' ? 'c' : '';
                const canSort = !!(col.sortable && col.accessorKey);
                return (
                  <th key={idx} scope="col" className={cls} aria-sort={canSort ? (active ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}>
                    {canSort ? (
                      <button type="button" className="dt-sort" onClick={() => handleSort(col.accessorKey)}>
                        <span>{col.header}</span>
                        {active ? (sortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" /> : <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />) : <ArrowUpDown className="w-3 h-3 opacity-50" aria-hidden="true" />}
                      </button>
                    ) : (
                      <span>{col.header}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {error ? (
              <tr>
                <td colSpan={columns.length}>
                  <div className="dt-state">
                    <div className="rrms-alert-error" role="alert" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <AlertCircle className="w-4 h-4" aria-hidden="true" /> {error}
                    </div>
                    <p className="text-body-sm" style={{ marginTop: 8 }}>An error occurred while communicating with the railway service.</p>
                    {onRetry && (
                      <button type="button" onClick={onRetry} className="btn-ghost" style={{ marginTop: 10 }}>
                        <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Retry
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : loading ? (
              Array.from({ length: 6 }).map((_, rIdx) => (
                <tr key={rIdx} aria-hidden="true">
                  {columns.map((_, cIdx) => (
                    <td key={cIdx}><Skeleton h={14} w={cIdx % 3 === 0 ? '55%' : '80%'} /></td>
                  ))}
                </tr>
              ))
            ) : paginatedData.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>
                  <EmptyState art={searchQuery ? 'search' : 'ticket'} title={searchQuery ? 'Nothing matches your search' : emptyMessage} text={searchQuery ? 'Try other words or clear the search box.' : undefined} />
                </td>
              </tr>
            ) : (
              paginatedData.map((row, rIdx) => (
                <tr key={rIdx}>
                  {columns.map((col, cIdx) => (
                    <td key={cIdx} className={col.align === 'right' ? 'r' : col.align === 'center' ? 'c' : ''}>
                      {col.cell ? col.cell(row) : col.accessorKey ? String(row[col.accessorKey] ?? '—') : '—'}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!loading && sortedData.length > 0 && (
        <div className="dt-foot">
          <div className="text-body-sm" role="status">
            Showing <b>{(currentPage - 1) * pageSize + 1}</b> to <b>{Math.min(currentPage * pageSize, sortedData.length)}</b> of <b>{sortedData.length}</b> records
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1} aria-label="Previous page" className="btn-icon disabled:opacity-40 disabled:cursor-not-allowed">
              <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <span className="text-body-sm mono" style={{ padding: '0 6px' }}>{currentPage} / {totalPages}</span>
            <button type="button" onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} aria-label="Next page" className="btn-icon disabled:opacity-40 disabled:cursor-not-allowed">
              <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
