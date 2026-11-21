import React from 'react';

type Art = 'train' | 'ticket' | 'search' | 'bell';

/** Small illustrated empty state (inline SVG, themed with currentColor). */
export const EmptyState: React.FC<{ title: string; text?: string; art?: Art; action?: React.ReactNode }> = ({ title, text, art = 'train', action }) => (
  <div className="rrms-empty" role="status">
    <svg width="120" height="88" viewBox="0 0 120 88" fill="none" aria-hidden="true">
      <path d="M8 80h104" stroke="currentColor" strokeOpacity=".35" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 7" />
      {art === 'train' && (
        <g stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round">
          <rect x="26" y="20" width="68" height="40" rx="12" fill="currentColor" fillOpacity=".12" />
          <rect x="34" y="28" width="20" height="14" rx="4" /><rect x="66" y="28" width="20" height="14" rx="4" />
          <path d="M40 60v8M80 60v8" strokeLinecap="round" /><circle cx="44" cy="70" r="4" fill="currentColor" /><circle cx="76" cy="70" r="4" fill="currentColor" />
          <path d="M100 14l4-4M104 24h6M18 14l-4-4" strokeLinecap="round" />
        </g>
      )}
      {art === 'ticket' && (
        <g stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round">
          <path d="M20 22h80v10a6 6 0 0 0 0 12v10H20V44a6 6 0 0 0 0-12z" fill="currentColor" fillOpacity=".12" />
          <path d="M78 22v32" strokeDasharray="3 4" /><path d="M32 34h30M32 44h20" strokeLinecap="round" />
        </g>
      )}
      {art === 'search' && (
        <g stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <circle cx="54" cy="36" r="20" fill="currentColor" fillOpacity=".12" /><path d="M69 51l20 18" /><path d="M46 36h16" />
        </g>
      )}
      {art === 'bell' && (
        <g stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round">
          <path d="M36 58V38a24 24 0 0 1 48 0v20l6 6H30z" fill="currentColor" fillOpacity=".12" /><path d="M52 70a8 8 0 0 0 16 0" />
        </g>
      )}
    </svg>
    <strong>{title}</strong>
    {text && <span style={{ maxWidth: 360, fontSize: 14 }}>{text}</span>}
    {action}
  </div>
);
