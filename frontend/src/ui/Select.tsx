import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import './ui.css';

export interface Option { value: string; label: string; hint?: string }

/**
 * Custom dropdown (listbox pattern). Keyboard: Arrow keys, Home/End, Enter/Space to pick, Escape to close,
 * type a letter to jump. Screen readers: button + listbox + aria-activedescendant.
 */
export const Select: React.FC<{
  label: string; value: string; onChange: (v: string) => void; options: Option[];
  disabled?: boolean; placeholder?: string; className?: string; hideLabel?: boolean;
}> = ({ label, value, onChange, options, disabled, placeholder = 'Select', className = '', hideLabel }) => {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ s: '', t: 0 });
  const selected = useMemo(() => options.findIndex((o) => o.value === value), [options, value]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [open]);

  useEffect(() => {
    if (open && list.current) (list.current.children[active] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const openList = () => { setActive(Math.max(0, selected)); setOpen(true); };
  const pick = (i: number) => { const o = options[i]; if (o) onChange(o.value); setOpen(false); (root.current?.querySelector('button.sel-btn') as HTMLElement | null)?.focus(); };

  const onKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openList(); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(options.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(active); }
    else if (e.key === 'Tab') setOpen(false);
    else if (e.key.length === 1) {
      const now = Date.now();
      typed.current.s = now - typed.current.t > 700 ? e.key.toLowerCase() : typed.current.s + e.key.toLowerCase();
      typed.current.t = now;
      const hit = options.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.s));
      if (hit >= 0) setActive(hit);
    }
  };

  const cur = selected >= 0 ? options[selected] : null;
  return (
    <div className={`sel ${className}`} ref={root} onKeyDown={onKey}>
      <span id={`${uid}-l`} className={hideLabel ? 'sr-only' : 'sel-label'}>{label}</span>
      <button
        type="button" className="sel-btn rrms-input" disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-labelledby={`${uid}-l ${uid}-b`}
        aria-controls={open ? `${uid}-list` : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
      >
        <span id={`${uid}-b`} className={cur ? 'sel-val' : 'sel-val ph'}>{cur ? cur.label : placeholder}</span>
        <ChevronDown size={16} aria-hidden="true" className={open ? 'sel-chev up' : 'sel-chev'} />
      </button>
      {open && (
        <ul id={`${uid}-list`} role="listbox" aria-labelledby={`${uid}-l`} aria-activedescendant={`${uid}-o${active}`} className="sel-list" ref={list} tabIndex={-1}>
          {options.map((o, i) => (
            <li
              key={o.value} id={`${uid}-o${i}`} role="option" aria-selected={i === selected}
              className={`sel-opt ${i === active ? 'on' : ''} ${i === selected ? 'sel' : ''}`}
              onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)}
            >
              <span>{o.label}{o.hint && <small>{o.hint}</small>}</span>
              {i === selected && <Check size={15} aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
