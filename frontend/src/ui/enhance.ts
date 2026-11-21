import { useEffect } from 'react';

/**
 * Upgrades the NATIVE <select> and <input type="date"> controls inside a container to the same accessible custom controls the
 * landing page uses (listbox dropdown, calendar popup). The native element stays in the page (visually hidden, still the source
 * of truth, still part of its form), so every existing page keeps working unchanged: React-controlled fields, the passenger page
 * controller (which sets .value directly) and form validation. A pick writes the native value and fires input + change events.
 *
 * Accessibility: the button gets the accessible name of the native field (aria-labelledby / aria-label / its <label>), the popup is a
 * listbox with aria-activedescendant (or a dialog with a day grid), and everything works with the keyboard
 * (arrows, Home/End, Enter/Space, Escape, type-ahead; PageUp/PageDown in the calendar).
 */

const MARK = 'data-enh';
let uid = 0;
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  return e;
}

function hideNative(native: HTMLElement) {
  native.setAttribute(MARK, '1');
  native.setAttribute('tabindex', '-1');
  native.setAttribute('aria-hidden', 'true');
  native.classList.add('enh-native');
}

/** accessible name of the native control, reused for the custom button */
function nameOf(native: HTMLElement): { labelledby?: string; label?: string } {
  const lb = native.getAttribute('aria-labelledby');
  if (lb) return { labelledby: lb };
  const al = native.getAttribute('aria-label');
  if (al) return { label: al };
  if (native.id) {
    const lab = document.querySelector(`label[for="${CSS.escape(native.id)}"]`) as HTMLElement | null;
    if (lab && lab.textContent?.trim()) { if (!lab.id) lab.id = `enh-l-${++uid}`; return { labelledby: lab.id }; }
  }
  const wrap = native.closest('label');
  if (wrap) {
    if (!wrap.id) wrap.id = `enh-l-${++uid}`;
    return { labelledby: wrap.id };
  }
  return { label: native.getAttribute('title') || 'Choose' };
}

/** the label text of a field, without the controls inside a wrapping label */
function labelTextOf(nm: { labelledby?: string; label?: string }): string {
  if (nm.label) return nm.label;
  const ids = (nm.labelledby || '').split(/\s+/).filter(Boolean);
  return ids.map((id) => {
    const e = document.getElementById(id);
    if (!e) return '';
    const c = e.cloneNode(true) as HTMLElement;
    c.querySelectorAll('.sel, select, input, button, ul, [aria-hidden="true"]').forEach((n) => n.remove());
    return (c.textContent || '').replace(/\s+/g, ' ').trim();
  }).join(' ').trim();
}

function place(pop: HTMLElement, anchor: HTMLElement, minW = 0) {
  const r = anchor.getBoundingClientRect();
  const w = Math.max(r.width, minW);
  pop.style.width = `${w}px`;
  pop.style.left = `${Math.min(Math.max(8, r.left), window.innerWidth - w - 8)}px`;
  const below = window.innerHeight - r.bottom;
  const h = pop.offsetHeight || 260;
  if (below < h + 12 && r.top > below) { pop.style.top = ''; pop.style.bottom = `${window.innerHeight - r.top + 6}px`; }
  else { pop.style.bottom = ''; pop.style.top = `${r.bottom + 6}px`; }
}

