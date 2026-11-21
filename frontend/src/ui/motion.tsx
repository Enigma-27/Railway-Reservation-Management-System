import React, { useEffect, useRef, useState } from 'react';

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Fades and lifts its children in when they scroll into view. Never blocks clicks (opacity / transform only). */
export const Reveal: React.FC<{ children: React.ReactNode; delay?: number; className?: string }> = ({ children, delay = 0, className = '' }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') { setShown(true); return; }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setShown(true); io.disconnect(); }
    }, { threshold: 0.1 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className={`reveal ${shown ? 'in' : ''} ${className}`} style={{ ['--d' as any]: `${delay}ms` }}>{children}</div>;
};

/** Counts from 0 up to `value` once it is on screen. A static number when the visitor prefers reduced motion. */
export const CountUp: React.FC<{ value: number; suffix?: string; decimals?: number; duration?: number }> = ({ value, suffix = '', decimals = 0, duration = 1200 }) => {
  const [n, setN] = useState(prefersReducedMotion() ? value : 0);
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useRef(false);
  useEffect(() => {
    if (prefersReducedMotion()) { setN(value); return; }
    let raf = 0;
    let from = 0;
    const run = () => {
      seen.current = true;
      const t0 = performance.now();
      const step = (t: number) => {
        const p = Math.min(1, (t - t0) / duration);
        setN(from + (value - from) * (1 - Math.pow(1 - p, 3)));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    const el = ref.current;
    if (seen.current || !el || typeof IntersectionObserver === 'undefined') { from = n; run(); return () => cancelAnimationFrame(raf); }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); run(); } });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const shown = decimals ? n.toFixed(decimals) : Math.round(n).toLocaleString('en-IN');
  return <span ref={ref}>{shown}{suffix}</span>;
};

/**
 * Typing effect that cycles through `words`. With reduced motion it shows the first word, static.
 * The animated text is aria-hidden; screen readers get the list of words once.
 */
export const Typed: React.FC<{ words: string[] }> = ({ words }) => {
  const [text, setText] = useState(prefersReducedMotion() ? words[0] : '');
  useEffect(() => {
    if (prefersReducedMotion()) return;
    let del = false;
    let pos = 0;
    let idx = 0;
    let timer = 0;
    const tick = () => {
      const w = words[idx];
      if (!del) {
        pos++; setText(w.slice(0, pos));
        if (pos === w.length) { del = true; timer = window.setTimeout(tick, 1700); return; }
      } else {
        pos--; setText(w.slice(0, pos));
        if (pos === 0) { del = false; idx = (idx + 1) % words.length; }
      }
      timer = window.setTimeout(tick, del ? 38 : 85);
    };
    timer = window.setTimeout(tick, 500);
    return () => window.clearTimeout(timer);
  }, [words]);
  return (
    <>
      <span className="sr-only">{words.join(', ')}</span>
      <em aria-hidden="true" className="typed">{text || ' '}<span className="typed-caret" /></em>
    </>
  );
};
