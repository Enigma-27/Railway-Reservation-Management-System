import React from 'react';

/** Grey shimmer block shown while data loads. */
export const Skeleton: React.FC<{ w?: number | string; h?: number | string; className?: string; style?: React.CSSProperties }> = ({ w = '100%', h = 14, className = '', style }) => (
  <div className={`rrms-skeleton ${className}`} style={{ width: w, height: h, ...style }} aria-hidden="true" />
);

/** A few skeleton rows: used for lists and tables while loading. */
export const SkeletonRows: React.FC<{ rows?: number; h?: number; label?: string }> = ({ rows = 5, h = 56, label = 'Loading' }) => (
  <div role="status" aria-label={label} style={{ display: 'grid', gap: 10 }}>
    {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} h={h} />)}
    <span className="sr-only">{label}...</span>
  </div>
);
