import React, { useEffect, useState } from 'react';
import { Skeleton } from '../../ui/Skeleton';

export interface StatItem { label: string; value: string | number; hint?: string }

/**
 * A strip of REAL numbers (from the database through GET /api/admin/analytics/...). Shows skeletons while loading and a small
 * "Live data" badge so nobody mistakes it for the labelled "Sample data" parts of a page.
 */
export const RealStats: React.FC<{ load: () => Promise<StatItem[]>; title?: string }> = ({ load, title = 'Live numbers from the database' }) => {
  const [items, setItems] = useState<StatItem[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    load().then((i) => alive && setItems(i)).catch(() => alive && setError(true));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <section className="rrms-card" style={{ padding: 16 }} aria-label={title}>
      <div className="flex items-center justify-between gap-2 flex-wrap" style={{ marginBottom: 10 }}>
        <span className="t-label">{title}</span>
        <span className="rrms-badge rrms-badge-confirmed"><span className="rrms-dot rrms-dot-live" aria-hidden="true" /> Live data</span>
      </div>
      {error && <p className="rrms-alert-error" role="alert">The numbers could not be loaded.</p>}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        {!items && !error && Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} h={58} />)}
        {items?.map((i) => (
          <div key={i.label} style={{ background: 'var(--rrms-surface-alt)', borderRadius: 12, padding: '10px 12px' }}>
            <div className="mono" style={{ fontSize: 20, fontWeight: 600 }}>{i.value}</div>
            <div className="live-sub">{i.label}</div>
            {i.hint && <div className="live-sub" style={{ fontSize: 11 }}>{i.hint}</div>}
          </div>
        ))}
      </div>
    </section>
  );
};
