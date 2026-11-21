import React from 'react';
import { statusChip } from '../ui/status';

interface StatusBadgeProps {
  status: string | null | undefined;
  size?: 'sm' | 'md';
}

/** Staff status chip: the same mapping as the admin one (src/ui/status.ts). */
export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'sm' }) => {
  if (!status) return <span className="text-body-sm">-</span>;
  return (
    <span className={`rrms-badge ${statusChip(status)}`} style={size === 'md' ? { fontSize: 12, padding: '4px 12px' } : undefined}>
      <span className="rrms-dot" style={{ width: 6, height: 6, background: 'currentColor', opacity: 0.8 }} aria-hidden="true" />
      {status.replace(/_/g, ' ')}
    </span>
  );
};
