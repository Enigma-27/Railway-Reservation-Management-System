import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
}

const WIDTH = { sm: 400, md: 480, lg: 560, xl: 680, '2xl': 820 };

/** Animated dialog: Escape closes, focus moves in and returns, Tab stays inside, a click outside closes. */
export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, maxWidth = 'lg' }) => {
  const uid = useId();
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    opener.current = document.activeElement;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => (box.current?.querySelector('input,select,textarea,button.sel-btn') as HTMLElement | null)?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !box.current) return;
      const f = Array.from(box.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]):not([aria-hidden="true"]),textarea:not([disabled]),select:not([disabled]):not([aria-hidden="true"]),[tabindex]:not([tabindex="-1"])'));
      if (!f.length) return;
      const a = f[0]; const z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  return (
    <div className="am-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="am" style={{ maxWidth: WIDTH[maxWidth] }} role="dialog" aria-modal="true" aria-labelledby={`${uid}-t`} ref={box}>
        <div className="am-head">
          <h3 id={`${uid}-t`}>{title}</h3>
          <button type="button" onClick={onClose} className="btn-icon shrink-0" aria-label={`Close ${title}`}>
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <div className="am-body scrollbar-thin">{children}</div>
      </div>
    </div>
  );
};
