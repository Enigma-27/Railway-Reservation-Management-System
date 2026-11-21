import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Slide-in drawer (right side) with a backdrop. Escape and a click outside close it, focus is trapped inside
 * and returns to the button that opened it. It is only on screen while open: nothing floats over the page otherwise.
 */
export const Drawer: React.FC<{ open: boolean; onClose: () => void; title: string; children: React.ReactNode; subtitle?: string }> = ({ open, onClose, title, subtitle, children }) => {
  const uid = useId();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => (panel.current?.querySelector('input,textarea,button,a') as HTMLElement | null)?.focus(), 50);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !panel.current) return;
      const f = Array.from(panel.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'));
      if (!f.length) return;
      const a = f[0]; const z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = prev;
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <>
      <div className="rrms-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="rrms-drawer" role="dialog" aria-modal="true" aria-labelledby={`${uid}-t`} ref={panel}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h2 id={`${uid}-t`}>{title}</h2>
            {subtitle && <p style={{ margin: '2px 0 0', color: 'var(--rrms-text-muted)', fontSize: 14 }}>{subtitle}</p>}
          </div>
          <button type="button" className="rrms-icon-btn" onClick={onClose} aria-label={`Close ${title}`}><X size={18} aria-hidden="true" /></button>
        </div>
        {children}
      </div>
    </>,
    document.body,
  );
};