/* ───────────────────────────── select ───────────────────────────── */
function enhanceSelect(native: HTMLSelectElement) {
  hideNative(native);
  const id = `enh-${++uid}`;
  const wrap = el('div', 'sel enh');
  const btn = el('button', 'sel-btn rrms-input', { type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' });
  const txt = el('span', 'sel-val', { id: `${id}-t` });
  const chev = el('span', 'sel-chev enh-chev', { 'aria-hidden': 'true' });
  chev.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  btn.append(txt, chev);
  wrap.append(btn);
  native.parentElement?.insertBefore(wrap, native);

  const nm = nameOf(native);
  const lbl = labelTextOf(nm) || 'Choose';

  let pop: HTMLUListElement | null = null;
  let active = 0;
  let typed = { s: '', t: 0 };

  const opts = () => Array.from(native.options);
  const sync = () => {
    const o = native.selectedOptions[0] || native.options[native.selectedIndex];
    const t = o ? o.textContent || '' : '';
    if (txt.textContent !== t) txt.textContent = t || ' ';
    txt.classList.toggle('ph', !o || o.value === '');
    const nameNow = `${lbl}: ${t.trim() || 'none'}`;
    if (btn.getAttribute('aria-label') !== nameNow) btn.setAttribute('aria-label', nameNow);
    if (btn.disabled !== native.disabled) btn.disabled = native.disabled;
    wrap.hidden = native.hidden;
    btn.style.display = '';
  };
  const close = () => {
    if (!pop) return;
    pop.remove(); pop = null;
    btn.setAttribute('aria-expanded', 'false');
    btn.removeAttribute('aria-controls');
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', close);
    document.removeEventListener('mousedown', onDown, true);
  };
  const onScroll = (e: Event) => { if (pop && e.target instanceof Node && pop.contains(e.target)) return; close(); };
  const onDown = (e: MouseEvent) => { if (e.target instanceof Node && !wrap.contains(e.target) && !(pop && pop.contains(e.target))) close(); };
  const paint = () => {
    if (!pop) return;
    Array.from(pop.children).forEach((li, i) => {
      li.classList.toggle('on', i === active);
      li.setAttribute('aria-selected', String(i === native.selectedIndex));
      li.classList.toggle('sel', i === native.selectedIndex);
    });
    pop.setAttribute('aria-activedescendant', `${id}-o${active}`);
    (pop.children[active] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  };
  const pick = (i: number) => {
    const o = opts()[i];
    if (o && !o.disabled) {
      native.selectedIndex = i;
      native.dispatchEvent(new Event('input', { bubbles: true }));
      native.dispatchEvent(new Event('change', { bubbles: true }));
    }
    close(); sync(); btn.focus();
  };
  const open = () => {
    if (pop || btn.disabled) return;
    sync();
    pop = el('ul', 'sel-list enh-pop', { role: 'listbox', id: `${id}-list`, tabindex: '-1' });
    pop.setAttribute('aria-label', lbl);
    opts().forEach((o, i) => {
      const li = el('li', 'sel-opt', { role: 'option', id: `${id}-o${i}` });
      const span = el('span'); span.textContent = o.textContent || '';
      li.append(span);
      if (o.disabled) li.setAttribute('aria-disabled', 'true');
      li.addEventListener('mouseenter', () => { active = i; paint(); });
      li.addEventListener('mousedown', (e) => e.preventDefault());
      li.addEventListener('click', () => pick(i));
      pop!.append(li);
    });
    document.body.append(pop);
    active = Math.max(0, native.selectedIndex);
    place(pop, btn, 200);
    paint();
    btn.setAttribute('aria-expanded', 'true');
    btn.setAttribute('aria-controls', `${id}-list`);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    document.addEventListener('mousedown', onDown, true);
  };

  btn.addEventListener('click', () => (pop ? close() : open()));
  btn.addEventListener('keydown', (e) => {
    if (!pop) { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(); } return; }
    const n = opts().length;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(n - 1, active + 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); paint(); }
    else if (e.key === 'Home') { e.preventDefault(); active = 0; paint(); }
    else if (e.key === 'End') { e.preventDefault(); active = n - 1; paint(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(active); }
    else if (e.key === 'Tab') close();
    else if (e.key.length === 1) {
      const now = Date.now();
      typed = { s: now - typed.t > 700 ? e.key.toLowerCase() : typed.s + e.key.toLowerCase(), t: now };
      const hit = opts().findIndex((o) => (o.textContent || '').toLowerCase().startsWith(typed.s));
      if (hit >= 0) { active = hit; paint(); }
    }
  });
  native.addEventListener('change', sync);
  // a label click should focus the custom button
  native.addEventListener('focus', () => btn.focus());
  sync();
  (wrap as any).__sync = sync;
  (wrap as any).__native = native;
}

/* ───────────────────────────── date ───────────────────────────── */
function enhanceDate(native: HTMLInputElement) {
  hideNative(native);
  const id = `enh-${++uid}`;
  const wrap = el('div', 'sel enh');
  const btn = el('button', 'sel-btn rrms-input', { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' });
  const txt = el('span', 'sel-val', { id: `${id}-t` });
  const chev = el('span', 'sel-chev enh-chev', { 'aria-hidden': 'true' });
  chev.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';
  btn.append(txt, chev);
  wrap.append(btn);
  native.parentElement?.insertBefore(wrap, native);
  const nm = nameOf(native);
  const lbl = labelTextOf(nm) || 'Date';

  let pop: HTMLDivElement | null = null;
  let focus = new Date();
  let gridEl: HTMLDivElement | null = null;

  const sync = () => {
    const t = native.value ? parse(native.value).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'Pick a date';
    if (txt.textContent !== t) txt.textContent = t;
    txt.classList.toggle('ph', !native.value);
    const nameNow = `${lbl}: ${t}`;
    if (btn.getAttribute('aria-label') !== nameNow) btn.setAttribute('aria-label', nameNow);
    if (btn.disabled !== native.disabled) btn.disabled = native.disabled;
    wrap.hidden = native.hidden;
  };
  const dis = (d: Date) => { const s = iso(d); return (!!native.min && s < native.min) || (!!native.max && s > native.max); };
  const close = () => {
    if (!pop) return;
    pop.remove(); pop = null; gridEl = null;
    btn.setAttribute('aria-expanded', 'false');
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', close);
    document.removeEventListener('mousedown', onDown, true);
  };
  const onScroll = (e: Event) => { if (pop && e.target instanceof Node && pop.contains(e.target)) return; close(); };
  const onDown = (e: MouseEvent) => { if (e.target instanceof Node && !wrap.contains(e.target) && !(pop && pop.contains(e.target))) close(); };
  const pick = (d: Date) => {
    native.value = iso(d);
    native.dispatchEvent(new Event('input', { bubbles: true }));
    native.dispatchEvent(new Event('change', { bubbles: true }));
    close(); sync(); btn.focus();
  };
  const render = (focusDay = false) => {
    if (!pop) return;
    pop.innerHTML = '';
    const head = el('div', 'dp-head');
    const prev = el('button', 'rrms-icon-btn dp-nav', { type: 'button', 'aria-label': 'Previous month' }); prev.textContent = '‹';
    const next = el('button', 'rrms-icon-btn dp-nav', { type: 'button', 'aria-label': 'Next month' }); next.textContent = '›';
    const title = el('strong', '', { 'aria-live': 'polite' }); title.textContent = `${MONTHS[focus.getMonth()]} ${focus.getFullYear()}`;
    prev.onclick = () => { focus = new Date(focus.getFullYear(), focus.getMonth() - 1, 1); render(); };
    next.onclick = () => { focus = new Date(focus.getFullYear(), focus.getMonth() + 1, 1); render(); };
    head.append(prev, title, next);
    const grid = el('div', 'dp-grid', { role: 'grid', 'aria-label': `${MONTHS[focus.getMonth()]} ${focus.getFullYear()}` });
    gridEl = grid;
    DOW.forEach((d) => { const s = el('span', 'dp-dow', { role: 'columnheader' }); s.textContent = d; grid.append(s); });
    const first = new Date(focus.getFullYear(), focus.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    for (let i = 0; i < offset; i++) grid.append(el('span', '', { 'aria-hidden': 'true' }));
    const days = new Date(focus.getFullYear(), focus.getMonth() + 1, 0).getDate();
    const today = iso(new Date());
    for (let n = 1; n <= days; n++) {
      const d = new Date(focus.getFullYear(), focus.getMonth(), n);
      const b = el('button', `dp-day${iso(d) === native.value ? ' sel' : ''}${iso(d) === today ? ' today' : ''}`, { type: 'button', role: 'gridcell', tabindex: iso(d) === iso(focus) ? '0' : '-1', 'aria-selected': String(iso(d) === native.value), 'aria-label': d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) });
      b.textContent = String(n);
      if (dis(d)) b.disabled = true;
      b.onclick = () => pick(d);
      grid.append(b);
    }
    pop.append(head, grid);
    if (focusDay) (grid.querySelector('button[tabindex="0"]') as HTMLElement | null)?.focus();
  };
  const move = (days: number) => { focus = new Date(focus.getFullYear(), focus.getMonth(), focus.getDate() + days); render(true); };
  const open = () => {
    if (pop || btn.disabled) return;
    focus = native.value ? parse(native.value) : new Date();
    if (!native.value && native.min && iso(focus) < native.min) focus = parse(native.min);
    pop = el('div', 'dp enh-pop', { role: 'dialog', 'aria-label': 'Choose a date' });
    pop.addEventListener('keydown', (e) => {
      const map: Record<string, () => void> = {
        ArrowLeft: () => move(-1), ArrowRight: () => move(1), ArrowUp: () => move(-7), ArrowDown: () => move(7),
        PageUp: () => { focus = new Date(focus.getFullYear(), focus.getMonth() - 1, 1); render(true); },
        PageDown: () => { focus = new Date(focus.getFullYear(), focus.getMonth() + 1, 1); render(true); },
      };
      if (e.key === 'Escape') { e.preventDefault(); close(); btn.focus(); }
      else if (map[e.key]) { e.preventDefault(); map[e.key](); }
    });
    document.body.append(pop);
    render(true);
    place(pop, btn, 300);
    btn.setAttribute('aria-expanded', 'true');
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    document.addEventListener('mousedown', onDown, true);
  };
  void gridEl;
  btn.addEventListener('click', () => (pop ? close() : open()));
  btn.addEventListener('keydown', (e) => { if (!pop && ['ArrowDown', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(); } });
  native.addEventListener('change', sync);
  native.addEventListener('focus', () => btn.focus());
  sync();
  (wrap as any).__sync = sync;
}

/** Enhance everything new inside `root`; keep every enhanced control in step with its native element. */
export function enhanceAll(root: Element) {
  root.querySelectorAll<HTMLSelectElement>(`select:not([${MARK}]):not([multiple]):not([size])`).forEach((s) => { if (!s.closest('.sel')) enhanceSelect(s); });
  root.querySelectorAll<HTMLInputElement>(`input[type="date"]:not([${MARK}])`).forEach((i) => { if (!i.closest('.sel')) enhanceDate(i); });
}

export function useEnhanceInputs(rootSelector: string, deps: unknown[]) {
  useEffect(() => {
    const root = document.querySelector(rootSelector);
    if (!root) return;
    let raf = 0;
    const run = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => enhanceAll(root)); };
    run();
    const mo = new MutationObserver(run);
    mo.observe(root, { childList: true, subtree: true });
    // programmatic changes (the passenger page controller sets .value without events): keep the buttons in step
    const tick = window.setInterval(() => {
      root.querySelectorAll<HTMLElement>('.sel.enh').forEach((w) => {
        const sync = (w as any).__sync as (() => void) | undefined;
        sync && sync();
      });
    }, 350);
    return () => { mo.disconnect(); window.clearInterval(tick); cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
