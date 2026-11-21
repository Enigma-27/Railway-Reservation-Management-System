import { useEffect } from 'react';

let counter = 0;

/**
 * Accessibility safety net for the staff and admin forms: many fields are written as `<label>Text</label><input>` (label as a
 * sibling, not linked). This links such a field to the label that sits right before it (or the placeholder / title as a last
 * resort) so screen readers announce a name. Fields that already have a name are left alone.
 */
function nameField(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) {
  if (el instanceof HTMLInputElement && ['hidden', 'submit', 'button', 'reset', 'image'].includes(el.type)) return;
  if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return;
  if (el.closest('label')) return;
  if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return;

  let label: HTMLElement | null = null;
  let node: Element | null = el;
  for (let depth = 0; depth < 3 && node && !label; depth++) {
    let sib = node.previousElementSibling;
    while (sib && !label) {
      if (sib.tagName === 'LABEL') label = sib as HTMLElement;
      else if (sib.querySelector && !sib.querySelector('input,select,textarea')) {
        const inner = sib.querySelector('label');
        if (inner) label = inner as HTMLElement;
      }
      break;
    }
    if (!label && node.parentElement && node.parentElement.tagName !== 'FORM') {
      const first = node.parentElement.firstElementChild;
      if (first && first !== node && first.tagName === 'LABEL') label = first as HTMLElement;
    }
    node = node.parentElement;
  }

  if (label && label.textContent?.trim()) {
    if (!label.id) label.id = `al-${++counter}`;
    el.setAttribute('aria-labelledby', label.id);
    return;
  }
  const fallback = el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name');
  if (fallback) el.setAttribute('aria-label', fallback);
  else if (el instanceof HTMLInputElement && el.type === 'date') el.setAttribute('aria-label', 'Date');
  else if (el instanceof HTMLInputElement && el.type === 'number') el.setAttribute('aria-label', 'Number');
  else if (el instanceof HTMLSelectElement) el.setAttribute('aria-label', 'Choose an option');
  else el.setAttribute('aria-label', 'Value');
}

export function useAutoLabel(rootSelector: string, deps: unknown[]) {
  useEffect(() => {
    const root = document.querySelector(rootSelector);
    if (!root) return;
    const run = () => {
      root.querySelectorAll<HTMLInputElement>('input,select,textarea').forEach(nameField);
      // scrollable tables / lists must be reachable with the keyboard
      root.querySelectorAll<HTMLElement>('.overflow-x-auto,.overflow-auto,.overflow-y-auto,.info-scroll,.live-scroll,.booking-steps').forEach((el) => {
        if (el.hasAttribute('tabindex') || el.querySelector('a[href],button,input,select,textarea,[tabindex]')) return;
        el.setAttribute('tabindex', '0'); el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Scrollable content');
      });
    };
    run();
    const mo = new MutationObserver(run);
    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
