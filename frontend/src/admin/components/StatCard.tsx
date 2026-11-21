import React from 'react';
import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  subtitle?: string;
  change?: string;
  isPositive?: boolean;
  color?: 'orange' | 'blue' | 'emerald' | 'amber' | 'rose' | 'purple';
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  icon: Icon,
  subtitle,
  change,
  isPositive,
  color = 'blue',
}) => {
  const colorMap = {
    orange: 'bg-orange-50 text-orange-600 border-orange-200/60',
    blue: 'bg-brand-soft text-brand-link border-blue-200/60',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
    amber: 'bg-amber-50 text-amber-700 border-amber-200/60',
    rose: 'bg-rose-50 text-rose-600 border-rose-200/60',
    purple: 'bg-purple-50 text-purple-600 border-purple-200/60',
  };

  return (
    <div className="sc">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="t-label" style={{ display: 'block' }}>{title}</span>
          <div className="sc-val">{value}</div>
        </div>
        <div className={`p-2.5 rounded-xl border shrink-0 ${colorMap[color]}`}>
          <Icon className="w-5 h-5" aria-hidden="true" />
        </div>
      </div>
      {(subtitle || change) && (
        <div className="mt-3 pt-2.5 flex items-center justify-between" style={{ borderTop: '1px solid var(--rrms-border-soft)' }}>
          {subtitle && <p className="text-meta line-clamp-1">{subtitle}</p>}
          {change && <span className={`text-[11px] font-bold shrink-0 ml-auto ${isPositive ? 'text-emerald-700' : 'text-rose-700'}`}>{change}</span>}
        </div>
      )}
    </div>
  );
};
