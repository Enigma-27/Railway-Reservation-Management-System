import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import './ui.css';

/**
 * Tabs with a sliding indicator (transform only). Arrow keys move between tabs.
 * The tab panels are rendered by the caller; each tab id is `${idPrefix}-tab-${value}`.
 */
export function Tabs<T extends string>({ value, onChange, items, label, idPrefix = 'tabs', className = '' }: {
  value: T; onChange: (v: T) => void; items: { value: T; label: string; accent?: string }[]; label: string; idPrefix?: string; className?: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [bar, setBar] = useState({ x: 0, w: 0 });

  const measure = () => {
    const el = refs.current[value];
    if (el) setBar({ x: el.offsetLeft, w: el.offsetWidth });
  };
  useLayoutEffect(measure, [value, items.length]);
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  });

  const onKey = (e: React.KeyboardEvent) => {
    const i = items.findIndex((t) => t.value === value);
    const next = e.key === 'ArrowRight' ? (i + 1) % items.length : e.key === 'ArrowLeft' ? (i - 1 + items.length) % items.length : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(items[next].value);
    refs.current[items[next].value]?.focus();
  };

  return (
    <div className={`tabs ${className}`} role="tablist" aria-label={label} onKeyDown={onKey}>
      <span className="tabs-bar" style={{ width: bar.w, transform: `translateX(${bar.x}px)`, background: items.find((t) => t.value === value)?.accent }} aria-hidden="true" />
      {items.map((t) => (
        <button
          key={t.value} ref={(el) => { refs.current[t.value] = el; }} type="button" role="tab" id={`${idPrefix}-tab-${t.value}`}
          aria-selected={t.value === value} tabIndex={t.value === value ? 0 : -1} className="tabs-tab" onClick={() => onChange(t.value)}
        >{t.label}</button>
      ))}
    </div>
  );
}
