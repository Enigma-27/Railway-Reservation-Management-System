import React, { useEffect, useId, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import './ui.css';

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

export function formatDay(s: string): string {
  if (!s) return '';
  const d = parse(s);
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/** Calendar popover. Keyboard: arrows move by day / week, PageUp / PageDown change the month, Enter picks, Escape closes. */
export const DatePicker: React.FC<{ label: string; value: string; onChange: (v: string) => void; min?: string; max?: string; className?: string; hideLabel?: boolean }> = ({ label, value, onChange, min, max, className = '', hideLabel }) => {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<Date>(() => (value ? parse(value) : new Date()));
  const root = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [open]);

  useEffect(() => {
    if (open) (grid.current?.querySelector('button[tabindex="0"]') as HTMLElement | null)?.focus();
  }, [open, focus]);

  const disabledDay = (d: Date) => { const s = iso(d); return (!!min && s < min) || (!!max && s > max); };
  const first = new Date(focus.getFullYear(), focus.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(focus.getFullYear(), focus.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [...Array(offset).fill(null), ...Array.from({ length: days }, (_, i) => new Date(focus.getFullYear(), focus.getMonth(), i + 1))];
  const today = iso(new Date());

  const move = (days: number) => setFocus((f) => new Date(f.getFullYear(), f.getMonth(), f.getDate() + days));
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); (root.current?.querySelector('.sel-btn') as HTMLElement | null)?.focus(); return; }
    const map: Record<string, () => void> = {
      ArrowLeft: () => move(-1), ArrowRight: () => move(1), ArrowUp: () => move(-7), ArrowDown: () => move(7),
      PageUp: () => setFocus((f) => new Date(f.getFullYear(), f.getMonth() - 1, 1)), PageDown: () => setFocus((f) => new Date(f.getFullYear(), f.getMonth() + 1, 1)),
    };
    if (map[e.key]) { e.preventDefault(); map[e.key](); }
  };

  return (
    <div className={`sel ${className}`} ref={root}>
      <span id={`${uid}-l`} className={hideLabel ? 'sr-only' : 'sel-label'}>{label}</span>
      <button type="button" className="sel-btn rrms-input" aria-haspopup="dialog" aria-expanded={open} aria-labelledby={`${uid}-l ${uid}-b`} onClick={() => { setFocus(value ? parse(value) : new Date()); setOpen(!open); }}>
        <span id={`${uid}-b`} className={value ? 'sel-val' : 'sel-val ph'}>{value ? formatDay(value) : 'Pick a date'}</span>
        <CalendarDays size={16} aria-hidden="true" className="sel-chev" />
      </button>
      {open && (
        <div className="dp" role="dialog" aria-label={`Choose ${label}`} onKeyDown={onKey}>
          <div className="dp-head">
            <button type="button" className="rrms-icon-btn dp-nav" aria-label="Previous month" onClick={() => setFocus(new Date(focus.getFullYear(), focus.getMonth() - 1, 1))}><ChevronLeft size={16} aria-hidden="true" /></button>
            <strong aria-live="polite">{MONTHS[focus.getMonth()]} {focus.getFullYear()}</strong>
            <button type="button" className="rrms-icon-btn dp-nav" aria-label="Next month" onClick={() => setFocus(new Date(focus.getFullYear(), focus.getMonth() + 1, 1))}><ChevronRight size={16} aria-hidden="true" /></button>
          </div>
          <div className="dp-grid" role="grid" aria-label={`${MONTHS[focus.getMonth()]} ${focus.getFullYear()}`} ref={grid}>
            {DOW.map((d) => <span key={d} className="dp-dow" role="columnheader">{d}</span>)}
            {cells.map((d, i) => d ? (
              <button
                key={i} type="button" role="gridcell" disabled={disabledDay(d)} tabIndex={iso(d) === iso(focus) ? 0 : -1}
                aria-selected={iso(d) === value} aria-label={d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                className={`dp-day ${iso(d) === value ? 'sel' : ''} ${iso(d) === today ? 'today' : ''}`}
                onClick={() => { onChange(iso(d)); setOpen(false); (root.current?.querySelector('.sel-btn') as HTMLElement | null)?.focus(); }}
              >{d.getDate()}</button>
            ) : <span key={i} aria-hidden="true" />)}
          </div>
        </div>
      )}
    </div>
  );
};
