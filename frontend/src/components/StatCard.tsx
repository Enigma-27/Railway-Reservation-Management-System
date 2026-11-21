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

const COLORS = {
  orange: 'bg-orange-50 text-orange-600 border-orange-100',
  blue: 'bg-blue-50 text-blue-600 border-blue-100',
  emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  amber: 'bg-amber-50 text-amber-600 border-amber-100',
  rose: 'bg-rose-50 text-rose-600 border-rose-100',
  purple: 'bg-purple-50 text-purple-600 border-purple-100',
};

/** Staff stat card: the same glass card as the admin one (class "sc" in admin/admin-components.css). */
export const StatCard: React.FC<StatCardProps> = ({ title, value, icon: Icon, subtitle, change, isPositive, color = 'blue' }) => (
  <div className="sc">
    <div className="flex items-center justify-between">
      <span className="t-label">{title}</span>
      <div className={`p-2.5 rounded-xl border ${COLORS[color]}`}>
        <Icon className="w-4 h-4" aria-hidden="true" />
      </div>
    </div>
    <div className="mt-4 flex items-baseline justify-between gap-2">
      <div className="sc-val" style={{ marginTop: 0 }}>{value}</div>
      {change && (
        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${isPositive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}>
          {change}
        </span>
      )}
    </div>
    {subtitle && <p className="mt-1.5 text-meta">{subtitle}</p>}
  </div>
);
