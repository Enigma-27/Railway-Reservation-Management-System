import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, Search, Ticket, Train } from 'lucide-react';
import { getSession } from '../auth/session';
import { ROLE_META } from '../layout/roles';
import { publicApi, TrainSummary } from '../services/publicApi';

export interface Cmd { id: string; label: string; hint?: string; group: string; run: () => void }

interface Ctx { open: () => void; register: (key: string, items: Cmd[]) => () => void }
const CommandContext = createContext<Ctx>({ open: () => {}, register: () => () => {} });
export const useCommandPalette = () => useContext(CommandContext);

/** Register page shortcuts for the palette while a component is on screen. */
export function useCommands(key: string, items: Cmd[]) {
  const { register } = useContext(CommandContext);
  const sig = items.map((i) => i.id).join('|');
  const ref = useRef(items);
  ref.current = items;
  useEffect(() => register(key, ref.current), [register, key, sig]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Where a PNR / train lookup goes for the signed-in role (or the public pages). */
export function pnrTarget(pnr: string): string {
  const s = getSession();
  if (s?.role === 'PASSENGER') return `/passenger/pnr?pnr=${pnr}`;
  if (s?.role === 'STAFF') return `/staff?tab=scanner&pnr=${pnr}`;
  if (s?.role === 'ADMIN') return `/admin/bookings?pnr=${pnr}`;
  return `/train-info?pnr=${pnr}`;
}
export function liveTarget(q: string): string {
  const s = getSession();
  const base = s ? ROLE_META[s.role].live : '/live-trains';
  return `${base}${base.includes('?') ? '&' : '?'}q=${encodeURIComponent(q)}`;
}

/** Ctrl+K (or Cmd+K): jump to a page, search a train by number or name, or look up a PNR. */
export const CommandProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOpen, setOpen] = useState(false);
  const [registry, setRegistry] = useState<Record<string, Cmd[]>>({});
  const open = useCallback(() => setOpen(true), []);
  const register = useCallback((key: string, items: Cmd[]) => {
    setRegistry((r) => ({ ...r, [key]: items }));
    return () => setRegistry((r) => { const n = { ...r }; delete n[key]; return n; });
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);

  const items = useMemo(() => Object.values(registry).flat(), [registry]);
  return (
    <CommandContext.Provider value={{ open, register }}>
      {children}
      {isOpen && <Palette items={items} onClose={() => setOpen(false)} />}
    </CommandContext.Provider>
  );
};

const Palette: React.FC<{ items: Cmd[]; onClose: () => void }> = ({ items, onClose }) => {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [trains, setTrains] = useState<TrainSummary[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(document.activeElement);

  useEffect(() => {
    input.current?.focus();
    publicApi.trains().then(setTrains).catch(() => setTrains([]));
    const prev = opener.current as HTMLElement | null;
    return () => prev?.focus?.();
  }, []);

  const results = useMemo<Cmd[]>(() => {
    const term = q.trim().toLowerCase();
    const out: Cmd[] = [];
    if (/^\d{10}$/.test(term)) out.push({ id: 'pnr', group: 'PNR', label: `Look up PNR ${term}`, hint: 'Ticket status', run: () => { if (getSession()?.role === 'ADMIN') window.dispatchEvent(new Event('rrms:open-pnr')); else navigate(pnrTarget(term)); } });
    if (term.length >= 2) {
      trains
        .filter((t) => t.trainNumber.includes(term) || t.displayName.toLowerCase().includes(term))
        .slice(0, 6)
        .forEach((t) => out.push({ id: `train-${t.trainId}`, group: 'Trains', label: `${t.trainNumber} ${t.displayName.replace(/ \(\d+\)$/, '')}`, hint: 'Live seats', run: () => navigate(liveTarget(t.trainNumber)) }));
    }
    const pages = term ? items.filter((i) => `${i.label} ${i.group}`.toLowerCase().includes(term)) : items;
    return [...out, ...pages.slice(0, 14)];
  }, [q, trains, items, navigate]);

  useEffect(() => setActive(0), [q]);

  const run = (c?: Cmd) => { if (!c) return; onClose(); c.run(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(results[active]); }
    else if (e.key === 'Tab') e.preventDefault();
  };

  let lastGroup = '';
  return createPortal(
    <div className="rrms-modal-backdrop cmdk-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} role="presentation">
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKey}>
        <div className="cmdk-input">
          <Search size={18} aria-hidden="true" />
          <input
            ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Jump to a page, a train number or a 10-digit PNR..."
            role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-activedescendant={results[active] ? `cmdk-${results[active].id}` : undefined} aria-label="Search pages, trains or PNR"
          />
          <kbd>Esc</kbd>
        </div>
        <ul id="cmdk-list" role="listbox" aria-label="Results" className="cmdk-list">
          {results.length === 0 && <li className="cmdk-empty" role="option" aria-selected="false">Nothing found. Try a page name, a train number or a 10-digit PNR.</li>}
          {results.map((r, i) => {
            const head = r.group !== lastGroup ? (lastGroup = r.group) : null;
            return (
              <React.Fragment key={r.id}>
                {head && <li role="presentation" className="cmdk-group">{head}</li>}
                <li id={`cmdk-${r.id}`} role="option" aria-selected={i === active} className={i === active ? 'cmdk-item on' : 'cmdk-item'} onMouseEnter={() => setActive(i)} onClick={() => run(r)}>
                  {r.group === 'Trains' ? <Train size={16} aria-hidden="true" /> : r.group === 'PNR' ? <Ticket size={16} aria-hidden="true" /> : <CornerDownLeft size={16} aria-hidden="true" />}
                  <span>{r.label}</span>
                  {r.hint && <small>{r.hint}</small>}
                </li>
              </React.Fragment>
            );
          })}
        </ul>
        <div className="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Ctrl</kbd>+<kbd>K</kbd> toggle</span></div>
      </div>
    </div>,
    document.body,
  );
};
