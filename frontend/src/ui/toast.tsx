import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';
interface ToastItem { id: number; msg: string; type: ToastType }

/** One toast system for the whole site. Call toast('Saved') from anywhere (React or plain JS). */
export function toast(msg: string, type: ToastType = 'success'): void {
  window.dispatchEvent(new CustomEvent('rrms:toast', { detail: { msg, type } }));
}

const ICON = { success: CheckCircle2, error: AlertCircle, warning: TriangleAlert, info: Info };

/** Rendered once at the top of the app. Toasts stack in the top-right corner and fade away by themselves. */
export const ToastHost: React.FC = () => {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    let n = 0;
    const onToast = (e: Event) => {
      const { msg, type } = (e as CustomEvent).detail as { msg: string; type: ToastType };
      const id = ++n;
      setItems((cur) => [...cur.slice(-3), { id, msg: String(msg), type }]);
      window.setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), type === 'error' ? 6500 : 4200);
    };
    window.addEventListener('rrms:toast', onToast);
    return () => window.removeEventListener('rrms:toast', onToast);
  }, []);

  return (
    <div className="rrms-toast-host" role="region" aria-label="Notifications" aria-live="polite">
      {items.map((t) => {
        const Icon = ICON[t.type] || Info;
        return (
          <div key={t.id} className={`rrms-toast ${t.type}`} role={t.type === 'error' ? 'alert' : 'status'}>
            <Icon size={18} aria-hidden="true" />
            <span>{t.msg}</span>
            <button type="button" aria-label="Dismiss notification" onClick={() => setItems((cur) => cur.filter((x) => x.id !== t.id))}><X size={14} aria-hidden="true" /></button>
          </div>
        );
      })}
    </div>
  );
};
